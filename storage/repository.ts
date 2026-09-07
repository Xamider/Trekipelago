import type { ActivityEntry, Orb, SoloSnapshot } from '../game/types';
import { DEFAULT_PREFERENCES, validatePreferences, type AppPreferences } from '../state/preferences';
import type { SqlConnection, SqlDatabase } from './driver';

type StoredSave = Omit<SoloSnapshot, 'orbs' | 'activity'>;
export interface AppSnapshot { save: SoloSnapshot | null; preferences: AppPreferences }

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS solo_save (
    id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orbs (
    id TEXT PRIMARY KEY, save_id INTEGER NOT NULL DEFAULT 1 REFERENCES solo_save(id) ON DELETE CASCADE,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY, save_id INTEGER NOT NULL DEFAULT 1 REFERENCES solo_save(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL
  );
  PRAGMA user_version = 1;
`;

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export function createRepository(open: () => Promise<SqlDatabase>) {
  let ready: Promise<SqlDatabase> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  async function retryLocked<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await operation(); }
      catch (error) {
        if (attempt >= 3 || !/locked|SQLITE_BUSY/i.test(String(error))) throw error;
        await delay(50 * 2 ** attempt);
      }
    }
  }

  function database() {
    if (!ready) {
      ready = (async () => {
        const db = await open();
        await retryLocked(() => db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;'));
        await retryLocked(() => db.withExclusiveTransactionAsync(async tx => {
          const version = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
          if ((version?.user_version ?? 0) > 1) throw new Error('This save needs a newer version of Trekipelago.');
          if (!version?.user_version) await tx.execAsync(SCHEMA);
        }));
        return db;
      })().catch(error => { ready = undefined; throw error; });
    }
    return ready;
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  }

  async function transaction<T>(operation: (tx: SqlConnection) => Promise<T>): Promise<T> {
    const db = await database();
    return retryLocked(async () => {
      let result!: T;
      await db.withExclusiveTransactionAsync(async tx => {
        await tx.execAsync('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
        result = await operation(tx);
      });
      return result;
    });
  }

  async function readSave(tx: SqlConnection): Promise<SoloSnapshot | null> {
    const row = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM solo_save WHERE id = 1');
    if (!row) return null;
    const saved = JSON.parse(row.payload) as StoredSave;
    const orbs = await tx.getAllAsync<{ payload: string }>('SELECT payload FROM orbs ORDER BY rowid');
    const activity = await tx.getAllAsync<{ payload: string }>('SELECT payload FROM activity ORDER BY position');
    return { ...saved, orbs: orbs.map(row => JSON.parse(row.payload) as Orb), activity: activity.map(row => JSON.parse(row.payload) as ActivityEntry) };
  }

  async function writeSave(tx: SqlConnection, previous: SoloSnapshot | null, next: SoloSnapshot) {
    const { orbs, activity, ...saved } = next;
    await tx.runAsync('INSERT INTO solo_save (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload', JSON.stringify(saved));
    const retained = new Set(orbs.map(orb => orb.id));
    const existing = new Set(previous?.orbs.map(orb => orb.id));
    for (const orb of previous?.orbs ?? []) {
      if (!retained.has(orb.id)) await tx.runAsync('DELETE FROM orbs WHERE id = ?', orb.id);
    }
    for (const orb of orbs) {
      if (!existing.has(orb.id)) await tx.runAsync('INSERT INTO orbs (id, payload) VALUES (?, ?)', orb.id, JSON.stringify(orb));
    }
    if (JSON.stringify(previous?.activity) !== JSON.stringify(activity)) {
      await tx.runAsync('DELETE FROM activity');
      for (let index = 0; index < activity.length; index++) {
        const entry = activity[index];
        await tx.runAsync('INSERT INTO activity (id, position, payload) VALUES (?, ?, ?)', entry.id, index, JSON.stringify(entry));
      }
    }
  }

  function notify() {
    for (const listener of listeners) {
      // A view failure must never make a committed transaction look like a failed write.
      try { listener(); } catch (error) { console.error('Save subscriber failed:', error); }
    }
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** A cheap freshness check for cross-runtime polling: skips the orbs/activity tables entirely. */
    peekUpdatedAt(): Promise<number | null> {
      return enqueue(() => transaction(async tx => {
        const row = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM solo_save WHERE id = 1');
        if (!row) return null;
        const saved = JSON.parse(row.payload) as StoredSave;
        return saved.updatedAt;
      }));
    },
    read(): Promise<AppSnapshot> {
      return enqueue(() => transaction(async tx => {
        const save = await readSave(tx);
        const row = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM preferences WHERE id = 1');
        const preferences: AppPreferences = { ...DEFAULT_PREFERENCES, ...(row ? JSON.parse(row.payload) : {}) };
        validatePreferences(preferences);
        return { save, preferences };
      }));
    },
    /** Read, transform, and commit together. Never write a snapshot captured by a screen. */
    update(transform: (current: SoloSnapshot | null) => SoloSnapshot | null): Promise<SoloSnapshot | null> {
      return enqueue(async () => {
        let changed = false;
        const result = await transaction(async tx => {
          const previous = await readSave(tx);
          const next = transform(previous);
          changed = next !== previous;
          if (changed && next) await writeSave(tx, previous, next);
          else if (changed) {
            await tx.runAsync('DELETE FROM orbs');
            await tx.runAsync('DELETE FROM activity');
            await tx.runAsync('DELETE FROM solo_save');
          }
          return next;
        });
        if (changed) notify();
        return result;
      });
    },
    updatePreferences(patch: Partial<AppPreferences>): Promise<void> {
      return enqueue(async () => {
        await transaction(async tx => {
          const row = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM preferences WHERE id = 1');
          const next: AppPreferences = { ...DEFAULT_PREFERENCES, ...(row ? JSON.parse(row.payload) : {}), ...patch };
          validatePreferences(next);
          await tx.runAsync('INSERT INTO preferences (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload', JSON.stringify(next));
        });
        notify();
      });
    },
  };
}

export type SoloRepository = ReturnType<typeof createRepository>;

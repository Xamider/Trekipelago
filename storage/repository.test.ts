import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { applyLocations, collectOrb, createSave, DEFAULT_SOLO_CONFIG, rollSpawn, setTracking } from '../game/engine';
import type { SoloSnapshot } from '../game/types';
import { DEFAULT_PREFERENCES } from '../state/preferences';
import type { SqlConnection, SqlDatabase, SqlValue } from './driver';
import { createRepository } from './repository';

const START = 1_000_000;
const SESSION = 'original';

/** Executes the production SQL in SQLite, including real transaction rollback. */
class NodeSqliteAdapter implements SqlDatabase {
  readonly sqlite = new DatabaseSync(':memory:');
  statementHook: ((sql: string) => void) | undefined;
  beginFailures = 0;
  transactionAttempts = 0;
  rollbacks = 0;
  activeTransactions = 0;
  maxActiveTransactions = 0;

  async execAsync(sql: string): Promise<void> {
    this.statementHook?.(sql);
    this.sqlite.exec(sql);
  }

  async runAsync(sql: string, ...params: SqlValue[]): Promise<unknown> {
    this.statementHook?.(sql);
    return this.sqlite.prepare(sql).run(...params);
  }

  async getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null> {
    this.statementHook?.(sql);
    return (this.sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]> {
    this.statementHook?.(sql);
    return this.sqlite.prepare(sql).all(...params) as T[];
  }

  async withExclusiveTransactionAsync(task: (transaction: SqlConnection) => Promise<void>): Promise<void> {
    this.transactionAttempts++;
    if (this.beginFailures > 0) {
      this.beginFailures--;
      throw new Error('SQLITE_BUSY: database is locked');
    }
    this.sqlite.exec('BEGIN IMMEDIATE');
    this.activeTransactions++;
    this.maxActiveTransactions = Math.max(this.maxActiveTransactions, this.activeTransactions);
    try {
      await task(this);
      this.sqlite.exec('COMMIT');
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      this.rollbacks++;
      throw error;
    } finally {
      this.activeTransactions--;
    }
  }
}

function setup(t: TestContext) {
  const adapter = new NodeSqliteAdapter();
  t.after(() => adapter.sqlite.close());
  const repository = createRepository(async () => adapter);
  return { adapter, repository };
}

function saveWithOrb(session = SESSION, now = START): SoloSnapshot {
  let save = createSave(DEFAULT_SOLO_CONFIG, session, now);
  save = applyLocations(save, session, [{ latitude: 0, longitude: 0, accuracy: 3, timestamp: now }], now);
  return rollSpawn(save, session, now + 10_000, true, () => 0);
}

test('an empty database migrates once and returns default preferences with no save', async t => {
  const { adapter, repository } = setup(t);
  assert.deepEqual(await repository.read(), { save: null, preferences: DEFAULT_PREFERENCES });
  assert.equal(adapter.sqlite.prepare('PRAGMA user_version').get()?.user_version, 1);
  assert.equal(adapter.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM solo_save').get()?.total, 0);
  const reopened = createRepository(async () => adapter);
  assert.deepEqual(await reopened.read(), { save: null, preferences: DEFAULT_PREFERENCES });
});

test('a new repository restores all save fields, uncollected orbs, and ordered activity', async t => {
  const { adapter, repository } = setup(t);
  let save = saveWithOrb();
  save = applyLocations(save, SESSION, [{ latitude: 0, longitude: 0.0001, accuracy: 3, timestamp: START + 15_000 }], START + 15_000);
  await repository.update(() => save);
  const reopened = createRepository(async () => adapter);
  assert.deepEqual((await reopened.read()).save, save);
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM solo_save').get()?.total, 1);
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM orbs').get()?.total, 1);
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM activity').get()?.total, save.activity.length);
});

test('replacement keeps one save, replaces its orbs and history, and preserves preferences', async t => {
  const { adapter, repository } = setup(t);
  const original = saveWithOrb();
  await repository.update(() => original);
  const preferences = { mapStyle: 'satellite' as const, showPOI: false, distanceUnit: 'mi' as const, volume: 0.4 };
  await repository.updatePreferences(preferences);
  const replacement = saveWithOrb('replacement', START + 30_000);
  await repository.update(() => replacement);
  assert.deepEqual(await repository.read(), { save: replacement, preferences: { ...DEFAULT_PREFERENCES, ...preferences } });
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM solo_save').get()?.total, 1);
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM orbs WHERE id = ?').get(original.orbs[0].id)?.total, 0);
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM activity WHERE id = ?').get(original.activity[0].id)?.total, 0);
});

test('a failure after replacing the save and orb rows rolls back the whole replacement', async t => {
  const { adapter, repository } = setup(t);
  const original = saveWithOrb();
  await repository.update(() => original);
  await repository.updatePreferences({ mapStyle: 'topographic' });
  const before = await repository.read();
  let notifications = 0;
  repository.subscribe(() => { notifications++; });
  const replacement = saveWithOrb('replacement', START + 30_000);
  let injected = false;
  adapter.statementHook = sql => {
    if (!injected && sql.startsWith('INSERT INTO activity')) {
      injected = true;
      throw new Error('Injected disk write failure');
    }
  };
  await assert.rejects(repository.update(() => replacement), /Injected disk write failure/);
  adapter.statementHook = undefined;
  assert.equal(injected, true, 'Fault occurs after the main save and orbs have already been written');
  assert.deepEqual(await repository.read(), before);
  assert.equal(adapter.rollbacks, 1);
  assert.equal(notifications, 0, 'Observers must not see an uncommitted replacement');
  await repository.update(() => replacement);
  assert.deepEqual((await repository.read()).save, replacement, 'A rejected write must not poison the command queue');
});

test('a failure during collection restores both the orb and collection count', async t => {
  const { adapter, repository } = setup(t);
  const original = saveWithOrb();
  await repository.update(() => original);
  adapter.statementHook = sql => {
    if (sql.startsWith('DELETE FROM activity')) throw new Error('Disk full');
  };
  await assert.rejects(repository.update(save => collectOrb(save!, SESSION, original.orbs[0].id, START + 11_000)), /Disk full/);
  adapter.statementHook = undefined;
  assert.deepEqual((await repository.read()).save, original);
});

test('concurrent movement and duplicate collection commands compose from committed state', async t => {
  const { adapter, repository } = setup(t);
  const original = saveWithOrb();
  await repository.update(() => original);
  const orbId = original.orbs[0].id;
  await Promise.all([
    repository.update(save => applyLocations(save!, SESSION, [{ latitude: 0, longitude: 0.0001, accuracy: 3, timestamp: START + 15_000 }], START + 15_000)),
    repository.update(save => collectOrb(save!, SESSION, orbId, START + 16_000)),
    repository.update(save => collectOrb(save!, SESSION, orbId, START + 16_001)),
  ]);
  const saved = (await repository.read()).save!;
  assert.ok(saved.distanceMeters > 11 && saved.distanceMeters < 12);
  assert.equal(saved.collectedCount, 1);
  assert.equal(saved.orbs.length, 0);
  assert.equal(saved.activity.filter(entry => entry.kind === 'collection').length, 1);
  assert.equal(adapter.maxActiveTransactions, 1);
});

test('old session callbacks cannot alter a replacement persisted ahead of them', async t => {
  const { repository } = setup(t);
  const original = saveWithOrb();
  await repository.update(() => original);
  const replacement = saveWithOrb('replacement', START + 20_000);
  await Promise.all([
    repository.update(() => replacement),
    repository.update(save => applyLocations(save!, SESSION, [{ latitude: 0, longitude: 0.0002, accuracy: 3, timestamp: START + 35_000 }], START + 35_000)),
    repository.update(save => collectOrb(save!, SESSION, original.orbs[0].id, START + 35_000)),
    repository.update(save => rollSpawn(save!, SESSION, START + 35_000, true, () => { throw new Error('Old session must not roll'); })),
  ]);
  assert.deepEqual((await repository.read()).save, replacement);
});

test('deleting the save removes dependent rows but retains app preferences', async t => {
  const { adapter, repository } = setup(t);
  await repository.update(() => saveWithOrb());
  await repository.updatePreferences({ soundEffects: false, distanceUnit: 'mi' });
  await repository.update(() => null);
  assert.deepEqual(await repository.read(), { save: null, preferences: { ...DEFAULT_PREFERENCES, soundEffects: false, distanceUnit: 'mi' } });
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM orbs').get()?.total, 0);
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM activity').get()?.total, 0);
});

test('concurrent preference patches retain each other and invalid patches do not persist', async t => {
  const { repository } = setup(t);
  await Promise.all([
    repository.updatePreferences({ volume: 0.2 }),
    repository.updatePreferences({ showPOI: false }),
    repository.updatePreferences({ distanceUnit: 'mi' }),
  ]);
  const before = await repository.read();
  assert.deepEqual(before.preferences, { ...DEFAULT_PREFERENCES, volume: 0.2, showPOI: false, distanceUnit: 'mi' });
  await assert.rejects(repository.updatePreferences({ volume: NaN }), /Invalid app preferences/);
  assert.deepEqual(await repository.read(), before);
});

test('persisted activity stays bounded and restores its original order', async t => {
  const { adapter, repository } = setup(t);
  let save = saveWithOrb();
  for (let index = 0; index < 120; index++) save = setTracking(save, index % 2 === 0, `session-${index}`, START + 20_000 + index);
  await repository.update(() => save);
  const restored = (await createRepository(async () => adapter).read()).save!;
  assert.equal(restored.activity.length, 100);
  assert.deepEqual(restored.activity, save.activity);
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM activity').get()?.total, 100);
});

test('transient begin locks retry up to three times and eventually commit once', async t => {
  const { adapter, repository } = setup(t);
  await repository.read();
  const attemptsBefore = adapter.transactionAttempts;
  adapter.beginFailures = 3;
  let transforms = 0;
  let notifications = 0;
  repository.subscribe(() => { notifications++; });
  await repository.update(() => { transforms++; return saveWithOrb(); });
  assert.equal(adapter.transactionAttempts - attemptsBefore, 4);
  assert.equal(transforms, 1);
  assert.equal(notifications, 1);
  assert.equal((await repository.read()).save?.orbs.length, 1);
});

test('persistent locks fail after four attempts and the next command can recover', async t => {
  const { adapter, repository } = setup(t);
  await repository.read();
  const attemptsBefore = adapter.transactionAttempts;
  adapter.beginFailures = 10;
  await assert.rejects(repository.update(() => saveWithOrb()), /SQLITE_BUSY/);
  assert.equal(adapter.transactionAttempts - attemptsBefore, 4);
  adapter.beginFailures = 0;
  assert.equal((await repository.read()).save, null);
  await repository.update(() => saveWithOrb());
  assert.equal((await repository.read()).save?.sessionId, SESSION);
});

test('a lock halfway through writing rolls back before retrying the entire transaction', async t => {
  const { adapter, repository } = setup(t);
  const original = saveWithOrb();
  await repository.update(() => original);
  let injected = false;
  adapter.statementHook = sql => {
    if (!injected && sql.startsWith('INSERT INTO activity')) {
      injected = true;
      throw new Error('SQLITE_BUSY: database is locked');
    }
  };
  const replacement = saveWithOrb('replacement', START + 30_000);
  let transforms = 0;
  let notifications = 0;
  repository.subscribe(() => { notifications++; });
  await repository.update(current => {
    transforms++;
    assert.deepEqual(current, original, 'Retry must read the original state restored by rollback');
    return replacement;
  });
  assert.equal(transforms, 2);
  assert.equal(adapter.rollbacks, 1);
  assert.equal(notifications, 1);
  assert.deepEqual((await repository.read()).save, replacement);
});

test('non-lock write errors are returned immediately without retrying the transform', async t => {
  const { adapter, repository } = setup(t);
  await repository.read();
  const attemptsBefore = adapter.transactionAttempts;
  adapter.statementHook = sql => { if (sql.startsWith('INSERT INTO solo_save')) throw new Error('Disk full'); };
  let transforms = 0;
  await assert.rejects(repository.update(() => { transforms++; return saveWithOrb(); }), /Disk full/);
  assert.equal(transforms, 1);
  assert.equal(adapter.transactionAttempts - attemptsBefore, 1);
});

test('newer save schemas are refused without modifying their version', async t => {
  const { adapter, repository } = setup(t);
  adapter.sqlite.exec('PRAGMA user_version = 2');
  await assert.rejects(repository.read(), /newer version of Trekipelago/);
  assert.equal(adapter.sqlite.prepare('PRAGMA user_version').get()?.user_version, 2);
});

test('database initialization can recover from an initial open failure', async t => {
  const adapter = new NodeSqliteAdapter();
  t.after(() => adapter.sqlite.close());
  let attempts = 0;
  const repository = createRepository(async () => {
    if (++attempts === 1) throw new Error('Storage unavailable');
    return adapter;
  });
  await assert.rejects(repository.read(), /Storage unavailable/);
  assert.deepEqual(await repository.read(), { save: null, preferences: DEFAULT_PREFERENCES });
  assert.equal(attempts, 2);
});

test('subscribers see commits, no-op updates stay silent, and unsubscribe removes listeners', async t => {
  const { repository } = setup(t);
  let notifications = 0;
  const unsubscribe = repository.subscribe(() => { notifications++; });
  await repository.update(() => saveWithOrb());
  assert.equal(notifications, 1);
  await repository.update(save => save);
  assert.equal(notifications, 1);
  unsubscribe();
  await repository.updatePreferences({ volume: 0.3 });
  assert.equal(notifications, 1);
});

test('a broken observer cannot make a committed save report a storage failure', async t => {
  const { repository } = setup(t);
  repository.subscribe(() => { throw new Error('Observer render failed'); });
  let healthyNotifications = 0;
  repository.subscribe(() => { healthyNotifications++; });
  await assert.doesNotReject(repository.update(() => saveWithOrb()));
  assert.equal((await repository.read()).save?.sessionId, SESSION);
  assert.equal(healthyNotifications, 1, 'One broken observer must not suppress the remaining observers');
});

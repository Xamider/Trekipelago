import { generateDefenseLevel } from '../game/towerDefense';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { beginTreasureChallenge, completeDefenseChallenge, completeTreasureChallenge, treasureProgress, getTreasureReward, isTreasureAvailable, removeTreasureBox, collectTreasureBox, spawnTreasures, applyLocations, collectOrb, createSave, DEFAULT_SOLO_CONFIG, rollSpawn, setTracking } from '../game/engine';
import type { SoloSnapshot } from '../game/types';
import { DEFAULT_PREFERENCES } from '../state/preferences';
import type { SqlConnection, SqlDatabase, SqlValue } from './driver';
import { createRepository } from './repository';
import { TREASURE_HISTORY_LIMIT } from '../game/engine';

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
  let rollIndex = 0;
  return rollSpawn(save, session, now + 10_000, true, () => {
    rollIndex++;
    return rollIndex <= 3 ? 0 : 0.99;
  });
}

test('an empty database migrates once and returns default preferences with no save', async t => {
  const { adapter, repository } = setup(t);
  assert.deepEqual(await repository.read(), { save: null, preferences: DEFAULT_PREFERENCES });
  assert.equal(adapter.sqlite.prepare('PRAGMA user_version').get()?.user_version, 2);
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
  adapter.sqlite.exec('PRAGMA user_version = 3');
  await assert.rejects(repository.read(), /newer version of Trekipelago/);
  assert.equal(adapter.sqlite.prepare('PRAGMA user_version').get()?.user_version, 3);
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

test('Archipelago state saves configuration, checks, received items, and restores correctly', async t => {
  const { repository } = setup(t);

  // Initial read should have null archipelago state
  const initial = await repository.readArchipelagoState();
  assert.equal(initial, null);

  // Save Archipelago config
  await repository.saveArchipelagoConfig({
    host: 'archipelago.gg',
    port: '38290',
    slotName: 'Explorer1',
    password: 'secret',
  });

  const state1 = await repository.readArchipelagoState();
  assert.equal(state1?.config.host, 'archipelago.gg');
  assert.equal(state1?.config.slotName, 'Explorer1');
  assert.equal(state1?.config.password, 'secret');
  assert.equal(state1?.checkedLocations.length, 0);

  // Record checked locations
  await repository.recordArchipelagoLocationChecks([7740001, 7740002]);
  await repository.recordArchipelagoLocationChecks([7740002, 7740003]); // Duplicate 7740002 should not be added twice

  const state2 = await repository.readArchipelagoState();
  assert.deepEqual(state2?.checkedLocations, [7740001, 7740002, 7740003]);

  // Record received items
  await repository.recordArchipelagoReceivedItems(
    [
      { item: 7730001, location: 7740001, player: 1, flags: 1 },
      { item: 7730002, location: 7740002, player: 1, flags: 1 },
    ],
    2,
  );

  const state3 = await repository.readArchipelagoState();
  assert.equal(state3?.receivedItems.length, 2);
  assert.equal(state3?.receivedItemIndex, 2);
  assert.equal(state3?.receivedItems[0].item, 7730001);

  // AppSnapshot read() also includes the full archipelago state when present
  const snapshot = await repository.read();
  assert.equal(snapshot.archipelago?.config.slotName, 'Explorer1');
  assert.equal(snapshot.archipelago?.receivedItems.length, 2);
});


test('treasure collection, history, deadline and replacement survive reopening atomically', async t => {
  const { adapter, repository } = setup(t);
  const original = spawnTreasures(saveWithOrb(), SESSION, START + 10_000, () => 0);
  await repository.update(() => original);
  await Promise.all([0, 1].map(() => repository.update(save => collectTreasureBox(save!, SESSION, original.treasures[0].id, START + 10_000, () => 0))));
  const saved = (await createRepository(async () => adapter).read()).save!;
  assert.equal(saved.treasures.filter(box => box.collectedAt !== undefined).length, 1);
  assert.equal(saved.effects.length, 1);
  assert.equal(saved.effects[0].expiresAt, START + 10_000 + 15 * 60_000);
  assert.equal(saved.nextTreasureSpawnAt, original.nextTreasureSpawnAt);
  adapter.statementHook = sql => { if (sql.startsWith('INSERT INTO treasures')) throw new Error('treasure write failed'); };
  await assert.rejects(repository.update(save => collectTreasureBox(save!, SESSION, original.treasures[1].id, START + 10_000, () => 0)), /treasure write failed/);
  adapter.statementHook = undefined;
  assert.deepEqual((await repository.read()).save, saved);
  await repository.update(save => collectTreasureBox(save!, SESSION, original.treasures[1].id, START + 10_000, () => 0));
  assert.equal((await repository.read()).save!.treasures.length, 4);
  await repository.update(() => createSave(DEFAULT_SOLO_CONFIG, 'replacement', START + 20_000));
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM treasures').get()?.total, 0);
});

test('version 1 saves gain an initial pending treasure batch without losing journey data', async t => {
  const { adapter, repository } = setup(t);
  const old = saveWithOrb();
  await repository.update(() => old);
  const { treasures, nextTreasureSpawnAt, treasureBatchSequence, ...legacy } = old;
  delete legacy.config.treasureSpawnIntervalMinutes;
  adapter.sqlite.prepare('UPDATE solo_save SET payload = ?').run(JSON.stringify(legacy));
  adapter.sqlite.exec('DROP TABLE treasures; PRAGMA user_version = 1');
  const migrated = (await createRepository(async () => adapter).read()).save!;
  assert.deepEqual(migrated.treasures, []);
  assert.equal(migrated.config.treasureSpawnIntervalMinutes, 30);
  assert.equal(migrated.nextTreasureSpawnAt, old.createdAt);
  assert.equal(migrated.distanceMeters, old.distanceMeters);
  assert.equal(spawnTreasures(migrated, SESSION, START + 10_000, () => 0).treasures.length, 2);
});


test('removed treasures and refill blocking persist with their fixed rewards', async t => {
  const { adapter, repository } = setup(t);
  const original = spawnTreasures(saveWithOrb(), SESSION, START + 10000, () => 0);
  await repository.update(() => original);
  const [removed, remaining] = original.treasures;
  await repository.update(save => removeTreasureBox(save!, SESSION, removed.id, START + 10001));
  const reopened = createRepository(async () => adapter);
  const saved = (await reopened.read()).save!;
  assert.equal(saved.treasureRefillBlocked, true);
  assert.equal(saved.treasures[0].removedAt, START + 10001);
  assert.deepEqual(getTreasureReward(saved.treasures[1]), getTreasureReward(remaining));
  await reopened.update(save => collectTreasureBox(save!, SESSION, remaining.id, START + 10002, () => 0));
  const cleared = (await reopened.read()).save!;
  assert.equal(cleared.treasures.filter(isTreasureAvailable).length, 0);
  assert.equal(cleared.nextTreasureSpawnAt, original.nextTreasureSpawnAt);
});


test('labyrinth and reward limit survive reload and concurrent completion grants only once', async t => {
  const { adapter, repository } = setup(t);
  const original = spawnTreasures(saveWithOrb(), SESSION, START + 10000, () => 0);
  original.config.maxTreasureRewards = 1;
  await repository.update(() => beginTreasureChallenge(original, SESSION, original.treasures[0].id, START + 10000, () => 0));
  const reopened = createRepository(async () => adapter);
  const restored = (await reopened.read()).save!;
  const challenge = restored.treasureChallenge!;
  assert.ok(challenge);
  assert.ok(challenge.kind !== 'tower_defense');
  assert.equal(restored.config.maxTreasureRewards, 1);
  const queue = [[0]];
  const visited = new Set([0]);
  let solution: number[] = [];
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    const last = path[path.length - 1];
    if (last === challenge.maze.size ** 2 - 1) { solution = path; break; }
    for (const next of challenge.maze.passages[last]) {
      if (!visited.has(next)) { visited.add(next); queue.push([...path, next]); }
    }
  }
  assert.ok(solution.length > 1);
  await Promise.all([0, 1].map(() => reopened.update(save => completeTreasureChallenge(save!, SESSION, challenge.id, solution, START + 10000, () => 0))));
  const completed = (await repository.read()).save!;
  assert.deepEqual(treasureProgress(completed), { collected: 1, rewarded: 1, limit: 1 });
  assert.equal(completed.effects[0].expiresAt, START + 10000 + 15 * 60000);
  assert.equal(completed.treasureChallenge, null);
});


test('tower defense persists its generated level and atomically awards one victory', async t => {
  const { adapter, repository } = setup(t);
  let original = spawnTreasures(saveWithOrb(), SESSION, START + 10000, () => 0);
  let seed = 2;
  original.treasures[0].minigame = { kind: 'tower_defense', defense: generateDefenseLevel(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }) };
  original = beginTreasureChallenge(original, SESSION, original.treasures[0].id, START + 10000, () => 0);
  await repository.update(() => original);
  const reopened = createRepository(async () => adapter);
  const restored = (await reopened.read()).save!;
  const challenge = restored.treasureChallenge!;
  assert.ok(challenge.kind === 'tower_defense');
  assert.deepEqual(challenge, original.treasureChallenge);
  const towers = [59, 3].map(cell => ({ cell, type: 'sniper' as const }));
  adapter.statementHook = sql => { if (sql.startsWith('INSERT INTO treasures')) throw new Error('defense collection failed'); };
  await assert.rejects(reopened.update(save => completeDefenseChallenge(save!, SESSION, challenge.id, towers, START + 10000, () => 0)), /defense collection failed/);
  adapter.statementHook = undefined;
  assert.deepEqual((await reopened.read()).save, restored);
  await Promise.all([0, 1].map(() => reopened.update(save => completeDefenseChallenge(save!, SESSION, challenge.id, towers, START + 10000, () => 0))));
  const completed = (await repository.read()).save!;
  assert.equal(treasureProgress(completed).collected, 1);
  assert.equal(treasureProgress(completed).rewarded, 1);
  assert.equal(completed.treasureChallenge, null);
});


test('legacy boxes receive persisted minigames once and preserve an active challenge layout', async t => {
  const { adapter, repository } = setup(t);
  const original = spawnTreasures(saveWithOrb(), SESSION, START + 10000, () => 0);
  const started = beginTreasureChallenge(original, SESSION, original.treasures[0].id, START + 10000, () => 0);
  await repository.update(() => started);
  for (const box of started.treasures) {
    const { minigame, ...legacy } = box;
    adapter.sqlite.prepare('UPDATE treasures SET payload = ? WHERE id = ?').run(JSON.stringify(legacy), box.id);
  }
  const restored = (await createRepository(async () => adapter).read()).save!;
  const active = restored.treasureChallenge!;
  assert.ok(active.kind !== 'tower_defense');
  assert.deepEqual(restored.treasures[0].minigame, { kind: 'maze', maze: active.maze });
  assert.ok(restored.treasures[1].minigame);
  for (const box of restored.treasures) {
    const stored = adapter.sqlite.prepare('SELECT payload FROM treasures WHERE id = ?').get(box.id) as { payload: string };
    assert.deepEqual(JSON.parse(stored.payload).minigame, box.minigame);
  }
  assert.deepEqual((await repository.read()).save!.treasures, restored.treasures);
});

test('treasure diffing ignores key order and unchanged layouts but persists real changes', async t => {
  const { adapter, repository } = setup(t);
  const original = spawnTreasures(saveWithOrb(), SESSION, START + 10000, () => 0);
  await repository.update(() => original);
  let treasureWrites = 0;
  adapter.statementHook = sql => { if (sql.startsWith('INSERT INTO treasures')) treasureWrites++; };
  await repository.update(save => ({ ...save!, distanceMeters: 5 }));
  await repository.update(save => ({ ...save!, treasures: save!.treasures.map(box =>
    JSON.parse(JSON.stringify(box), (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value)) }));
  assert.equal(treasureWrites, 0, 'GPS updates and rebuilt equal objects must not rewrite treasure layouts');
  await repository.update(save => ({ ...save!, treasures: save!.treasures.map((box, index) => index ? box
    : { ...box, reward: { type: 'speed_up', durationMs: 123000 } }) }));
  assert.equal(treasureWrites, 1);
  await repository.update(save => ({ ...save!, treasures: save!.treasures.map((box, index) => index ? box
    : { ...box, minigame: { kind: 'tower_defense', defense: generateDefenseLevel(() => 0.9) } }) }));
  assert.equal(treasureWrites, 2);
  await repository.update(save => removeTreasureBox(save!, SESSION, original.treasures[0].id, START + 10001));
  assert.equal(treasureWrites, 3);
  const restored = (await createRepository(async () => adapter).read()).save!;
  assert.deepEqual(restored.treasures[0].reward, { type: 'speed_up', durationMs: 123000 });
  assert.equal(restored.treasures[0].minigame?.kind, 'tower_defense');
  assert.equal(restored.treasures[0].removedAt, START + 10001);
});

test('legacy history compaction persists counters and row deletions atomically across reloads', async t => {
  const { adapter, repository } = setup(t);
  const original = spawnTreasures(saveWithOrb(), SESSION, START + 10000, () => 0);
  await repository.update(() => original);
  for (let i = 0; i < 120; i++) {
    const box = { ...original.treasures[0], id: `legacy-${i}`,
      ...(i % 3 === 0 ? { removedAt: START + i }
        : { collectedAt: START + i, ...(i % 3 === 1 ? { rewardGranted: false } : {}) }) };
    adapter.sqlite.prepare('INSERT INTO treasures (id, payload) VALUES (?, ?)').run(box.id, JSON.stringify(box));
  }
  const rootBefore = adapter.sqlite.prepare('SELECT payload FROM solo_save').get();
  adapter.statementHook = sql => { if (sql.startsWith('DELETE FROM treasures')) throw new Error('Pruning failed'); };
  await assert.rejects(repository.read(), /Pruning failed/);
  adapter.statementHook = undefined;
  assert.deepEqual(adapter.sqlite.prepare('SELECT payload FROM solo_save').get(), rootBefore);
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM treasures').get()?.total, 122);

  const migrated = (await repository.read()).save!;
  assert.equal(migrated.treasures.length, TREASURE_HISTORY_LIMIT + 2);
  assert.deepEqual(treasureProgress(migrated), { collected: 80, rewarded: 40, limit: 10 });
  assert.deepEqual(migrated.treasures.filter(isTreasureAvailable), original.treasures);
  assert.equal(migrated.nextTreasureSpawnAt, original.nextTreasureSpawnAt);
  assert.equal(adapter.sqlite.prepare('SELECT COUNT(*) AS total FROM treasures').get()?.total, TREASURE_HISTORY_LIMIT + 2);
  const reopened = createRepository(async () => adapter);
  assert.deepEqual((await reopened.read()).save, migrated, 'Reloading cannot archive the same boxes twice');
  const next = await reopened.update(save => collectTreasureBox(save!, SESSION, original.treasures[0].id, START + 10001));
  assert.deepEqual(treasureProgress(next!), { collected: 81, rewarded: 40, limit: 10 });
  assert.deepEqual(next!.effects, [], 'Archived rewards must still count against the item cap');
  assert.deepEqual((await repository.read()).save, next);
  await repository.update(() => createSave(DEFAULT_SOLO_CONFIG, 'new-session', START + 20000));
  assert.deepEqual(treasureProgress((await repository.read()).save!), { collected: 0, rewarded: 0, limit: 10 });
});

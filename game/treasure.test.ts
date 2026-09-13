import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginTreasureChallenge, getTreasureMinigame, getTreasureReward, isTreasureAvailable, removeTreasureBox, collectTreasureBox, createSave, DEFAULT_SOLO_CONFIG, distanceBetween, processLocations, TREASURE_TEST_RADIUS_METERS, TREASURE_DESTINATION_RADIUS_METERS, sampleTreasureDistance, setTracking, spawnTreasures, validateConfig } from './engine';
import { compactTreasureHistory, treasureProgress, TREASURE_HISTORY_LIMIT } from './engine';

const START = 1_000_000;
const SESSION = 'treasure-test';
const fix = (timestamp = START, longitude = 0) => ({ latitude: 0, longitude, accuracy: 3, timestamp });
const fresh = (random = () => 0) => processLocations(createSave(DEFAULT_SOLO_CONFIG, SESSION, START), SESSION, [fix()], START, 0, false, random);

test('distance weights favor the inner kilometre and taper sharply toward 2 km', () => {
  const counts = [0, 0, 0, 0];
  let last = -1;
  const total = 10000;
  for (let i = 0; i < total; i++) {
    const distance = sampleTreasureDistance(() => (i + 0.5) / total);
    assert.ok(distance >= last && distance >= 0 && distance <= 2000);
    last = distance;
    counts[distance < 100 ? 0 : distance < 500 ? 1 : distance < 1000 ? 2 : 3]++;
  }
  // Integrals of the requested linear relative weights over each distance band.
  [10, 100, 287.5, 55].forEach((weight, i) => {
    assert.ok(Math.abs(counts[i] / total - weight / 452.5) < 0.001);
  });
  assert.equal(sampleTreasureDistance(() => 0), 0);
  assert.ok(sampleTreasureDistance(() => 1 - Number.EPSILON) <= 2000);
  for (const invalid of [-1, 1, NaN, Infinity]) assert.throws(() => sampleTreasureDistance(() => invalid));
});

test('balanced treasure positions retain their sampled distance across poles and the date line', () => {
  for (const latitude of [0, 89.99, -89.99]) {
    for (const draw of [0.1, 0.5, 0.99]) {
      const center = { ...fix(), latitude, longitude: 179.999 };
      const save = processLocations(createSave(DEFAULT_SOLO_CONFIG, SESSION, START), SESSION, [center], START, 0, false, () => draw);
      for (const box of save.treasures) {
        assert.ok(Math.abs(distanceBetween(center, box) - sampleTreasureDistance(() => draw) * (TREASURE_TEST_RADIUS_METERS ?? TREASURE_DESTINATION_RADIUS_METERS) / TREASURE_DESTINATION_RADIUS_METERS) < 0.01);
        assert.ok(box.longitude >= -180 && box.longitude <= 180);
      }
    }
  }
});

test('first fresh GPS spawns 2 or 3 boxes within 2 km; no fix means no spawn', () => {
  assert.equal(TREASURE_TEST_RADIUS_METERS, null, 'The production radius must not use the testing override');
  const empty = createSave(DEFAULT_SOLO_CONFIG, SESSION, START);
  assert.equal(spawnTreasures(empty, SESSION, START, () => 0), empty);
  for (const draw of [0, 0.49, 0.5, 0.99]) {
    const save = fresh(() => draw);
    assert.equal(save.treasures.length, draw < 0.5 ? 2 : 3);
    assert.ok(save.treasures.every(box => distanceBetween(fix(), box) <= 2000));
    if (draw >= 0.49) assert.ok(save.treasures.every(box => distanceBetween(fix(), box) > 100));
    assert.equal(save.nextTreasureSpawnAt, START + 30 * 60_000);
  }
});

test('resolved history stays bounded without losing totals, live boxes, or the reward cap', () => {
  let save = fresh();
  const originalBox = save.treasures[0];
  for (let i = 0; i < TREASURE_HISTORY_LIMIT + 20; i++) {
    const now = START + i;
    const target = save.treasures.find(isTreasureAvailable)!;
    save = collectTreasureBox(save, SESSION, target.id, now, () => 0);
  }
  assert.equal(save.treasures.filter(box => !isTreasureAvailable(box)).length, TREASURE_HISTORY_LIMIT);
  assert.equal(save.treasures.filter(isTreasureAvailable).length, 2);
  assert.deepEqual(treasureProgress(save), { collected: 120, rewarded: 10, limit: 10 });
  assert.equal(save.treasures.some(box => box.id === originalBox.id), false);
  assert.equal(collectTreasureBox(save, SESSION, originalBox.id, START + 200), save);
  assert.equal(compactTreasureHistory(save), save, 'Repeated compaction must not count history twice');
  const deadline = save.nextTreasureSpawnAt;
  for (const box of save.treasures.filter(isTreasureAvailable)) {
    save = removeTreasureBox(save, SESSION, box.id, START + 200);
  }
  assert.equal(save.treasures.length, TREASURE_HISTORY_LIMIT);
  assert.deepEqual(treasureProgress(save), { collected: 120, rewarded: 10, limit: 10 });
  assert.equal(save.treasureRefillBlocked, true);
  assert.equal(save.nextTreasureSpawnAt, deadline);
});

test('compaction retains newly resolved old boxes after clock rollback and every uncollected box', () => {
  const save = fresh();
  const oldBox = save.treasures[0];
  save.treasures = [oldBox, ...Array.from({ length: 150 }, (_, i) => ({
    ...oldBox, id: `resolved-${i}`, collectedAt: START + 60_000 + i, rewardGranted: false,
  })), ...Array.from({ length: 150 }, (_, i) => ({ ...oldBox, id: `available-${i}` }))];
  const collected = collectTreasureBox(save, SESSION, oldBox.id, START + 200);
  assert.equal(collected.treasures.filter(isTreasureAvailable).length, 150);
  assert.equal(collected.treasures.find(box => box.id === oldBox.id)?.collectedAt, START + 200);
  assert.deepEqual(treasureProgress(collected), { collected: 151, rewarded: 1, limit: 10 });
});

test('interval accumulates permanent positions; overdue spawns only one batch at current GPS', () => {
  const save = fresh();
  const now = START + 120 * 60_000;
  const next = processLocations(save, SESSION, [fix(now, 1)], now, 0, true, () => 0);
  assert.equal(next.treasures.length, 4);
  assert.deepEqual(next.treasures.slice(0, 2), save.treasures);
  assert.equal(next.treasures[2].longitude, 1);
  assert.equal(next.nextTreasureSpawnAt, now + 30 * 60_000);
  assert.equal(spawnTreasures(next, SESSION, now, () => 0), next);
});

test('collect last chest refills immediately and resets clock, without changing orb progress', () => {
  let save = fresh();
  const ids = save.treasures.map(box => box.id);
  save = collectTreasureBox(save, SESSION, ids[0], START + 1000, () => 0);
  assert.equal(save.treasures.length, 2);
  assert.equal(collectTreasureBox(save, SESSION, ids[0], START + 1000, () => 0), save);
  save = collectTreasureBox(save, SESSION, ids[1], START + 2000, () => 0);
  assert.equal(save.treasures.length, 4);
  assert.equal(save.treasures.filter(box => box.collectedAt !== undefined).length, 2);
  assert.equal(save.nextTreasureSpawnAt, START + 2000 + 30 * 60_000);
  assert.equal(save.collectedCount, 0);
  assert.equal(save.orbItemsClaimed, 0);
  assert.equal(save.effects[0].expiresAt, START + 1000 + 30 * 60_000);
});

test('collection requires range, fresh GPS, current session and active tracking', () => {
  const save = fresh();
  const id = save.treasures[0].id;
  for (const invalid of [save, { ...save, tracking: false }, { ...save, lastFix: fix(START, 1) }]) {
    const now = invalid === save ? START + 31_000 : START;
    assert.equal(collectTreasureBox(invalid, SESSION, id, now), invalid);
  }
  assert.equal(collectTreasureBox(save, 'stale', id, START), save);
  for (const meters of [99.9, 100.1]) {
    const positioned = { ...save, lastFix: fix(START, meters / 6371000 * 180 / Math.PI) };
    assert.equal(collectTreasureBox(positioned, SESSION, id, START) !== positioned, meters < 100);
  }
});

test('buff rewards are positive, last 15 or 30 minutes, and cancel opposite effects', () => {
  for (const draw of [0, 0.4, 0.65, 0.99]) {
    const save = fresh(() => draw);
    const box = save.treasures[0];
    save.lastFix = { ...fix(), latitude: box.latitude, longitude: box.longitude };
    const next = collectTreasureBox(save, SESSION, box.id, START, () => 0);
    assert.equal(next.effects[0].type, getTreasureReward(box).type);
    assert.ok(['speed_up', 'boost_distance_2x', 'boost_drop_2x', 'boost_collect_2x'].includes(next.effects[0].type));
    assert.equal(next.effects[0].expiresAt - START, (draw < 0.5 ? 15 : 30) * 60_000);
  }
  const save = fresh();
  save.effects = [{ id: 'slow', type: 'trap_slow', expiresAt: START + 15 * 60_000 }];
  assert.equal(collectTreasureBox(save, SESSION, save.treasures[0].id, START, () => 0).effects.length, 0);
});

test('locked background GPS spawns treasures without distance or passive rewards', () => {
  const save = fresh();
  save.backgroundCollectorLevel = 3;
  save.orbs = [{ id: 'orb', ...fix(), spawnedAt: START }];
  const next = processLocations(save, SESSION, [fix(START + 1800000, 0.01)], START + 1800000, 5, true, () => 0);
  assert.equal(next.treasures.length, 4);
  assert.equal(next.distanceMeters, 0);
  assert.equal(next.collectedCount, 0);
  assert.deepEqual(next.orbs, save.orbs);
  assert.equal(next.distanceAnchor, null);
});

test('pause, resume, stale fixes, custom intervals and rollback preserve a single deadline', () => {
  const save = fresh();
  const paused = setTracking(save, false, 'paused', START + 1000);
  assert.equal(spawnTreasures(paused, 'paused', START + 2000000, () => 0), paused);
  const resumed = setTracking(paused, true, 'resumed', START + 2000000);
  assert.equal(spawnTreasures(resumed, 'resumed', START + 2000000, () => 0), resumed);
  const next = processLocations(resumed, 'resumed', [fix(START + 2000000)], START + 2000000, 0, false, () => 0);
  assert.equal(next.treasures.length, 4);
  const rollback = spawnTreasures(next, 'resumed', START, () => 0);
  assert.equal(rollback.treasures.length, 4);
  assert.equal(rollback.nextTreasureSpawnAt, START + 1800000);
  const custom = processLocations(createSave({ ...DEFAULT_SOLO_CONFIG, treasureSpawnIntervalMinutes: 1 }, SESSION, START), SESSION, [fix()], START, 0, false, () => 0);
  assert.equal(custom.nextTreasureSpawnAt, START + 60000);
  for (const minutes of [0, -1, 1.5, Infinity, NaN]) assert.ok(validateConfig({ ...DEFAULT_SOLO_CONFIG, treasureSpawnIntervalMinutes: minutes }));
});


test('removal blocks immediate refill until the next scheduled batch, including after final collection', () => {
  let save = fresh();
  const deadline = save.nextTreasureSpawnAt;
  const [removed, remaining] = save.treasures;
  save = removeTreasureBox(save, SESSION, removed.id, START + 1000);
  assert.equal(save.treasureRefillBlocked, true);
  assert.equal(save.nextTreasureSpawnAt, deadline);
  assert.deepEqual(save.effects, []);
  assert.equal(save.treasures[0].removedAt, START + 1000);
  assert.equal(collectTreasureBox(save, SESSION, removed.id, START + 1000), save);
  assert.equal(removeTreasureBox(save, SESSION, removed.id, START + 1000), save);
  assert.equal(removeTreasureBox(save, 'old-session', remaining.id, START + 1000), save);
  save = collectTreasureBox(save, SESSION, remaining.id, START + 2000, () => 0);
  assert.equal(save.treasures.filter(isTreasureAvailable).length, 0);
  assert.equal(save.nextTreasureSpawnAt, deadline);
  save = processLocations(save, SESSION, [fix(deadline - 1)], deadline - 1, 0, false, () => 0);
  assert.equal(save.treasures.filter(isTreasureAvailable).length, 0);
  save = processLocations(save, SESSION, [fix(deadline)], deadline, 0, false, () => 0);
  assert.equal(save.treasures.filter(isTreasureAvailable).length, 2);
  assert.equal(save.treasureRefillBlocked, false);
  for (const box of save.treasures.filter(isTreasureAvailable)) {
    save = collectTreasureBox(save, SESSION, box.id, deadline + 1000, () => 0);
  }
  assert.equal(save.treasures.filter(isTreasureAvailable).length, 2);
});

test('removing all boxes works while paused and gives no rewards or immediate spawn', () => {
  let save = fresh();
  save = { ...save, tracking: false, lastFix: null };
  const deadline = save.nextTreasureSpawnAt;
  for (const box of save.treasures) save = removeTreasureBox(save, SESSION, box.id, START + 1000);
  assert.equal(save.treasures.filter(isTreasureAvailable).length, 0);
  assert.equal(save.nextTreasureSpawnAt, deadline);
  assert.deepEqual(save.effects, []);
  assert.equal(save.collectedCount, 0);
});

test('legacy treasure reward previews are stable and match collection after reload', () => {
  const save = fresh();
  delete save.treasures[0].reward;
  const preview = getTreasureReward(save.treasures[0]);
  const restored = JSON.parse(JSON.stringify(save));
  assert.deepEqual(getTreasureReward(restored.treasures[0]), preview);
  const collected = collectTreasureBox(restored, SESSION, restored.treasures[0].id, START, () => 0.99);
  assert.equal(collected.effects[0].type, preview.type);
  assert.equal(collected.effects[0].expiresAt, START + preview.durationMs!);
});


test('treasures receive saved random games at spawn and retain them when another box is opened', () => {
  const mazeSave = fresh(() => 0);
  const defenseSave = fresh(() => 0.9);
  assert.equal(mazeSave.treasures[0].minigame?.kind, 'maze');
  assert.equal(defenseSave.treasures[0].minigame?.kind, 'tower_defense');
  const [first, second] = mazeSave.treasures;
  let save = beginTreasureChallenge(mazeSave, SESSION, first.id, START, () => 0);
  const firstGame = getTreasureMinigame(first);
  save = beginTreasureChallenge(save, SESSION, second.id, START + 1, () => 0.99);
  save = beginTreasureChallenge(save, SESSION, first.id, START + 2, () => 0.99);
  assert.equal(save.treasureChallenge?.kind, firstGame.kind);
  assert.ok(save.treasureChallenge?.kind !== 'tower_defense' && firstGame.kind === 'maze');
  assert.deepEqual(save.treasureChallenge?.maze, firstGame.maze);
  assert.deepEqual(getTreasureMinigame(JSON.parse(JSON.stringify(first))), firstGame);
});

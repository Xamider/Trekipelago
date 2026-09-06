import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyLocations, collectOrb, createSave, DEFAULT_SOLO_CONFIG, distanceBetween,
  isFreshFix, resetSpawnClock, rollSpawn, setTracking, validateConfig,
} from './engine';
import type { LocationSample, SoloConfig, SoloSnapshot } from './types';

const START = 1_000_000;
const SESSION = 'session-a';
const metersToDegrees = (meters: number) => meters / 6_371_000 * 180 / Math.PI;
const fix = (east: number, north: number, timestamp: number, accuracy = 3): LocationSample => ({
  latitude: metersToDegrees(north), longitude: metersToDegrees(east), accuracy, timestamp,
});
const freshSave = (config: SoloConfig = { ...DEFAULT_SOLO_CONFIG }) => applyLocations(
  createSave(config, SESSION, START), SESSION, [fix(0, 0, START)], START,
);
const near = (actual: number, expected: number, tolerance = 0.001) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`,
);
const sequence = (...values: number[]) => {
  let index = 0;
  return () => {
    assert.ok(index < values.length, 'Random source used more values than expected');
    return values[index++];
  };
};

test('default settings and new save have exactly one local journey worth of state', () => {
  assert.deepEqual(DEFAULT_SOLO_CONFIG, { radiusMeters: 200, baseChance: 0.2, spawnReduction: 0.25, recoveryDistanceMeters: 100 });
  const config = { ...DEFAULT_SOLO_CONFIG };
  const save = createSave(config, SESSION, START);
  assert.equal(save.sessionId, SESSION);
  assert.equal(save.tracking, true);
  assert.equal(save.nextSpawnAt, START + 10_000);
  assert.equal(save.chance, 0.2);
  assert.equal(save.lastFix, null);
  assert.equal(save.distanceMeters, 0);
  assert.equal(save.collectedCount, 0);
  assert.deepEqual(save.orbs, []);
  config.radiusMeters = 50;
  assert.equal(save.config.radiusMeters, 200, 'Save owns a copy of its configuration');
});

test('configuration rejects invalid positive distances and fractional probabilities', () => {
  for (const field of ['radiusMeters', 'recoveryDistanceMeters', 'baseChance', 'spawnReduction'] as const) {
    for (const value of [0, -1, Infinity, NaN]) {
      const config = { ...DEFAULT_SOLO_CONFIG, [field]: value };
      assert.ok(validateConfig(config), `${field}=${value} must be rejected`);
      assert.throws(() => createSave(config, SESSION, START));
    }
  }
  for (const field of ['baseChance', 'spawnReduction'] as const) {
    assert.ok(validateConfig({ ...DEFAULT_SOLO_CONFIG, [field]: 1.01 }));
    assert.equal(validateConfig({ ...DEFAULT_SOLO_CONFIG, [field]: 1 }), null);
  }
  assert.equal(validateConfig({ ...DEFAULT_SOLO_CONFIG, radiusMeters: 0.5 }), null);
});

test('successive successful rolls reduce chance relatively, not by percentage points', () => {
  const original = freshSave();
  const first = rollSpawn(original, SESSION, START + 10_000, true, sequence(0.1, 0.25, 0));
  near(first.chance, 0.15);
  assert.equal(first.orbs.length, 1);
  const second = rollSpawn(first, SESSION, START + 20_000, true, sequence(0.1, 0.25, 0.5));
  near(second.chance, 0.1125);
  assert.equal(second.orbs.length, 2);
  assert.notEqual(second.orbs[0].id, second.orbs[1].id);
  assert.equal(original.chance, 0.2);
  assert.equal(original.orbs.length, 0, 'Engine must not mutate the previous snapshot');
});

test('failed and zero-chance rolls consume an interval without changing chance or creating an orb', () => {
  const original = freshSave();
  const failed = rollSpawn(original, SESSION, START + 10_000, true, sequence(0.2));
  assert.equal(failed.chance, 0.2);
  assert.equal(failed.orbs.length, 0);
  assert.equal(failed.nextSpawnAt, START + 20_000);
  const reduced = rollSpawn(freshSave({ ...DEFAULT_SOLO_CONFIG, spawnReduction: 1 }), SESSION, START + 10_000, true, sequence(0, 0, 0));
  const noChance = rollSpawn(reduced, SESSION, START + 20_000, true, sequence(0));
  assert.equal(noChance.chance, 0);
  assert.equal(noChance.orbs.length, 1);
});

test('timer waits 10 seconds, rolls once after delay, and never rolls in the background', () => {
  const original = freshSave();
  const neverRandom = () => { throw new Error('Must not roll'); };
  assert.equal(rollSpawn(original, SESSION, START + 9_999, true, neverRandom), original);
  assert.equal(rollSpawn(original, SESSION, START + 25_000, false, neverRandom), original);
  const delayed = rollSpawn(original, SESSION, START + 25_000, true, sequence(0, 0, 0));
  assert.equal(delayed.orbs.length, 1);
  assert.equal(delayed.nextSpawnAt, START + 35_000);
  assert.equal(rollSpawn(delayed, SESSION, START + 25_000, true, neverRandom), delayed);
});

test('foreground entry resets the deadline, excluding missed background intervals', () => {
  const save = freshSave();
  const resumed = resetSpawnClock(save, START + 100_000);
  assert.equal(resumed.nextSpawnAt, START + 110_000);
  assert.equal(rollSpawn(resumed, SESSION, START + 100_000, true, () => { throw new Error('Must wait'); }), resumed);
});

test('spawn requires a fresh usable fix and consumes stale attempts without calling random', () => {
  const save = freshSave();
  assert.equal(isFreshFix(save, START + 30_000), true);
  assert.equal(isFreshFix(save, START + 30_001), false);
  assert.equal(isFreshFix(save, START - 1), false);
  assert.equal(isFreshFix(createSave(DEFAULT_SOLO_CONFIG, SESSION, START), START), false);
  const stale = rollSpawn(save, SESSION, START + 30_001, true, () => { throw new Error('Stale GPS must not roll'); });
  assert.equal(stale.orbs.length, 0);
  assert.equal(stale.nextSpawnAt, START + 40_001);
});

test('spawn position samples disk area and remains within radius across bearings and random draws', () => {
  const save = freshSave();
  const halfwayArea = rollSpawn(save, SESSION, START + 10_000, true, sequence(0, 0.25, 0));
  near(distanceBetween(save.lastFix!, halfwayArea.orbs[0]), 100);
  for (const area of [0, 0.01, 0.25, 0.9, 0.999999]) {
    for (const bearing of [0, 0.125, 0.25, 0.5, 0.75, 0.999]) {
      const spawned = rollSpawn(save, SESSION, START + 10_000, true, sequence(0, area, bearing));
      const distance = distanceBetween(save.lastFix!, spawned.orbs[0]);
      assert.ok(distance <= 200.00001 && distance >= 0);
    }
  }
});

test('spawn coordinates normalize the antimeridian and remain valid near a pole', () => {
  for (const point of [{ latitude: 0, longitude: 179.9999 }, { latitude: 89.9999, longitude: -179.9999 }]) {
    const original = createSave(DEFAULT_SOLO_CONFIG, SESSION, START);
    const save = applyLocations(original, SESSION, [{ ...point, accuracy: 3, timestamp: START }], START);
    const spawned = rollSpawn(save, SESSION, START + 10_000, true, sequence(0, 0.99, 0.25));
    const orb = spawned.orbs[0];
    assert.ok(orb.latitude >= -90 && orb.latitude <= 90);
    assert.ok(orb.longitude >= -180 && orb.longitude <= 180);
    near(distanceBetween(point, orb), 200 * Math.sqrt(0.99), 0.02);
  }
});

test('random sources outside the probability interval are rejected', () => {
  for (const value of [1, -0.1, Infinity, NaN]) {
    assert.throws(() => rollSpawn(freshSave(), SESSION, START + 10_000, true, () => value), /Random source/);
  }
});

test('walking a closed loop counts the entire path and restores chance', () => {
  let save = freshSave();
  save = { ...save, chance: 0 };
  save = applyLocations(save, SESSION, [
    fix(25, 0, START + 5_000), fix(25, 25, START + 10_000),
    fix(0, 25, START + 15_000), fix(0, 0, START + 20_000),
  ], START + 20_000);
  near(save.distanceMeters, 100);
  near(save.chance, 0.2);
  near(distanceBetween(fix(0, 0, START), save.lastFix!), 0);
});

test('distance recovers linearly and never exceeds the configured base chance', () => {
  const depleted = { ...freshSave(), chance: 0.1 };
  const restored = applyLocations(depleted, SESSION, [fix(25, 0, START + 5_000)], START + 5_000);
  near(restored.chance, 0.15);
  const capped = applyLocations(restored, SESSION, [fix(200, 0, START + 10_000)], START + 10_000);
  assert.equal(capped.chance, 0.2);
});

test('slow movement accumulates against an anchor until the displacement threshold is reached', () => {
  let save = freshSave();
  for (let step = 1; step <= 5; step++) {
    save = applyLocations(save, SESSION, [fix(step, 0, START + step * 5_000)], START + step * 5_000);
  }
  near(save.distanceMeters, 3);
  save = applyLocations(save, SESSION, [fix(6.01, 0, START + 30_000)], START + 30_000);
  near(save.distanceMeters, 6.01);
});

test('stationary jitter below reported accuracy does not add distance or recovery', () => {
  let save = applyLocations(createSave(DEFAULT_SOLO_CONFIG, SESSION, START), SESSION, [fix(0, 0, START, 10)], START);
  save = { ...save, chance: 0.1 };
  for (let step = 1; step <= 20; step++) {
    const timestamp = START + step * 5_000;
    save = applyLocations(save, SESSION, [fix(step % 2 ? 4 : -4, 2, timestamp, 10)], timestamp);
  }
  assert.equal(save.distanceMeters, 0);
  assert.equal(save.chance, 0.1);
});

test('movement threshold uses mean accuracy at the anchor and candidate fix', () => {
  let save = applyLocations(createSave(DEFAULT_SOLO_CONFIG, SESSION, START), SESSION, [fix(0, 0, START, 10)], START);
  save = applyLocations(save, SESSION, [fix(10, 0, START + 5_000, 20)], START + 5_000);
  assert.equal(save.distanceMeters, 0);
  save = applyLocations(save, SESSION, [fix(15.01, 0, START + 10_000, 20)], START + 10_000);
  near(save.distanceMeters, 15.01);
});

test('duplicate and out-of-order batches cannot count movement twice', () => {
  const samples = [fix(25, 0, START + 5_000), fix(50, 0, START + 10_000)];
  const save = applyLocations(freshSave(), SESSION, samples, START + 10_000);
  const repeated = applyLocations(save, SESSION, [...samples, fix(40, 0, START + 7_000)], START + 20_000);
  assert.equal(repeated, save);
  near(repeated.distanceMeters, 50);
});

test('a reverse-ordered batch counts the same distance as forward order', () => {
  const forward = applyLocations(freshSave(), SESSION, [
    fix(25, 0, START + 5_000), fix(25, 25, START + 10_000),
    fix(0, 25, START + 15_000), fix(0, 0, START + 20_000),
  ], START + 20_000);
  const reversed = applyLocations(freshSave(), SESSION, [
    fix(0, 0, START + 20_000), fix(0, 25, START + 15_000),
    fix(25, 25, START + 10_000), fix(25, 0, START + 5_000),
  ], START + 20_000);
  near(reversed.distanceMeters, forward.distanceMeters);
  near(reversed.distanceMeters, 100);
});

test('a device clock rollback resets timing/GPS baselines while preserving progress', () => {
  const save = freshSave();
  const traveled = applyLocations(save, SESSION, [fix(25, 0, START + 5_000)], START + 5_000);
  near(traveled.distanceMeters, 25);

  // The device clock jumps backward relative to the last recorded `updatedAt`.
  const rolledBack = applyLocations(traveled, SESSION, [], START + 1_000);
  assert.equal(rolledBack.distanceMeters, 25, 'Progress made before the rollback is preserved');
  assert.equal(rolledBack.lastFix, null, 'GPS baseline resets so a stale gap is not measured across the jump');
  assert.equal(rolledBack.distanceAnchor, null);
  assert.equal(rolledBack.lastProcessedTimestamp, START + 999);
  assert.equal(rolledBack.nextSpawnAt, START + 11_000);

  // Tracking resumes normally once fixes arrive on the corrected clock.
  const reacquired = applyLocations(rolledBack, SESSION, [fix(40, 0, START + 2_000)], START + 2_000);
  assert.equal(reacquired.distanceMeters, 25, 'Re-acquiring GPS after a rollback only re-anchors');
  const resumed = applyLocations(reacquired, SESSION, [fix(50, 0, START + 7_000)], START + 7_000);
  near(resumed.distanceMeters, 35);
});

test('a device clock rollback also resets a stuck spawn deadline', () => {
  const save = freshSave();
  const rolledBack = rollSpawn(save, SESSION, START - 5_000, true, () => { throw new Error('Must not roll immediately after a rollback'); });
  assert.equal(rolledBack.nextSpawnAt, START + 5_000);
  assert.equal(rolledBack.lastFix, null);
});

test('bad coordinates, accuracy, and timestamps never update the GPS baseline', () => {
  const save = freshSave();
  const valid = fix(10, 0, START + 5_000);
  const samples = [
    { ...valid, latitude: NaN }, { ...valid, latitude: 91 }, { ...valid, longitude: Infinity },
    { ...valid, longitude: -181 }, { ...valid, accuracy: -1 }, { ...valid, accuracy: 25.01 },
    { ...valid, accuracy: NaN }, { ...valid, timestamp: Infinity }, { ...valid, timestamp: -1 },
    { ...valid, timestamp: START + 5_001 },
  ];
  assert.equal(applyLocations(save, SESSION, samples, START + 5_000), save);
  assert.ok(Number.isNaN(distanceBetween({ latitude: 100, longitude: 0 }, valid)));
});

test('implausible jumps are rejected and the next plausible point resumes from the good fix', () => {
  const original = freshSave();
  const jumped = applyLocations(original, SESSION, [fix(1_000, 0, START + 5_000)], START + 5_000);
  assert.equal(jumped.lastFix, original.lastFix);
  assert.equal(jumped.distanceMeters, 0);
  assert.equal(jumped.lastProcessedTimestamp, START + 5_000);
  const recovered = applyLocations(jumped, SESSION, [fix(10, 0, START + 10_000)], START + 10_000);
  near(recovered.distanceMeters, 10);
});

test('gaps exceeding 30 seconds reset the distance baseline without inventing travel', () => {
  const recovered = applyLocations(freshSave(), SESSION, [fix(10_000, 0, START + 30_001)], START + 30_001);
  assert.equal(recovered.distanceMeters, 0);
  near(distanceBetween(recovered.distanceAnchor!, fix(10_000, 0, START + 30_001)), 0);
  const walked = applyLocations(recovered, SESSION, [fix(10_010, 0, START + 35_001)], START + 35_001);
  near(walked.distanceMeters, 10);
});

test('historical background batches count accepted segments but remain stale for foreground gameplay', () => {
  const save = applyLocations({ ...freshSave(), chance: 0 }, SESSION, [
    fix(25, 0, START + 5_000), fix(50, 0, START + 10_000), fix(75, 0, START + 15_000),
  ], START + 60_000);
  near(save.distanceMeters, 75);
  near(save.chance, 0.15);
  assert.equal(isFreshFix(save, START + 60_000), false);
});

test('orbs keep fixed coordinates and leave the save when the moving region passes them', () => {
  const original = rollSpawn(freshSave(), SESSION, START + 10_000, true, sequence(0, 0, 0));
  const nearby = applyLocations(original, SESSION, [fix(100, 0, START + 15_000)], START + 15_000);
  assert.deepEqual(nearby.orbs, original.orbs);
  const distant = applyLocations(nearby, SESSION, [fix(201, 0, START + 20_000)], START + 20_000);
  assert.deepEqual(distant.orbs, []);
  assert.equal(distant.collectedCount, 0, 'Leaving the region is not collection');
});

test('collection requires an active fresh in-range orb and happens exactly once', () => {
  const save = rollSpawn(freshSave(), SESSION, START + 10_000, true, sequence(0, 0, 0));
  const orbId = save.orbs[0].id;
  const collected = collectOrb(save, SESSION, orbId, START + 11_000);
  assert.equal(collected.collectedCount, 1);
  assert.equal(collected.orbs.length, 0);
  assert.equal(collected.chance, save.chance, 'Collection itself does not reduce chance');
  assert.equal(collectOrb(collected, SESSION, orbId, START + 12_000), collected);
  assert.equal(collectOrb(save, SESSION, orbId, START + 30_001), save);
  assert.equal(collectOrb(save, SESSION, 'missing', START + 11_000), save);
  const distant: SoloSnapshot = { ...save, orbs: [{ ...save.orbs[0], longitude: metersToDegrees(201) }] };
  assert.equal(collectOrb(distant, SESSION, orbId, START + 11_000), distant);
});

test('pause stops GPS, spawning, and collection while preserving progress and saved orbs', () => {
  const save = rollSpawn(freshSave(), SESSION, START + 10_000, true, sequence(0, 0, 0));
  const paused = setTracking(save, false, 'paused', START + 11_000);
  assert.equal(paused.tracking, false);
  assert.equal(paused.lastFix, null);
  assert.equal(paused.distanceAnchor, null);
  assert.deepEqual(paused.orbs, save.orbs);
  assert.equal(applyLocations(paused, 'paused', [fix(25, 0, START + 15_000)], START + 15_000), paused);
  assert.equal(rollSpawn(paused, 'paused', START + 25_000, true, () => { throw new Error('Paused'); }), paused);
  assert.equal(collectOrb(paused, 'paused', save.orbs[0].id, START + 12_000), paused);
});

test('resume and tracker restart require a fresh baseline, prune saved orbs, and reject old callbacks', () => {
  const save = rollSpawn(freshSave(), SESSION, START + 10_000, true, sequence(0, 0, 0));
  const resumed = setTracking(save, true, 'session-b', START + 20_000);
  assert.equal(resumed.lastFix, null);
  assert.equal(resumed.nextSpawnAt, START + 30_000);
  assert.equal(applyLocations(resumed, SESSION, [fix(500, 0, START + 21_000)], START + 21_000), resumed);
  assert.equal(collectOrb(resumed, SESSION, save.orbs[0].id, START + 21_000), resumed);
  assert.equal(rollSpawn(resumed, SESSION, START + 30_000, true, () => { throw new Error('Old session'); }), resumed);
  assert.equal(applyLocations(resumed, 'session-b', [fix(100, 0, START + 19_000)], START + 21_000), resumed);
  const acquired = applyLocations(resumed, 'session-b', [fix(500, 0, START + 21_000)], START + 21_000);
  assert.equal(acquired.distanceMeters, 0);
  assert.equal(acquired.orbs.length, 0);
});

test('replacement creates clean progress and rejects every previous session callback', () => {
  const previous = rollSpawn(freshSave(), SESSION, START + 10_000, true, sequence(0, 0, 0));
  const replacement = createSave({ ...DEFAULT_SOLO_CONFIG, radiusMeters: 500 }, 'replacement', START + 15_000);
  assert.equal(replacement.distanceMeters, 0);
  assert.equal(replacement.orbs.length, 0);
  assert.equal(replacement.chance, DEFAULT_SOLO_CONFIG.baseChance);
  assert.equal(applyLocations(replacement, SESSION, [fix(25, 0, START + 20_000)], START + 20_000), replacement);
  assert.equal(collectOrb(replacement, SESSION, previous.orbs[0].id, START + 20_000), replacement);
});

test('activity history retains only the latest 100 entries with distinct identifiers', () => {
  let save = freshSave();
  for (let index = 0; index < 125; index++) save = setTracking(save, index % 2 === 0, `session-${index}`, START + 1_000);
  assert.equal(save.activity.length, 100);
  assert.equal(new Set(save.activity.map(entry => entry.id)).size, 100);
  assert.equal(save.activity.at(-1)?.message, 'Tracking resumed. Waiting for fresh GPS.');
});

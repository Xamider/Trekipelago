import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyEffectOrOpposite, applyLocations as engineApplyLocations, collectOrb, createSave, DEFAULT_SOLO_CONFIG, distanceBetween,
  generateExpeditionPools, getEffectDetails, isFreshFix, resetSpawnClock, rollEvent, rollSpawn, setTracking, SPEED_LEVELS_MPS, validateConfig, WEIGHTED_REGULAR_ITEMS,
} from './engine';
import type { LocationSample, SoloConfig, SoloSnapshot } from './types';

const START = 1_000_000;
const SESSION = 'session-a';
const metersToDegrees = (meters: number) => meters / 6_371_000 * 180 / Math.PI;
const fix = (east: number, north: number, timestamp: number, accuracy = 3): LocationSample => ({
  latitude: metersToDegrees(north), longitude: metersToDegrees(east), accuracy, timestamp,
});
const applyLocations = (save: SoloSnapshot, session: string, fixes: LocationSample[], now: number, maxSpeed = 5) =>
  engineApplyLocations(save, session, fixes, now, maxSpeed);

const freshSave = (config: SoloConfig = { ...DEFAULT_SOLO_CONFIG }) => applyLocations(
  createSave(config, SESSION, START), SESSION, [fix(0, 0, START)], START,
);
const near = (actual: number, expected: number, tolerance = 0.001) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`,
);
const sequence = (...values: number[]) => {
  let index = 0;
  return () => {
    if (index >= values.length) return 0.99;
    return values[index++];
  };
};

test('default settings and new save have exactly one local journey worth of state', () => {
  assert.deepEqual(DEFAULT_SOLO_CONFIG, {
    radiusMeters: 100,
    baseChance: 0.2,
    maxDistanceMeters: 5000,
    rewardIntervalMeters: 500,
    orbsPerReward: 5,
    maxOrbs: 50,
    spawnReduction: 0.125,
    recoveryDistanceMeters: 400,
    buffRatio: 0.7,
  });
  const config = { ...DEFAULT_SOLO_CONFIG };
  const save = createSave(config, SESSION, START);
  assert.equal(save.sessionId, SESSION);
  assert.equal(save.tracking, true);
  assert.equal(save.nextSpawnAt, START + 10_000);
  assert.equal(save.chance, 0.2);
  assert.equal(save.lastFix, null);
  assert.equal(save.distanceMeters, 0);
});

test('configuration rejects invalid positive distances and fractional probabilities', () => {
  const base = { ...DEFAULT_SOLO_CONFIG };
  assert.equal(validateConfig({ ...base, radiusMeters: 0 }), 'Region radius must be a positive number.');
  assert.equal(validateConfig({ ...base, baseChance: 0 }), 'Base chance must be between 1% and 100%.');
  assert.equal(validateConfig({ ...base, baseChance: 0.005 }), 'Base chance must be between 1% and 100%.');
  assert.equal(validateConfig({ ...base, baseChance: 1.5 }), 'Base chance must be between 1% and 100%.');
  assert.equal(validateConfig({ ...base, spawnReduction: -0.1 }), 'Spawn reduction must be greater than 0% and at most 100%.');
  assert.equal(validateConfig({ ...base, recoveryDistanceMeters: -1 }), 'Recovery distance must be a positive number.');
  assert.equal(validateConfig({ ...base, maxDistanceMeters: 0 }), 'Max distance must be a positive number.');
  assert.equal(validateConfig({ ...base, rewardIntervalMeters: 0 }), 'Reward interval must be a positive number.');
  assert.equal(validateConfig({ ...base, orbsPerReward: 0 }), 'Orbs per reward must be a positive number.');
  assert.ok(validateConfig({ ...base, maxDistanceMeters: 1000, rewardIntervalMeters: 1000, maxOrbs: 10, orbsPerReward: 5 })?.includes('Not enough reward milestones'));
  assert.equal(validateConfig(base), null);
});

test('successive successful rolls reduce chance relatively, not by percentage points', () => {
  let save = freshSave({ ...DEFAULT_SOLO_CONFIG, baseChance: 0.5, spawnReduction: 0.25 });
  save = rollSpawn(save, SESSION, START + 10_000, true, sequence(0.1));
  near(save.chance, 0.375);
  save = rollSpawn(save, SESSION, START + 20_000, true, sequence(0.1));
  near(save.chance, 0.28125);
});

test('a successful roll immediately rolls for another orb with reduced chance until a roll fails', () => {
  const save = freshSave({ ...DEFAULT_SOLO_CONFIG, baseChance: 0.5, spawnReduction: 0.25 });
  // draw 1: roll check (0.1 < 0.5 -> success)
  // draw 2, 3: spawnPosition (radius, bearing)
  // draw 4: roll check (0.1 < 0.375 -> success)
  // draw 5, 6: spawnPosition (radius, bearing)
  // draw 7: roll check (0.9 >= 0.28125 -> stop)
  const multi = rollSpawn(save, SESSION, START + 10_000, true, sequence(0.1, 0.5, 0.5, 0.1, 0.5, 0.5, 0.9));
  assert.equal(multi.orbs.length, 2);
  near(multi.chance, 0.28125);
  assert.equal(multi.activity.at(-1)?.message, '2 light orbs appeared in your region!');
});

test('failed and zero-chance rolls consume an interval without changing chance or creating an orb', () => {
  const save = freshSave({ ...DEFAULT_SOLO_CONFIG, baseChance: 0.2 });
  const failed = rollSpawn(save, SESSION, START + 10_000, true, sequence(0.5));
  assert.equal(failed.orbs.length, 0);
  assert.equal(failed.chance, 0.2);
  assert.equal(failed.nextSpawnAt, START + 20_000);
  const zero = rollSpawn({ ...save, chance: 0 }, SESSION, START + 10_000, true, sequence(0));
  assert.equal(zero.orbs.length, 0);
  assert.equal(zero.chance, 0);
});

test('timer waits 10 seconds, rolls once after delay, and never rolls in the background', () => {
  const save = freshSave();
  assert.equal(rollSpawn(save, SESSION, START + 9_999, true, sequence(0)).orbs.length, 0);
  assert.equal(rollSpawn(save, SESSION, START + 10_000, false, sequence(0)).orbs.length, 0);
  const rolled = rollSpawn(save, SESSION, START + 10_000, true, sequence(0));
  assert.equal(rolled.orbs.length, 1);
  assert.equal(rollSpawn(rolled, SESSION, START + 10_001, true, sequence(0)).orbs.length, 1);
});

test('foreground entry resets the deadline, excluding missed background intervals', () => {
  const save = freshSave();
  const reset = resetSpawnClock(save, START + 60_000);
  assert.equal(reset.nextSpawnAt, START + 70_000);
  assert.equal(rollSpawn(reset, SESSION, START + 60_000, true, sequence(0)).orbs.length, 0);
});

test('spawn requires a fresh usable fix and consumes stale attempts without calling random', () => {
  const save = createSave(DEFAULT_SOLO_CONFIG, SESSION, START);
  const missed = rollSpawn(save, SESSION, START + 10_000, true, () => { throw new Error('Unused'); });
  assert.equal(missed.orbs.length, 0);
  assert.equal(missed.nextSpawnAt, START + 20_000);
  const stale = applyLocations(save, SESSION, [fix(0, 0, START)], START);
  const consumed = rollSpawn(stale, SESSION, START + 30_001, true, () => { throw new Error('Stale'); });
  assert.equal(consumed.orbs.length, 0);
  assert.equal(consumed.nextSpawnAt, START + 40_001);
});

test('spawn position samples disk area and remains within radius across bearings and random draws', () => {
  const origin: LocationSample = { latitude: 0, longitude: 0, accuracy: 3, timestamp: START };
  const base = applyLocations(createSave(DEFAULT_SOLO_CONFIG, SESSION, START), SESSION, [origin], START);
  for (const draw of [0.01, 0.25, 0.75, 0.99]) {
    const spawned = rollSpawn(base, SESSION, START + 10_000, true, sequence(0, draw, draw));
    const orb = spawned.orbs[0];
    assert.ok(orb);
    const distance = distanceBetween(origin, orb);
    assert.ok(distance <= DEFAULT_SOLO_CONFIG.radiusMeters);
  }
});

test('spawn coordinates normalize the antimeridian and remain valid near a pole', () => {
  const polar = applyLocations(createSave(DEFAULT_SOLO_CONFIG, SESSION, START), SESSION, [{
    latitude: 89.999, longitude: 179.999, accuracy: 3, timestamp: START,
  }], START);
  const spawned = rollSpawn(polar, SESSION, START + 10_000, true, sequence(0, 0.5, 0.5));
  const orb = spawned.orbs[0];
  assert.ok(orb.latitude >= -90 && orb.latitude <= 90);
  assert.ok(orb.longitude >= -180 && orb.longitude <= 180);
});

test('random sources outside the probability interval are rejected', () => {
  const save = freshSave();
  assert.throws(() => rollSpawn(save, SESSION, START + 10_000, true, () => 1));
  assert.throws(() => rollSpawn(save, SESSION, START + 10_000, true, () => -0.01));
  assert.throws(() => rollSpawn(save, SESSION, START + 10_000, true, () => Number.NaN));
});

test('walking a closed loop counts the entire path and restores chance', () => {
  let save = freshSave({ ...DEFAULT_SOLO_CONFIG, recoveryDistanceMeters: 100 });
  save = { ...save, chance: 0 };
  save = applyLocations(save, SESSION, [
    fix(25, 0, START + 5_000), fix(25, 25, START + 10_000), fix(0, 25, START + 15_000), fix(0, 0, START + 20_000),
  ], START + 20_000);
  near(save.distanceMeters, 100);
  near(save.chance, DEFAULT_SOLO_CONFIG.baseChance);
});

test('distance recovers linearly and never exceeds the configured base chance', () => {
  let save = freshSave({ ...DEFAULT_SOLO_CONFIG, baseChance: 0.4, recoveryDistanceMeters: 100 });
  save = { ...save, chance: 0.1 };
  save = applyLocations(save, SESSION, [fix(50, 0, START + 5_000)], START + 5_000, 5);
  near(save.chance, 0.3);
  save = applyLocations(save, SESSION, [fix(150, 0, START + 15_000)], START + 15_000, 5);
  near(save.chance, 0.4);
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
  let save = freshSave({ ...DEFAULT_SOLO_CONFIG, baseChance: 0.5, recoveryDistanceMeters: 100 });
  save = { ...save, chance: 0.1 };
  save = applyLocations(save, SESSION, [fix(2, 2, START + 5_000, 8), fix(-2, 1, START + 10_000, 8)], START + 10_000);
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
  const save = freshSave();
  const forward = applyLocations(save, SESSION, [fix(20, 0, START + 5_000), fix(40, 0, START + 10_000)], START + 10_000);
  const replay = applyLocations(forward, SESSION, [fix(20, 0, START + 5_000), fix(40, 0, START + 10_000)], START + 10_000);
  assert.equal(replay.distanceMeters, forward.distanceMeters);
  assert.equal(replay.activity.length, forward.activity.length);
});

test('a reverse-ordered batch counts the same distance as forward order', () => {
  const forward = applyLocations(freshSave(), SESSION, [fix(20, 0, START + 5_000), fix(40, 0, START + 10_000)], START + 10_000);
  const reversed = applyLocations(freshSave(), SESSION, [fix(40, 0, START + 10_000), fix(20, 0, START + 5_000)], START + 10_000);
  near(reversed.distanceMeters, forward.distanceMeters);
});

test('a device clock rollback resets timing/GPS baselines while preserving progress', () => {
  const save = freshSave();
  const traveled = applyLocations(save, SESSION, [fix(25, 0, START + 5_000)], START + 5_000);
  near(traveled.distanceMeters, 25);

  const rollback = applyLocations(traveled, SESSION, [], START + 1_000);
  assert.equal(rollback.distanceMeters, 25);
  assert.equal(rollback.lastFix, null);
  assert.equal(rollback.distanceAnchor, null);
});

test('a device clock rollback also resets a stuck spawn deadline', () => {
  const original = freshSave();
  const rollback = rollSpawn(original, SESSION, START - 100_000, true, sequence(0));
  assert.equal(rollback.nextSpawnAt, START - 90_000);
});

test('bad coordinates, accuracy, and timestamps never update the GPS baseline', () => {
  const save = freshSave();
  const invalid = applyLocations(save, SESSION, [
    { latitude: 95, longitude: 0, accuracy: 5, timestamp: START + 5_000 },
    { latitude: 0, longitude: 0, accuracy: -1, timestamp: START + 6_000 },
    { latitude: 0, longitude: 0, accuracy: 5, timestamp: START + 40_000 },
  ], START + 5_000);
  assert.equal(invalid.lastProcessedTimestamp, save.lastProcessedTimestamp);
  assert.equal(invalid.distanceMeters, 0);
});

test('implausible jumps are rejected and the next plausible point resumes from the good fix', () => {
  let save = freshSave();
  save = applyLocations(save, SESSION, [fix(20, 0, START + 5_000)], START + 5_000, 5);
  near(save.distanceMeters, 20);
  save = applyLocations(save, SESSION, [fix(2_000, 0, START + 6_000)], START + 6_000, 5);
  near(save.distanceMeters, 20);
  save = applyLocations(save, SESSION, [fix(30, 0, START + 7_000)], START + 7_000, 5);
  near(save.distanceMeters, 30);
});

test('gaps exceeding 30 seconds reset the distance baseline without inventing travel', () => {
  let save = freshSave();
  save = applyLocations(save, SESSION, [fix(20, 0, START + 5_000)], START + 5_000);
  save = applyLocations(save, SESSION, [fix(100, 0, START + 45_000)], START + 45_000);
  near(save.distanceMeters, 20);
  save = applyLocations(save, SESSION, [fix(125, 0, START + 50_000)], START + 50_000);
  near(save.distanceMeters, 45);
});

test('historical background batches count accepted segments but remain stale for foreground gameplay', () => {
  const save = applyLocations({ ...freshSave(), chance: 0 }, SESSION, [
    fix(25, 0, START + 5_000), fix(50, 0, START + 10_000), fix(75, 0, START + 15_000),
  ], START + 60_000);
  near(save.distanceMeters, 75);
  near(save.chance, 0.0375);
  assert.equal(isFreshFix(save, START + 60_000), false);
});

test('orbs keep fixed coordinates and leave the save when the moving region passes them', () => {
  const original = rollSpawn(freshSave(), SESSION, START + 10_000, true, sequence(0, 0, 0));
  const nearby = applyLocations(original, SESSION, [fix(50, 0, START + 15_000)], START + 15_000);
  assert.deepEqual(nearby.orbs, original.orbs);
  const distant = applyLocations(nearby, SESSION, [fix(101, 0, START + 20_000)], START + 20_000);
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
  const distant: SoloSnapshot = { ...save, orbs: [{ ...save.orbs[0], longitude: metersToDegrees(101) }] };
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

test('expedition pool generation guarantees unlock_background, passive_collector (up to lv 3), and progressive_speed (up to lv 5)', () => {
  const pools = generateExpeditionPools(15, 10, Math.random);
  const allItems = [...pools.distancePool, ...pools.orbPool];

  const unlocks = allItems.filter(i => i.type === 'unlock_background');
  const collectors = allItems.filter(i => i.type === 'passive_collector');
  const speeds = allItems.filter(i => i.type === 'progressive_speed');

  assert.equal(unlocks.length, 1, 'Exactly 1 unlock_background guaranteed');
  assert.equal(collectors.length, 3, 'Exactly 3 passive_collector guaranteed for 3 tiers');
  assert.equal(speeds.length, 5, 'Exactly 5 progressive_speed guaranteed for 5 tiers');
});

test('progressive speed items increase speedLevel up to max and expand allowed GPS speed', () => {
  let save = createSave(DEFAULT_SOLO_CONFIG, SESSION, START);
  assert.equal(save.speedLevel, 0);

  // Set next distance reward to progressive_speed
  save.distanceItemPool = [{ type: 'progressive_speed', durationMs: null }];
  save.distanceItemsClaimed = 0;

  // Award milestone
  save = rollEvent(save, START + 10_000, 'distance', Math.random);
  assert.equal(save.speedLevel, 1);
  assert.ok(save.activity.at(-1)?.message.includes('Speed Limit Increased (Level 1'));

  // With speedLevel = 1, SPEED_LEVELS_MPS[1] = 6.0 / 3.6 = 1.667 m/s. A jump of 6m over 5s (1.2 m/s) is accepted!
  const fix1 = fix(0, 0, START + 20_000);
  const fix2 = fix(6, 0, START + 25_000); // 1.2 m/s
  save = engineApplyLocations(save, SESSION, [fix1, fix2], START + 25_000, 0);
  near(save.distanceMeters, 6);
});

test('WEIGHTED_REGULAR_ITEMS does not contain items affecting orbs directly (trap_orbs, burst_orbs)', () => {
  const types = WEIGHTED_REGULAR_ITEMS.map(i => i.type);
  assert.ok(!types.includes('trap_orbs'), 'trap_orbs must not be in regular weighted pool');
  assert.ok(!types.includes('burst_orbs'), 'burst_orbs must not be in regular weighted pool');
});

test('collecting orbsPerReward awards an item milestone from orbItemPool', () => {
  let save = freshSave({ ...DEFAULT_SOLO_CONFIG, orbsPerReward: 2 });
  save.orbItemPool = [{ type: 'boost_distance_2x', durationMs: 300_000 }];
  save.orbItemsClaimed = 0;
  save.lastRewardedOrbs = 0;

  // Add 2 orbs within range
  const orb1 = { id: 'o1', latitude: 0, longitude: 0, spawnedAt: START };
  const orb2 = { id: 'o2', latitude: 0, longitude: 0, spawnedAt: START };
  save = { ...save, orbs: [orb1, orb2] };

  // Collect 1st orb -> no reward yet
  save = collectOrb(save, SESSION, 'o1', START + 1_000);
  assert.equal(save.collectedCount, 1);
  assert.equal(save.orbItemsClaimed, 0);
  assert.equal(save.effects.length, 0);

  // Collect 2nd orb -> triggers milestone!
  save = collectOrb(save, SESSION, 'o2', START + 2_000);
  assert.equal(save.collectedCount, 2);
  assert.equal(save.orbItemsClaimed, 1);
  assert.equal(save.lastRewardedOrbs, 2);
  assert.ok(save.effects.some(e => e.type === 'boost_distance_2x'));
  assert.ok(save.activity.at(-1)?.message.includes('Orb Milestone'));
});

test('speed_up temporary buff increases GPS speed limit by 50% in applyLocations', () => {
  let save = freshSave();
  // Base speed level 0 is 3.0 / 3.6 ≈ 0.833 m/s.
  // Over 5 seconds, max allowed distance without boost = 0.833 * 5 ≈ 4.16m.
  // Traveling 5m over 5s (1.0 m/s) is normally rejected (> 0.833 m/s):
  const normalSave = engineApplyLocations(save, SESSION, [fix(0, 0, START + 10_000), fix(5, 0, START + 15_000)], START + 15_000, 0);
  assert.equal(normalSave.distanceMeters, 0, 'Should reject 1.0 m/s when base limit is 0.833 m/s');

  // Now with speed_up active, limit becomes 0.833 * 1.5 = 1.25 m/s. 1.0 m/s (5m in 5s) is accepted!
  const boostedSave = {
    ...save,
    effects: [{ id: 'boost-1', type: 'speed_up' as const, expiresAt: START + 60_000 }],
  };
  const result = engineApplyLocations(boostedSave, SESSION, [fix(0, 0, START + 10_000), fix(5, 0, START + 15_000)], START + 15_000, 0);
  near(result.distanceMeters, 5);
});

test('getEffectDetails returns clear descriptive info for all active effects and perks', () => {
  const bg = getEffectDetails('unlock_background');
  assert.ok(bg.description.toLowerCase().includes('background'));

  const coll = getEffectDetails('passive_collector', 2);
  assert.equal(coll.shortLabel, 'COLLECTOR LV.2');

  const speed = getEffectDetails('speed_up');
  assert.ok(speed.description.includes('+50%'));

  const dist = getEffectDetails('boost_distance_2x');
  assert.ok(dist.description.toLowerCase().includes('double'));
});

test('applyEffectOrOpposite extends duration when same effect is applied', () => {
  const now = 1_000_000;
  const initial = [
    { id: '1', type: 'boost_distance_2x' as const, expiresAt: now + 30 * 60 * 1000 },
  ];
  // Applying another 30 minutes of boost_distance_2x
  const result = applyEffectOrOpposite(initial, { type: 'boost_distance_2x', durationMs: 30 * 60 * 1000 }, now);
  assert.equal(result.effects.length, 1);
  assert.equal(result.effects[0].type, 'boost_distance_2x');
  assert.equal(result.effects[0].expiresAt, now + 60 * 60 * 1000);
});

test('applyEffectOrOpposite cancels out opposite effect durations properly', () => {
  const now = 1_000_000;
  // Case A: 30 min buff + 10 min debuff -> 20 min buff remaining
  const initialA = [
    { id: '1', type: 'boost_distance_2x' as const, expiresAt: now + 30 * 60 * 1000 },
  ];
  const resA = applyEffectOrOpposite(initialA, { type: 'trap_distance_half', durationMs: 10 * 60 * 1000 }, now);
  assert.equal(resA.effects.length, 1);
  assert.equal(resA.effects[0].type, 'boost_distance_2x');
  assert.equal(resA.effects[0].expiresAt, now + 20 * 60 * 1000);

  // Case B: 10 min buff + 30 min debuff -> 20 min debuff remaining
  const initialB = [
    { id: '1', type: 'boost_distance_2x' as const, expiresAt: now + 10 * 60 * 1000 },
  ];
  const resB = applyEffectOrOpposite(initialB, { type: 'trap_distance_half', durationMs: 30 * 60 * 1000 }, now);
  assert.equal(resB.effects.length, 1);
  assert.equal(resB.effects[0].type, 'trap_distance_half');
  assert.equal(resB.effects[0].expiresAt, now + 20 * 60 * 1000);

  // Case C: 15 min buff + 15 min debuff -> 0 min (both removed!)
  const initialC = [
    { id: '1', type: 'speed_up' as const, expiresAt: now + 15 * 60 * 1000 },
  ];
  const resC = applyEffectOrOpposite(initialC, { type: 'trap_slow', durationMs: 15 * 60 * 1000 }, now);
  assert.equal(resC.effects.length, 0);
});

test('trap_distance_half cuts distance progression in half in applyLocations', () => {
  let save = freshSave();
  const debuffedSave = {
    ...save,
    effects: [{ id: 'trap-1', type: 'trap_distance_half' as const, expiresAt: START + 60_000 }],
  };
  // Move 20m over 5s
  const result = engineApplyLocations(debuffedSave, SESSION, [fix(0, 0, START + 10_000), fix(20, 0, START + 15_000)], START + 15_000, 5);
  near(result.distanceMeters, 10);
});

test('trap_slow cuts GPS speed limit in half in applyLocations', () => {
  let save = freshSave();
  // Base speed level 0 is 3.5 m/s.
  // With trap_slow, limit becomes 3.5 * 0.5 = 1.75 m/s.
  const trappedSave = {
    ...save,
    effects: [{ id: 'trap-slow-1', type: 'trap_slow' as const, expiresAt: START + 60_000 }],
  };
  // Moving 10m over 5s is 2 m/s. This is rejected because 2 m/s > 1.75 m/s:
  const result = engineApplyLocations(trappedSave, SESSION, [fix(0, 0, START + 10_000), fix(10, 0, START + 15_000)], START + 15_000, 0);
  assert.equal(result.distanceMeters, 0, 'Should reject 2 m/s when trapped limit is 1.75 m/s');
});

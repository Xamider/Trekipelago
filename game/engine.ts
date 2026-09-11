import type { ActiveEffect, ActivityEntry, EventItem, ItemType, LocationSample, Orb, SoloConfig, SoloSnapshot } from './types';

export const DEFAULT_SOLO_CONFIG: Readonly<SoloConfig> = Object.freeze({
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

export const SPAWN_INTERVAL_MS = 10_000;
export const FRESH_FIX_MS = 30_000;
const EARTH_RADIUS_METERS = 6_371_000;
const MAX_ACCURACY_METERS = 2000;

export const SPEED_LEVELS_MPS = [
  3.0 / 3.6,   // Level 0: 3.0 km/h (~0.833 m/s) - slow walking
  6.0 / 3.6,   // Level 1: 6.0 km/h (~1.667 m/s) - normal walking
  12.0 / 3.6,  // Level 2: 12.0 km/h (~3.333 m/s) - brisk jog
  22.0 / 3.6,  // Level 3: 22.0 km/h (~6.111 m/s) - running / casual cycling
  35.0 / 3.6,  // Level 4: 35.0 km/h (~9.722 m/s) - fast cycling
  50.0 / 3.6,  // Level 5: 50.0 km/h (~13.889 m/s) - max cycling / 50 km/h
];

export const ITEM_TYPES: ItemType[] = [
  'boost_drop_2x', 
  'boost_distance_2x', 
  'speed_up', 
  'boost_collect_2x',
  'unlock_background',
  'passive_collector',
  'progressive_speed',
  'trap_slow',
  'trap_distance_half',
  'trap_drop_half',
  'trap_collect_half',
  'trap_blind',
  'trap_distance',
  'trap_orbs',
  'burst_orbs',
];

export function isOppositeEffect(a: ItemType, b: ItemType): boolean {
  if (
    (a === 'boost_distance_2x' && (b === 'trap_distance_half' || b === 'trap_distance')) ||
    ((a === 'trap_distance_half' || a === 'trap_distance') && b === 'boost_distance_2x')
  ) {
    return true;
  }
  if (
    (a === 'boost_drop_2x' && (b === 'trap_drop_half' || b === 'trap_orbs')) ||
    ((a === 'trap_drop_half' || a === 'trap_orbs') && b === 'boost_drop_2x')
  ) {
    return true;
  }
  if (
    (a === 'speed_up' && b === 'trap_slow') ||
    (a === 'trap_slow' && b === 'speed_up')
  ) {
    return true;
  }
  if (
    (a === 'boost_collect_2x' && b === 'trap_collect_half') ||
    (a === 'trap_collect_half' && b === 'boost_collect_2x')
  ) {
    return true;
  }
  return false;
}

export function applyEffectOrOpposite(
  effects: ActiveEffect[],
  newItem: EventItem,
  now: number
): { effects: ActiveEffect[]; message: string } {
  const durationMs = newItem.durationMs || 300_000;
  const opposite = effects.find(e => isOppositeEffect(e.type, newItem.type));

  if (opposite) {
    const oppositeRemainingMs = Math.max(0, opposite.expiresAt - now);
    const oppDetails = getEffectDetails(opposite.type);
    const newDetails = getEffectDetails(newItem.type);

    if (oppositeRemainingMs > durationMs) {
      const remainingAfter = oppositeRemainingMs - durationMs;
      const updated = effects.map(e => e.id === opposite.id ? { ...e, expiresAt: now + remainingAfter } : e);
      const minLeft = Math.round(remainingAfter / 60_000);
      return {
        effects: updated,
        message: `${newDetails.name} neutralized by active ${oppDetails.name}! (${minLeft}m remaining on ${oppDetails.shortLabel})`,
      };
    } else if (oppositeRemainingMs === durationMs) {
      const updated = effects.filter(e => e.id !== opposite.id);
      return {
        effects: updated,
        message: `${newDetails.name} and active ${oppDetails.name} cancelled each other out!`,
      };
    } else {
      const excessDurationMs = durationMs - oppositeRemainingMs;
      const filtered = effects.filter(e => e.id !== opposite.id);
      const newEffect: ActiveEffect = {
        id: Math.random().toString(36).slice(2),
        type: newItem.type,
        expiresAt: now + excessDurationMs,
      };
      const excessMin = Math.round(excessDurationMs / 60_000);
      return {
        effects: [...filtered, newEffect],
        message: `Active ${oppDetails.name} absorbed part of ${newDetails.name}! ${excessMin}m applied.`,
      };
    }
  }

  const same = effects.find(e => e.type === newItem.type);
  if (same) {
    const existingRemainingMs = Math.max(0, same.expiresAt - now);
    const totalDurationMs = existingRemainingMs + durationMs;
    const updated = effects.map(e => e.id === same.id ? { ...e, expiresAt: now + totalDurationMs } : e);
    const details = getEffectDetails(newItem.type);
    const totalMin = Math.round(totalDurationMs / 60_000);
    return {
      effects: updated,
      message: `${details.name} extended by ${Math.round(durationMs / 60_000)}m (Total: ${totalMin}m)!`,
    };
  }

  const newEffect: ActiveEffect = {
    id: Math.random().toString(36).slice(2),
    type: newItem.type,
    expiresAt: now + durationMs,
  };
  const details = getEffectDetails(newItem.type);
  return {
    effects: [...effects, newEffect],
    message: `${details.name} activated for ${Math.round(durationMs / 60_000)}m!`,
  };
}

export const BUFF_ITEMS: ReadonlyArray<{ type: ItemType; weight: number }> = [
  { type: 'speed_up', weight: 30 },
  { type: 'boost_distance_2x', weight: 25 },
  { type: 'boost_drop_2x', weight: 25 },
  { type: 'boost_collect_2x', weight: 20 },
];

export const DEBUFF_ITEMS: ReadonlyArray<{ type: ItemType; weight: number }> = [
  { type: 'trap_slow', weight: 25 },
  { type: 'trap_distance_half', weight: 25 },
  { type: 'trap_drop_half', weight: 20 },
  { type: 'trap_collect_half', weight: 20 },
  { type: 'trap_blind', weight: 10 },
];

export const WEIGHTED_REGULAR_ITEMS: ReadonlyArray<{ type: ItemType; weight: number }> = [
  { type: 'speed_up', weight: 30 },
  { type: 'boost_drop_2x', weight: 25 },
  { type: 'boost_distance_2x', weight: 25 },
  { type: 'boost_collect_2x', weight: 20 },
  { type: 'trap_blind', weight: 10 },
  { type: 'trap_distance_half', weight: 15 },
];

export function rollWeightedItem(random: () => number, buffRatio: number = 0.7): ItemType {
  const isBuff = random() < Math.max(0, Math.min(1, buffRatio));
  const list = isBuff ? BUFF_ITEMS : DEBUFF_ITEMS;
  const totalWeight = list.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * totalWeight;
  for (const item of list) {
    if (roll < item.weight) return item.type;
    roll -= item.weight;
  }
  return list[0].type;
}

export interface EffectInfo {
  name: string;
  shortLabel: string;
  description: string;
  isTrap?: boolean;
}

export function getEffectDetails(type: string, level = 0): EffectInfo {
  switch (type) {
    case 'unlock_background':
      return {
        name: 'Background Tracking',
        shortLabel: 'BG TRACKING',
        description: 'Background Tracking: Counts distance and collects orbs even when your screen is locked or the app is minimized.',
      };
    case 'passive_collector':
      return {
        name: `Passive Collector (Level ${level}/3)`,
        shortLabel: `COLLECTOR LV.${level}`,
        description: `Automated Background Collector: Gathers light orbs within your region in the background. Level 1 collects 1 orb every 30s; Level 2 collects up to 2 orbs every 20s; Level 3 collects up to 3 orbs every 10s.`,
      };
    case 'progressive_speed':
      return {
        name: `Max Speed Limit (Level ${level}/5)`,
        shortLabel: `SPEED LV.${level}`,
        description: `Permanent Speed Cap Increase: Raises maximum acceptable GPS speed (from base 3.0 km/h up to ${(SPEED_LEVELS_MPS[Math.min(level, SPEED_LEVELS_MPS.length - 1)] * 3.6).toFixed(1)} km/h), preventing distance rejection while running or cycling.`,
      };
    case 'speed_up':
      return {
        name: 'Speed Boost (+50% speed limit)',
        shortLabel: '+50% SPEED',
        description: 'Temporary Boost: Increases your current GPS speed cap by +50%, allowing faster sprints or cycling without movement being rejected by the speed filter.',
      };
    case 'boost_distance_2x':
      return {
        name: 'Double Distance (2x)',
        shortLabel: '2X DISTANCE',
        description: 'Temporary Boost: Every meter traveled counts double towards your total journey distance and upcoming distance rewards.',
      };
    case 'boost_drop_2x':
      return {
        name: 'Double Orb Spawn Chance (2x)',
        shortLabel: '2X ORBS',
        description: 'Temporary Boost: Doubles the chance for a light orb to spawn on every roll interval (every 10 seconds) during your trek.',
      };
    case 'boost_collect_2x':
      return {
        name: 'Double Collected Orbs (2x)',
        shortLabel: '2X COLLECT',
        description: 'Temporary Boost: Every light orb collected counts as 2 towards your orb goal and upcoming milestones.',
      };
    case 'trap_blind':
      return {
        name: 'Map Blindness (Trap)',
        shortLabel: 'MAP BLINDED',
        description: 'Trap: Temporarily obscures the map view, requiring you to navigate without visual cues.',
        isTrap: true,
      };
    case 'trap_distance':
    case 'trap_distance_half':
      return {
        name: 'Half Distance (Trap)',
        shortLabel: '0.5X DISTANCE',
        description: 'Trap: Every meter traveled counts for only half (0.5x) progress towards your distance and upcoming rewards.',
        isTrap: true,
      };
    case 'trap_slow':
      return {
        name: 'Slow Movement (Trap)',
        shortLabel: '-50% SPEED',
        description: 'Trap: Cuts your GPS speed limit in half (-50%), requiring you to move slower so movement is not rejected.',
        isTrap: true,
      };
    case 'trap_orbs':
    case 'trap_drop_half':
      return {
        name: 'Half Orb Spawn Chance (Trap)',
        shortLabel: '0.5X ORBS',
        description: 'Trap: Reduces your light orb spawn chance by 50%.',
        isTrap: true,
      };
    case 'trap_collect_half':
      return {
        name: 'Half Collected Orbs (Trap)',
        shortLabel: '0.5X COLLECT',
        description: 'Trap: Every light orb collected counts for only half (0.5x) progress towards your orb goal.',
        isTrap: true,
      };
    default:
      return {
        name: type.replaceAll('_', ' ').toUpperCase(),
        shortLabel: type.toUpperCase(),
        description: 'Active in-game effect.',
      };
  }
}

const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (angle: number) => angle * 180 / Math.PI;
type Coordinates = Pick<LocationSample, 'latitude' | 'longitude'>;

export function validateConfig(config: SoloConfig): string | null {
  if (!Number.isFinite(config.radiusMeters) || config.radiusMeters <= 0) {
    return 'Region radius must be a positive number.';
  }
  if (!Number.isFinite(config.baseChance) || config.baseChance < 0.01 || config.baseChance > 1) {
    return 'Base chance must be between 1% and 100%.';
  }
  if (!Number.isFinite(config.spawnReduction) || config.spawnReduction <= 0 || config.spawnReduction > 1) {
    return 'Spawn reduction must be greater than 0% and at most 100%.';
  }
  if (!Number.isFinite(config.recoveryDistanceMeters) || config.recoveryDistanceMeters <= 0) {
    return 'Recovery distance must be a positive number.';
  }
  if (!Number.isFinite(config.maxDistanceMeters) || config.maxDistanceMeters <= 0) {
    return 'Max distance must be a positive number.';
  }
  if (!Number.isFinite(config.rewardIntervalMeters) || config.rewardIntervalMeters <= 0) {
    return 'Reward interval must be a positive number.';
  }
  if (!Number.isFinite(config.orbsPerReward) || config.orbsPerReward <= 0) {
    return 'Orbs per reward must be a positive number.';
  }
  if (config.maxOrbs !== undefined && (!Number.isFinite(config.maxOrbs) || config.maxOrbs <= 0)) {
    return 'Max orbs limit must be a positive number.';
  }
  if (config.buffRatio !== undefined && (!Number.isFinite(config.buffRatio) || config.buffRatio < 0 || config.buffRatio > 1)) {
    return 'Buff ratio must be between 0% and 100%.';
  }
  const distanceChecks = Math.floor(config.maxDistanceMeters / config.rewardIntervalMeters);
  const maxOrbsGoal = config.maxOrbs ?? 50;
  const orbChecks = Math.floor(maxOrbsGoal / config.orbsPerReward);
  const totalChecks = distanceChecks + orbChecks;
  const MIN_CHECKS_REQUIRED = 9; // 1 background tracking + 3 passive collectors + 5 speed levels
  if (totalChecks < MIN_CHECKS_REQUIRED) {
    return `Not enough reward milestones for all guaranteed progression items (${totalChecks}/${MIN_CHECKS_REQUIRED} checks available). Increase Max Distance or Max Orbs, or lower reward intervals.`;
  }
  return null;
}

export function addActivity(save: SoloSnapshot, kind: ActivityEntry['kind'], message: string, now: number, item?: EventItem): SoloSnapshot {
  const lastId = save.activity[save.activity.length - 1]?.id;
  const sequence = (Number(lastId?.split(':').pop()) || 0) + 1;
  const entry: ActivityEntry = {
    id: `${save.sessionId}:${now}:${sequence}`,
    kind,
    timestamp: now,
    message,
    ...(item ? { item } : {}),
  };
  return { ...save, activity: [...save.activity, entry].slice(-100) };
}

function rollDuration(type: ItemType, random: () => number): number | null {
  if (type === 'trap_blind') return random() < 0.85 ? 60_000 : 180_000;
  if (type === 'passive_collector' || type === 'progressive_speed' || type === 'unlock_background') return null;
  const r = random();
  if (r < 0.65) return 300_000;   // 5m (65% chance)
  if (r < 0.90) return 900_000;   // 15m (25% chance)
  return 1_800_000;               // 30m (10% chance)
}

export function generateExpeditionPools(
  distanceSize: number,
  orbSize: number,
  random: () => number = Math.random,
  buffRatio: number = 0.7,
): { distancePool: EventItem[]; orbPool: EventItem[] } {
  const distancePool: (EventItem | null)[] = new Array(distanceSize).fill(null);
  const orbPool: (EventItem | null)[] = new Array(orbSize).fill(null);
  const totalSlots = distanceSize + orbSize;
  if (totalSlots === 0) return { distancePool: [], orbPool: [] };

  // Map each global slot index to its pool and pool index, ordered by progression
  type GlobalSlot = { pool: 'distance' | 'orb'; poolIndex: number; progress: number };
  const allSlots: GlobalSlot[] = [];
  for (let i = 0; i < distanceSize; i++) {
    allSlots.push({ pool: 'distance', poolIndex: i, progress: (i + 0.5) / Math.max(1, distanceSize) });
  }
  for (let i = 0; i < orbSize; i++) {
    allSlots.push({ pool: 'orb', poolIndex: i, progress: (i + 0.5) / Math.max(1, orbSize) });
  }
  allSlots.sort((a, b) => a.progress - b.progress);

  const placedItems: (EventItem | null)[] = new Array(totalSlots).fill(null);

  // Helper to find candidate slots in a progression interval [minProg, maxProg], preferring non-adjacent
  function pickSlot(minProg: number, maxProg: number): number {
    const candidates: Array<{ index: number; weight: number }> = [];
    for (let i = 0; i < totalSlots; i++) {
      if (placedItems[i] !== null) continue;
      const prog = allSlots[i].progress;
      let weight = (prog >= minProg && prog <= maxProg) ? 10 : Math.max(0.1, 1 - Math.abs(prog - (minProg + maxProg) / 2));
      // Spacing penalty: drastically reduce weight if adjacent slot already has a guaranteed item
      const leftOccupied = i > 0 && placedItems[i - 1] !== null;
      const rightOccupied = i < totalSlots - 1 && placedItems[i + 1] !== null;
      if (leftOccupied || rightOccupied) {
        weight *= 0.05;
      }
      candidates.push({ index: i, weight });
    }
    if (candidates.length === 0) {
      return placedItems.findIndex(item => item === null);
    }
    const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
    let r = random() * totalWeight;
    for (const c of candidates) {
      r -= c.weight;
      if (r <= 0) return c.index;
    }
    return candidates[0].index;
  }

  // 1. Background Tracking: 50% chance in first 10% of game, <1% chance past 50%
  const u = random();
  let bgTargetProg: number;
  if (u < 0.50) {
    bgTargetProg = random() * 0.10; // First 10% of expedition (50% probability)
  } else if (u < 0.99) {
    bgTargetProg = 0.10 + random() * 0.40; // 10% - 50% of expedition (49% probability)
  } else {
    bgTargetProg = 0.50 + random() * 0.50; // Past 50% (1% probability)
  }
  const bgSlot = pickSlot(Math.max(0, bgTargetProg - 0.05), Math.min(1, bgTargetProg + 0.05));
  if (bgSlot !== -1) {
    placedItems[bgSlot] = { type: 'unlock_background', durationMs: null };
  }

  // 2. Guaranteed items:
  // - 3x passive_collector (early, middle, late)
  // - 5x progressive_speed (across 5 sectors)
  const progressionQueue: Array<{ type: ItemType; minProg: number; maxProg: number }> = [
    { type: 'passive_collector', minProg: 0.00, maxProg: 0.35 },
    { type: 'progressive_speed', minProg: 0.00, maxProg: 0.20 },
    { type: 'progressive_speed', minProg: 0.20, maxProg: 0.40 },
    { type: 'passive_collector', minProg: 0.35, maxProg: 0.70 },
    { type: 'progressive_speed', minProg: 0.40, maxProg: 0.60 },
    { type: 'progressive_speed', minProg: 0.60, maxProg: 0.80 },
    { type: 'passive_collector', minProg: 0.70, maxProg: 1.00 },
    { type: 'progressive_speed', minProg: 0.80, maxProg: 1.00 },
  ];

  for (const prog of progressionQueue) {
    const slotIdx = pickSlot(prog.minProg, prog.maxProg);
    if (slotIdx === -1) break;
    placedItems[slotIdx] = { type: prog.type, durationMs: null };
  }

  // 3. Filler items (buffs & debuffs weighted according to buffRatio)
  for (let i = 0; i < totalSlots; i++) {
    if (placedItems[i] === null) {
      const type = rollWeightedItem(random, buffRatio);
      placedItems[i] = { type, durationMs: rollDuration(type, random) };
    }
  }

  // Distribute back to distancePool and orbPool
  for (let i = 0; i < totalSlots; i++) {
    const slot = allSlots[i];
    const item = placedItems[i]!;
    if (slot.pool === 'distance') {
      distancePool[slot.poolIndex] = item;
    } else {
      orbPool[slot.poolIndex] = item;
    }
  }

  return {
    distancePool: distancePool as EventItem[],
    orbPool: orbPool as EventItem[],
  };
}

export function createSave(config: SoloConfig, sessionId: string, now: number): SoloSnapshot {
  const error = validateConfig(config);
  if (error) throw new Error(error);
  const maxOrbs = config.maxOrbs ?? 50;
  const orbPoolSize = Math.max(1, Math.floor(maxOrbs / config.orbsPerReward));
  const distancePoolSize = Math.max(1, Math.floor(config.maxDistanceMeters / config.rewardIntervalMeters));
  const pools = generateExpeditionPools(distancePoolSize, orbPoolSize, Math.random, config.buffRatio ?? 0.7);

  return addActivity({
    sessionId,
    config: { ...config, maxOrbs },
    tracking: true,
    createdAt: now,
    updatedAt: now,
    distanceMeters: 0,
    lastRewardedDistance: 0,
    lastRewardedOrbs: 0,
    chance: config.baseChance,
    collectedCount: 0,
    lastFix: null,
    distanceAnchor: null,
    lastProcessedTimestamp: 0,
    nextSpawnAt: now + SPAWN_INTERVAL_MS,
    orbs: [],
    activity: [],
    effects: [],
    backgroundUnlocked: false,
    backgroundCollectorLevel: 0,
    speedLevel: 0,
    distanceItemPool: pools.distancePool,
    distanceItemsClaimed: 0,
    orbItemPool: pools.orbPool,
    orbItemsClaimed: 0,
  }, 'game', 'Solo journey started. Waiting for GPS.', now);
}

/** Restarting the native tracker must always supply a new session identifier. */
export function setTracking(save: SoloSnapshot, tracking: boolean, newSessionId: string, now: number): SoloSnapshot {
  if (save.tracking === tracking && save.sessionId === newSessionId) return save;
  return addActivity({
    ...save,
    sessionId: newSessionId,
    tracking,
    updatedAt: now,
    lastFix: null,
    distanceAnchor: null,
    lastProcessedTimestamp: now - 1,
    nextSpawnAt: now + SPAWN_INTERVAL_MS,
  }, 'tracking', tracking ? 'Tracking resumed. Waiting for fresh GPS.' : 'Tracking paused.', now);
}

/** Called on foreground entry so a background interval never produces catch-up rolls. */
export function resetSpawnClock(save: SoloSnapshot, now: number): SoloSnapshot {
  const nextSpawnAt = now + SPAWN_INTERVAL_MS;
  return save.nextSpawnAt === nextSpawnAt ? save : { ...save, nextSpawnAt, updatedAt: now };
}

function validCoordinates(point: Coordinates): boolean {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

export function distanceBetween(a: Coordinates, b: Coordinates): number {
  if (!validCoordinates(a) || !validCoordinates(b)) return Number.NaN;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))));
}

function validFix(fix: LocationSample, now: number): boolean {
  return validCoordinates(fix)
    && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= MAX_ACCURACY_METERS
    && Number.isFinite(fix.timestamp) && fix.timestamp >= 0 && fix.timestamp <= now + 30000;
}

export function isFreshFix(save: SoloSnapshot, now: number): boolean {
  return save.lastFix !== null && validFix(save.lastFix, now) && now >= save.lastFix.timestamp && now - save.lastFix.timestamp <= FRESH_FIX_MS;
}

/** A backward device-clock jump must reset timing/GPS baselines instead of stalling tracking forever. */
function recoverFromClockRollback(save: SoloSnapshot, now: number): SoloSnapshot {
  if (now >= save.updatedAt) return save;
  return {
    ...save,
    lastFix: null,
    distanceAnchor: null,
    lastProcessedTimestamp: now - 1,
    nextSpawnAt: now + SPAWN_INTERVAL_MS,
    updatedAt: now,
  };
}

export function rollEvent(save: SoloSnapshot, now: number, source: 'distance' | 'orbs', random: () => number): SoloSnapshot {
  let next = { ...save };
  let eventItem: EventItem;
  
  if (source === 'distance') {
    if (next.distanceItemPool && (next.distanceItemsClaimed ?? 0) < next.distanceItemPool.length) {
      eventItem = next.distanceItemPool[next.distanceItemsClaimed ?? 0];
      next.distanceItemsClaimed = (next.distanceItemsClaimed ?? 0) + 1;
    } else {
      const type = rollWeightedItem(random, next.config.buffRatio ?? 0.7);
      eventItem = { type, durationMs: rollDuration(type, random) };
    }
  } else {
    if (next.orbItemPool && (next.orbItemsClaimed ?? 0) < next.orbItemPool.length) {
      eventItem = next.orbItemPool[next.orbItemsClaimed ?? 0];
      next.orbItemsClaimed = (next.orbItemsClaimed ?? 0) + 1;
    } else {
      const type = rollWeightedItem(random, next.config.buffRatio ?? 0.7);
      eventItem = { type, durationMs: rollDuration(type, random) };
    }
  }
  
  let message = '';

  if (eventItem.type === 'unlock_background') {
    if (!next.backgroundUnlocked) {
      next.backgroundUnlocked = true;
      message = 'Item found: Background Tracking Unlocked!';
    } else {
      next.distanceMeters += 250;
      message = 'Item found: +250m Distance Bonus!';
    }
  } else if (eventItem.type === 'passive_collector') {
    next.backgroundCollectorLevel = Math.min(3, (next.backgroundCollectorLevel || 0) + 1);
    message = `Item found: Passive Background Orb Collector (Level ${next.backgroundCollectorLevel})!`;
  } else if (eventItem.type === 'progressive_speed') {
    next.speedLevel = Math.min(SPEED_LEVELS_MPS.length - 1, (next.speedLevel || 0) + 1);
    const speedKmh = (SPEED_LEVELS_MPS[next.speedLevel] * 3.6).toFixed(1);
    message = `Item found: Max Speed Limit Increased (Level ${next.speedLevel} - ${speedKmh} km/h)!`;
  } else {
    let mappedType = eventItem.type;
    if (mappedType === 'trap_distance') mappedType = 'trap_distance_half';
    if (mappedType === 'trap_orbs') mappedType = 'trap_drop_half';

    const result = applyEffectOrOpposite(next.effects, { ...eventItem, type: mappedType }, now);
    next.effects = result.effects;
    message = result.message;
  }

  const reasonDesc = source === 'distance' ? 'Distance Milestone' : 'Orb Milestone';
  return addActivity(next, 'event', message + ` (${reasonDesc})`, now, eventItem);
}

export function cleanupEffects(save: SoloSnapshot, now: number): SoloSnapshot {
  const activeEffects = save.effects.filter(e => e.expiresAt > now);
  if (activeEffects.length === save.effects.length) return save;
  return { ...save, effects: activeEffects, updatedAt: now };
}

export function applyLocations(save: SoloSnapshot, sessionId: string, fixes: LocationSample[], now: number, maxSpeedLevel: number = 0): SoloSnapshot {
  if (!save.tracking || save.sessionId !== sessionId) return save;
  let next = recoverFromClockRollback(save, now);
  next = cleanupEffects(next, now);
  
  const ordered = [...fixes].sort((a, b) => a.timestamp - b.timestamp);
  
  const effectiveSpeedLevel = Math.max(save.speedLevel || 0, maxSpeedLevel);
  let currentSpeedLimit = SPEED_LEVELS_MPS[Math.min(effectiveSpeedLevel, SPEED_LEVELS_MPS.length - 1)] ?? SPEED_LEVELS_MPS[0];
  if (next.effects.some(e => e.type === 'speed_up')) {
    currentSpeedLimit *= 1.5; // temporary 50% speed increase
  } else if (next.effects.some(e => e.type === 'trap_slow')) {
    currentSpeedLimit *= 0.5; // temporary 50% speed reduction trap
  }

  const doubleDistance = next.effects.some(e => e.type === 'boost_distance_2x');
  const halfDistance = next.effects.some(e => e.type === 'trap_distance_half' || e.type === 'trap_distance');
  const distMultiplier = doubleDistance ? 2 : (halfDistance ? 0.5 : 1);

  for (const sourceFix of ordered) {
    if (!validFix(sourceFix, now) || sourceFix.timestamp <= next.lastProcessedTimestamp) continue;
    const fix = { ...sourceFix };
    const previous = next.lastFix;
    const gap = previous ? fix.timestamp - previous.timestamp : Infinity;
    
    next = { ...next, lastProcessedTimestamp: fix.timestamp, updatedAt: now };
    
    if (previous && gap <= FRESH_FIX_MS
      && distanceBetween(previous, fix) / (gap / 1_000) > currentSpeedLimit) continue;

    let distance = 0;
    let anchor = next.distanceAnchor;
    if (!anchor || gap > FRESH_FIX_MS) {
      anchor = fix;
    } else {
      const displacement = distanceBetween(anchor, fix);
      const threshold = Math.max(3, (anchor.accuracy + fix.accuracy) / 2);
      if (displacement >= threshold) {
        distance = displacement;
        anchor = fix;
      }
    }
    const wasWaiting = previous === null || gap > FRESH_FIX_MS;
    next = {
      ...next,
      lastFix: fix,
      distanceAnchor: anchor,
    };
    
    if (distance > 0) {
      next.distanceMeters += distance * distMultiplier;
      next.chance = Math.min(next.config.baseChance, next.chance + next.config.baseChance * distance / (next.config.recoveryDistanceMeters || 1));

      // Check distance milestones (award every crossed interval)
      let lastRewardedDist = next.lastRewardedDistance || 0;
      while (next.distanceMeters - lastRewardedDist >= next.config.rewardIntervalMeters) {
        lastRewardedDist += next.config.rewardIntervalMeters;
        next.lastRewardedDistance = lastRewardedDist;
        next = rollEvent(next, fix.timestamp, 'distance', Math.random);
      }
    }
    
    next.orbs = next.orbs.filter(orb => distanceBetween(fix, orb) <= next.config.radiusMeters);
    if (wasWaiting) next = addActivity(next, 'tracking', 'GPS acquired. Tracking movement.', fix.timestamp);
  }
  
  // Try passive background collection if enabled
  const maxOrbsGoal = next.config.maxOrbs ?? 50;
  if (next.collectedCount < maxOrbsGoal && next.backgroundCollectorLevel > 0 && fixes.length > 0 && Math.random() < (next.backgroundCollectorLevel * 0.1) * (fixes.length / 10)) {
    const orbsToGrab = Math.floor(Math.random() * next.backgroundCollectorLevel) + 1;
    let actualCount = 0;
    
    // Auto-collect nearby orbs
    const toKill: string[] = [];
    if (next.lastFix) {
      for (const o of next.orbs) {
        if (toKill.length < orbsToGrab && distanceBetween(next.lastFix, o) <= next.config.radiusMeters) {
          toKill.push(o.id);
          actualCount++;
          if (next.collectedCount + actualCount >= maxOrbsGoal) break;
        }
      }
    }
    
    if (actualCount > 0) {
      const hasCollectBoost = next.effects.some(e => e.type === 'boost_collect_2x');
      const hasCollectDebuff = next.effects.some(e => e.type === 'trap_collect_half');
      const collectMultiplier = hasCollectBoost ? 2 : hasCollectDebuff ? 0.5 : 1;
      const countAdded = actualCount * collectMultiplier;

      next = addActivity({
        ...next,
        updatedAt: now,
        collectedCount: next.collectedCount + countAdded,
        orbs: next.orbs.filter(o => !toKill.includes(o.id))
      }, 'collection', 'Auto-collected ' + actualCount + ' orbs in background!', now);
      
      let lastRewardedOrbs = next.lastRewardedOrbs || 0;
      while (next.collectedCount - lastRewardedOrbs >= next.config.orbsPerReward) {
        lastRewardedOrbs += next.config.orbsPerReward;
        next.lastRewardedOrbs = lastRewardedOrbs;
        next = rollEvent(next, now, 'orbs', Math.random);
      }
    }
  }
  
  return next;
}

function randomFraction(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('Random source must return a finite value in [0, 1).');
  }
  return value;
}

function spawnPosition(center: LocationSample, radiusMeters: number, random: () => number): Coordinates {
  const angularRadius = Math.min(Math.PI, radiusMeters / EARTH_RADIUS_METERS);
  const angularDistance = 2 * Math.asin(Math.sqrt(randomFraction(random)) * Math.sin(angularRadius / 2));
  const bearing = 2 * Math.PI * randomFraction(random);
  const latitude = radians(center.latitude);
  const longitude = radians(center.longitude);
  const resultLatitude = Math.asin(Math.max(-1, Math.min(1,
    Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing))));
  const resultLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(resultLatitude),
  );
  return { latitude: degrees(resultLatitude), longitude: ((degrees(resultLongitude) + 540) % 360) - 180 };
}

export function rollSpawn(save: SoloSnapshot, sessionId: string, now: number, foreground: boolean, random: () => number): SoloSnapshot {
  if (!save.tracking || save.sessionId !== sessionId || !foreground) return save;
  let next = recoverFromClockRollback(save, now);
  next = cleanupEffects(next, now);

  if (now < next.nextSpawnAt) return next;

  const fix = next.lastFix;
  if (!isFreshFix(save, now) || !fix) {
    return { ...next, nextSpawnAt: now + SPAWN_INTERVAL_MS, updatedAt: now };
  }

  const maxOrbsGoal = next.config.maxOrbs ?? 50;
  if (next.collectedCount + next.orbs.length >= maxOrbsGoal) {
    return { ...next, nextSpawnAt: now + SPAWN_INTERVAL_MS, updatedAt: now };
  }

  const spawnedOrbs: Orb[] = [];
  let spawnIndex = 0;

  while (true) {
    if (next.collectedCount + next.orbs.length + spawnedOrbs.length >= maxOrbsGoal) break;

    let chance = next.chance;
    if (next.effects.some(e => e.type === 'boost_drop_2x')) chance = Math.min(1.0, chance * 2);
    else if (next.effects.some(e => e.type === 'trap_drop_half' || e.type === 'trap_orbs')) chance = chance * 0.5;

    const roll = randomFraction(random);
    if (roll >= chance) {
      break;
    }

    const orbId = spawnIndex === 0 ? `${next.sessionId}:orb:${now}` : `${next.sessionId}:orb:${now}-${spawnIndex}`;
    const orb: Orb = {
      id: orbId,
      ...spawnPosition(fix, next.config.radiusMeters, random),
      spawnedAt: now,
    };
    spawnedOrbs.push(orb);
    next = {
      ...next,
      chance: next.chance * (1 - next.config.spawnReduction),
    };
    spawnIndex++;
  }

  next = { ...next, nextSpawnAt: now + SPAWN_INTERVAL_MS, updatedAt: now };
  if (spawnedOrbs.length === 0) return next;

  const msg = spawnedOrbs.length === 1
    ? "A light orb appeared in your region."
    : `${spawnedOrbs.length} light orbs appeared in your region!`;

  return addActivity({
    ...next,
    orbs: [...next.orbs, ...spawnedOrbs],
  }, "spawn", msg, now);
}

export function collectOrb(save: SoloSnapshot, sessionId: string, orbId: string, now: number): SoloSnapshot {
  if (!save.tracking || save.sessionId !== sessionId || !isFreshFix(save, now) || !save.lastFix) return save;
  const orb = save.orbs.find(candidate => candidate.id === orbId);
  if (!orb || distanceBetween(save.lastFix, orb) > save.config.radiusMeters) return save;

  const hasCollectBoost = save.effects.some(e => e.type === "boost_collect_2x");
  const hasCollectDebuff = save.effects.some(e => e.type === "trap_collect_half");
  const collectIncrement = hasCollectBoost ? 2 : hasCollectDebuff ? 0.5 : 1;

  let next = addActivity({
    ...save,
    updatedAt: now,
    collectedCount: save.collectedCount + collectIncrement,
    orbs: save.orbs.filter(candidate => candidate.id !== orbId),
  }, "collection", "Light orb collected.", now);

  // Check orb milestone (award every crossed interval)
  let lastRewarded = next.lastRewardedOrbs || 0;
  while (next.collectedCount - lastRewarded >= next.config.orbsPerReward) {
    lastRewarded += next.config.orbsPerReward;
    next.lastRewardedOrbs = lastRewarded;
    next = rollEvent(next, now, "orbs", Math.random);
  }

  return next;
}

export function injectTestEffects(save: SoloSnapshot, now: number): SoloSnapshot {
  return {
    ...save,
    backgroundUnlocked: true,
    backgroundCollectorLevel: 3,
    speedLevel: 5,
    effects: [
      { id: "test-trap-drop", type: "trap_drop_half", expiresAt: now + 30 * 60 * 1000 },
      { id: "test-trap-dist", type: "trap_distance_half", expiresAt: now + 30 * 60 * 1000 },
      { id: "test-trap-slow", type: "trap_slow", expiresAt: now + 30 * 60 * 1000 },
      { id: "test-trap-blind", type: "trap_blind", expiresAt: now + 3 * 60 * 1000 },
    ],
  };
}

export function clearAllEffects(save: SoloSnapshot, now: number = Date.now()): SoloSnapshot {
  return {
    ...save,
    effects: [],
    updatedAt: now,
  };
}

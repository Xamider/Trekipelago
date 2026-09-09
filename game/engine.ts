import type { ActiveEffect, ActivityEntry, EventItem, ItemType, LocationSample, Orb, SoloConfig, SoloSnapshot } from './types';

export const DEFAULT_SOLO_CONFIG: Readonly<SoloConfig> = Object.freeze({
  radiusMeters: 100,
  baseChance: 0.2,
  maxDistanceMeters: 5000,
  rewardIntervalMeters: 500,
  orbsPerReward: 5,
  maxOrbs: 50,
  spawnReduction: 0.25,
  recoveryDistanceMeters: 100,
});

export const SPAWN_INTERVAL_MS = 10_000;
export const FRESH_FIX_MS = 30_000;
const EARTH_RADIUS_METERS = 6_371_000;
const MAX_ACCURACY_METERS = 2000;

export const SPEED_LEVELS_MPS = [
  3.5,
  7.5,
  12.5,
  19.5,
  27.8,
  38.9
];

export const ITEM_TYPES: ItemType[] = [
  'boost_drop_2x', 
  'boost_distance_2x', 
  'speed_up', 
  'burst_orbs', 
  'unlock_background',
  'trap_distance',
  'trap_orbs',
  'trap_blind',
  'passive_collector',
  'progressive_speed',
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

export const WEIGHTED_REGULAR_ITEMS: ReadonlyArray<{ type: ItemType; weight: number }> = [
  { type: 'speed_up', weight: 35 },
  { type: 'boost_drop_2x', weight: 25 },
  { type: 'boost_distance_2x', weight: 20 },
  { type: 'trap_blind', weight: 12 },
  { type: 'trap_distance', weight: 8 },
];

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
        description: `Permanent Speed Cap Increase: Raises maximum acceptable GPS speed (from base 12.6 km/h up to ${(SPEED_LEVELS_MPS[Math.min(level, SPEED_LEVELS_MPS.length - 1)] * 3.6).toFixed(1)} km/h), preventing distance rejection while running or cycling.`,
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
    case 'trap_blind':
      return {
        name: 'Map Blindness (Trap)',
        shortLabel: 'MAP BLINDED',
        description: 'Trap: Temporarily obscures the map view, requiring you to navigate without visual cues.',
        isTrap: true,
      };
    case 'trap_distance':
      return {
        name: 'Distance Theft (Trap)',
        shortLabel: 'LOST DISTANCE',
        description: 'Instant Trap: Deducts up to 500 meters from your current journey distance progress.',
        isTrap: true,
      };
    case 'trap_slow':
      return {
        name: 'Slow Movement (Trap)',
        shortLabel: '-50% SPEED',
        description: 'Trap: Cuts your GPS speed limit in half (-50%) for 30 minutes, requiring you to move slower so movement is not rejected.',
        isTrap: true,
      };
    case 'trap_drop_half':
      return {
        name: 'Half Orb Spawn Chance (Trap)',
        shortLabel: '0.5X ORBS',
        description: 'Trap: Reduces your light orb spawn chance by 50% for 30 minutes.',
        isTrap: true,
      };
    case 'trap_distance_half':
      return {
        name: 'Half Distance (Trap)',
        shortLabel: '0.5X DISTANCE',
        description: 'Trap: Every meter traveled counts for only half (0.5x) progress towards your distance and upcoming rewards for 30 minutes.',
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

function rollWeightedItem(random: () => number): ItemType {
  const totalWeight = WEIGHTED_REGULAR_ITEMS.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * totalWeight;
  for (const item of WEIGHTED_REGULAR_ITEMS) {
    if (roll < item.weight) return item.type;
    roll -= item.weight;
  }
  return WEIGHTED_REGULAR_ITEMS[0].type;
}

const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (angle: number) => angle * 180 / Math.PI;
type Coordinates = Pick<LocationSample, 'latitude' | 'longitude'>;

export function validateConfig(config: SoloConfig): string | null {
  if (!Number.isFinite(config.radiusMeters) || config.radiusMeters <= 0) {
    return 'Region radius must be a positive number.';
  }
  if (!Number.isFinite(config.baseChance) || config.baseChance <= 0 || config.baseChance > 1) {
    return 'Base chance must be greater than 0% and at most 100%.';
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
  return null;
}

export function addActivity(save: SoloSnapshot, kind: ActivityEntry['kind'], message: string, now: number): SoloSnapshot {
  const lastId = save.activity[save.activity.length - 1]?.id;
  const sequence = (Number(lastId?.split(':').pop()) || 0) + 1;
  const entry: ActivityEntry = { id: `${save.sessionId}:${now}:${sequence}`, kind, timestamp: now, message };
  return { ...save, activity: [...save.activity, entry].slice(-100) };
}

function rollDuration(type: ItemType, random: () => number): number | null {
  if (type === 'trap_blind') return random() < 0.95 ? 60_000 : 300_000;
  if (type === 'passive_collector' || type === 'progressive_speed' || type === 'unlock_background') return null;
  if (
    type === 'boost_drop_2x' ||
    type === 'boost_distance_2x' ||
    type === 'speed_up' ||
    type === 'trap_slow' ||
    type === 'trap_drop_half' ||
    type === 'trap_distance_half'
  ) {
    const r = random();
    if (r < 0.65) return 300_000; // 5m
    if (r < 0.90) return 900_000; // 15m
    return 1_800_000; // 30m
  }
  return null;
}

export function generateExpeditionPools(distanceSize: number, orbSize: number, random: () => number): { distancePool: EventItem[]; orbPool: EventItem[] } {
  const distancePool: (EventItem | null)[] = new Array(distanceSize).fill(null);
  const orbPool: (EventItem | null)[] = new Array(orbSize).fill(null);

  // 1. Guaranteed unlock_background: placed with cubic bias towards early slots
  const putUnlockInDistance = orbSize <= 0 || (distanceSize > 0 && random() < 0.5);
  if (putUnlockInDistance && distanceSize > 0) {
    const unlockIdx = Math.floor(Math.pow(random(), 3) * distanceSize);
    distancePool[unlockIdx] = { type: 'unlock_background', durationMs: null };
  } else if (orbSize > 0) {
    const unlockIdx = Math.floor(Math.pow(random(), 3) * orbSize);
    orbPool[unlockIdx] = { type: 'unlock_background', durationMs: null };
  }

  // 2. Guaranteed progressive items:
  // - 3x passive_collector (up to max level 3)
  // - 5x progressive_speed (up to max level 5: 38.9 m/s)
  const guaranteedProgression: ItemType[] = [
    'passive_collector', 'passive_collector', 'passive_collector',
    'progressive_speed', 'progressive_speed', 'progressive_speed', 'progressive_speed', 'progressive_speed',
  ];

  // Collect all free slots across both pools
  type SlotRef = { pool: 'distance' | 'orb'; index: number };
  const freeSlots: SlotRef[] = [];
  for (let i = 0; i < distanceSize; i++) {
    if (distancePool[i] === null) freeSlots.push({ pool: 'distance', index: i });
  }
  for (let i = 0; i < orbSize; i++) {
    if (orbPool[i] === null) freeSlots.push({ pool: 'orb', index: i });
  }

  // Shuffle free slots using Fisher-Yates
  for (let i = freeSlots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = freeSlots[i];
    freeSlots[i] = freeSlots[j];
    freeSlots[j] = temp;
  }

  // Place guaranteed progression items into available free slots
  for (const progType of guaranteedProgression) {
    const slot = freeSlots.pop();
    if (!slot) break;
    const item: EventItem = { type: progType, durationMs: null };
    if (slot.pool === 'distance') {
      distancePool[slot.index] = item;
    } else {
      orbPool[slot.index] = item;
    }
  }

  // 3. Fill all remaining slots with weighted random buffs and debuffs (no orb-altering items)
  for (let i = 0; i < distanceSize; i++) {
    if (distancePool[i] === null) {
      const type = rollWeightedItem(random);
      distancePool[i] = { type, durationMs: rollDuration(type, random) };
    }
  }
  for (let i = 0; i < orbSize; i++) {
    if (orbPool[i] === null) {
      const type = rollWeightedItem(random);
      orbPool[i] = { type, durationMs: rollDuration(type, random) };
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
  const distancePoolSize = Math.max(1, Math.floor(config.maxDistanceMeters / config.rewardIntervalMeters) + 5);
  const pools = generateExpeditionPools(distancePoolSize, orbPoolSize, Math.random);

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
      const type = rollWeightedItem(random);
      eventItem = { type, durationMs: rollDuration(type, random) };
    }
  } else {
    if (next.orbItemPool && (next.orbItemsClaimed ?? 0) < next.orbItemPool.length) {
      eventItem = next.orbItemPool[next.orbItemsClaimed ?? 0];
      next.orbItemsClaimed = (next.orbItemsClaimed ?? 0) + 1;
    } else {
      const type = rollWeightedItem(random);
      eventItem = { type, durationMs: rollDuration(type, random) };
    }
  }
  
  let message = '';
  const durStr = eventItem.durationMs ? ' (' + Math.round(eventItem.durationMs / 60000) + ' min)' : '';
  
  if (eventItem.type === 'boost_drop_2x') {
    next.effects = [...next.effects.filter(e => e.type !== eventItem.type), { id: Math.random().toString(), type: eventItem.type, expiresAt: now + (eventItem.durationMs || 300_000) }];
    message = 'Item found: 2x Orb Drop Boost' + durStr + '!';
  } else if (eventItem.type === 'boost_distance_2x') {
    next.effects = [...next.effects.filter(e => e.type !== eventItem.type), { id: Math.random().toString(), type: eventItem.type, expiresAt: now + (eventItem.durationMs || 300_000) }];
    message = 'Item found: 2x Distance Boost' + durStr + '!';
  } else if (eventItem.type === 'speed_up') {
    next.effects = [...next.effects.filter(e => e.type !== eventItem.type), { id: Math.random().toString(), type: eventItem.type, expiresAt: now + (eventItem.durationMs || 300_000) }];
    message = 'Item found: Speed Limit Increased (+50%)' + durStr + '!';
  } else if (eventItem.type === 'burst_orbs') {
    message = 'Item found: Orb Energy!';
  } else if (eventItem.type === 'unlock_background') {
    if (!next.backgroundUnlocked) {
      next.backgroundUnlocked = true;
      message = 'Item found: Background Tracking Unlocked!';
    } else {
      next.distanceMeters += 250;
      message = 'Item found: +250m Distance Bonus!';
    }
  } else if (eventItem.type === 'trap_distance') {
    const penalty = Math.min(next.distanceMeters, 500);
    next.distanceMeters -= penalty;
    message = `Trap triggered: Lost ${Math.round(penalty)}m!`;
  } else if (eventItem.type === 'trap_orbs') {
    message = 'Trap avoided!';
  } else if (eventItem.type === 'trap_blind') {
    next.effects = [...next.effects.filter(e => e.type !== eventItem.type), { id: Math.random().toString(), type: eventItem.type, expiresAt: now + (eventItem.durationMs || 60_000) }];
    message = 'Trap triggered: Screen blinded' + durStr + '!';
  } else if (eventItem.type === 'passive_collector') {
    next.backgroundCollectorLevel = Math.min(3, (next.backgroundCollectorLevel || 0) + 1);
    message = 'Item found: Passive Background Orb Collector (Level ' + next.backgroundCollectorLevel + ')';
  } else if (eventItem.type === 'progressive_speed') {
    next.speedLevel = Math.min(SPEED_LEVELS_MPS.length - 1, (next.speedLevel || 0) + 1);
    const speedKmh = (SPEED_LEVELS_MPS[next.speedLevel] * 3.6).toFixed(1);
    message = `Item found: Max Speed Limit Increased (Level ${next.speedLevel} - ${speedKmh} km/h)!`;
  }

  const reasonDesc = source === 'distance' ? 'Distance Milestone' : 'Orb Milestone';
  return addActivity(next, 'event', message + ` (${reasonDesc})`, now);
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
    
    // Mark even an implausible fix as processed, so replaying a native batch is idempotent.
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
      next = addActivity({
        ...next,
        updatedAt: now,
        collectedCount: next.collectedCount + actualCount,
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
  if (!isFreshFix(next, now) || !fix) {
    return { ...next, nextSpawnAt: now + SPAWN_INTERVAL_MS, updatedAt: now };
  }

  const maxOrbsGoal = next.config.maxOrbs ?? 50;
  const spawnedOrbs: Orb[] = [];
  let spawnIndex = 0;

  // Chain-roll: when an orb drops, immediately roll again with reduced chance until a roll fails
  while (true) {
    if (next.collectedCount + next.orbs.length + spawnedOrbs.length >= maxOrbsGoal) break;

    let chance = next.chance;
    if (next.effects.some(e => e.type === 'boost_drop_2x')) chance = Math.min(1.0, chance * 2);

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
    ? 'A light orb appeared in your region.'
    : `${spawnedOrbs.length} light orbs appeared in your region!`;

  return addActivity({
    ...next,
    orbs: [...next.orbs, ...spawnedOrbs],
  }, 'spawn', msg, now);
}

export function collectOrb(save: SoloSnapshot, sessionId: string, orbId: string, now: number): SoloSnapshot {
  if (!save.tracking || save.sessionId !== sessionId || !isFreshFix(save, now) || !save.lastFix) return save;
  const orb = save.orbs.find(candidate => candidate.id === orbId);
  if (!orb || distanceBetween(save.lastFix, orb) > save.config.radiusMeters) return save;
  
  let next = addActivity({
    ...save,
    updatedAt: now,
    collectedCount: save.collectedCount + 1,
    orbs: save.orbs.filter(candidate => candidate.id !== orbId),
  }, 'collection', 'Light orb collected.', now);
  
  // Check orb milestone (award every crossed interval)
  let lastRewarded = next.lastRewardedOrbs || 0;
  while (next.collectedCount - lastRewarded >= next.config.orbsPerReward) {
    lastRewarded += next.config.orbsPerReward;
    next.lastRewardedOrbs = lastRewarded;
    next = rollEvent(next, now, 'orbs', Math.random);
  }
  
  return next;
}

/** Temporary test helper: inject all buffs and perks to easily inspect their visual appearance. */
export function injectTestEffects(save: SoloSnapshot, now: number): SoloSnapshot {
  return {
    ...save,
    backgroundUnlocked: true,
    backgroundCollectorLevel: 3,
    speedLevel: 5,
    effects: [
      { id: 'test-trap-drop', type: 'trap_drop_half', expiresAt: now + 30 * 60 * 1000 },
      { id: 'test-trap-dist', type: 'trap_distance_half', expiresAt: now + 30 * 60 * 1000 },
      { id: 'test-trap-slow', type: 'trap_slow', expiresAt: now + 30 * 60 * 1000 },
      { id: 'test-trap-blind', type: 'trap_blind', expiresAt: now + 3 * 60 * 1000 },
    ],
  };
}

/** Remove all active temporary effects. */
export function clearAllEffects(save: SoloSnapshot, now: number = Date.now()): SoloSnapshot {
  return {
    ...save,
    effects: [],
    updatedAt: now,
  };
}

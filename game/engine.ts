import type { ActivityEntry, LocationSample, Orb, SoloConfig, SoloSnapshot } from './types';

export const DEFAULT_SOLO_CONFIG: Readonly<SoloConfig> = Object.freeze({
  radiusMeters: 200,
  baseChance: 0.2,
  spawnReduction: 0.25,
  recoveryDistanceMeters: 100,
});

export const SPAWN_INTERVAL_MS = 10_000;
export const FRESH_FIX_MS = 30_000;
const EARTH_RADIUS_METERS = 6_371_000;
const MAX_ACCURACY_METERS = 25;
const MAX_SPEED_METERS_PER_SECOND = 50;
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
  return null;
}

function addActivity(save: SoloSnapshot, kind: ActivityEntry['kind'], message: string, now: number): SoloSnapshot {
  const lastId = save.activity[save.activity.length - 1]?.id;
  const sequence = (Number(lastId?.split(':').pop()) || 0) + 1;
  const entry: ActivityEntry = { id: `${save.sessionId}:${now}:${sequence}`, kind, timestamp: now, message };
  return { ...save, activity: [...save.activity, entry].slice(-100) };
}

export function createSave(config: SoloConfig, sessionId: string, now: number): SoloSnapshot {
  const error = validateConfig(config);
  if (error) throw new Error(error);
  return addActivity({
    sessionId,
    config: { ...config },
    tracking: true,
    createdAt: now,
    updatedAt: now,
    distanceMeters: 0,
    chance: config.baseChance,
    collectedCount: 0,
    lastFix: null,
    distanceAnchor: null,
    lastProcessedTimestamp: now - 1,
    nextSpawnAt: now + SPAWN_INTERVAL_MS,
    orbs: [],
    activity: [],
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
    && Number.isFinite(fix.timestamp) && fix.timestamp >= 0 && fix.timestamp <= now;
}

export function isFreshFix(save: SoloSnapshot, now: number): boolean {
  return save.lastFix !== null && validFix(save.lastFix, now) && now - save.lastFix.timestamp <= FRESH_FIX_MS;
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

export function applyLocations(save: SoloSnapshot, sessionId: string, fixes: LocationSample[], now: number): SoloSnapshot {
  if (!save.tracking || save.sessionId !== sessionId) return save;
  let next = recoverFromClockRollback(save, now);
  const ordered = [...fixes].sort((a, b) => a.timestamp - b.timestamp);
  for (const sourceFix of ordered) {
    if (!validFix(sourceFix, now) || sourceFix.timestamp <= next.lastProcessedTimestamp) continue;
    const fix = { ...sourceFix };
    const previous = next.lastFix;
    const gap = previous ? fix.timestamp - previous.timestamp : Infinity;
    // Mark even an implausible fix as processed, so replaying a native batch is idempotent.
    next = { ...next, lastProcessedTimestamp: fix.timestamp, updatedAt: now };
    if (previous && gap <= FRESH_FIX_MS
      && distanceBetween(previous, fix) / (gap / 1_000) > MAX_SPEED_METERS_PER_SECOND) continue;

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
      distanceMeters: next.distanceMeters + distance,
      chance: Math.min(next.config.baseChance, next.chance + next.config.baseChance * distance / next.config.recoveryDistanceMeters),
      orbs: next.orbs.filter(orb => distanceBetween(fix, orb) <= next.config.radiusMeters),
    };
    if (wasWaiting) next = addActivity(next, 'tracking', 'GPS acquired. Tracking movement.', fix.timestamp);
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
  // Uniform area on a spherical cap; the asin form remains precise for small radii.
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
  const recovered = recoverFromClockRollback(save, now);
  if (now < recovered.nextSpawnAt) return recovered;
  // A due attempt consumes the interval even without GPS; stale periods cannot queue a roll.
  const next = { ...recovered, nextSpawnAt: now + SPAWN_INTERVAL_MS, updatedAt: now };
  if (!isFreshFix(recovered, now) || !recovered.lastFix || randomFraction(random) >= recovered.chance) return next;
  const orb: Orb = {
    id: `${recovered.sessionId}:orb:${now}`,
    ...spawnPosition(recovered.lastFix, recovered.config.radiusMeters, random),
    spawnedAt: now,
  };
  return addActivity({
    ...next,
    chance: next.chance * (1 - next.config.spawnReduction),
    orbs: [...next.orbs, orb],
  }, 'spawn', 'A light orb appeared in your region.', now);
}

export function collectOrb(save: SoloSnapshot, sessionId: string, orbId: string, now: number): SoloSnapshot {
  if (!save.tracking || save.sessionId !== sessionId || !isFreshFix(save, now) || !save.lastFix) return save;
  const orb = save.orbs.find(candidate => candidate.id === orbId);
  if (!orb || distanceBetween(save.lastFix, orb) > save.config.radiusMeters) return save;
  return addActivity({
    ...save,
    updatedAt: now,
    collectedCount: save.collectedCount + 1,
    orbs: save.orbs.filter(candidate => candidate.id !== orbId),
  }, 'collection', 'Light orb collected.', now);
}

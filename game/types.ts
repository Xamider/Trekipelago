/** Probabilities are fractions: 0.2 means a 20% chance. */
export interface SoloConfig {
  radiusMeters: number;
  baseChance: number;
  spawnReduction: number;
  recoveryDistanceMeters: number;
}

export interface LocationSample {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export interface Orb {
  id: string;
  latitude: number;
  longitude: number;
  spawnedAt: number;
}

export interface ActivityEntry {
  id: string;
  timestamp: number;
  message: string;
  kind: 'game' | 'tracking' | 'spawn' | 'collection';
}

export interface SoloSnapshot {
  sessionId: string;
  config: SoloConfig;
  tracking: boolean;
  createdAt: number;
  updatedAt: number;
  distanceMeters: number;
  chance: number;
  collectedCount: number;
  lastFix: LocationSample | null;
  distanceAnchor: LocationSample | null;
  lastProcessedTimestamp: number;
  nextSpawnAt: number;
  orbs: Orb[];
  activity: ActivityEntry[];
}

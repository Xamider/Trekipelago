/** Probabilities are fractions: 0.2 means a 20% chance. */
export interface SoloConfig {
  radiusMeters: number;
  baseChance: number;
  maxDistanceMeters: number;
  rewardIntervalMeters: number;
  orbsPerReward: number;
  maxOrbs: number; // added maxOrbs
  spawnReduction: number;
  recoveryDistanceMeters: number; // e.g. 5 orbs gives a reward
  buffRatio?: number; // 0.0 to 1.0 (default 0.7 = 70% buffs, 30% debuffs)
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

export type ItemType = 
  | 'boost_drop_2x' 
  | 'boost_distance_2x' 
  | 'speed_up' 
  | 'boost_collect_2x'
  | 'burst_orbs' 
  | 'unlock_background'
  | 'trap_distance'
  | 'trap_distance_half'
  | 'trap_orbs'
  | 'trap_drop_half'
  | 'trap_slow'
  | 'trap_collect_half'
  | 'trap_blind'
  | 'passive_collector'
  | 'progressive_speed';

export interface EventItem {
  type: ItemType;
  durationMs: number | null;
}

export interface ActiveEffect {
  id: string;
  type: ItemType;
  expiresAt: number;
}

export interface ActivityEntry {
  id: string;
  timestamp: number;
  message: string;
  kind: 'game' | 'tracking' | 'spawn' | 'collection' | 'event';
  item?: EventItem;
}

export interface SoloSnapshot {
  sessionId: string;
  config: SoloConfig;
  tracking: boolean;
  createdAt: number;
  updatedAt: number;
  distanceMeters: number;
  lastRewardedDistance: number;
  lastRewardedOrbs: number;
  chance: number;
  collectedCount: number;
  lastFix: LocationSample | null;
  distanceAnchor: LocationSample | null;
  lastProcessedTimestamp: number;
  nextSpawnAt: number;
  lastPassiveCollectAt?: number;
  orbs: Orb[];
  activity: ActivityEntry[];
  effects: ActiveEffect[];
  backgroundUnlocked: boolean;
  backgroundCollectorLevel: number;
  speedLevel: number;
  distanceItemPool: EventItem[];
  distanceItemsClaimed: number;
  orbItemPool: EventItem[];
  orbItemsClaimed: number;
}

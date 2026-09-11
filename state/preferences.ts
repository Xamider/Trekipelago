export interface AppPreferences {
  volume: number;
  soundEffects: boolean;
  pushNotifications: boolean;
  checkAlerts: boolean;
  partyUpdates: boolean;
  mapStyle: 'dark' | 'satellite' | 'topographic';
  showPOI: boolean;
  distanceUnit: 'km' | 'mi';
  maxSpeedLevel: number;
  vibrateOnReward: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  volume: 0.75,
  soundEffects: true,
  pushNotifications: true,
  checkAlerts: false,
  partyUpdates: true,
  mapStyle: 'dark',
  showPOI: false,
  distanceUnit: 'km',
  maxSpeedLevel: 0,
  vibrateOnReward: true,
};

export function validatePreferences(value: AppPreferences): void {
  if (!Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1
    || !['dark', 'satellite', 'topographic'].includes(value.mapStyle)
    || !['km', 'mi'].includes(value.distanceUnit)
    || !Number.isInteger(value.maxSpeedLevel) || value.maxSpeedLevel < 0
    || ['soundEffects', 'pushNotifications', 'checkAlerts', 'partyUpdates', 'showPOI', 'vibrateOnReward']
      .some(key => typeof value[key as keyof AppPreferences] !== 'boolean')) {
    throw new Error('Invalid app preferences.');
  }
}

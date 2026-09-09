import { Alert, AppState, PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { applyLocations, createSave, setTracking, validateConfig } from '../game/engine';
import type { SoloConfig, SoloSnapshot } from '../game/types';
import { repository } from '../storage/database';
import { clearTrackingError, getTrackingError, reportTrackingError } from './errors';

export const LOCATION_TASK = 'trekipelago-solo-location';
let commandTail: Promise<unknown> = Promise.resolve();
let foregroundWatcherSubscription: Location.LocationSubscription | null = null;

export class GameActionError extends Error {}

function command<T>(work: () => Promise<T>) {
  const next = commandTail.then(work);
  commandTail = next.catch(() => undefined);
  return next;
}

const sessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export async function stopNativeTracking() {
  stopForegroundWatcher();
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

export async function haltAfterFailure(error: unknown) {
  reportTrackingError(error);
  try { await stopNativeTracking(); }
  catch (stopError) { reportTrackingError(`${String(error)} Tracking could not be stopped: ${String(stopError)}`); }
}

/**
 * Foreground location watcher: ensures real-time, uninterrupted high-accuracy GPS fixes
 * while the app is visible on screen, preventing the GPS hardware from sleeping.
 */
export async function startForegroundWatcher() {
  if (Platform.OS !== 'android') return;
  if (foregroundWatcherSubscription) return;
  if (AppState.currentState !== 'active') return;

  try {
    const permissions = await Location.getForegroundPermissionsAsync();
    if (!permissions.granted) return;

    foregroundWatcherSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 2000,
        distanceInterval: 0,
      },
      async (location) => {
        if (AppState.currentState !== 'active') return;
        const current = await repository.read();
        if (!current.save?.tracking) return;

        const fixes = [{
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy ?? Infinity,
          timestamp: location.timestamp,
        }];
        const maxSpeedLevel = Math.max(current.save?.speedLevel || 0, current.preferences.maxSpeedLevel || 0);
        await repository.update(save => save ? applyLocations(save, save.sessionId, fixes, Date.now(), maxSpeedLevel) : save);
      }
    );
  } catch {
    // If watching fails temporarily, wakeGps watchdog handles fallback
  }
}

export function stopForegroundWatcher() {
  if (foregroundWatcherSubscription) {
    try {
      foregroundWatcherSubscription.remove();
    } catch {
      // Ignore cleanup error
    }
    foregroundWatcherSubscription = null;
  }
}

export function wakeGps() {
  if (AppState.currentState !== 'active') return;
  // Fire an immediate, high-accuracy fetch to kick the Android Location Provider
  void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
    .then(async (location) => {
      const current = await repository.read();
      if (!current.save?.tracking) return;
      const fixes = [{
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? Infinity,
        timestamp: location.timestamp,
      }];
      const maxSpeedLevel = Math.max(current.save?.speedLevel || 0, current.preferences.maxSpeedLevel || 0);
      await repository.update(save => save ? applyLocations(save, save.sessionId, fixes, Date.now(), maxSpeedLevel) : save);
    })
    .catch(() => {
      // Fallback with balanced accuracy if high accuracy times out
      void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then(async (location) => {
          const current = await repository.read();
          if (!current.save?.tracking) return;
          const fixes = [{
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy ?? Infinity,
            timestamp: location.timestamp,
          }];
          const maxSpeedLevel = Math.max(current.save?.speedLevel || 0, current.preferences.maxSpeedLevel || 0);
          await repository.update(save => save ? applyLocations(save, save.sessionId, fixes, Date.now(), maxSpeedLevel) : save);
        })
        .catch(() => undefined);
    });
}

// Background JS entrypoint for location deliveries
if (Platform.OS === 'android' && !TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    try {
      if (getTrackingError()) return;
      if (error) throw new Error(error.message);
      if (!data?.locations?.length) return;
      const current = await repository.read();
      if (!current.save?.tracking) return;
      
      const isForeground = AppState.currentState === 'active';
      if (!isForeground && !current.save.backgroundUnlocked) {
        return; // Drop locations entirely if background locked and app not active
      }
      
      const expectedSession = current.save.sessionId;
      const maxSpeedLevel = Math.max(current.save.speedLevel || 0, current.preferences.maxSpeedLevel || 0);
      const fixes = data.locations.map(location => ({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? Infinity,
        timestamp: location.timestamp,
      }));
      await repository.update(save => save ? applyLocations(save, expectedSession, fixes, Date.now(), maxSpeedLevel) : save);
    } catch (error) { await haltAfterFailure(error); }
  });
}

function explainBackgroundPermission(): Promise<void> {
  return new Promise((resolve, reject) => Alert.alert(
    'Keep your walk counting',
    'Allow location all the time on the next screen to count distance while your phone is locked. Spawning pauses in the background. You can stop tracking at any time with Pause.',
    [
      { text: 'Cancel', style: 'cancel', onPress: () => reject(new Error('Background permission explanation cancelled.')) },
      { text: 'Continue', onPress: () => resolve() },
    ],
  ));
}

async function ensurePermissions(requestIfMissing: boolean): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Location tracking is only supported on Android.');

  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) {
    if (!requestIfMissing) throw new Error('Location access is required to track your movement.');
    const nextForeground = await Location.requestForegroundPermissionsAsync();
    if (!nextForeground.granted) throw new Error('Location access was denied.');
  }

  const background = await Location.getBackgroundPermissionsAsync();
  if (!background.granted) {
    if (!requestIfMissing) throw new Error('Background location access is required to keep counting when your phone is locked.');
    await explainBackgroundPermission();
    const nextBackground = await Location.requestBackgroundPermissionsAsync();
    if (!nextBackground.granted) throw new Error('Background location access was denied.');
  }

  if (Platform.Version >= 33) {
    const postNotificationsGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (!postNotificationsGranted) {
      if (!requestIfMissing) throw new Error('Notification permission is required to keep the foreground service running.');
      const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      if (status !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Notification permission was denied.');
    }
  }

  if (Platform.Version >= 29) {
    const activityGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
    if (!activityGranted && requestIfMissing) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
    }
  }

  if (AppState.currentState !== 'active') {
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 1000);
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') {
          clearTimeout(timeout);
          subscription.remove();
          resolve();
        }
      });
    });
  }
}

export function buildCollectorRateDescription(level: number): string {
  switch (level) {
    case 1:
      return 'Collector (Lv. 1): 1 orb every 30s';
    case 2:
      return 'Collector (Lv. 2): up to 2 orbs every 20s';
    case 3:
      return 'Collector (Lv. 3): up to 3 orbs every 10s';
    default:
      return 'Collector: Inactive';
  }
}

export function buildNotificationBody(save?: SoloSnapshot | null): string {
  const isUnlocked = save?.backgroundUnlocked ?? false;
  const level = save?.backgroundCollectorLevel ?? 0;
  const collectorRate = buildCollectorRateDescription(level);
  const distanceStr = Math.round(save?.distanceMeters ?? 0);

  if (isUnlocked) {
    return `${collectorRate} · Distance counting (${distanceStr}m)`;
  }
  return `Background tracking locked · ${collectorRate}`;
}

export async function startNativeTracking(save?: SoloSnapshot | null) {
  if (AppState.currentState !== 'active') {
    // Cannot start or modify Android Foreground Service when application is in the background
    return;
  }
  const isUnlocked = save?.backgroundUnlocked ?? false;
  const body = buildNotificationBody(save);

  try {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 5_000,
      distanceInterval: 0,
      deferredUpdatesDistance: 0,
      deferredUpdatesInterval: 0,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: isUnlocked ? 'Trekipelago · Solo tracking' : 'Background tracking locked',
        notificationBody: body,
        notificationColor: isUnlocked ? '#70F40B' : '#E50914',
        killServiceOnDestroy: false,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Foreground service cannot be started') || AppState.currentState !== 'active') {
      return;
    }
    throw error;
  }
}

export async function updateTrackingNotification(save?: SoloSnapshot | null) {
  if (AppState.currentState !== 'active') return;
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (isRunning) {
      await startNativeTracking(save);
    }
  } catch {
    // Suppress background transition errors
  }
}

export function createSoloGame(config: SoloConfig) {
  return command(async () => {
    const validation = validateConfig(config);
    if (validation) throw new GameActionError(validation);
    try {
      await ensurePermissions(true);
    } catch (error) {
      throw new GameActionError(error instanceof Error ? error.message : String(error));
    }

    const id = sessionId();
    const newSave = createSave(config, id, Date.now());

    const isAlreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (!isAlreadyRunning) {
      try {
        await startNativeTracking(newSave);
      } catch (error) {
        throw error; 
      }
    } else {
      await updateTrackingNotification(newSave);
    }

    await repository.update(() => newSave);
    void startForegroundWatcher();
    return true;
  });
}

export function resumeSoloTracking(requestPermissions: boolean) {
  return command(async () => {
    const current = (await repository.read()).save;
    if (!current) return;

    if (!requestPermissions && AppState.currentState !== 'active') {
      return;
    }

    await ensurePermissions(requestPermissions);
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (!isRunning) {
      try { 
        await startNativeTracking(current); 
        clearTrackingError(); 
      }
      catch (error) { 
        await haltAfterFailure(error); 
        throw error; 
      }
    } else {
      await updateTrackingNotification(current);
      clearTrackingError();
    }
    
    const id = sessionId();
    await repository.update(save => save ? setTracking(save, true, id, Date.now()) : save);
    void startForegroundWatcher();
    // Ping the sensor to wake it up in case it was asleep
    wakeGps();
  });
}

export function pauseSoloTracking() {
  return command(async () => {
    try {
      await repository.update(save => save ? setTracking(save, false, sessionId(), Date.now()) : save);
    } finally { 
      stopForegroundWatcher();
      await stopNativeTracking(); 
    }
    clearTrackingError();
  });
}

/** Checks location permission during active foreground usage without failing due to background state. */
export async function checkTrackingPermissions() {
  if (AppState.currentState !== 'active') return;
  const current = (await repository.read()).save;
  if (!current?.tracking) return;
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) {
      reportTrackingError(new Error('Location access is required to track your movement.'));
      return;
    }
    clearTrackingError();
  } catch (error) {
    reportTrackingError(error);
  }
}

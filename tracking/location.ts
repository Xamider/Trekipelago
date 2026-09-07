import { Alert, AppState, PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { applyLocations, createSave, setTracking, validateConfig } from '../game/engine';
import type { SoloConfig } from '../game/types';
import { repository } from '../storage/database';
import { clearTrackingError, getTrackingError, reportTrackingError } from './errors';

export const LOCATION_TASK = 'trekipelago-solo-location';
let commandTail: Promise<unknown> = Promise.resolve();

export class GameActionError extends Error {}

function command<T>(work: () => Promise<T>) {
  const next = commandTail.then(work);
  commandTail = next.catch(() => undefined);
  return next;
}

const sessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export async function stopNativeTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

export async function haltAfterFailure(error: unknown) {
  reportTrackingError(error);
  try { await stopNativeTracking(); }
  catch (stopError) { reportTrackingError(`${String(error)} Tracking could not be stopped: ${String(stopError)}`); }
}

export function wakeGps() {
  if (AppState.currentState !== 'active') return;
  // Fire an immediate, high-accuracy fetch. This forces the Android LocationService out of background throttling
  // and immediately pushes the fresh fix to our UI and background listeners without restarting the whole service.
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
      await repository.update(save => save ? applyLocations(save, save.sessionId, fixes, Date.now(), current.preferences.maxSpeedLevel || 0) : save);
    })
    .catch(() => undefined);
}

if (Platform.OS === 'android' && !TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    try {
      if (getTrackingError()) return;
      if (error) throw new Error(error.message);
      if (!data?.locations?.length) return;
      const current = await repository.read();
      if (!current.save?.tracking) return;
      const expectedSession = current.save.sessionId;
      const maxSpeedLevel = current.preferences.maxSpeedLevel || 0;
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
      { text: 'Not now', style: 'cancel', onPress: () => reject(new Error('Background location is needed to start tracking. Your save is unchanged.')) },
      { text: 'Continue', onPress: () => resolve() },
    ],
    { cancelable: false },
  ));
}

async function ensurePermissions(request: boolean) {
  if (Platform.OS !== 'android') throw new Error('Solo tracking is available on Android.');
  if (!await TaskManager.isAvailableAsync()) throw new Error('Install the Android development build to play Solo. Background tracking is unavailable in Expo Go.');
  if (!await Location.hasServicesEnabledAsync()) throw new Error('Turn on phone location services, then try again.');
  let foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted && request) foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error('Allow precise location in Android settings to start tracking.');
  if (foreground.android?.accuracy === 'coarse') throw new Error('Enable precise location in Android settings to track your walk.');
  let background = await Location.getBackgroundPermissionsAsync();
  if (!background.granted && request) {
    await explainBackgroundPermission();
    background = await Location.requestBackgroundPermissionsAsync();
  }
  if (!background.granted) throw new Error('Allow location all the time in Android settings, then tap Resume.');
  
  if (request && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  if (request && AppState.currentState !== 'active') {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { subscription.remove(); reject(new Error('Return to Trekipelago and tap Resume.')); }, 30_000);
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') { clearTimeout(timeout); subscription.remove(); resolve(); }
      });
    });
  }
}

async function startNativeTracking() {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5_000,
    distanceInterval: 0,
    deferredUpdatesDistance: 0,
    deferredUpdatesInterval: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Trekipelago · Solo tracking',
      notificationBody: 'Your distance is counting. Open Trekipelago to pause.',
      notificationColor: '#70F40B',
      killServiceOnDestroy: false,
    },
  });
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

    const isAlreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (!isAlreadyRunning) {
      try {
        await startNativeTracking();
      } catch (error) {
        throw error; 
      }
    }

    const id = sessionId();
    await repository.update(() => createSave(config, id, Date.now()));
    clearTrackingError();
    // Instantly poke the GPS so the new game doesn't sit on a "Waiting..." screen
    wakeGps();
  });
}

export function resumeSoloTracking(requestPermissions = true) {
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
        await startNativeTracking(); 
        clearTrackingError(); 
      }
      catch (error) { 
        await haltAfterFailure(error); 
        throw error; 
      }
    } else {
      clearTrackingError();
    }
    
    const id = sessionId();
    await repository.update(save => save ? setTracking(save, true, id, Date.now()) : save);
    // Ping the sensor to wake it up in case it was asleep
    wakeGps();
  });
}

export function pauseSoloTracking() {
  return command(async () => {
    try {
      await repository.update(save => save ? setTracking(save, false, sessionId(), Date.now()) : save);
    } finally { await stopNativeTracking(); }
    clearTrackingError();
  });
}

export async function checkTrackingPermissions() {
  if (AppState.currentState !== 'active') return;
  const current = (await repository.read()).save;
  if (!current?.tracking) return;
  await ensurePermissions(false);
}

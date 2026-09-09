import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Alert, AppState } from 'react-native';
import { clearAllEffects, collectOrb as collect, injectTestEffects, resetSpawnClock, rollSpawn } from '../game/engine';
import type { SoloConfig, SoloSnapshot } from '../game/types';
import { repository } from '../storage/database';
import { clearTrackingError, getTrackingError, subscribeTrackingErrors } from '../tracking/errors';
import { ForegroundClock } from '../tracking/foregroundClock';
import { checkTrackingPermissions, createSoloGame, GameActionError, haltAfterFailure, pauseSoloTracking, resumeSoloTracking, startForegroundWatcher, stopForegroundWatcher, stopNativeTracking, updateTrackingNotification, wakeGps } from '../tracking/location';
import { DEFAULT_PREFERENCES, type AppPreferences } from './preferences';

export function computeTrackingStatus(save: SoloSnapshot | null, loading: boolean, error: string | null, now: number): string {
  if (loading) return 'Loading your journey...';
  if (error) return `Error: ${error}`;
  if (!save) return 'Ready for a new journey';
  if (!save.tracking) return 'Tracking paused';
  if (save.lastFix) {
    const ageSec = Math.max(0, Math.round((now - save.lastFix.timestamp) / 1000));
    if (ageSec <= 60) {
      return 'Tracking your distance';
    } else {
      return 'Waiting for precise GPS...';
    }
  }
  return 'Waiting for precise GPS...';
}

interface GameContextValue {
  save: SoloSnapshot | null;
  preferences: AppPreferences;
  loading: boolean;
  busy: boolean;
  error: string | null;
  status: string | null;
  createGame(config: SoloConfig): Promise<boolean>;
  resume(): Promise<boolean>;
  pause(): Promise<void>;
  collectOrb(id: string): Promise<void>;
  applyTestEffects(): Promise<void>;
  clearEffects(): Promise<void>;
  setPreferences(patch: Partial<AppPreferences>): Promise<void>;
  retry(): Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: PropsWithChildren) {
  const [save, setSave] = useState<SoloSnapshot | null>(null);
  const [preferences, setPrefs] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock] = useState(() => new ForegroundClock());
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const saveRef = useRef<SoloSnapshot | null>(null);

  const refresh = useCallback(async () => {
    const snapshot = await repository.read();
    if (mounted.current) {
      saveRef.current = snapshot.save;
      setSave(snapshot.save);
      setPrefs(snapshot.preferences);
      if (snapshot.save && AppState.currentState === 'active') {
        void updateTrackingNotification(snapshot.save).catch(() => {});
      }
    }
    return snapshot;
  }, []);

  const fail = useCallback(async (reason: unknown) => {
    clock.setVisible(false);
    stopForegroundWatcher();
    await haltAfterFailure(reason);
  }, [clock]);

  const foreground = useCallback(async () => {
    clock.setVisible(true);
    const rightNow = Date.now();
    await repository.update(current => current ? resetSpawnClock(current, rightNow) : current);
    
    // Check permissions and force wake the GPS if tracking is currently active
    if (!busyRef.current) await checkTrackingPermissions();
    if (saveRef.current?.tracking) {
      void startForegroundWatcher();
      wakeGps();
    }
    
    await refresh();
  }, [clock, refresh]);

  useEffect(() => {
    const unsubscribe = repository.subscribe(() => {
      void refresh();
    });
    const unsubscribeErrors = subscribeTrackingErrors(err => {
      if (mounted.current) setError(err);
    });
    void (async () => {
      busyRef.current = true;
      try {
        let snapshot = await refresh();
        if (snapshot.save?.effects?.some(e => e.id.startsWith('test-'))) {
          await repository.update(s => s ? {
            ...s,
            effects: s.effects.filter(e => !e.id.startsWith('test-')),
          } : s);
          snapshot = await refresh();
        }
        if (snapshot.save?.tracking) {
          await resumeSoloTracking(false);
          void startForegroundWatcher();
        } else {
          await stopNativeTracking();
        }
        clearTrackingError();
      } catch (reason) { await fail(reason); }
      finally {
        busyRef.current = false;
        if (mounted.current) {
          setLoading(false);
          if (AppState.currentState === 'active') void foreground().catch(fail);
        }
      }
    })();
    const stateSubscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        clock.setVisible(false);
        stopForegroundWatcher();
      } else {
        void foreground().catch(fail);
      }
    });
    const blurSubscription = AppState.addEventListener('blur', () => {
      clock.setVisible(false);
      stopForegroundWatcher();
    });
    const focusSubscription = AppState.addEventListener('focus', () => { 
      void foreground().catch(fail); 
    });
    let working = false;
    let ticks = 0;
    
    const timer = setInterval(() => {
      if (working) return;
      working = true;
      void (async () => {
        try {
          const currentSave = saveRef.current;
          const rightNow = Date.now();
          const epoch = clock.capture();
          
          if (currentSave?.tracking && AppState.currentState === 'active') {
            if (clock.permits(epoch) && !getTrackingError() && rightNow >= currentSave.nextSpawnAt) {
              const id = currentSave.sessionId;
              await repository.update(current => current && current.sessionId === id
                ? rollSpawn(current, id, rightNow, clock.permits(epoch) && !getTrackingError(), Math.random) : current);
            }

            // GPS watchdog: if no accurate fix arrived within 8 seconds on the active map screen,
            // immediately trigger wakeGps to poll the GPS hardware and ensure the foreground watcher is running.
            const fixAgeMs = currentSave.lastFix ? rightNow - currentSave.lastFix.timestamp : Infinity;
            if (fixAgeMs > 8_000) {
              wakeGps();
              void startForegroundWatcher();
            }
          }
          
          ticks++;
          // Periodically check permissions every 10 seconds while active
          if (ticks % 10 === 0 && AppState.currentState === 'active') {
            await checkTrackingPermissions();
          }
        } catch (reason) { await fail(reason); }
        finally {
          working = false;
        }
      })();
    }, 1_000);
    return () => {
      mounted.current = false;
      clock.setVisible(false);
      stopForegroundWatcher();
      clearInterval(timer);
      stateSubscription.remove(); blurSubscription.remove(); focusSubscription.remove();
      unsubscribe(); unsubscribeErrors();
    };
  }, [clock, fail, foreground, refresh]);

  async function action<T>(work: () => Promise<T>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    if (mounted.current) setBusy(true);
    try {
      await work();
      clearTrackingError();
      await refresh();
      return true;
    } catch (reason) {
      if (reason instanceof GameActionError) {
        Alert.alert('Unable to start tracking', reason.message);
      } else {
        await fail(reason);
      }
      return false;
    }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  const applyTestEffects = useCallback(async () => {
    await repository.update(current => current ? injectTestEffects(current, Date.now()) : current);
    await refresh();
  }, [refresh]);

  const clearEffects = useCallback(async () => {
    await repository.update(current => current ? clearAllEffects(current) : current);
    await refresh();
  }, [refresh]);

  const status = computeTrackingStatus(save, loading, error, Date.now());

  const context: GameContextValue = {
    save, preferences, loading, busy, error, status,
    createGame: async config => {
      return action(async () => {
        await createSoloGame(config);
      });
    },
    resume: () => action(async () => { await resumeSoloTracking(true); }),
    pause: async () => {
      await action(async () => { await pauseSoloTracking(); });
    },
    collectOrb: async id => {
      const current = saveRef.current;
      const epoch = clock.capture();
      if (!current || !clock.permits(epoch) || getTrackingError()) return;
      try {
        await repository.update(snapshot => snapshot && snapshot.sessionId === current.sessionId
          ? collect(snapshot, current.sessionId, id, Date.now()) : snapshot);
      } catch (reason) { await fail(reason); }
    },
    applyTestEffects,
    clearEffects,
    setPreferences: async patch => {
      try { await repository.updatePreferences(patch); }
      catch (reason) { await fail(reason); }
    },
    retry: async () => {
      await action(async () => {
        clearTrackingError();
        const current = saveRef.current;
        if (current?.tracking) await resumeSoloTracking(true);
        else await refresh();
      });
    },
  };

  return <GameContext.Provider value={context}>{children}</GameContext.Provider>;
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used within a GameProvider');
  return context;
}

export function useGameStatus() {
  const game = useGame();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const status = computeTrackingStatus(game.save, game.loading, game.error, now);
  return { ...game, status, now };
}

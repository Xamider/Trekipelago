import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Alert, AppState } from 'react-native';
import { collectOrb as collect, isFreshFix, resetSpawnClock, rollSpawn } from '../game/engine';
import type { SoloConfig, SoloSnapshot } from '../game/types';
import { repository } from '../storage/database';
import { clearTrackingError, getTrackingError, subscribeTrackingErrors } from '../tracking/errors';
import { ForegroundClock } from '../tracking/foregroundClock';
import { checkTrackingPermissions, createSoloGame, GameActionError, haltAfterFailure, pauseSoloTracking, resumeSoloTracking, stopNativeTracking, wakeGps } from '../tracking/location';
import { DEFAULT_PREFERENCES, type AppPreferences } from './preferences';

interface GameContextValue {
  save: SoloSnapshot | null;
  preferences: AppPreferences;
  loading: boolean;
  busy: boolean;
  error: string | null;
  createGame(config: SoloConfig): Promise<boolean>;
  resume(): Promise<boolean>;
  pause(): Promise<void>;
  collectOrb(id: string): Promise<void>;
  setPreferences(patch: Partial<AppPreferences>): Promise<void>;
  retry(): Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: PropsWithChildren) {
  const [save, setSave] = useState<SoloSnapshot | null>(null);
  const [preferences, setPrefs] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(getTrackingError);
  const saveRef = useRef(save);
  const clock = useRef(new ForegroundClock()).current;
  const busyRef = useRef(false);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    const snapshot = await repository.read();
    if (mounted.current) {
      saveRef.current = snapshot.save;
      setSave(snapshot.save);
      setPrefs(snapshot.preferences);
    }
    return snapshot;
  }, []);

  const fail = useCallback(async (reason: unknown) => {
    clock.setVisible(false);
    await haltAfterFailure(reason);
  }, [clock]);

  const foreground = useCallback(async () => {
    const epoch = clock.setVisible(AppState.currentState === 'active' && !getTrackingError());
    if (AppState.currentState !== 'active' || getTrackingError()) return;
    const id = saveRef.current?.sessionId;
    await repository.update(current => current && current.sessionId === id && clock.permits(epoch)
      ? resetSpawnClock(current, Date.now()) : current);
    
    // Check permissions and force wake the GPS if tracking is currently active
    if (!busyRef.current) await checkTrackingPermissions();
    if (saveRef.current?.tracking) wakeGps();
    
    await refresh();
  }, [clock, refresh]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribeErrors = subscribeTrackingErrors(message => {
      if (message) clock.setVisible(false);
      if (mounted.current) setError(message);
    });
    const unsubscribe = repository.subscribe(() => { void refresh().catch(fail); });
    void (async () => {
      busyRef.current = true;
      try {
        const snapshot = await refresh();
        if (snapshot.save?.tracking) await resumeSoloTracking(false);
        else await stopNativeTracking();
        clearTrackingError();
      } catch (reason) { await fail(reason); }
      finally {
        busyRef.current = false;
        if (mounted.current) {
          setLoading(false);
          void foreground().catch(fail);
        }
      }
    })();
    const stateSubscription = AppState.addEventListener('change', state => {
      clock.setVisible(false);
      if (state === 'active') void foreground().catch(fail);
    });
    const blurSubscription = AppState.addEventListener('blur', () => clock.setVisible(false));
    const focusSubscription = AppState.addEventListener('focus', () => { void foreground().catch(fail); });
    let working = false;
    let ticks = 0;
    
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (working || busyRef.current || getTrackingError()) return;
      working = true;
      const epoch = clock.capture();
      const id = saveRef.current?.sessionId;
      void (async () => {
        try {
          const currentSave = saveRef.current;
          const isTracking = currentSave?.tracking;
          
          if (isTracking && id && currentSave) {
            const rightNow = Date.now();
            const dueForSpawn = clock.permits(epoch) && currentSave.nextSpawnAt <= rightNow;
            if (dueForSpawn) {
              await repository.update(current => current && current.sessionId === id
                ? rollSpawn(current, id, rightNow, clock.permits(epoch) && !getTrackingError(), Math.random) : current);
            }
          }
          
          ticks++;
          if (ticks % 2 === 0 && isTracking) {
            const updatedAt = await repository.peekUpdatedAt();
            if (updatedAt !== (saveRef.current?.updatedAt ?? null)) await refresh();
          }
          if (ticks % 10 === 0 && isTracking) {
            await checkTrackingPermissions();
          }
        } catch (reason) { await fail(reason); }
        finally { working = false; }
      })();
    }, 1_000);
    return () => {
      mounted.current = false;
      clock.setVisible(false);
      clearInterval(timer);
      stateSubscription.remove(); blurSubscription.remove(); focusSubscription.remove();
      unsubscribe(); unsubscribeErrors();
    };
  }, [clock, fail, foreground, refresh]);

  async function action(work: () => Promise<void>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    clock.setVisible(false);
    try {
      await work();
      await refresh();
      clearTrackingError();
      busyRef.current = false;
      await foreground().catch(fail);
      return true;
    } catch (reason) {
      if (reason instanceof GameActionError) {
        busyRef.current = false;
        await refresh();
        await foreground().catch(fail);
        Alert.alert('Could not start', reason.message);
        return false;
      }
      await fail(reason);
      return false;
    }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  const context: GameContextValue = {
    save, preferences, loading, busy, error,
    createGame: config => action(() => createSoloGame(config)),
    resume: () => action(() => resumeSoloTracking(true)),
    pause: async () => { await action(pauseSoloTracking); },
    collectOrb: async id => {
      const current = saveRef.current;
      const epoch = clock.capture();
      if (!current || busyRef.current || getTrackingError() || !clock.permits(epoch)) return;
      try {
        await repository.update(snapshot => snapshot && clock.permits(epoch) && !getTrackingError()
          ? collect(snapshot, current.sessionId, id, Date.now()) : snapshot);
      } catch (reason) { await fail(reason); }
    },
    setPreferences: async patch => {
      try { await repository.updatePreferences(patch); }
      catch (reason) { await fail(reason); }
    },
    retry: async () => {
      await action(async () => {
        const snapshot = await refresh();
        await repository.updatePreferences({});
        if (snapshot.save?.tracking) await resumeSoloTracking(true);
        else { await stopNativeTracking(); clearTrackingError(); }
      });
    },
  };

  return <GameContext.Provider value={context}>{children}</GameContext.Provider>;
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used inside GameProvider.');
  return context;
}

export function useAppClock(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    function start() { timer = setInterval(() => setNow(Date.now()), intervalMs); }
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', state => {
      clearInterval(timer);
      if (state === 'active') { setNow(Date.now()); start(); }
    });
    return () => { clearInterval(timer); if (sub) sub.remove(); };
  }, [intervalMs]);
  return now;
}

export function useGameStatus() {
  const context = useGame();
  const now = useAppClock();
  const hasRecentGps = context.save?.lastFix ? (now - context.save.lastFix.timestamp) <= 60000 : false;
  const status = context.loading ? 'Loading your journey...' : context.error ? 'Tracking needs attention'
      : !context.save ? 'Ready for a new journey' : !context.save.tracking ? 'Tracking paused'
        : hasRecentGps ? 'Tracking your distance' : 'Waiting for precise GPS...';
  
  return { ...context, status, now };
}
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Alert, AppState } from 'react-native';
import { collectOrb as collect, isFreshFix, resetSpawnClock, rollSpawn } from '../game/engine';
import type { SoloConfig, SoloSnapshot } from '../game/types';
import { repository } from '../storage/database';
import { clearTrackingError, getTrackingError, subscribeTrackingErrors } from '../tracking/errors';
import { ForegroundClock } from '../tracking/foregroundClock';
import { checkTrackingPermissions, createSoloGame, GameActionError, haltAfterFailure, pauseSoloTracking, resumeSoloTracking, stopNativeTracking } from '../tracking/location';
import { DEFAULT_PREFERENCES, type AppPreferences } from './preferences';

interface GameContextValue {
  save: SoloSnapshot | null;
  preferences: AppPreferences;
  loading: boolean;
  busy: boolean;
  error: string | null;
  status: string;
  now: number;
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
  const [now, setNow] = useState(Date.now);
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
    if (!busyRef.current) await checkTrackingPermissions();
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
      setNow(Date.now());
      if (working || busyRef.current || getTrackingError()) return;
      working = true;
      const epoch = clock.capture();
      const id = saveRef.current?.sessionId;
      void (async () => {
        try {
          // Avoid a transactional read on every tick: only touch the database once a roll is actually due.
          const dueForSpawn = id && saveRef.current?.tracking && clock.permits(epoch)
            && saveRef.current.nextSpawnAt <= Date.now();
          if (dueForSpawn) {
            await repository.update(current => current && current.sessionId === id
              ? rollSpawn(current, id, Date.now(), clock.permits(epoch) && !getTrackingError(), Math.random) : current);
          }
          if (++ticks % 2 === 0) {
            const updatedAt = await repository.peekUpdatedAt();
            if (updatedAt !== (saveRef.current?.updatedAt ?? null)) await refresh();
          }
          if (ticks % 10 === 0) await checkTrackingPermissions();
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
      // Screen/provider lifetimes do not own the native tracker. Only Pause stops a journey.
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
      await foreground();
      return true;
    } catch (reason) {
      if (reason instanceof GameActionError) {
        // Nothing was mutated: leave any existing journey and its tracker running untouched.
        busyRef.current = false;
        await refresh();
        await foreground();
        Alert.alert('Could not start', reason.message);
        return false;
      }
      await fail(reason);
      return false;
    }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  const context: GameContextValue = {
    save, preferences, loading, busy, error, now,
    status: loading ? 'Loading your journey…' : error ? 'Tracking needs attention'
      : !save ? 'Ready for a new journey' : !save.tracking ? 'Tracking paused'
        : isFreshFix(save, now) ? 'Tracking your distance' : 'Waiting for precise GPS…',
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
        // Check a write as well as a read before clearing a persistence failure.
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

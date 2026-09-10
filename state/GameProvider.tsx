import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Alert, AppState, Vibration } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { clearAllEffects, collectOrb as collect, injectTestEffects, resetSpawnClock, rollSpawn } from '../game/engine';
import type { SoloConfig, SoloSnapshot } from '../game/types';
import { repository } from '../storage/database';
import { clearTrackingError, getTrackingError, subscribeTrackingErrors } from '../tracking/errors';
import { ForegroundClock } from '../tracking/foregroundClock';
import { checkTrackingPermissions, createSoloGame, GameActionError, haltAfterFailure, pauseSoloTracking, resumeSoloTracking, startForegroundWatcher, stopForegroundWatcher, stopNativeTracking, updateTrackingNotification, wakeGps } from '../tracking/location';
import { DEFAULT_PREFERENCES, type AppPreferences } from './preferences';

export interface RewardNotice {
  id: string;
  text: string;
  color: string;
  bg: string;
  border: string;
  icon: keyof typeof Feather.glyphMap;
}

export function getEventVisuals(message: string) {
  const isTrap = /trap|slow|blind|half/i.test(message);
  if (isTrap) {
    if (/blind/i.test(message)) {
      return { color: '#f87171', bg: 'rgba(248, 113, 113, 0.22)', border: '#dc2626', icon: 'eye-off' as const };
    }
    if (/slow/i.test(message)) {
      return { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.22)', border: '#dc2626', icon: 'activity' as const };
    }
    if (/distance/i.test(message)) {
      return { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.22)', border: '#dc2626', icon: 'trending-down' as const };
    }
    if (/drop|orbs/i.test(message)) {
      return { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.22)', border: '#dc2626', icon: 'zap-off' as const };
    }
    if (/collect/i.test(message)) {
      return { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.22)', border: '#dc2626', icon: 'minus-circle' as const };
    }
    return { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.22)', border: '#dc2626', icon: 'alert-triangle' as const };
  }

  if (/speed boost|\+50% speed/i.test(message)) {
    return { color: '#4ade80', bg: 'rgba(74, 222, 128, 0.22)', border: '#16a34a', icon: 'activity' as const };
  }
  if (/distance bonus|double distance|2x distance/i.test(message)) {
    return { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.22)', border: '#0284c7', icon: 'trending-up' as const };
  }
  if (/orb drop|2x orbs|orb energy|double orb/i.test(message)) {
    return { color: '#70F40B', bg: 'rgba(112, 244, 11, 0.22)', border: '#16a34a', icon: 'zap' as const };
  }
  if (/collect.*2x|double collect|2x collect/i.test(message)) {
    return { color: '#c084fc', bg: 'rgba(192, 132, 252, 0.22)', border: '#9333ea', icon: 'plus-circle' as const };
  }
  if (/collector/i.test(message)) {
    return { color: '#c084fc', bg: 'rgba(192, 132, 252, 0.22)', border: '#9333ea', icon: 'cpu' as const };
  }
  if (/background/i.test(message)) {
    return { color: '#34d399', bg: 'rgba(52, 211, 153, 0.22)', border: '#059669', icon: 'check-circle' as const };
  }
  if (/speed limit/i.test(message)) {
    return { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.22)', border: '#0284c7', icon: 'trending-up' as const };
  }

  return { color: '#70F40B', bg: 'rgba(112, 244, 11, 0.22)', border: '#16a34a', icon: 'award' as const };
}

export function getEventShortText(message: string): string {
  let cleaned = message
    .replace(/^Item found:\s*/i, '')
    .replace(/\s*\([^)]*Milestone\)$/i, '')
    .trim();

  cleaned = cleaned
    .replace(/^(Double Distance \(2x\)|2X DISTANCE)/i, '2x Distance')
    .replace(/^(Double Orb Spawn Chance \(2x\)|2X ORBS)/i, '2x Orbs')
    .replace(/^(Double Collected Orbs \(2x\)|2X COLLECT)/i, '2x Collect')
    .replace(/^(Speed Boost \(\+50% speed limit\)|\+50% SPEED)/i, '+50% Speed')
    .replace(/^(Slow Movement \(Trap\)|-50% SPEED)/i, 'Slow (-50%)')
    .replace(/^(Half Distance \(Trap\)|0\.5X DISTANCE)/i, '0.5x Distance')
    .replace(/^(Half Orb Spawn Chance \(Trap\)|0\.5X ORBS)/i, '0.5x Orbs')
    .replace(/^(Half Collected Orbs \(Trap\)|0\.5X COLLECT)/i, '0.5x Collect')
    .replace(/^(Map Blindness \(Trap\)|MAP BLINDED)/i, 'Map Blinded')
    .replace(/^Passive Background Orb Collector/i, 'Collector')
    .replace(/^Max Speed Limit Increased/i, 'Max Speed')
    .replace(/^Background Tracking Unlocked!/i, 'BG Tracking');

  return cleaned;
}

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
  rewardNotice: RewardNotice | null;
  dismissRewardNotice(): void;
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
  const [rewardNotice, setRewardNotice] = useState<RewardNotice | null>(null);
  const [clock] = useState(() => new ForegroundClock());
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const saveRef = useRef<SoloSnapshot | null>(null);
  const prevClaimedRef = useRef<number | null>(null);
  const lastSeenEventIdRef = useRef<string | null>(null);
  const rewardTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerRewardFeedback = useCallback((currentSave: SoloSnapshot, prefs: AppPreferences) => {
    const currentClaimed = (currentSave.distanceItemsClaimed || 0) + (currentSave.orbItemsClaimed || 0);
    const latestEvent = currentSave.activity
      ? [...currentSave.activity].reverse().find(a => a.kind === 'event')
      : undefined;

    if (prevClaimedRef.current === null) {
      prevClaimedRef.current = currentClaimed;
      lastSeenEventIdRef.current = latestEvent?.id ?? null;
      return;
    }

    const hasNewItem = currentClaimed > prevClaimedRef.current || (Boolean(latestEvent) && latestEvent?.id !== lastSeenEventIdRef.current);
    prevClaimedRef.current = currentClaimed;
    if (latestEvent) {
      lastSeenEventIdRef.current = latestEvent.id;
    }

    if (hasNewItem && latestEvent) {
      const visuals = getEventVisuals(latestEvent.message);
      const text = getEventShortText(latestEvent.message);
      setRewardNotice({ id: latestEvent.id, text, ...visuals });

      if (prefs.vibrateOnReward) {
        try {
          Vibration.vibrate([0, 200, 100, 300]);
        } catch {
          // Ignore
        }
      }

      if (rewardTimerRef.current) clearTimeout(rewardTimerRef.current);
      rewardTimerRef.current = setTimeout(() => {
        setRewardNotice(null);
      }, 8000);
    }
  }, []);

  const refresh = useCallback(async () => {
    const snapshot = await repository.read();
    if (mounted.current) {
      saveRef.current = snapshot.save;
      setSave(snapshot.save);
      setPrefs(snapshot.preferences);
      if (snapshot.save) {
        triggerRewardFeedback(snapshot.save, snapshot.preferences);
        if (AppState.currentState === 'active') {
          void updateTrackingNotification(snapshot.save).catch(() => {});
        }
      }
    }
    return snapshot;
  }, [triggerRewardFeedback]);

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

            const fixAgeMs = currentSave.lastFix ? rightNow - currentSave.lastFix.timestamp : Infinity;
            if (fixAgeMs > 8_000) {
              wakeGps();
              void startForegroundWatcher();
            }
          }
          
          ticks++;
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
      if (rewardTimerRef.current) clearTimeout(rewardTimerRef.current);
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
    rewardNotice,
    dismissRewardNotice: () => setRewardNotice(null),
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

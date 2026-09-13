import { useState, useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { EffectTooltip, LocationMap, UnsupportedPlatform } from '../components';
import { AppText, AssetIcon, formatDistance } from '../components/ui';
import { treasureProgress, distanceBetween, isTreasureAvailable, isFreshFix, SPEED_LEVELS_MPS } from '../game/engine';
import { ItemType } from '../game/types';
import { usePointsOfInterest } from '../services';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useGame } from '../state/GameProvider';
import { designAssets, theme } from '../theme';
import { TreasurePopup } from '../components/TreasurePopup';

function effectConfig(type: ItemType, expiresAt?: number) {
  const remainingSec = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : null;
  const timeStr = remainingSec !== null ? ` ${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, '0')}` : '';

  switch (type) {
    case 'boost_drop_2x':
      return { label: `2X ORBS${timeStr}`, color: '#70F40B', bg: 'rgba(112, 244, 11, 0.16)', border: '#16a34a', icon: 'zap' as const };
    case 'trap_drop_half':
    case 'trap_orbs':
      return { label: `0.5X ORBS${timeStr}`, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.16)', border: '#dc2626', icon: 'zap-off' as const };
    case 'boost_distance_2x':
      return { label: `2X DISTANCE${timeStr}`, color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.16)', border: '#0284c7', icon: 'trending-up' as const };
    case 'trap_distance_half':
    case 'trap_distance':
      return { label: `0.5X DISTANCE${timeStr}`, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.16)', border: '#dc2626', icon: 'trending-down' as const };
    case 'speed_up':
      return { label: `+50% SPEED${timeStr}`, color: '#4ade80', bg: 'rgba(74, 222, 128, 0.16)', border: '#16a34a', icon: 'activity' as const };
    case 'trap_slow':
      return { label: `-50% SPEED${timeStr}`, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.16)', border: '#dc2626', icon: 'activity' as const };
    case 'boost_collect_2x':
      return { label: `2X COLLECT${timeStr}`, color: '#c084fc', bg: 'rgba(192, 132, 252, 0.16)', border: '#9333ea', icon: 'plus-circle' as const };
    case 'trap_collect_half':
      return { label: `0.5X COLLECT${timeStr}`, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.16)', border: '#dc2626', icon: 'minus-circle' as const };
    case 'trap_blind':
      return { label: `BLINDED${timeStr}`, color: '#f87171', bg: 'rgba(248, 113, 113, 0.16)', border: '#dc2626', icon: 'eye-off' as const };
    default:
      return { label: `${type.replaceAll('_', ' ').toUpperCase()}${timeStr}`, color: theme.colors.primary, bg: 'rgba(255,255,255,0.15)', border: theme.colors.border, icon: 'info' as const };
  }
}

export function MapScreen() {
  const { save, preferences, busy, error, status, collectOrb, beginTreasureChallenge, removeTreasureBox } = useGame();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [, refreshClock] = useState(0);
  const [recenterVersion, setRecenterVersion] = useState(0);
  const focused = useIsFocused();
  const [treasureSelection, setTreasureSelection] = useState<{ id: string; sessionId: string; anchor: { x: number; y: number } } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const selectedTreasure = save?.sessionId === treasureSelection?.sessionId
    ? save?.treasures.find(box => box.id === treasureSelection?.id && isTreasureAvailable(box)) : undefined;
  useEffect(() => {
    if (!focused || !selectedTreasure) setTreasureSelection(null);
  }, [focused, selectedTreasure?.id]);

  const [selectedEffect, setSelectedEffect] = useState<{ type: string; level?: number; expiresAt?: number } | null>(null);
  const insets = useSafeAreaInsets();
  // A GPS fix can arrive between timer ticks. Compare it with the actual render
  // time so a new fix never looks like a future (unusable) location.
  const freshFix = save ? isFreshFix(save) : false;
  const { pointsOfInterest } = usePointsOfInterest(
    save?.lastFix ?? null,
    preferences.showPOI && freshFix,
  );

  useEffect(() => {
    if (!save || !focused) return;
    const interval = setInterval(() => refreshClock(tick => tick + 1), 1000);
    return () => clearInterval(interval);
  }, [Boolean(save), focused]);

  if (Platform.OS !== 'android') return <UnsupportedPlatform />;

  const openTreasure = (id: string, anchor: { x: number; y: number }) => {
    if (!save?.treasures.some(box => box.id === id && isTreasureAvailable(box))) return;
    setSelectedEffect(null);
    setTreasureSelection({ id, anchor, sessionId: save.sessionId });
  };

  const maxDistanceGoal = save?.config?.maxDistanceMeters || 5000;
  const progress = save ? Math.min(1, Math.max(0, save.distanceMeters / maxDistanceGoal)) : 0;
  const isBlinded = Boolean(save?.effects?.some(e => e.type === 'trap_blind'));
  const canCollect = Boolean(save?.tracking && freshFix && !busy && !error);
  const mapHint = !save ? 'Create a Solo expedition to explore.'
    : !save.tracking ? 'Tracking paused. Resume to keep exploring.'
      : !freshFix ? status || 'Waiting for an accurate GPS fix...'
        : 'Tap light orbs inside your region to collect them.';

  const hasDropBoost = Boolean(save?.effects?.some(e => e.type === 'boost_drop_2x'));
  const hasDropDebuff = Boolean(save?.effects?.some(e => e.type === 'trap_drop_half' || e.type === 'trap_orbs'));
  const effectiveChance = save ? Math.min(1.0, save.chance * (hasDropBoost ? 2 : hasDropDebuff ? 0.5 : 1)) : 0;
  const chanceColor = hasDropBoost ? '#70F40B' : hasDropDebuff ? '#ef4444' : theme.colors.text;

  const hasSpeedBoost = Boolean(save?.effects?.some(e => e.type === 'speed_up'));
  const hasSpeedDebuff = Boolean(save?.effects?.some(e => e.type === 'trap_slow'));
  const currentSpeedLevel = Math.max(save?.speedLevel || 0, preferences.maxSpeedLevel || 0);
  const baseSpeedLimitMps = SPEED_LEVELS_MPS[Math.min(currentSpeedLevel, SPEED_LEVELS_MPS.length - 1)] ?? SPEED_LEVELS_MPS[0];
  const effectiveSpeedLimitMps = baseSpeedLimitMps * (hasSpeedBoost ? 1.5 : hasSpeedDebuff ? 0.5 : 1.0);
  const speedColor = hasSpeedBoost ? '#4ade80' : hasSpeedDebuff ? '#ef4444' : '#ffffff';
  const maxSpeedStr = preferences.distanceUnit === 'mi'
    ? `${(effectiveSpeedLimitMps * 2.23694).toFixed(1)} mi/h`
    : `${(effectiveSpeedLimitMps * 3.6).toFixed(1)} km/h`;

  const hasDistBoost = Boolean(save?.effects?.some(e => e.type === 'boost_distance_2x'));
  const hasDistDebuff = Boolean(save?.effects?.some(e => e.type === 'trap_distance_half' || e.type === 'trap_distance'));
  const distColor = hasDistBoost ? '#38bdf8' : hasDistDebuff ? '#ef4444' : '#ffffff';

  const hasCollectBoost = Boolean(save?.effects?.some(e => e.type === 'boost_collect_2x'));
  const hasCollectDebuff = Boolean(save?.effects?.some(e => e.type === 'trap_collect_half'));
  const collectColor = hasCollectBoost ? '#c084fc' : hasCollectDebuff ? '#ef4444' : '#ffffff';

  const totalSegments = save ? Math.max(1, Math.floor((save.config.maxDistanceMeters || 1) / (save.config.rewardIntervalMeters || 1))) : 1;
  const currentInterval = save?.config?.rewardIntervalMeters || 1;
  const nextMilestoneMeters = save ? (Math.floor(save.distanceMeters / currentInterval) + 1) * currentInterval : 0;
  const metersToNextReward = save ? Math.max(0, nextMilestoneMeters - save.distanceMeters) : 0;

  const maxOrbsGoal = save?.config?.maxOrbs ?? 50;
  const orbsInterval = save?.config?.orbsPerReward || 5;
  const collected = save?.collectedCount || 0;
  const nextOrbMilestone = (Math.floor(collected / orbsInterval) + 1) * orbsInterval;
  const orbsToNextReward = Math.max(0, nextOrbMilestone - collected);

  const isDistMax = Boolean(save && (save.distanceMeters >= maxDistanceGoal || ((save.distanceItemPool?.length ?? 0) > 0 && (save.distanceItemsClaimed ?? 0) >= (save.distanceItemPool?.length ?? 0))));
  const isOrbsMax = Boolean(save && (save.collectedCount >= maxOrbsGoal || ((save.orbItemPool?.length ?? 0) > 0 && (save.orbItemsClaimed ?? 0) >= (save.orbItemPool?.length ?? 0))));

  return (
    <View style={styles.container} onLayout={event => { const { width, height } = event.nativeEvent.layout; setViewport({ width, height }); }}>
      {save?.lastFix ? (
        <LocationMap
          key={save.sessionId}
          location={save.lastFix}
          radiusMeters={save.config.radiusMeters}
          orbs={save.orbs}
          treasures={save.treasures}
          onSelectTreasureBox={openTreasure}
          mapStyle={preferences.mapStyle}
          pointsOfInterest={pointsOfInterest}
          canCollect={canCollect}
          recenterVersion={recenterVersion}
          onCollectOrb={(id: string) => { void collectOrb(id); }}
        />
      ) : (
        <View style={styles.waitingMap}>
          <Image source={designAssets.topo} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={styles.waitingTint} />
          <View style={styles.waitingContent}>
            <AssetIcon name="pin" size={40} />
            <AppText style={styles.waitingTitle}>{save ? 'Finding your location' : 'Your expedition awaits'}</AppText>
            <AppText style={styles.waitingText}>{mapHint}</AppText>
          </View>
        </View>
      )}

      {/* Blind Overlay over Map */}
      {isBlinded && (
        <View style={styles.blindOverlay} pointerEvents="none">
          <View style={styles.blindCard}>
            <Feather name="eye-off" size={28} color="#ef4444" />
            <AppText style={styles.blindTitle}>MAP BLINDED</AppText>
            <AppText style={styles.blindSubtitle}>Trap active • visibility obscured</AppText>
          </View>
        </View>
      )}

      <View pointerEvents="box-none" style={styles.overlay}>
        <LinearGradient
          pointerEvents="box-none"
          colors={['rgba(13,23,3,0.98)', 'rgba(13,23,3,0.88)', 'rgba(13,23,3,0)']}
          style={[styles.topGradient, { paddingTop: insets.top + 8 }]}>
          
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to Home"
              onPress={() => navigation.navigate('Home')}
              style={styles.homeButton}>
              <Feather name="home" size={22} color="#ffffff" />
            </Pressable>
            <AppText style={styles.headerTitle}>Map Explorer</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              onPress={() => navigation.navigate('Settings')}
              style={styles.settingsButton}>
              <Feather name="settings" size={22} color="#ffffff" />
            </Pressable>
          </View>

          {/* Active Perks & Buffs Row */}
          <View style={styles.effectsRow}>
            {save?.backgroundUnlocked && (
              <Pressable
                onPress={() => setSelectedEffect({ type: 'unlock_background' })}
                style={[styles.pill, styles.pillBgTracking]}>
                <Feather name="check-circle" size={13} color="#34d399" />
                <AppText style={[styles.pillText, { color: '#34d399' }]}>BG TRACKING</AppText>
              </Pressable>
            )}

            {(save?.backgroundCollectorLevel ?? 0) > 0 && (
              <Pressable
                onPress={() => setSelectedEffect({ type: 'passive_collector', level: save?.backgroundCollectorLevel })}
                style={[styles.pill, styles.pillCollector]}>
                <Feather name="cpu" size={13} color="#c084fc" />
                <AppText style={[styles.pillText, { color: '#c084fc' }]}>
                  COLLECTOR LV.{save?.backgroundCollectorLevel}
                </AppText>
              </Pressable>
            )}

            {(save?.speedLevel ?? 0) > 0 && (
              <Pressable
                onPress={() => setSelectedEffect({ type: 'progressive_speed', level: save?.speedLevel })}
                style={[styles.pill, styles.pillSpeed]}>
                <Feather name="trending-up" size={13} color="#38bdf8" />
                <AppText style={[styles.pillText, { color: '#38bdf8' }]}>
                  SPEED LV.{save?.speedLevel}
                </AppText>
              </Pressable>
            )}

            {save?.effects?.map((effect, idx) => {
              const cfg = effectConfig(effect.type, effect.expiresAt);
              return (
                <Pressable
                  key={`${effect.type}-${idx}`}
                  onPress={() => setSelectedEffect({ type: effect.type, expiresAt: effect.expiresAt })}
                  style={[styles.pill, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                  <Feather name={cfg.icon} size={13} color={cfg.color} />
                  <AppText style={[styles.pillText, { color: cfg.color }]}>{cfg.label}</AppText>
                </Pressable>
              );
            })}
          </View>

          {/* Stats Row */}
          <View pointerEvents="none" style={styles.statsRow}>
            <View style={styles.statCol}>
              <AppText style={styles.statLabel}>DISTANCE</AppText>
              <AppText style={[styles.statValue, { color: distColor }]}>
                {formatDistance(save ? save.distanceMeters : 0, preferences.distanceUnit)}
                {hasDistBoost ? ' (2x)' : hasDistDebuff ? ' (0.5x)' : ''}
              </AppText>
            </View>
            <View style={styles.statCol}>
              <AppText style={styles.statLabel}>MAX SPEED</AppText>
              <AppText style={[styles.statValue, { color: speedColor }]}>
                {maxSpeedStr}{hasSpeedDebuff ? ' (-50%)' : hasSpeedBoost ? ' (+50%)' : ''}
              </AppText>
            </View>
            <View style={styles.statCol}>
              <AppText style={styles.statLabel}>SPAWN CHANCE</AppText>
              <AppText style={[styles.statValue, { color: chanceColor }]}>
                {((effectiveChance) * 100).toFixed(1)}%{hasDropBoost ? ' (2x)' : hasDropDebuff ? ' (0.5x)' : ''}
              </AppText>
            </View>
            <View style={[styles.statCol, { alignItems: 'flex-end' }]}>
              <AppText style={styles.statLabel}>COLLECTED</AppText>
              <View style={styles.collectedOrbRow}>
                <View style={styles.smallOrbDot} />
                <AppText style={[styles.statValue, { color: collectColor }]}>
                  {Math.floor(collected)}/{maxOrbsGoal}
                  {hasCollectDebuff ? ' (0.5x)' : hasCollectBoost ? ' (2x)' : ''}
                </AppText>
              </View>
            </View>
          </View>

          {/* Segmented Progress Bar */}
          <View
            pointerEvents="none"
            style={styles.segmentedProgressBar}
            accessibilityRole="progressbar"
            accessibilityLabel="Journey progress"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
            {Array.from({ length: totalSegments }).map((_, i) => {
              const segStart = i * currentInterval;
              const segEnd = (i + 1) * currentInterval;
              const dist = save ? save.distanceMeters : 0;
              const isCompleted = dist >= segEnd;
              const isCurrent = dist >= segStart && dist < segEnd;
              const segFillPercent = isCompleted
                ? 100
                : isCurrent
                  ? Math.min(100, Math.max(0, ((dist - segStart) / currentInterval) * 100))
                  : 0;

              return (
                <View
                  key={i}
                  style={[
                    styles.segmentBlock,
                    isCurrent && styles.segmentBlockCurrent,
                  ]}>
                  <View style={[styles.segmentBlockFill, { width: `${segFillPercent}%` }]} />
                  <View
                    style={[
                      styles.segmentDot,
                      isCompleted && styles.segmentDotCompleted,
                      isCurrent && styles.segmentDotCurrent,
                    ]}
                  />
                </View>
              );
            })}
          </View>

          {save && <View pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="package" size={13} color={theme.colors.primary} />
            <AppText style={{ fontSize: 12, color: theme.colors.secondary }}>
              Treasures collected: {treasureProgress(save).collected} | Items: {treasureProgress(save).rewarded}/{treasureProgress(save).limit}
            </AppText>
          </View>}
          {/* Next Reward Notices */}
          <View pointerEvents="none" style={styles.rewardsRow}>
            {isDistMax ? (
              <AppText style={styles.rewardGreenText}>
                Distance goal reached (MAX)
              </AppText>
            ) : (
              <AppText style={styles.rewardGrayText}>
                Next dist. reward:{' '}
                <AppText style={styles.rewardGreenText}>
                  {formatDistance(nextMilestoneMeters, preferences.distanceUnit)}
                </AppText>{' '}
                <AppText style={styles.rewardGrayText}>
                  ({formatDistance(metersToNextReward, preferences.distanceUnit)})
                </AppText>
              </AppText>
            )}

            {isOrbsMax ? (
              <AppText style={styles.rewardPurpleText}>
                Orb goal reached (MAX)
              </AppText>
            ) : (
              <AppText style={styles.rewardGrayText}>
                Next orb reward:{' '}
                <AppText style={styles.rewardPurpleText}>{nextOrbMilestone} orbs</AppText>{' '}
                <AppText style={styles.rewardGrayText}>({orbsToNextReward} orbs)</AppText>
              </AppText>
            )}
          </View>
        </LinearGradient>

        {/* Recenter Button */}
        <View pointerEvents="box-none" style={styles.bottomControls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recenter map on current location"
            onPress={() => setRecenterVersion((v) => v + 1)}
            style={({ pressed }) => [styles.recenterButton, pressed && styles.recenterButtonPressed]}>
            <AssetIcon name="compass" size={24} color={theme.colors.background} />
          </Pressable>
        </View>
      </View>

      {focused && selectedTreasure && treasureSelection && viewport.width > 0 && save && <TreasurePopup
        key={selectedTreasure.id}
        box={selectedTreasure}
        anchor={treasureSelection.anchor}
        viewport={viewport}
        canCollect={canCollect && !!save.lastFix && distanceBetween(save.lastFix, selectedTreasure) <= save.config.radiusMeters}
        collectionHint={!save.tracking ? 'Resume tracking to collect this reward.'
          : !freshFix ? 'Waiting for fresh GPS to check collection range.'
          : save.lastFix && distanceBetween(save.lastFix, selectedTreasure) > save.config.radiusMeters
            ? `Walk within ${save.config.radiusMeters} m to collect this reward.`
            : 'Win a minigame to open this box.'}
        disabled={busy || !!error}
        onClose={() => setTreasureSelection(null)}
        rewardAvailable={treasureProgress(save).rewarded < treasureProgress(save).limit}
        onCollect={async () => {
          const challenge = await beginTreasureChallenge(selectedTreasure.id);
          if (!challenge) return false;
          if (challenge.kind === 'tower_defense') navigation.navigate('TowerDefense', { challengeId: challenge.id });
          else navigation.navigate('Labyrinth', { challengeId: challenge.id });
          return true;
        }}
        onRemove={() => removeTreasureBox(selectedTreasure.id)}
      />}

      {/* Floating Tooltip for Buff/Debuff description */}
      <EffectTooltip
        effectType={selectedEffect?.type ?? null}
        level={selectedEffect?.level}
        expiresAt={selectedEffect?.expiresAt}
        onClose={() => setSelectedEffect(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1703' },
  waitingMap: { flex: 1, backgroundColor: '#0D1703', alignItems: 'center', justifyContent: 'center' },
  waitingTint: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(13,23,3,0.85)' },
  waitingContent: { alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  waitingTitle: { fontFamily: theme.fonts.bold, fontSize: 20, color: theme.colors.text, textAlign: 'center' },
  waitingText: { fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.muted, textAlign: 'center', lineHeight: 18 },
  blindOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(10, 15, 8, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  blindCard: {
    backgroundColor: 'rgba(30, 20, 20, 0.9)',
    borderWidth: 1.5,
    borderColor: '#ef4444',
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 8,
  },
  blindTitle: { fontFamily: theme.fonts.bold, fontSize: 16, color: '#ef4444', letterSpacing: 1.5 },
  blindSubtitle: { fontFamily: theme.fonts.body, fontSize: 12, color: '#fca5a5' },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between' },
  topGradient: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  homeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(18, 30, 15, 0.95)',
    borderWidth: 1.5,
    borderColor: 'rgba(112, 244, 11, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: theme.fonts.bold,
    fontSize: 22,
    color: '#ffffff',
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(40, 48, 38, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  effectsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  pillBgTracking: {
    borderColor: '#059669',
    backgroundColor: 'rgba(52, 211, 153, 0.16)',
  },
  pillCollector: {
    borderColor: '#9333ea',
    backgroundColor: 'rgba(192, 132, 252, 0.16)',
  },
  pillSpeed: {
    borderColor: '#0284c7',
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
  },
  pillText: {
    fontFamily: theme.fonts.mono,
    fontSize: 10,
    fontWeight: 'bold',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  statCol: {
    gap: 2,
  },
  statLabel: {
    fontFamily: theme.fonts.medium,
    fontSize: 10,
    color: '#889988',
    letterSpacing: 0.5,
  },
  statValue: {
    fontFamily: theme.fonts.bold,
    fontSize: 17,
    color: '#ffffff',
  },
  collectedOrbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  smallOrbDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#70F40B',
  },
  segmentedProgressBar: {
    flexDirection: 'row',
    height: 8,
    gap: 4,
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
  },
  segmentBlock: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 3,
    overflow: 'visible',
    position: 'relative',
    justifyContent: 'center',
  },
  segmentBlockCurrent: {
    borderColor: 'rgba(112, 244, 11, 0.4)',
    borderWidth: 1,
  },
  segmentBlockFill: {
    height: '100%',
    backgroundColor: theme.colors.primary,
    borderRadius: 3,
  },
  segmentDot: {
    position: 'absolute',
    right: 2,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  segmentDotCompleted: {
    backgroundColor: '#ffffff',
  },
  segmentDotCurrent: {
    backgroundColor: '#facc15',
    width: 7,
    height: 7,
    borderRadius: 3.5,
    right: 0,
  },
  rewardsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  rewardGrayText: {
    fontFamily: theme.fonts.medium,
    fontSize: 11,
    color: '#889988',
  },
  rewardGreenText: {
    fontFamily: theme.fonts.bold,
    fontSize: 11,
    color: '#70F40B',
  },
  rewardPurpleText: {
    fontFamily: theme.fonts.bold,
    fontSize: 11,
    color: '#c084fc',
  },
  bottomControls: {
    position: 'absolute',
    bottom: 24,
    right: 16,
  },
  recenterButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  recenterButtonPressed: {
    transform: [{ scale: 0.94 }],
  },
});

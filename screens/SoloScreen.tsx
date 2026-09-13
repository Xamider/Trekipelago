import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Feather } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { EffectTooltip } from '../components';
import { AppButton, AppHeader, AppScreen, AppText, AssetIcon, Card, Field, Notice, SectionLabel, formatDistance } from '../components/ui';
import { DEFAULT_SOLO_CONFIG, treasureProgress, SPEED_LEVELS_MPS, validateConfig } from '../game/engine';
import { SoloConfig } from '../game/types';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useGame } from '../state/GameProvider';
import { theme } from '../theme';

function fieldsFor(config: SoloConfig) {
  return {
    maxTreasureRewards: String(config.maxTreasureRewards ?? 10),
    treasureInterval: String(config.treasureSpawnIntervalMinutes ?? 30),
    radius: String(config.radiusMeters),
    chance: String(config.baseChance * 100),
    maxDistance: String(config.maxDistanceMeters / 1000),
    rewardInterval: String(config.rewardIntervalMeters),
    orbsPerReward: String(config.orbsPerReward),
    maxOrbs: String(config.maxOrbs ?? 50),
    buffRatio: String(Math.round((config.buffRatio ?? 0.7) * 100)),
  };
}

export function SoloScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Solo'>) {
  const { save, preferences, busy, createGame, resume } = useGame();
  const [editing, setEditing] = useState(!save);
  const [fields, setFields] = useState(() => fieldsFor(save?.config ?? DEFAULT_SOLO_CONFIG));
  const [validation, setValidation] = useState<string | null>(null);
  const [selectedEffect, setSelectedEffect] = useState<{ type: string; level?: number; expiresAt?: number } | null>(null);

  const openMap = () => navigation.navigate('Expedition', { screen: 'Map' });

  const submit = async () => {
    const config: SoloConfig = {
      maxTreasureRewards: Number(fields.maxTreasureRewards),
      treasureSpawnIntervalMinutes: Number(fields.treasureInterval),
      radiusMeters: 100,
      baseChance: Number(fields.chance) / 100,
      maxDistanceMeters: Number(fields.maxDistance) * 1000,
      rewardIntervalMeters: Number(fields.rewardInterval),
      orbsPerReward: Number(fields.orbsPerReward),
      maxOrbs: Number(fields.maxOrbs),
      spawnReduction: save?.config.spawnReduction ?? DEFAULT_SOLO_CONFIG.spawnReduction,
      recoveryDistanceMeters: save?.config.recoveryDistanceMeters ?? DEFAULT_SOLO_CONFIG.recoveryDistanceMeters,
    };
    const error = validateConfig(config);
    if (error) { setValidation(error); return; }
    setValidation(null);
    if (await createGame(config)) { setEditing(false); openMap(); }
  };

  return <AppScreen>
    <AppHeader title="Solo Mode" />
    <View style={styles.content}>
      {save && !editing ? <>
        {/* Single Unified Journey & Perks Card */}
        <Card style={styles.summaryCard}>
          <SectionLabel>Current journey</SectionLabel>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCol}><AppText style={styles.summaryLabel}>Distance</AppText><AppText style={styles.summaryValue}>{formatDistance(save.distanceMeters, preferences.distanceUnit)}</AppText></View>
            <View style={styles.summaryCol}><AppText style={styles.summaryLabel}>Target</AppText><AppText style={styles.summaryValue}>{formatDistance(save.config.maxDistanceMeters, preferences.distanceUnit)}</AppText></View>
            <View style={styles.summaryCol}><AppText style={styles.summaryLabel}>Collected</AppText><AppText style={styles.summaryValue}>{save.collectedCount} orbs</AppText></View>
          </View>
          
          <View style={styles.rule} />
          
          <View style={styles.summaryDetails}>
            <AppText style={styles.detailText}>Distance rewards: every {save.config.rewardIntervalMeters}m ({save.distanceItemsClaimed ?? 0} claimed)</AppText>
            <AppText style={styles.detailText}>Orb rewards: every {save.config.orbsPerReward} orbs ({save.orbItemsClaimed ?? 0} claimed)</AppText>
            <AppText style={styles.detailText}>Treasures collected: {treasureProgress(save).collected} | Items: {treasureProgress(save).rewarded}/{treasureProgress(save).limit}</AppText>
            <AppText style={styles.detailText}>Treasure boxes: every {save.config.treasureSpawnIntervalMinutes ?? 30} minutes</AppText>
            <AppText style={styles.detailText}>Region radius: {save.config.radiusMeters} m</AppText>
            {(() => {
              const hasDropBoost = Boolean(save.effects?.some(e => e.type === 'boost_drop_2x'));
              const hasDropDebuff = Boolean(save.effects?.some(e => e.type === 'trap_drop_half' || e.type === 'trap_orbs'));
              const effectiveChance = Math.min(1.0, save.chance * (hasDropBoost ? 2 : hasDropDebuff ? 0.5 : 1));
              return (
                <AppText style={styles.detailText}>
                  Spawn chance: {(effectiveChance * 100).toFixed(1)}%{hasDropBoost ? ' (2x Boost)' : hasDropDebuff ? ' (0.5x Trap)' : ''}
                </AppText>
              );
            })()}
            <AppText style={styles.detailText}>State: {save.tracking ? 'Tracking movement' : 'Paused'}</AppText>
          </View>

          <View style={styles.rule} />

          <SectionLabel>Active Effects & Perks</SectionLabel>
          <AppText style={styles.caption}>Tap an item to view details.</AppText>
          
          <View style={{ gap: 8, marginTop: 4 }}>
            {save.effects && save.effects.length > 0 ? save.effects.map(e => {
              const remMin = Math.ceil(Math.max(0, e.expiresAt - Date.now()) / 60000);
              const isTrap = e.type.startsWith('trap_');
              return (
                <Pressable
                  key={e.id}
                  onPress={() => setSelectedEffect({ type: e.type, expiresAt: e.expiresAt })}
                  accessibilityRole="button"
                  accessibilityHint="Tap to open details tooltip"
                  style={({ pressed }) => [styles.effectItem, pressed && { opacity: 0.7 }]}>
                  <Feather name={isTrap ? 'alert-triangle' : 'zap'} size={15} color={isTrap ? '#ef4444' : '#70F40B'} />
                  <AppText style={[styles.effectName, isTrap && { color: '#ef4444' }]}>
                    {e.type.replaceAll('_', ' ').toUpperCase()} ({remMin > 0 ? `${remMin} min` : 'expired'})
                  </AppText>
                  <Feather name="info" size={12} color={theme.colors.muted} style={{ marginLeft: 'auto' }} />
                </Pressable>
              );
            }) : <AppText style={styles.caption}>No active temporary effects.</AppText>}

            <Pressable
              onPress={() => setSelectedEffect({ type: 'progressive_speed', level: save.speedLevel })}
              accessibilityRole="button"
              accessibilityHint="Tap to open details tooltip"
              style={({ pressed }) => [styles.effectItem, pressed && { opacity: 0.7 }]}>
              <Feather name="trending-up" size={15} color="#38bdf8" />
              <AppText style={styles.effectName}>
                Max Speed Limit: Level {save.speedLevel || 0} ({(SPEED_LEVELS_MPS[Math.min(save.speedLevel || 0, SPEED_LEVELS_MPS.length - 1)] * 3.6).toFixed(1)} km/h)
              </AppText>
              <Feather name="info" size={12} color={theme.colors.muted} style={{ marginLeft: 'auto' }} />
            </Pressable>

            <Pressable
              onPress={() => setSelectedEffect({ type: 'passive_collector', level: save.backgroundCollectorLevel })}
              accessibilityRole="button"
              accessibilityHint="Tap to open details tooltip"
              style={({ pressed }) => [styles.effectItem, pressed && { opacity: 0.7 }]}>
              <Feather name="cpu" size={15} color="#c084fc" />
              <AppText style={styles.effectName}>Passive Collector: Level {save.backgroundCollectorLevel || 0}</AppText>
              <Feather name="info" size={12} color={theme.colors.muted} style={{ marginLeft: 'auto' }} />
            </Pressable>

            <Pressable
              onPress={() => setSelectedEffect({ type: 'unlock_background' })}
              accessibilityRole="button"
              accessibilityHint="Tap to open details tooltip"
              style={({ pressed }) => [styles.effectItem, pressed && { opacity: 0.7 }]}>
              <Feather name="check-circle" size={15} color="#34d399" />
              <AppText style={styles.effectName}>Background Tracking: {save.backgroundUnlocked ? 'Unlocked' : 'Locked'}</AppText>
              <Feather name="info" size={12} color={theme.colors.muted} style={{ marginLeft: 'auto' }} />
            </Pressable>
          </View>
        </Card>

        <AppButton title="Continue expedition" loading={busy} onPress={() => { void (async () => { if (save.tracking || await resume()) openMap(); })(); }} />
        <AppButton title="New game" secondary disabled={busy} onPress={() => { setFields(fieldsFor(DEFAULT_SOLO_CONFIG)); setValidation(null); setEditing(true); }} />
      </> : <>
        <View style={styles.intro}><AssetIcon name="pin" size={32} /><AppText style={styles.title}>{save ? 'A new beginning' : 'Make it your journey'}</AppText><AppText style={styles.description}>Set your region and reward conditions.</AppText></View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Max dist. (km)" value={fields.maxDistance} onChangeText={maxDistance => setFields({ ...fields, maxDistance })} keyboardType="decimal-pad" hint="Total journey length." />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Reward int. (m)" value={fields.rewardInterval} onChangeText={rewardInterval => setFields({ ...fields, rewardInterval })} keyboardType="decimal-pad" hint="Meters per item." />
          </View>
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Orbs per item" value={fields.orbsPerReward} onChangeText={orbsPerReward => setFields({ ...fields, orbsPerReward })} keyboardType="decimal-pad" hint="Orbs for 1 item." />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Max Orbs Goal" value={fields.maxOrbs} onChangeText={maxOrbs => setFields({ ...fields, maxOrbs })} keyboardType="decimal-pad" hint="Total orbs to collect." />
          </View>
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field
              label="Base chance (%)"
              value={fields.chance}
              onChangeText={chance => setFields({ ...fields, chance })}
              keyboardType="decimal-pad"
              hint="Starting spawn chance (1 - 100%)."
            />
          </View>
        </View>

        <Field label="Treasure reward limit" value={fields.maxTreasureRewards}
          onChangeText={maxTreasureRewards => setFields({ ...fields, maxTreasureRewards })} keyboardType="number-pad"
          hint="Maximum boxes awarding items. Further boxes count as collected without items. Zero disables treasure rewards." />
        <Field label="Treasure interval (minutes)" value={fields.treasureInterval}
          onChangeText={treasureInterval => setFields({ ...fields, treasureInterval })} keyboardType="number-pad"
          hint="Adds 2 or 3 boxes within 2 km. Collect all boxes for an immediate refill; removing any box makes you wait for the next scheduled spawn." />
        <View style={styles.buffRatioSection}>
          <View style={styles.buffRatioHeader}>
            <AppText style={styles.buffRatioLabel}>FILLER ITEMS RATIO</AppText>
            <AppText style={styles.buffRatioValue}>
              <AppText style={{ color: '#70F40B', fontFamily: theme.fonts.bold }}>{fields.buffRatio}% Buffs</AppText>
              {' / '}
              <AppText style={{ color: '#ef4444', fontFamily: theme.fonts.bold }}>{100 - Number(fields.buffRatio)}% Traps</AppText>
            </AppText>
          </View>
          <Slider
            accessibilityLabel="Filler Items Ratio"
            accessibilityValue={{ min: 0, max: 100, now: Number(fields.buffRatio) }}
            minimumValue={0}
            maximumValue={100}
            step={5}
            value={Number(fields.buffRatio)}
            onValueChange={val => setFields(f => ({ ...f, buffRatio: String(Math.round(val)) }))}
            minimumTrackTintColor="#70F40B"
            maximumTrackTintColor="#ef4444"
            thumbTintColor="#70F40B"
            style={styles.ratioSlider}
          />
          <AppText style={styles.hint}>Ratio of positive buffs versus traps in rewards.</AppText>
        </View>
        {validation ? <Notice>{validation}</Notice> : null}
        <AppButton title="Start journey" loading={busy} onPress={() => { void submit(); }} />
        {save ? <AppButton title="Cancel" secondary disabled={busy} onPress={() => { setEditing(false); setValidation(null); }} /> : null}
      </>}
    </View>

    <EffectTooltip
      effectType={selectedEffect?.type ?? null}
      level={selectedEffect?.level}
      expiresAt={selectedEffect?.expiresAt}
      onClose={() => setSelectedEffect(null)}
    />
  </AppScreen>;
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  intro: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  title: { fontFamily: theme.fonts.display, fontSize: 24, lineHeight: 32, textAlign: 'center' },
  description: { color: theme.colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 12 },
  summaryCard: { gap: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryCol: { flex: 1 },
  summaryLabel: { color: theme.colors.secondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontFamily: theme.fonts.bold, fontSize: 16, marginTop: 4 },
  summaryDetails: { gap: 4 },
  detailText: { color: theme.colors.muted, fontSize: 12 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginVertical: 4 },
  effectItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  effectName: { fontSize: 12, fontFamily: theme.fonts.mono, color: theme.colors.text },
  caption: { color: theme.colors.muted, fontSize: 12 },
  buffRatioSection: { gap: 6, paddingVertical: 4 },
  buffRatioHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  buffRatioLabel: { color: theme.colors.secondary, fontFamily: theme.fonts.semibold, textTransform: 'uppercase', fontSize: 13, lineHeight: 17 },
  buffRatioValue: { fontFamily: theme.fonts.mono, fontSize: 12 },
  hint: { color: theme.colors.muted, fontSize: 12, lineHeight: 17 },
  ratioSlider: { width: '100%', height: 40, marginVertical: -4 },
});

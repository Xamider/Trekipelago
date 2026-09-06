import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { AppButton, AppHeader, AppScreen, AppText, AssetIcon, Card, Field, Notice, SectionLabel, formatDistance } from '../components/ui';
import { DEFAULT_SOLO_CONFIG, validateConfig } from '../game/engine';
import { SoloConfig } from '../game/types';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useGame } from '../state/GameProvider';
import { theme } from '../theme';

function fieldsFor(config: SoloConfig) {
  return { radius: String(config.radiusMeters), chance: String(config.baseChance * 100), reduction: String(config.spawnReduction * 100), recovery: String(config.recoveryDistanceMeters) };
}

export function SoloScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Solo'>) {
  const { save, preferences, busy, createGame, resume } = useGame();
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState(() => fieldsFor(DEFAULT_SOLO_CONFIG));
  const [validation, setValidation] = useState<string | null>(null);
  const openMap = () => navigation.navigate('Expedition', { screen: 'Map' });

  const start = () => {
    const number = (value: string) => Number(value.trim().replace(',', '.'));
    const config: SoloConfig = { radiusMeters: number(fields.radius), baseChance: number(fields.chance) / 100, spawnReduction: number(fields.reduction) / 100, recoveryDistanceMeters: number(fields.recovery) };
    const error = validateConfig(config);
    setValidation(error);
    if (error) return;
    const create = async () => {
      if (await createGame(config)) { setEditing(false); openMap(); }
    };
    if (save) {
      Alert.alert('Replace your Solo save?', 'This creates a new expedition and permanently replaces your current distance, collected orbs, and remaining orbs.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Create new game', style: 'destructive', onPress: () => { void create(); } },
      ]);
    } else { void create(); }
  };

  return <AppScreen>
    <AppHeader title="Solo Expedition" />
    <View style={styles.content}>
      {save && !editing ? <>
        <View style={styles.intro}><AssetIcon name="pin" size={32} /><AppText style={styles.title}>Your expedition</AppText><AppText style={styles.description}>One journey. Every step counts.</AppText></View>
        <Card style={styles.saveCard}>
          <SectionLabel>Saved on this device</SectionLabel>
          <AppText style={styles.distance}>{formatDistance(save.distanceMeters, preferences.distanceUnit)}</AppText>
          <View style={styles.stats}><View><AppText style={styles.value}>{save.collectedCount}</AppText><AppText style={styles.caption}>Orbs collected</AppText></View>
            <View><AppText style={styles.value}>{(save.chance * 100).toFixed(1)}%</AppText><AppText style={styles.caption}>Spawn chance</AppText></View></View>
          <View style={styles.rule} />
          <AppText style={styles.caption}>Region radius: {save.config.radiusMeters} m · {save.orbs.length} nearby orbs</AppText>
          <AppText style={styles.caption}>Base chance {(save.config.baseChance * 100).toFixed(0)}% · Reduction {(save.config.spawnReduction * 100).toFixed(0)}% · Recovery {save.config.recoveryDistanceMeters} m</AppText>
        </Card>
        <AppButton title="Continue expedition" loading={busy} onPress={() => { void (async () => { if (save.tracking || await resume()) openMap(); })(); }} />
        <AppButton title="New game" secondary disabled={busy} onPress={() => { setFields(fieldsFor(DEFAULT_SOLO_CONFIG)); setValidation(null); setEditing(true); }} />
      </> : <>
        <View style={styles.intro}><AssetIcon name="pin" size={32} /><AppText style={styles.title}>{save ? 'A new beginning' : 'Make it your journey'}</AppText><AppText style={styles.description}>Set your region and orb rules before you start.</AppText></View>
        <Field label="Region radius (m)" value={fields.radius} onChangeText={radius => setFields({ ...fields, radius })} keyboardType="decimal-pad" hint="The area around your live location where light orbs appear." />
        <Field label="Base spawn chance (%)" value={fields.chance} onChangeText={chance => setFields({ ...fields, chance })} keyboardType="decimal-pad" hint="Chance of one orb appearing on each 10-second roll." />
        <Field label="Reduction per spawn (%)" value={fields.reduction} onChangeText={reduction => setFields({ ...fields, reduction })} keyboardType="decimal-pad" hint="Relative reduction. At 25%, a 20% chance becomes 15%." />
        <Field label="Full recovery distance (m)" value={fields.recovery} onChangeText={recovery => setFields({ ...fields, recovery })} keyboardType="decimal-pad" hint="Walking this distance restores the full base chance." />
        {validation && <Notice danger>{validation}</Notice>}
        <Notice>Distance and chance recovery continue with the screen locked. Orbs spawn while the app is visible. Pause tracking whenever you want to stop.</Notice>
        <AppButton title={save ? 'Create new game' : 'Start expedition'} loading={busy} onPress={start} />
        {save && <AppButton title="Keep current expedition" secondary disabled={busy} onPress={() => setEditing(false)} />}
      </>}
    </View>
  </AppScreen>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 18 },
  intro: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  title: { fontFamily: theme.fonts.display, fontSize: 26, lineHeight: 32, textAlign: 'center' },
  description: { color: theme.colors.muted, textAlign: 'center', fontSize: 13 },
  saveCard: { gap: 14 },
  distance: { fontFamily: theme.fonts.black, fontSize: 40, lineHeight: 48, color: theme.colors.primary },
  stats: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  value: { fontFamily: theme.fonts.display, fontSize: 25, lineHeight: 32 },
  caption: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  rule: { height: 1, backgroundColor: theme.colors.border },
});

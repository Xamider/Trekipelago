import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';

import { AppButton, AppHeader, AppScreen, AppText, AssetIcon, Card, SectionLabel, SettingRow, Toggle } from '../components/ui';
import { useGame } from '../state/GameProvider';
import { AppPreferences } from '../state/preferences';
import { theme } from '../theme';

const mapStyles = [
  { value: 'dark', label: 'Dark' }, { value: 'satellite', label: 'Satellite' }, { value: 'topographic', label: 'Topographic' },
] as const;

export function SettingsScreen() {
  const { preferences, setPreferences, busy } = useGame();
  const [volume, setVolume] = useState(preferences.volume);
  const [choosingStyle, setChoosingStyle] = useState(false);
  useEffect(() => setVolume(preferences.volume), [preferences.volume]);
  const update = (patch: Partial<AppPreferences>) => { void setPreferences(patch); };

  return <AppScreen>
    <AppHeader title="Settings" />
    <View style={styles.content}>
      <View style={styles.section}>
        <SectionLabel>Audio</SectionLabel>
        <Card style={styles.card}>
          <View style={styles.volumeRow}><AppText style={styles.settingLabel}>Volume</AppText><AppText style={styles.value}>{Math.round(volume * 100)}%</AppText></View>
          <Slider accessibilityLabel="Volume" accessibilityValue={{ min: 0, max: 100, now: Math.round(volume * 100) }} minimumValue={0} maximumValue={1} step={0.01} value={volume}
            onValueChange={setVolume} onSlidingComplete={next => update({ volume: next })} disabled={busy}
            minimumTrackTintColor={theme.colors.primary} maximumTrackTintColor={theme.colors.background} thumbTintColor={theme.colors.primary} style={styles.slider} />
          <SettingRow label="Sound Effects"><Toggle label="Sound Effects" value={preferences.soundEffects} onChange={soundEffects => update({ soundEffects })} disabled={busy} /></SettingRow>
        </Card>
        <AppText style={styles.pending}>Preferences saved. Audio is coming in a future version.</AppText>
      </View>
      <View style={styles.section}>
        <SectionLabel>Notifications</SectionLabel>
        <Card style={styles.card}>
          <SettingRow label="Push Notifications"><Toggle label="Push Notifications" value={preferences.pushNotifications} onChange={pushNotifications => update({ pushNotifications })} disabled={busy} /></SettingRow>
          <SettingRow label="Check Alerts" divider><Toggle label="Check Alerts" value={preferences.checkAlerts} onChange={checkAlerts => update({ checkAlerts })} disabled={busy} /></SettingRow>
          <SettingRow label="Party Updates" divider><Toggle label="Party Updates" value={preferences.partyUpdates} onChange={partyUpdates => update({ partyUpdates })} disabled={busy} /></SettingRow>
        </Card>
        <AppText style={styles.pending}>Preferences saved. Game alerts are coming in a future version.</AppText>
      </View>
      <View style={styles.section}>
        <SectionLabel>Map</SectionLabel>
        <Card style={styles.card}>
          <SettingRow label="Map Style"><Pressable accessibilityRole="button" accessibilityLabel={`Map style: ${preferences.mapStyle}`} onPress={() => setChoosingStyle(true)} style={styles.dropdown}>
            <AppText style={styles.dropdownText}>{mapStyles.find(option => option.value === preferences.mapStyle)?.label}</AppText><AssetIcon name="down" size={14} />
          </Pressable></SettingRow>
          <SettingRow label="Show Points of Interest" divider><Toggle label="Show Points of Interest" value={preferences.showPOI} onChange={showPOI => update({ showPOI })} disabled={busy} /></SettingRow>
          <SettingRow label="Distance Unit" divider><View style={styles.segments}>
            {(['km', 'mi'] as const).map(unit => <Pressable accessibilityRole="radio" accessibilityState={{ checked: preferences.distanceUnit === unit, disabled: busy }} accessibilityLabel={unit === 'km' ? 'Kilometers' : 'Miles'} key={unit} disabled={busy} onPress={() => update({ distanceUnit: unit })}
              style={[styles.segment, preferences.distanceUnit === unit && styles.selectedSegment]}>
              <AppText style={[styles.segmentText, preferences.distanceUnit === unit && styles.selectedText]}>{unit.toUpperCase()}</AppText>
            </Pressable>)}
          </View></SettingRow>
        </Card>
        <AppText style={styles.pending}>Showing points of interest sends your approximate location to OpenStreetMap community servers (Overpass). Off by default.</AppText>
      </View>
    </View>
    <Modal transparent visible={choosingStyle} animationType="fade" onRequestClose={() => setChoosingStyle(false)}>
      <View style={styles.modal}>
        <Pressable accessibilityLabel="Close map style selection" style={StyleSheet.absoluteFill} onPress={() => setChoosingStyle(false)} />
        <Card style={styles.modalCard}>
          <AppText style={styles.modalTitle}>Map style</AppText>
          {mapStyles.map(option => <AppButton key={option.value} title={option.label} secondary={preferences.mapStyle !== option.value} disabled={busy} onPress={() => { update({ mapStyle: option.value }); setChoosingStyle(false); }} />)}
          <AppButton title="Cancel" secondary onPress={() => setChoosingStyle(false)} />
        </Card>
      </View>
    </Modal>
  </AppScreen>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 24 },
  section: { gap: 6 },
  card: { paddingVertical: 8 },
  volumeRow: { paddingTop: 12, paddingBottom: 6, flexDirection: 'row', justifyContent: 'space-between' },
  settingLabel: { fontFamily: theme.fonts.medium },
  value: { color: theme.colors.primary, fontFamily: theme.fonts.bold, fontSize: 13 },
  slider: { height: 36, marginHorizontal: -8 },
  pending: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, paddingTop: 2 },
  dropdown: { backgroundColor: theme.colors.background, borderWidth: 1, borderColor: '#1a2e05', borderRadius: 6, minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dropdownText: { fontSize: 13, fontFamily: theme.fonts.medium },
  segments: { backgroundColor: theme.colors.background, borderWidth: 1, borderColor: '#1a2e05', borderRadius: 6, padding: 2, flexDirection: 'row' },
  segment: { minWidth: 44, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  selectedSegment: { backgroundColor: theme.colors.primary },
  segmentText: { color: theme.colors.subtle, fontSize: 12, fontFamily: theme.fonts.medium },
  selectedText: { color: theme.colors.background, fontFamily: theme.fonts.bold },
  modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', padding: 24, justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '100%', maxWidth: 420, gap: 12 },
  modalTitle: { fontFamily: theme.fonts.display, fontSize: 24, lineHeight: 32, paddingBottom: 4 },
});

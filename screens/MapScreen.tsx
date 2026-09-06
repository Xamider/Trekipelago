import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LocationMap, UnsupportedPlatform } from '../components';
import { AppHeader, AppText, AssetIcon, formatDistance } from '../components/ui';
import { isFreshFix } from '../game/engine';
import { usePointsOfInterest } from '../services';
import { useGame } from '../state/GameProvider';
import { designAssets, theme } from '../theme';

export function MapScreen() {
  const { save, preferences, busy, error, status, now, collectOrb } = useGame();
  const focused = useIsFocused();
  const [recenterVersion, setRecenterVersion] = useState(0);
  const freshFix = save ? isFreshFix(save, now) : false;
  const { pointsOfInterest, loading: placesLoading, error: placesError } = usePointsOfInterest(
    save?.lastFix ?? null,
    focused && preferences.showPOI && freshFix,
  );

  if (Platform.OS !== 'android') return <UnsupportedPlatform />;

  const recovery = save ? Math.min(1, Math.max(0, save.chance / save.config.baseChance)) : 0;
  const recoveryMeters = save ? (1 - recovery) * save.config.recoveryDistanceMeters : 0;
  const locationReady = Boolean(save?.lastFix);
  const canCollect = Boolean(save?.tracking && freshFix && !busy && !error);
  const mapHint = !save ? 'Create a Solo expedition to explore.'
    : !save.tracking ? 'Tracking paused. Resume to keep exploring.'
      : !freshFix ? status || 'Waiting for an accurate GPS fix…'
        : 'Tap light orbs inside your region to collect them.';

  return (
    <View style={styles.container}>
      {save?.lastFix ? <LocationMap
        key={save.sessionId}
        location={save.lastFix}
        radiusMeters={save.config.radiusMeters}
        orbs={save.orbs}
        mapStyle={preferences.mapStyle}
        pointsOfInterest={pointsOfInterest}
        canCollect={canCollect}
        recenterVersion={recenterVersion}
        onCollectOrb={(id) => { void collectOrb(id); }}
      /> : <View style={styles.waitingMap}>
        <Image source={designAssets.topo} style={StyleSheet.absoluteFill} contentFit="cover" />
        <View style={styles.waitingTint} />
        <View style={styles.waitingContent}>
          <AssetIcon name="pin" size={40} />
          <AppText style={styles.waitingTitle}>{save ? 'Finding your location' : 'Your expedition awaits'}</AppText>
          <AppText style={styles.waitingText}>{mapHint}</AppText>
        </View>
      </View>}

      <SafeAreaView edges={['top', 'left', 'right']} pointerEvents="box-none" style={styles.overlay}>
        <LinearGradient pointerEvents="box-none" colors={['rgba(13,23,3,0.98)', 'rgba(13,23,3,0.82)', 'rgba(13,23,3,0)']}
          style={styles.headerGradient}>
          <AppHeader title="Map Explorer" actionLabel="Recenter map"
            onAction={() => setRecenterVersion((value) => value + 1)} />
          {save && <View pointerEvents="none" style={styles.stats}>
            <View style={styles.statRow}>
              <View style={styles.statDistance}>
                <AppText style={styles.label}>Distance</AppText>
                <AppText style={styles.value}>{formatDistance(save.distanceMeters, preferences.distanceUnit)}</AppText>
              </View>
              <View style={styles.statChance}>
                <AppText style={styles.label}>Spawn chance</AppText>
                <AppText style={styles.chanceValue}>{(save.chance * 100).toFixed(1)}%</AppText>
              </View>
              <View style={styles.statOrbs}>
                <View style={styles.orbsRow}><AssetIcon name="orb" size={24} /><AppText style={styles.value}>{save.collectedCount}</AppText></View>
                <AppText style={styles.caption}>Collected</AppText>
              </View>
            </View>
            <View style={styles.recoveryTrack} accessibilityRole="progressbar"
              accessibilityLabel="Spawn chance recovery"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(recovery * 100) }}>
              <View style={[styles.recoveryFill, { width: `${recovery * 100}%` }]} />
            </View>
            <View style={styles.recoveryLabels}>
              <AppText style={styles.caption}>{recoveryMeters < 0.01 ? 'Chance fully restored' : `${formatDistance(recoveryMeters, preferences.distanceUnit)} to full chance`}</AppText>
              <AppText style={styles.caption}>Roll every 10s</AppText>
            </View>
          </View>}
        </LinearGradient>
      </SafeAreaView>

      <View pointerEvents="box-none" style={styles.footer}>
        {locationReady && <View pointerEvents="none" style={styles.mapHint}>
          <View style={[styles.statusDot, { backgroundColor: canCollect ? theme.colors.primary : theme.colors.muted }]} />
          <AppText style={styles.hintText}>{mapHint}</AppText>
        </View>}
        {preferences.showPOI && <View style={styles.attributionRow}>
          <AppText style={styles.placesStatus}>{placesLoading ? 'Loading nearby places…' : placesError ?? `${pointsOfInterest.length} nearby places`}</AppText>
          <Pressable accessibilityRole="link" accessibilityLabel="OpenStreetMap attribution"
            onPress={() => { void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {}); }}>
            <AppText style={styles.attribution}>© OpenStreetMap</AppText>
          </Pressable>
        </View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  overlay: { ...StyleSheet.absoluteFill },
  headerGradient: { paddingBottom: 24 },
  stats: { marginHorizontal: 16, marginTop: 4, borderRadius: 16, borderWidth: 1.5, borderColor: '#1a2e05', backgroundColor: 'rgba(13,23,3,0.92)', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  statRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  statDistance: { flex: 1, minWidth: 0, gap: 4 },
  statChance: { flex: 1, minWidth: 0, gap: 4 },
  statOrbs: { alignItems: 'flex-end', gap: 4 },
  label: { color: theme.colors.secondary, fontFamily: theme.fonts.medium, fontSize: 12, lineHeight: 16 },
  value: { fontFamily: theme.fonts.bold, fontSize: 14, lineHeight: 20 },
  chanceValue: { color: theme.colors.primary, fontFamily: theme.fonts.bold, fontSize: 14, lineHeight: 20 },
  orbsRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  caption: { color: theme.colors.muted, fontSize: 11, lineHeight: 15, flexShrink: 1 },
  recoveryTrack: { height: 6, borderRadius: 3, borderWidth: 1, borderColor: '#1a2e05', backgroundColor: theme.colors.background, overflow: 'hidden' },
  recoveryFill: { height: '100%', borderRadius: 3, backgroundColor: theme.colors.primary },
  recoveryLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  waitingMap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  waitingTint: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(13,23,3,0.92)' },
  waitingContent: { maxWidth: 320, paddingHorizontal: 24, gap: 12, alignItems: 'center', marginTop: 100 },
  waitingTitle: { fontFamily: theme.fonts.display, fontSize: 22, lineHeight: 28, textAlign: 'center' },
  waitingText: { color: theme.colors.secondary, textAlign: 'center', fontSize: 14 },
  footer: { position: 'absolute', bottom: 8, left: 16, right: 16, gap: 8 },
  mapHint: { backgroundColor: 'rgba(13,23,3,0.92)', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  hintText: { flex: 1, fontSize: 11, lineHeight: 16, color: theme.colors.secondary },
  attributionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: 'rgba(13,23,3,0.9)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  placesStatus: { flex: 1, color: theme.colors.muted, fontSize: 10, lineHeight: 14 },
  attribution: { color: theme.colors.secondary, fontSize: 10, lineHeight: 14, textDecorationLine: 'underline' },
});

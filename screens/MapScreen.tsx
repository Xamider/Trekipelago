import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LocationMap, UnsupportedPlatform } from '../components';
import { AppHeader, AppText, AssetIcon, formatDistance } from '../components/ui';
import { isFreshFix, SPEED_LEVELS_MPS } from '../game/engine';
import { usePointsOfInterest } from '../services';
import { useGameStatus } from '../state/GameProvider';
import { designAssets, theme } from '../theme';

export function MapScreen() {
  const { save, preferences, busy, error, status, now, collectOrb } = useGameStatus();
  const focused = useIsFocused();
  const [recenterVersion, setRecenterVersion] = useState(0);
  const insets = useSafeAreaInsets();
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

  const currentSpeedLimitMps = SPEED_LEVELS_MPS[Math.min(preferences.maxSpeedLevel || 0, SPEED_LEVELS_MPS.length - 1)] ?? SPEED_LEVELS_MPS[0];
  const maxSpeedStr = preferences.distanceUnit === 'mi'
    ? `${(currentSpeedLimitMps * 2.23694).toFixed(1)} mi/h`
    : `${(currentSpeedLimitMps * 3.6).toFixed(1)} km/h`;

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

      <View pointerEvents="box-none" style={styles.overlay}>
        <LinearGradient pointerEvents="box-none" colors={['rgba(13,23,3,0.98)', 'rgba(13,23,3,0.82)', 'rgba(13,23,3,0)']}
          style={[styles.headerGradient, { paddingTop: insets.top }]}>
          <AppHeader title="Map Explorer" />
          {save && <View pointerEvents="none" style={styles.stats}>
            <View style={styles.statRow}>
              <View style={styles.statDistance}>
                <AppText style={styles.label}>Distance</AppText>
                <AppText style={styles.value}>{formatDistance(save.distanceMeters, preferences.distanceUnit)}</AppText>
              </View>
              <View style={styles.statSpeed}>
                <AppText style={styles.label}>Max speed</AppText>
                <AppText style={styles.value}>{maxSpeedStr}</AppText>
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
      </View>

      <View pointerEvents="box-none" style={styles.footer}>
        <View style={styles.footerOverlay}>
          {preferences.showPOI ? <View style={styles.attributionRow}>
            <AppText style={styles.placesStatus}>{placesLoading ? 'Loading nearby places…' : placesError ?? `${pointsOfInterest.length} nearby places`}</AppText>
            <Pressable accessibilityRole="link" accessibilityLabel="OpenStreetMap attribution"
              onPress={() => { void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {}); }}>
              <AppText style={styles.attribution}>© OpenStreetMap</AppText>
            </Pressable>
          </View> : <View style={{ flex: 1 }} />}
          
          <Pressable 
            style={styles.recenterButton} 
            accessibilityRole="button" 
            accessibilityLabel="Recenter map"
            onPress={() => setRecenterVersion((value) => value + 1)}>
            <AssetIcon name="userPulse" size={24} color={theme.colors.background} />
          </Pressable>
        </View>
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
  statDistance: { flex: 2, minWidth: 0, gap: 4 },
  statSpeed: { flex: 2, minWidth: 0, gap: 4 },
  statChance: { flex: 2, minWidth: 0, gap: 4 },
  statOrbs: { alignItems: 'flex-end', gap: 4 },
  label: { color: theme.colors.secondary, fontFamily: theme.fonts.medium, fontSize: 12, lineHeight: 16 },
  value: { fontFamily: theme.fonts.bold, fontSize: 13, lineHeight: 20 },
  chanceValue: { color: theme.colors.primary, fontFamily: theme.fonts.bold, fontSize: 13, lineHeight: 20 },
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
  footer: { position: 'absolute', bottom: 16, left: 16, right: 16, gap: 12 },
  footerOverlay: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  recenterButton: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84 },
  attributionRow: { flex: 1, marginRight: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: 'rgba(13,23,3,0.9)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  placesStatus: { flex: 1, color: theme.colors.muted, fontSize: 10, lineHeight: 14 },
  attribution: { color: theme.colors.secondary, fontSize: 10, lineHeight: 14, textDecorationLine: 'underline' },
});

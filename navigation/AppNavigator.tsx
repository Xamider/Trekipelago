import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { DarkTheme, NavigationContainer, NavigatorScreenParams, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';

import { AppScreen, AppText } from '../components/ui';
import { ArchipelagoScreen } from '../screens/ArchipelagoScreen';
import { ConsoleScreen } from '../screens/ConsoleScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { MapScreen } from '../screens/MapScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TowerDefenseScreen } from '../screens/TowerDefenseScreen';
import { LabyrinthScreen } from '../screens/LabyrinthScreen';
import { SoloScreen } from '../screens/SoloScreen';
import { useGame, useGameStatus } from '../state/GameProvider';
import { theme } from '../theme';

export type ExpeditionTabParamList = { Map: undefined; Console: undefined };
export type RootStackParamList = {
  TowerDefense: { challengeId: string };
  Labyrinth: { challengeId: string };
  Home: undefined;
  Solo: undefined;
  Expedition: NavigatorScreenParams<ExpeditionTabParamList>;
  Settings: undefined;
  Archipelago: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<ExpeditionTabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function TrackingStrip() {
  const { save, busy, error, status, pause, resume, retry, now, rewardNotice, dismissRewardNotice } = useGameStatus();
  const [rowWidth, setRowWidth] = useState(0);
  
  const missingGpsDurationMs = save?.lastFix ? Math.max(0, now - save.lastFix.timestamp) : 0;
  const isGpsDelaying = save?.tracking && missingGpsDurationMs > 60000;
  
  const intensity = Math.min(1, Math.max(0, (missingGpsDurationMs - 60000) / 30000));
  const r = Math.round(109 + (255 - 109) * intensity);
  const g = Math.round(166 + (107 - 166) * intensity);
  const b = Math.round(164 + (107 - 164) * intensity);
  const warningColor = `rgb(${r},${g},${b})`;

  if (!save && !error) return null;

  return <View style={styles.trackingPanel}>
    {error && <AppText accessibilityLiveRegion="polite" style={styles.error}>{error}</AppText>}

    {rewardNotice && (
      <Pressable
        onPress={dismissRewardNotice}
        accessibilityRole="button"
        accessibilityLabel={`Reward: ${rewardNotice.text}. Tap to dismiss`}
        style={rowWidth >= 440 ? styles.centerBadgeWrapper : styles.aboveBadgeWrapper}
        pointerEvents="box-none">
        <View style={[styles.eventBadge, { backgroundColor: rewardNotice.bg, borderColor: rewardNotice.border }]}>
          <Feather name={rewardNotice.icon} size={11} color={rewardNotice.color} />
          <AppText numberOfLines={1} style={[styles.eventText, { color: rewardNotice.color }]}>
            {rewardNotice.text}
          </AppText>
        </View>
      </Pressable>
    )}

    <View style={styles.trackingRow} onLayout={e => setRowWidth(e.nativeEvent.layout.width)}>
      {save && <Pressable accessibilityRole="button" accessibilityLabel="Open Solo map" style={styles.trackingInfo} onPress={() => { if (navigationRef.isReady()) navigationRef.navigate('Expedition', { screen: 'Map' }); }}>
        <View style={[styles.statusDot, !save.tracking && { backgroundColor: theme.colors.subtle }]} />
        <View style={styles.statusText}>
          <AppText numberOfLines={1} style={styles.statusLabel}>SOLO {save.tracking ? 'TRACKING' : 'PAUSED'}</AppText>
          <AppText numberOfLines={1} style={[styles.statusDescription, isGpsDelaying && { color: warningColor }]}>{status}</AppText>
        </View>
      </Pressable>}

      {error ? <>
        {save?.tracking && <Pressable accessibilityRole="button" accessibilityLabel="Pause Solo tracking" disabled={busy} onPress={() => { void pause(); }} style={styles.trackingButton}><AppText style={styles.trackingButtonText}>Pause</AppText></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Retry saving and tracking" disabled={busy} onPress={() => { void retry(); }} style={styles.trackingButton}><AppText style={styles.trackingButtonText}>{busy ? 'Retrying…' : 'Retry'}</AppText></Pressable>
      </>
        : <Pressable accessibilityRole="button" accessibilityLabel={save?.tracking ? 'Pause Solo tracking' : 'Resume Solo tracking'} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => { if (save?.tracking) void pause(); else void resume(); }} style={styles.trackingButton}>
          <AppText style={styles.trackingButtonText}>{busy ? 'Please wait…' : save?.tracking ? 'Pause' : 'Resume'}</AppText>
        </Pressable>}
    </View>
  </View>;
}

function ExpeditionTabs() {
  return <Tabs.Navigator
    safeAreaInsets={{ bottom: 0 }}
    tabBar={(props) => (
      <View style={{ backgroundColor: theme.colors.nav }}>
        <TrackingStrip />
        <BottomTabBar {...props} />
      </View>
    )}
    screenOptions={({ route }) => ({
      headerShown: false,
      tabBarStyle: styles.tabBar,
      tabBarActiveTintColor: theme.colors.primary,
      tabBarInactiveTintColor: theme.colors.subtle,
      tabBarLabelStyle: styles.tabLabel,
      tabBarIcon: ({ focused, color }) => (
        <View style={[styles.tabIcon, focused && styles.activeTabIcon]}>
          <Feather name={route.name === 'Map' ? 'map' : 'terminal'} size={20} color={color} />
        </View>
      ),
      sceneStyle: { backgroundColor: theme.colors.background },
    })}>
    <Tabs.Screen name="Map" component={MapScreen} />
    <Tabs.Screen name="Console" component={ConsoleScreen} />
  </Tabs.Navigator>;
}

export function AppNavigator() {
  const { loading } = useGame();
  
  if (loading) return <AppScreen scroll={false}><View style={styles.loading}><ActivityIndicator color={theme.colors.primary} /><AppText>Loading your expedition…</AppText></View></AppScreen>;
  
  return <NavigationContainer ref={navigationRef} theme={{ ...DarkTheme, colors: { ...DarkTheme.colors, primary: theme.colors.primary, background: theme.colors.background, card: theme.colors.surface, text: theme.colors.text, border: theme.colors.border } }}>
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <Stack.Navigator initialRouteName="Home" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Screen name="TowerDefense" component={TowerDefenseScreen} />
        <Stack.Screen name="Labyrinth" component={LabyrinthScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Solo" component={SoloScreen} />
        <Stack.Screen name="Expedition" component={ExpeditionTabs} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Archipelago" component={ArchipelagoScreen} />
      </Stack.Navigator>
      <GlobalTrackingStripWrapper />
    </SafeAreaView>
  </NavigationContainer>;
}

function GlobalTrackingStripWrapper() {
  const [currentRoute, setCurrentRoute] = useState<string | undefined>(undefined);
  
  useEffect(() => {
    if (!navigationRef.isReady()) return;
    setCurrentRoute(navigationRef.getCurrentRoute()?.name);
    const unsubscribe = navigationRef.addListener('state', () => {
      setCurrentRoute(navigationRef.getCurrentRoute()?.name);
    });
    return unsubscribe;
  }, []);

  if (currentRoute === 'Map' || currentRoute === 'Console' || currentRoute === 'Labyrinth' || currentRoute === 'TowerDefense') {
    return null;
  }

  return <TrackingStrip />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.nav },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  tabBar: { minHeight: 72, height: 72, paddingTop: 6, paddingBottom: 10, borderTopWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 24, elevation: 0 },
  tabLabel: { fontFamily: theme.fonts.medium, fontSize: 10, marginTop: 4 },
  tabIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  activeTabIcon: { backgroundColor: 'rgba(112,244,11,0.15)' },
  trackingPanel: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 6, gap: 4, position: 'relative' },
  trackingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, gap: 12 },
  trackingInfo: { flex: 1, minWidth: 0, flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 44 },
  aboveBadgeWrapper: {
    position: 'absolute',
    top: -34,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99,
  },
  centerBadgeWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  eventBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxHeight: 28,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
  },
  eventText: {
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    lineHeight: 14,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.primary },
  statusText: { flex: 1, minWidth: 0 },
  statusLabel: { color: theme.colors.primary, fontFamily: theme.fonts.mono, fontSize: 10, lineHeight: 14 },
  statusDescription: { fontSize: 10, lineHeight: 14, color: theme.colors.muted },
  trackingButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, zIndex: 11 },
  trackingButtonText: { color: theme.colors.primary, fontFamily: theme.fonts.bold, fontSize: 12 },
  error: { fontSize: 12, lineHeight: 17, color: theme.colors.danger },
});

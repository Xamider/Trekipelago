import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { DarkTheme, NavigationContainer, NavigatorScreenParams, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppScreen, AppText, AssetIcon } from '../components/ui';
import { ArchipelagoScreen } from '../screens/ArchipelagoScreen';
import { ConsoleScreen } from '../screens/ConsoleScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { MapScreen } from '../screens/MapScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SoloScreen } from '../screens/SoloScreen';
import { useGame } from '../state/GameProvider';
import { theme } from '../theme';

export type ExpeditionTabParamList = { Map: undefined; Console: undefined };
export type RootStackParamList = {
  Home: undefined;
  Solo: undefined;
  Expedition: NavigatorScreenParams<ExpeditionTabParamList>;
  Settings: undefined;
  Archipelago: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<ExpeditionTabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function ExpeditionTabs() {
  return <Tabs.Navigator safeAreaInsets={{ bottom: 0 }} screenOptions={({ route }) => ({
    headerShown: false,
    tabBarStyle: styles.tabBar,
    tabBarActiveTintColor: theme.colors.primary,
    tabBarInactiveTintColor: theme.colors.subtle,
    tabBarLabelStyle: styles.tabLabel,
    tabBarIcon: ({ focused, color }) => <View style={[styles.tabIcon, focused && styles.activeTabIcon]}><AssetIcon name={route.name === 'Map' ? 'map' : 'console'} size={20} color={color} /></View>,
    sceneStyle: { backgroundColor: theme.colors.background },
  })}>
    <Tabs.Screen name="Map" component={MapScreen} />
    <Tabs.Screen name="Console" component={ConsoleScreen} />
  </Tabs.Navigator>;
}

function TrackingStrip() {
  const { save, busy, error, status, pause, resume, retry } = useGame();
  if (!save && !error) return null;
  return <View style={styles.trackingPanel}>
    {error && <AppText accessibilityLiveRegion="polite" style={styles.error}>{error}</AppText>}
    <View style={styles.trackingRow}>
      {save && <Pressable accessibilityRole="button" accessibilityLabel="Open Solo map" style={styles.trackingInfo} onPress={() => { if (navigationRef.isReady()) navigationRef.navigate('Expedition', { screen: 'Map' }); }}>
        <View style={[styles.statusDot, !save.tracking && { backgroundColor: theme.colors.subtle }]} />
        <View style={styles.statusText}><AppText style={styles.statusLabel}>SOLO {save.tracking ? 'TRACKING' : 'PAUSED'}</AppText><AppText style={styles.statusDescription}>{status}</AppText></View>
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

export function AppNavigator() {
  const { loading } = useGame();
  if (loading) return <AppScreen scroll={false}><View style={styles.loading}><ActivityIndicator color={theme.colors.primary} /><AppText>Loading your expedition…</AppText></View></AppScreen>;
  return <NavigationContainer ref={navigationRef} theme={{ ...DarkTheme, colors: { ...DarkTheme.colors, primary: theme.colors.primary, background: theme.colors.background, card: theme.colors.surface, text: theme.colors.text, border: theme.colors.border } }}>
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Solo" component={SoloScreen} />
        <Stack.Screen name="Expedition" component={ExpeditionTabs} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Archipelago" component={ArchipelagoScreen} />
      </Stack.Navigator>
      <TrackingStrip />
    </SafeAreaView>
  </NavigationContainer>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  tabBar: { minHeight: 72, height: 72, paddingTop: 6, paddingBottom: 10, borderTopWidth: 0, backgroundColor: '#050c02', paddingHorizontal: 24 },
  tabLabel: { fontFamily: theme.fonts.medium, fontSize: 10, marginTop: 4 },
  tabIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  activeTabIcon: { backgroundColor: 'rgba(112,244,11,0.15)' },
  trackingPanel: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 6, gap: 4 },
  trackingRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  trackingInfo: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 44 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.primary },
  statusText: { flex: 1 },
  statusLabel: { color: theme.colors.primary, fontFamily: theme.fonts.mono, fontSize: 10, lineHeight: 14 },
  statusDescription: { fontSize: 10, lineHeight: 14, color: theme.colors.muted },
  trackingButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8 },
  trackingButtonText: { color: theme.colors.primary, fontFamily: theme.fonts.bold, fontSize: 12 },
  error: { fontSize: 12, lineHeight: 17, color: theme.colors.danger },
});

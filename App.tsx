import { useFonts } from 'expo-font';
import { Outfit_600SemiBold, Outfit_700Bold, Outfit_900Black } from '@expo-google-fonts/outfit';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { UnsupportedPlatform } from './components/UnsupportedPlatform';
import { AppNavigator } from './navigation/AppNavigator';
import { GameProvider } from './state/GameProvider';

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Outfit_600SemiBold, Outfit_700Bold, Outfit_900Black,
    Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold,
    JetBrainsMono_700Bold,
  });
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {Platform.OS !== 'android' ? <UnsupportedPlatform /> : !fontsLoaded && !fontError ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#70F40B" />
          <Text style={styles.loadingText}>Preparing your journey…</Text>
        </View>
      ) : (
        <GameProvider><AppNavigator /></GameProvider>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: '#0D1703' },
  loadingText: { color: '#F0FEE7' },
});

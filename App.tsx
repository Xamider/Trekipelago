import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MapScreen } from './screens';

export default function App() {
  return (
    <SafeAreaProvider>
      <MapScreen />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function UnsupportedPlatform() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Trekipelago</Text>
      <Text style={styles.text}>Mapa Google jest obecnie dostępna w aplikacji Android.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f8fafc',
  },
  title: { color: '#0f172a', fontSize: 28, fontWeight: '800' },
  text: { color: '#475569', fontSize: 16, marginTop: 8, textAlign: 'center' },
});

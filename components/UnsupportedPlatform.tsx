import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function UnsupportedPlatform() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Trekipelago</Text>
      <Text style={styles.text}>Trekipelago is currently available on Android.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0D1703',
  },
  title: { color: '#F0FEE7', fontSize: 28, fontWeight: '800' },
  text: { color: '#A2F76E', fontSize: 16, marginTop: 8, textAlign: 'center' },
});

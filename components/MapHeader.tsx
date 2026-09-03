import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type MapHeaderProps = {
  placesCount: number;
};

export function MapHeader({ placesCount }: MapHeaderProps) {
  return (
    <SafeAreaView pointerEvents="none" style={styles.overlay}>
      <View style={styles.header}>
        <Text style={styles.title}>Trekipelago</Text>
        <Text style={styles.subtitle}>Katowice • {placesCount} miejsc z OpenStreetMap</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill },
  header: {
    alignSelf: 'center',
    width: '92%',
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  title: { color: '#0f172a', fontSize: 21, fontWeight: '800' },
  subtitle: { color: '#475569', fontSize: 14, marginTop: 3 },
});

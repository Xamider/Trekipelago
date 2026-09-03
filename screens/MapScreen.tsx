import { Platform, StyleSheet, View } from 'react-native';

import { KatowiceMap, MapHeader, UnsupportedPlatform } from '../components';
import { usePointsOfInterest } from '../services';

export function MapScreen() {
  const pointsOfInterest = usePointsOfInterest();

  if (Platform.OS !== 'android') return <UnsupportedPlatform />;

  return (
    <View style={styles.container}>
      <KatowiceMap pointsOfInterest={pointsOfInterest} />
      <MapHeader placesCount={pointsOfInterest.length} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});

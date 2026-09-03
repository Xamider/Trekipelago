import { Platform, StyleSheet } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import { KATOWICE, KATOWICE_INITIAL_REGION } from '../data';
import type { PointOfInterest } from '../types';

type KatowiceMapProps = {
  pointsOfInterest: PointOfInterest[];
};

export function KatowiceMap({ pointsOfInterest }: KatowiceMapProps) {
  return (
    <MapView
      style={styles.map}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      initialRegion={KATOWICE_INITIAL_REGION}
      showsUserLocation
      showsMyLocationButton
      scrollEnabled
      zoomEnabled
      rotateEnabled
      pitchEnabled
    >
      <Circle
        center={KATOWICE}
        radius={220}
        fillColor="rgba(37, 99, 235, 0.16)"
        strokeColor="rgba(37, 99, 235, 0.55)"
        strokeWidth={1}
      />
      <Marker
        coordinate={KATOWICE}
        title="Twoja lokalizacja"
        description="Punkt testowy: centrum Katowic"
        pinColor="#2563eb"
      />
      {pointsOfInterest.map((point) => (
        <Marker
          key={point.id}
          coordinate={point.coordinates}
          title={point.title}
          description={point.snippet}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});

import { Platform, StyleSheet } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import { PLACEHOLDER_INITIAL_REGION, PLACEHOLDER_LOCATION } from '../data';
import type { PointOfInterest } from '../types';

type LocationMapProps = {
  pointsOfInterest: PointOfInterest[];
};

export function LocationMap({ pointsOfInterest }: LocationMapProps) {
  return (
    <MapView
      style={styles.map}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      initialRegion={PLACEHOLDER_INITIAL_REGION}
      showsUserLocation
      showsMyLocationButton
      scrollEnabled
      zoomEnabled
      rotateEnabled
      pitchEnabled
    >
      <Circle
        center={PLACEHOLDER_LOCATION}
        radius={220}
        fillColor="rgba(37, 99, 235, 0.16)"
        strokeColor="rgba(37, 99, 235, 0.55)"
        strokeWidth={1}
      />
      <Marker
        coordinate={PLACEHOLDER_LOCATION}
        title="Twoja lokalizacja"
        description="Statyczny punkt testowy"
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

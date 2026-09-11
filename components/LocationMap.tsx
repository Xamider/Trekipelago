import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';

import type { Orb } from '../game/types';
import type { AppPreferences } from '../state/preferences';
import { theme } from '../theme';
import type { Coordinates, PointOfInterest } from '../types';

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#101b11' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#779267' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#101b11' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2d422b' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#112013' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#253527' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#142416' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#334a2e' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a191b' }] },
];

function viewingRegion(location: Coordinates, radiusMeters: number): Region {
  const latitudeDelta = Math.min(170, Math.max(0.002, radiusMeters * 5 / 111_320));
  return {
    ...location,
    latitudeDelta,
    longitudeDelta: Math.min(350, latitudeDelta / Math.max(0.01, Math.cos(location.latitude * Math.PI / 180))),
  };
}

type LocationMapProps = {
  location: Coordinates;
  radiusMeters: number;
  orbs: Orb[];
  mapStyle: AppPreferences['mapStyle'];
  pointsOfInterest: PointOfInterest[];
  canCollect: boolean;
  recenterVersion: number;
  onCollectOrb: (id: string) => void;
};

function MapPoint({ coordinate, icon, title, description, onPress }: {
  coordinate: Coordinates;
  icon: 'amber' | 'cyan' | 'orb';
  title?: string;
  description?: string;
  onPress?: () => void;
}) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setTracksViewChanges(false), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Marker
      coordinate={coordinate}
      title={title}
      description={description}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
      zIndex={icon === 'orb' ? 3 : 1}
      stopPropagation={true}
      onPress={onPress}
      accessibilityLabel={icon === 'orb' ? 'Collect light orb' : title}
      accessibilityRole={icon === 'orb' ? 'button' : undefined}
    >
      <View collapsable={false} style={icon === 'orb' ? styles.orbTarget : styles.poiTarget}>
        {icon === 'orb' ? (
          <View style={styles.orbDisc}>
            <View style={styles.orbCore} />
          </View>
        ) : (
          <View style={[styles.poiDot, icon === 'cyan' ? styles.poiCyan : styles.poiAmber]} />
        )}
      </View>
    </Marker>
  );
}

export function LocationMap({ location, radiusMeters, orbs, mapStyle, pointsOfInterest,
  recenterVersion, onCollectOrb }: LocationMapProps) {
  const map = useRef<MapView>(null);
  const following = useRef(true);
  const latestCenter = useRef(location);
  latestCenter.current = location;
  const [ready, setReady] = useState(false);
  const { latitude, longitude } = location;

  useEffect(() => {
    if (ready && following.current) map.current?.animateCamera({ center: { latitude, longitude } }, { duration: 500 });
  }, [ready, latitude, longitude]);

  useEffect(() => {
    following.current = true;
    if (ready) map.current?.animateToRegion(viewingRegion(latestCenter.current, radiusMeters), 350);
  }, [ready, recenterVersion, radiusMeters]);

  return (
    <MapView
      ref={map}
      style={styles.map}
      provider={PROVIDER_GOOGLE}
      initialRegion={viewingRegion(location, radiusMeters)}
      mapType={mapStyle === 'satellite' ? 'satellite' : mapStyle === 'topographic' ? 'terrain' : 'standard'}
      customMapStyle={mapStyle === 'dark' ? darkMapStyle : [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }]}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
      showsIndoors={false}
      moveOnMarkerPress={false}
      mapPadding={{ top: 220, right: 16, bottom: 50, left: 16 }}
      onMapReady={() => setReady(true)}
      onPanDrag={() => { following.current = false; }}
      onRegionChangeComplete={(_, detail) => { if (detail.isGesture) following.current = false; }}
      scrollEnabled
      zoomEnabled
      rotateEnabled
      pitchEnabled
    >
      <Circle
        center={location}
        radius={radiusMeters}
        fillColor="rgba(112, 244, 11, 0.15)"
        strokeColor={theme.colors.primary}
        strokeWidth={1.5}
        lineDashPattern={[6, 5]}
      />
      <Marker
        coordinate={location}
        title="Your location"
        description="The region moves with your GPS position"
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
        zIndex={2}
      >
        <View collapsable={false} style={styles.beaconHalo}><View style={styles.beacon} /></View>
      </Marker>
      {pointsOfInterest.map((point) => (
        <MapPoint
          key={point.id}
          coordinate={point.coordinates}
          title={point.title}
          description={point.snippet}
          icon={point.snippet.includes('cafe') ? 'cyan' : 'amber'}
        />
      ))}
      {orbs.map((orb) => (
        <MapPoint
          key={orb.id}
          coordinate={orb}
          icon="orb"
          onPress={() => onCollectOrb(orb.id)}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  beaconHalo: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(112,244,11,0.3)', alignItems: 'center', justifyContent: 'center' },
  beacon: { width: 20, height: 20, borderRadius: 10, backgroundColor: theme.colors.primary },
  orbTarget: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  orbDisc: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#0D1703',
    borderWidth: 2,
    borderColor: '#70F40B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#70F40B',
  },
  poiTarget: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  poiDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#0D1703' },
  poiCyan: { backgroundColor: '#2DD4BF' },
  poiAmber: { backgroundColor: '#F59E0B' },
});

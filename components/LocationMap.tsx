import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';

import type { Orb } from '../game/types';
import type { AppPreferences } from '../state/preferences';
import { designAssets, theme } from '../theme';
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

function MapPoint({ coordinate, icon, title, description, onPress, disabled = false }: {
  coordinate: Coordinates;
  icon: 'amber' | 'cyan' | 'orb';
  title?: string;
  description?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [trackImage, setTrackImage] = useState(true);

  useEffect(() => {
    if (!imageLoaded) return;
    // Capture the loaded SVG before stopping continuous marker redraws.
    const timer = setTimeout(() => setTrackImage(false), 250);
    return () => clearTimeout(timer);
  }, [imageLoaded]);

  return <Marker
    coordinate={coordinate}
    title={title}
    description={description}
    anchor={{ x: 0.5, y: 0.5 }}
    tracksViewChanges={trackImage}
    opacity={disabled ? 0.45 : 1}
    zIndex={icon === 'orb' ? 3 : 1}
    onPress={disabled ? undefined : onPress}
    accessibilityLabel={icon === 'orb' ? 'Collect light orb' : title}
    accessibilityRole={icon === 'orb' ? 'button' : undefined}
    accessibilityState={{ disabled }}
  >
    <View collapsable={false} style={icon === 'orb' ? styles.orbTarget : styles.poiTarget}>
      <Image source={designAssets[icon]} contentFit="contain"
        style={icon === 'orb' ? styles.orbImage : styles.poiImage}
        onLoad={() => setImageLoaded(true)} />
    </View>
  </Marker>;
}

export function LocationMap({ location, radiusMeters, orbs, mapStyle, pointsOfInterest,
  canCollect, recenterVersion, onCollectOrb }: LocationMapProps) {
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
      mapPadding={{ top: 170, right: 16, bottom: 50, left: 16 }}
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
      {orbs.map((orb) => <MapPoint key={orb.id} coordinate={orb} icon="orb"
        disabled={!canCollect} onPress={() => onCollectOrb(orb.id)} />)}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  beaconHalo: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(112,244,11,0.3)', alignItems: 'center', justifyContent: 'center' },
  beacon: { width: 20, height: 20, borderRadius: 10, backgroundColor: theme.colors.primary },
  orbTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  poiTarget: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  orbImage: { width: 32, height: 32 },
  poiImage: { width: 10, height: 10 },
});

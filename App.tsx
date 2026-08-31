import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

const KATOWICE = { latitude: 50.2649, longitude: 19.0238 };

type OverpassElement = {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: { name?: string; amenity?: string; tourism?: string; leisure?: string };
};

type OverpassResponse = { elements: OverpassElement[] };

type PointOfInterest = {
  id: string;
  title: string;
  snippet: string;
  coordinates: { latitude: number; longitude: number };
};

const overpassQuery = `[out:json][timeout:20];
(
  nwr["amenity"~"cafe|restaurant|museum|theatre|cinema"](around:3000,${KATOWICE.latitude},${KATOWICE.longitude});
  nwr["tourism"~"attraction|museum|viewpoint"](around:3000,${KATOWICE.latitude},${KATOWICE.longitude});
);
out center 30;`;

export default function App() {
  const [pointsOfInterest, setPointsOfInterest] = useState<PointOfInterest[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPointsOfInterest() {
      try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: controller.signal,
        });
        const data = (await response.json()) as OverpassResponse;
        const markers = data.elements.flatMap((place) => {
          const latitude = place.lat ?? place.center?.lat;
          const longitude = place.lon ?? place.center?.lon;
          const category = place.tags?.tourism ?? place.tags?.amenity ?? place.tags?.leisure;

          if (!latitude || !longitude || !place.tags?.name) return [];

          return [{
            id: `osm-${place.id}`,
            title: place.tags.name,
            snippet: category ? `OpenStreetMap • ${category}` : 'OpenStreetMap',
            coordinates: { latitude, longitude },
          }];
        });
        setPointsOfInterest(markers);
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          console.warn('Nie udało się pobrać POI z Overpass.', error);
        }
      }
    }

    loadPointsOfInterest();
    return () => controller.abort();
  }, []);

  if (Platform.OS !== 'android') {
    return (
      <SafeAreaView style={styles.unsupported}>
        <Text style={styles.unsupportedTitle}>Trekipelago</Text>
        <Text style={styles.unsupportedText}>Mapa Google jest obecnie dostępna w aplikacji Android.</Text>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{ ...KATOWICE, latitudeDelta: 0.06, longitudeDelta: 0.06 }}
        showsUserLocation
        showsMyLocationButton
      >
        <Marker coordinate={KATOWICE} title="Twoja lokalizacja" description="Centrum Katowic" pinColor="#2563eb" />
        {pointsOfInterest.map((point) => (
          <Marker
            key={point.id}
            coordinate={point.coordinates}
            title={point.title}
            description={point.snippet}
          />
        ))}
      </MapView>
      <SafeAreaView pointerEvents="none" style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.title}>Trekipelago</Text>
          <Text style={styles.subtitle}>Katowice • {pointsOfInterest.length} miejsc z OpenStreetMap</Text>
        </View>
      </SafeAreaView>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill },
  header: {
    alignSelf: 'center', width: '92%', marginTop: 8, paddingHorizontal: 18, paddingVertical: 14,
    borderRadius: 16, backgroundColor: 'rgba(255, 255, 255, 0.96)', shadowColor: '#0f172a',
    shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  title: { color: '#0f172a', fontSize: 21, fontWeight: '800' },
  subtitle: { color: '#475569', fontSize: 14, marginTop: 3 },
  unsupported: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#f8fafc' },
  unsupportedTitle: { color: '#0f172a', fontSize: 28, fontWeight: '800' },
  unsupportedText: { color: '#475569', fontSize: 16, marginTop: 8, textAlign: 'center' },
});

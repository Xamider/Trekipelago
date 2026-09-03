import { KATOWICE } from '../data';
import type { OverpassResponse } from '../types';

const overpassQuery = `[out:json][timeout:12];
(
  node["amenity"="cafe"]["name"](around:2000,${KATOWICE.latitude},${KATOWICE.longitude});
  node["amenity"="restaurant"]["name"](around:2000,${KATOWICE.latitude},${KATOWICE.longitude});
);
out 30;`;

const overpassEndpoints = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export async function fetchOverpassPlaces(signal: AbortSignal): Promise<OverpassResponse> {
  let lastError: Error | undefined;

  for (const endpoint of overpassEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal,
      });

      if (!response.ok) {
        lastError = new Error(`Overpass zwrócił HTTP ${response.status}.`);
        continue;
      }

      return (await response.json()) as OverpassResponse;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error instanceof Error ? error : new Error('Nieznany błąd Overpass.');
    }
  }

  throw lastError ?? new Error('Żaden endpoint Overpass nie zwrócił danych.');
}

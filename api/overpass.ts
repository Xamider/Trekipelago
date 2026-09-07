import type { Coordinates, OverpassResponse } from '../types';

function isPlausibleElement(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const element = value as Record<string, unknown>;
  return typeof element.id === 'number'
    && typeof element.lat === 'number'
    && typeof element.lon === 'number'
    && typeof element.tags === 'object' && element.tags !== null
    && typeof (element.tags as Record<string, unknown>).name === 'string';
}

const overpassEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export async function fetchOverpassPlaces(
  center: Coordinates,
  signal: AbortSignal,
): Promise<OverpassResponse> {
  if (!Number.isFinite(center.latitude) || Math.abs(center.latitude) > 90
    || !Number.isFinite(center.longitude) || Math.abs(center.longitude) > 180) {
    throw new Error('A valid location is required to load nearby places.');
  }

  // High 3 Fix: Round coordinates to 3 decimal places (~111m precision) 
  // to protect exact privacy as promised by the UI disclosure.
  const privacyLat = center.latitude.toFixed(3);
  const privacyLon = center.longitude.toFixed(3);

  const query = `[out:json][timeout:12];
(
  node["amenity"="cafe"]["name"](around:2000,${privacyLat},${privacyLon});
  node["amenity"="restaurant"]["name"](around:2000,${privacyLat},${privacyLon});
);
out 30;`;
  let lastError: Error | undefined;

  for (const endpoint of overpassEndpoints) {
    if (signal.aborted) throw new Error('Nearby places request was cancelled.');
    const request = new AbortController();
    const cancel = () => request.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 15_000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`,
        signal: request.signal,
      });

      if (!response.ok) throw new Error(`Nearby places returned HTTP ${response.status}.`);

      const result: unknown = await response.json();
      // Medium 5 Fix: Deeper validation ensuring elements possess required id, lat, lon and tags.name
      if (!result || typeof result !== 'object' || !('elements' in result)
        || !Array.isArray(result.elements) || !result.elements.every(isPlausibleElement)) {
        throw new Error('Nearby places returned an invalid/empty response.');
      }
      return result as OverpassResponse;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error instanceof Error ? error : new Error('Nearby places are unavailable.');
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
    }
  }

  throw lastError ?? new Error('Nearby places are unavailable.');
}

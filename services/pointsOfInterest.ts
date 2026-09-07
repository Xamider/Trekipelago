import type { OverpassResponse, PointOfInterest } from '../types';

export function toPointsOfInterest(data: OverpassResponse): PointOfInterest[] {
  return data.elements.flatMap((place) => {
    if (!place || typeof place !== 'object') return [];
    if (typeof place.id !== 'number' && typeof place.id !== 'string') return [];
    const latitude = place.lat ?? place.center?.lat;
    const longitude = place.lon ?? place.center?.lon;
    const category = place.tags?.tourism ?? place.tags?.amenity ?? place.tags?.leisure;

    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90
      || typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180
      || typeof place.tags?.name !== 'string' || !place.tags.name.trim()) return [];

    return [{
      id: `osm-${place.id}`,
      title: place.tags.name,
      snippet: category ? `OpenStreetMap · ${category}` : 'OpenStreetMap',
      coordinates: { latitude, longitude },
    }];
  });
}

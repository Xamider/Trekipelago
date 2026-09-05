import type { OverpassResponse, PointOfInterest } from '../types';

export function toPointsOfInterest(data: OverpassResponse): PointOfInterest[] {
  return data.elements.flatMap((place) => {
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
}

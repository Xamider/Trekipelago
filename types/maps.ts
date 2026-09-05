export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type PointOfInterest = {
  id: string;
  title: string;
  snippet: string;
  coordinates: Coordinates;
};

export type OverpassElement = {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: { name?: string; amenity?: string; tourism?: string; leisure?: string };
};

export type OverpassResponse = {
  elements: OverpassElement[];
};

import type { Coordinates } from '../types';

export const PLACEHOLDER_LOCATION: Coordinates = {
  latitude: 50.2649,
  longitude: 19.0238,
};

export const PLACEHOLDER_INITIAL_REGION = {
  ...PLACEHOLDER_LOCATION,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

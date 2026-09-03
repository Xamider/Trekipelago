import type { Coordinates } from '../types';

export const KATOWICE: Coordinates = {
  latitude: 50.2649,
  longitude: 19.0238,
};

export const KATOWICE_INITIAL_REGION = {
  ...KATOWICE,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

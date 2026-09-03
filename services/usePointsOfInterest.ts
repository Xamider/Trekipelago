import { useEffect, useState } from 'react';

import { fetchOverpassPlaces } from '../api';
import type { PointOfInterest } from '../types';
import { toPointsOfInterest } from './pointsOfInterest';

export function usePointsOfInterest() {
  const [pointsOfInterest, setPointsOfInterest] = useState<PointOfInterest[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPointsOfInterest() {
      try {
        const response = await fetchOverpassPlaces(controller.signal);
        setPointsOfInterest(toPointsOfInterest(response));
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('Nie udało się pobrać POI z Overpass.', error);
        }
      }
    }

    loadPointsOfInterest();
    return () => controller.abort();
  }, []);

  return pointsOfInterest;
}

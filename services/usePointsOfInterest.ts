import { useEffect, useRef, useState } from 'react';

import { fetchOverpassPlaces } from '../api';
import { distanceBetween } from '../game/engine';
import type { Coordinates, PointOfInterest } from '../types';
import { toPointsOfInterest } from './pointsOfInterest';

const REFRESH_DISTANCE_METERS = 500;
const RETRY_DELAY_MS = 60_000;

/** Only the visible Map requests POIs. Cached results survive tab and preference changes. */
export function usePointsOfInterest(center: Coordinates | null, enabled: boolean) {
  const [pointsOfInterest, setPointsOfInterest] = useState<PointOfInterest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const cacheCenter = useRef<Coordinates | null>(null);
  const pending = useRef<{ center: Coordinates; controller: AbortController } | null>(null);
  const failedAt = useRef(0);
  const latitude = center?.latitude;
  const longitude = center?.longitude;

  useEffect(() => () => pending.current?.controller.abort(), []);

  useEffect(() => {
    if (!enabled || !error) return;
    const timer = setTimeout(() => setRetryTick((value) => value + 1), RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, error, retryTick]);

  useEffect(() => {
    if (!enabled || latitude === undefined || longitude === undefined) {
      pending.current?.controller.abort();
      pending.current = null;
      setLoading(false);
      return;
    }

    const nextCenter = { latitude, longitude };
    if (pending.current
      && distanceBetween(nextCenter, pending.current.center) < REFRESH_DISTANCE_METERS) return;
    if (cacheCenter.current
      && distanceBetween(nextCenter, cacheCenter.current) < REFRESH_DISTANCE_METERS) {
      // Moving back into the cached area makes a request for the previous area obsolete,
      // and the cache is already satisfied, so any stale failure/backoff no longer applies.
      pending.current?.controller.abort();
      pending.current = null;
      setLoading(false);
      setError(null);
      failedAt.current = 0;
      return;
    }
    if (Date.now() - failedAt.current < RETRY_DELAY_MS) return;

    pending.current?.controller.abort();
    const controller = new AbortController();
    pending.current = { center: nextCenter, controller };
    setLoading(true);
    setError(null);

    void fetchOverpassPlaces(nextCenter, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || pending.current?.controller !== controller) return;
        setPointsOfInterest(toPointsOfInterest(response));
        cacheCenter.current = nextCenter;
        failedAt.current = 0;
      })
      .catch(() => {
        if (controller.signal.aborted || pending.current?.controller !== controller) return;
        failedAt.current = Date.now();
        setError('Nearby places are temporarily unavailable.');
      })
      .finally(() => {
        if (pending.current?.controller !== controller) return;
        pending.current = null;
        setLoading(false);
      });
  }, [enabled, latitude, longitude, retryTick]);

  return { pointsOfInterest: enabled ? pointsOfInterest : [], loading, error };
}

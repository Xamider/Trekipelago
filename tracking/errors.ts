let currentError: string | null = null;
const listeners = new Set<(message: string | null) => void>();

export function reportTrackingError(error: unknown) {
  currentError = error instanceof Error ? error.message : String(error);
  listeners.forEach(listener => listener(currentError));
}

export function clearTrackingError() {
  currentError = null;
  listeners.forEach(listener => listener(null));
}

export function getTrackingError() { return currentError; }
export function subscribeTrackingErrors(listener: (message: string | null) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

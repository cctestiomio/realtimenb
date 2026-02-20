const DEFAULT_TTL_MS = 1000;

const cache = new Map();

export async function getCachedProviderData(sportKey, loader, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now();
  const current = cache.get(sportKey);

  if (current?.value && now - current.fetchedAt <= ttlMs) {
    return current.value;
  }

  if (current?.inFlight) {
    return current.inFlight;
  }

  const inFlight = loader()
    .then((value) => {
      cache.set(sportKey, { value, fetchedAt: Date.now(), inFlight: null });
      return value;
    })
    .catch((error) => {
      cache.set(sportKey, { value: current?.value || null, fetchedAt: current?.fetchedAt || 0, inFlight: null });
      throw error;
    });

  cache.set(sportKey, { value: current?.value || null, fetchedAt: current?.fetchedAt || 0, inFlight });
  return inFlight;
}

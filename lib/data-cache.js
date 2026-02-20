// lib/data-cache.js
// Stale-while-revalidate: returns cached value instantly while refreshing in bg.
const DEFAULT_TTL_MS = 800;
const cache = new Map();

export async function getCachedProviderData(sportKey, loader, ttlMs = DEFAULT_TTL_MS) {
  const now     = Date.now();
  const current = cache.get(sportKey);
  const age     = current ? now - current.fetchedAt : Infinity;

  if (current?.value && age <= ttlMs) return current.value;
  if (current?.inFlight) return current.value ?? current.inFlight;

  const inFlight = loader()
    .then((value) => {
      cache.set(sportKey, { value, fetchedAt: Date.now(), inFlight: null });
      return value;
    })
    .catch((err) => {
      cache.set(sportKey, { value: current?.value ?? null, fetchedAt: current?.fetchedAt ?? 0, inFlight: null });
      throw err;
    });

  cache.set(sportKey, { value: current?.value ?? null, fetchedAt: current?.fetchedAt ?? 0, inFlight });
  if (current?.value) return current.value;
  return inFlight;
}
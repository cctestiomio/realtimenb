// lib/data-cache.js â€” optimised for real-time feel on serverless
// â€¢ 800 ms TTL (fast enough to feel live, low enough to not hammer upstreams)
// â€¢ Stale-while-revalidate: returns cached value immediately while refreshing
// â€¢ Per-sport in-flight deduplication

const DEFAULT_TTL_MS = 800;

const cache = new Map();

export async function getCachedProviderData(sportKey, loader, ttlMs = DEFAULT_TTL_MS) {
  const now     = Date.now();
  const current = cache.get(sportKey);
  const age     = current ? now - current.fetchedAt : Infinity;
  const fresh   = age <= ttlMs;

  // Fresh hit â€” serve immediately
  if (current?.value && fresh) return current.value;

  // In-flight deduplication
  if (current?.inFlight) {
    // Return stale value instantly if available; in-flight will update the cache
    return current.value ?? current.inFlight;
  }

  // Kick off a new fetch
  const inFlight = loader()
    .then((value) => {
      cache.set(sportKey, { value, fetchedAt: Date.now(), inFlight: null });
      return value;
    })
    .catch((error) => {
      cache.set(sportKey, {
        value:     current?.value ?? null,
        fetchedAt: current?.fetchedAt ?? 0,
        inFlight:  null
      });
      throw error;
    });

  cache.set(sportKey, {
    value:     current?.value ?? null,
    fetchedAt: current?.fetchedAt ?? 0,
    inFlight
  });

  // Stale-while-revalidate: return old data immediately; in-flight will update
  if (current?.value) return current.value;

  // No prior cache at all â€” must await first load
  return inFlight;
}

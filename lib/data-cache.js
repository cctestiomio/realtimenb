const cache = new Map();

export function cached(key, ttl, fetcher) {
  const now = Date.now();
  const item = cache.get(key);

  if (item && (now - item.time) < ttl) {
    return item.value;
  }

  const value = fetcher();
  cache.set(key, { value, time: now });

  return value;
}

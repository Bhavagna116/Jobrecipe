/**
 * Tiny in-process TTL cache for hot per-user read endpoints.
 *
 * The remote database is sometimes reached through a public proxy where a
 * single round-trip costs hundreds of milliseconds. Caching a profile or
 * submission list for a few seconds removes that cost from repeated page
 * loads. Callers must invalidate explicitly when they mutate the underlying
 * data; the TTL is only a safety net.
 */

const MAX_ENTRIES_PER_NAMESPACE = 5000;
const stores = new Map(); // namespace -> Map(key -> { value, expiresAt })

const storeFor = (namespace) => {
  let store = stores.get(namespace);
  if (!store) {
    store = new Map();
    stores.set(namespace, store);
  }
  return store;
};

const prune = (store, now) => {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  if (store.size >= MAX_ENTRIES_PER_NAMESPACE) store.clear();
};

export const cacheGet = (namespace, key) => {
  const store = stores.get(namespace);
  if (!store) return undefined;
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
};

export const cacheSet = (namespace, key, value, ttlMs) => {
  if (!(ttlMs > 0)) return;
  const store = storeFor(namespace);
  const now = Date.now();
  if (store.size >= MAX_ENTRIES_PER_NAMESPACE) prune(store, now);
  store.set(key, { value, expiresAt: now + ttlMs });
};

export const cacheDelete = (namespace, key) => {
  stores.get(namespace)?.delete(key);
};

export const cacheClear = (namespace) => {
  stores.get(namespace)?.clear();
};

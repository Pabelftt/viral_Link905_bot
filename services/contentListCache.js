const CONTENT_LIST_CACHE_TTL_MS = 10 * 1000;
const CONTENT_LIST_CACHE_MAX_ENTRIES = 100;
const contentListCache = new Map();

function getCachedContentList(key, loader) {
  const now = Date.now();
  const cached = contentListCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const entry = { expiresAt: Number.POSITIVE_INFINITY, promise: null };
  entry.promise = Promise.resolve().then(loader).then((value) => {
    entry.expiresAt = Date.now() + CONTENT_LIST_CACHE_TTL_MS;
    while (contentListCache.size > CONTENT_LIST_CACHE_MAX_ENTRIES) {
      contentListCache.delete(contentListCache.keys().next().value);
    }
    return value;
  }).catch((error) => {
    if (contentListCache.get(key) === entry) contentListCache.delete(key);
    throw error;
  });
  contentListCache.set(key, entry);
  return entry.promise;
}

function clearContentListCache() {
  contentListCache.clear();
}

module.exports = { getCachedContentList, clearContentListCache };

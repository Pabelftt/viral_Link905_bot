// The public custom domain can be suspended while the Render service stays online.
const DEFAULT_DATA_URL = 'https://p9x9.onrender.com/data/all';
const LEGACY_DATA_URL = 'https://p9x9.com/data/all';
const CACHE_TTL_MS = 10 * 60 * 1000;
const REFRESH_RETRY_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 30 * 1000;
const DEFAULT_RESULT_LIMIT = 40;
const MAX_RESULT_LIMIT = 100;

let cache = { items: [], fetchedAt: 0 };
let refreshPromise = null;
let lastRefreshFailedAt = 0;

function dataUrls() {
  const configured = String(process.env.P9X9_DATA_URL || '').trim();
  return [...new Set([configured, DEFAULT_DATA_URL, LEGACY_DATA_URL].filter(Boolean))];
}

function safeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizeSearch(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
}

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeHtmlEntities(value) {
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#x')) {
      const point = parseInt(lower.slice(2), 16);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    if (lower.startsWith('#')) {
      const point = parseInt(lower.slice(1), 10);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return HTML_ENTITIES[lower] ?? match;
  });
}

function normalizeCatalogItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw._id || raw.id || '').trim();
  const title = decodeHtmlEntities(raw.title).replace(/\s+/g, ' ').trim().slice(0, 180);
  if (!id || !title) return null;

  const createdAt = new Date(raw.createdAt || raw.created_at || raw.date || 0);
  const updatedAt = new Date(raw.updatedAt || raw.updated_at || raw.createdAt || raw.created_at || 0);
  const categories = (Array.isArray(raw.category) ? raw.category : Array.isArray(raw.categories) ? raw.categories : [])
    .map((category) => decodeHtmlEntities(category).trim())
    .filter(Boolean)
    .slice(0, 12);
  const routeName = String(raw.routeName || '').trim();
  const description = decodeHtmlEntities(raw.description).trim();

  return {
    id,
    routeName,
    title,
    description,
    imageUrl: safeHttpUrl(raw.imageLink || raw.imageUrl || raw.image_url),
    videoUrl: safeHttpUrl(raw.videoLink || raw.videoUrl || raw.video_url),
    totalViews: Math.max(0, Number(raw.totalView ?? raw.totalViews ?? raw.total_views ?? 0) || 0),
    duration: String(raw.duration || '').trim(),
    date: Number.isNaN(createdAt.getTime()) ? null : createdAt,
    updatedAt: Number.isNaN(updatedAt.getTime()) ? 0 : updatedAt.getTime(),
    categories,
    searchText: {
      title: normalizeSearch(title),
      routeName: normalizeSearch(routeName),
      categories: normalizeSearch(categories.join(' ')),
      description: normalizeSearch(description)
    }
  };
}

function publicCatalogItem(item) {
  return {
    id: item.id,
    routeName: item.routeName,
    title: item.title,
    description: item.description.slice(0, 220),
    imageUrl: item.imageUrl,
    videoUrl: item.videoUrl,
    totalViews: item.totalViews,
    duration: item.duration,
    date: item.date ? item.date.toISOString() : null,
    categories: item.categories
  };
}

function searchCatalogItems(items, query, limit = DEFAULT_RESULT_LIMIT) {
  const normalizedQuery = normalizeSearch(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const max = Math.min(Math.max(Number(limit) || DEFAULT_RESULT_LIMIT, 1), MAX_RESULT_LIMIT);
  const matches = [];

  for (const item of items) {
    if (!tokens.length) {
      matches.push({ item, score: 0 });
      continue;
    }
    const search = item.searchText;
    const haystack = `${search.title} ${search.routeName} ${search.categories} ${search.description}`;
    if (!tokens.every((token) => haystack.includes(token))) continue;

    let score = 0;
    if (search.title === normalizedQuery) score += 120;
    else if (search.title.startsWith(normalizedQuery)) score += 70;
    else if (search.title.includes(normalizedQuery)) score += 45;
    for (const token of tokens) {
      if (search.title.includes(token)) score += 10;
      if (search.routeName.includes(token)) score += 4;
      if (search.categories.includes(token)) score += 3;
      if (search.description.includes(token)) score += 1;
    }
    matches.push({ item, score });
  }

  matches.sort((a, b) => b.score - a.score
    || b.item.updatedAt - a.item.updatedAt
    || a.item.title.localeCompare(b.item.title));

  return {
    items: matches.slice(0, max).map(({ item }) => publicCatalogItem(item)),
    total: matches.length,
    sourceTotal: items.length
  };
}

function startRefresh() {
  if (refreshPromise) return refreshPromise;
  if (Date.now() - lastRefreshFailedAt < REFRESH_RETRY_MS) {
    return Promise.reject(Object.assign(new Error('Unable to load the p9x9 content list. Please try again shortly.'), { status: 502 }));
  }

  refreshPromise = (async () => {
    let lastError;
    try {
      for (const url of dataUrls()) {
        try {
          const response = await fetch(url, {
            headers: {
              accept: 'application/json',
              'user-agent': 'LinkHubAdmin/1.0 (+https://youtubevideoembed.onrender.com)'
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
          });
          if (!response.ok) throw new Error(`p9x9 responded with HTTP ${response.status}.`);

          const payload = await response.json();
          const rawItems = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.data)
              ? payload.data
              : Array.isArray(payload?.items)
                ? payload.items
                : [];
          const items = rawItems.map(normalizeCatalogItem).filter(Boolean);
          if (!items.length) throw new Error('p9x9 returned no usable content.');

          cache = { items, fetchedAt: Date.now() };
          lastRefreshFailedAt = 0;
          return { ...cache, stale: false };
        } catch (error) {
          lastError = error;
        }
      }

      lastRefreshFailedAt = Date.now();
      throw Object.assign(new Error('Unable to load the p9x9 content list. Please try again shortly.'), {
        status: 502,
        cause: lastError
      });
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function getP9x9Catalog() {
  const fresh = cache.items.length > 0 && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (fresh) return { ...cache, stale: false };

  if (cache.items.length) {
    if (Date.now() - lastRefreshFailedAt >= REFRESH_RETRY_MS) {
      startRefresh().catch((error) => {
        console.warn('Unable to refresh the p9x9 content catalog:', error.cause?.message || error.message);
      });
    }
    return { ...cache, stale: true };
  }

  return startRefresh();
}

async function searchP9x9Catalog(query, limit) {
  const catalog = await getP9x9Catalog();
  return {
    ...searchCatalogItems(catalog.items, query, limit),
    fetchedAt: catalog.fetchedAt,
    stale: catalog.stale
  };
}

function warmP9x9Catalog() {
  getP9x9Catalog().catch((error) => {
    console.warn('Unable to warm the p9x9 content catalog:', error.cause?.message || error.message);
  });
}

function clearP9x9CatalogCache() {
  cache = { items: [], fetchedAt: 0 };
  refreshPromise = null;
  lastRefreshFailedAt = 0;
}

module.exports = {
  CACHE_TTL_MS,
  clearP9x9CatalogCache,
  getP9x9Catalog,
  normalizeCatalogItem,
  searchCatalogItems,
  searchP9x9Catalog,
  warmP9x9Catalog
};

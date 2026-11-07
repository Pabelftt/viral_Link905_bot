const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clearP9x9CatalogCache,
  getP9x9Catalog,
  normalizeCatalogItem,
  searchCatalogItems
} = require('../services/p9x9Catalog');

const rawItem = (overrides = {}) => ({
  _id: '697f83595812782b3d032984',
  routeName: 'jannat-tuha',
  title: 'জান্নাত তোহা ভাইরাল ভিডিও | Jannat Toha Viral Video',
  description: 'A popular TikTok creator video.',
  imageLink: 'https://i.postimg.cc/sample/image.png',
  videoLink: 'https://files.catbox.moe/sample.mp4',
  totalView: 2733,
  duration: '3:21',
  category: ['TikToker', 'Bangla'],
  createdAt: '2026-02-01T16:46:17.762Z',
  updatedAt: '2026-11-07T11:04:20.573Z',
  ...overrides
});

test('p9x9 records are normalized for the admin picker', () => {
  const item = normalizeCatalogItem(rawItem());
  assert.equal(item.id, '697f83595812782b3d032984');
  assert.equal(item.title, 'জান্নাত তোহা ভাইরাল ভিডিও | Jannat Toha Viral Video');
  assert.equal(item.imageUrl, 'https://i.postimg.cc/sample/image.png');
  assert.equal(item.videoUrl, 'https://files.catbox.moe/sample.mp4');
  assert.equal(item.totalViews, 2733);
  assert.equal(item.duration, '3:21');
  assert.equal(item.date.toISOString(), '2026-02-01T16:46:17.762Z');
  assert.deepEqual(item.categories, ['TikToker', 'Bangla']);
});

test('p9x9 normalization rejects unsafe URLs and incomplete records', () => {
  const item = normalizeCatalogItem(rawItem({ imageLink: 'javascript:alert(1)', videoLink: 'ftp://example.test/video.mp4' }));
  assert.equal(item.imageUrl, '');
  assert.equal(item.videoUrl, '');
  assert.equal(normalizeCatalogItem({ title: 'No id' }), null);
  assert.equal(normalizeCatalogItem({ _id: '1' }), null);
});

test('p9x9 search matches titles, categories and descriptions with ranking', () => {
  const items = [
    rawItem(),
    rawItem({
      _id: '2',
      routeName: 'mehazabien-instagram',
      title: 'Mehazabien Chowdhury viral link | Instagram',
      description: 'Bangladeshi actress clip.',
      category: ['Actress', 'Instagram'],
      totalView: 816
    }),
    rawItem({
      _id: '3',
      routeName: 'cricket-highlights',
      title: 'Cricket match highlights',
      description: 'Sports recap.',
      category: ['Sports'],
      totalView: 100
    })
  ].map(normalizeCatalogItem);

  const titleMatch = searchCatalogItems(items, 'jannat');
  assert.equal(titleMatch.total, 1);
  assert.equal(titleMatch.items[0].id, '697f83595812782b3d032984');
  assert.equal(titleMatch.sourceTotal, 3);

  const categoryMatch = searchCatalogItems(items, 'actress');
  assert.equal(categoryMatch.total, 1);
  assert.equal(categoryMatch.items[0].id, '2');

  const multiToken = searchCatalogItems(items, 'viral link');
  assert.equal(multiToken.total, 1);
  assert.equal(multiToken.items[0].id, '2');

  assert.equal(searchCatalogItems(items, 'nothing-matches-this').total, 0);
  const limited = searchCatalogItems(items, '', 1);
  assert.equal(limited.items.length, 1);
  assert.equal(limited.total, 3);
});

test('p9x9 catalog is fetched once and reused by concurrent searches', async () => {
  clearP9x9CatalogCache();
  const originalFetch = global.fetch;
  let calls = 0;
  let resolveFetch;
  global.fetch = () => {
    calls += 1;
    return new Promise((resolve) => { resolveFetch = resolve; });
  };

  try {
    const first = getP9x9Catalog();
    const second = getP9x9Catalog();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);

    resolveFetch({ ok: true, json: async () => [rawItem()] });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.items.length, 1);
    assert.equal(secondResult.items.length, 1);
    assert.equal(firstResult.stale, false);

    await getP9x9Catalog();
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
    clearP9x9CatalogCache();
  }
});

test('p9x9 catalog falls back to another data URL when the first fails', async () => {
  clearP9x9CatalogCache();
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('primary data URL unavailable');
    return { ok: true, json: async () => [rawItem()] };
  };

  try {
    const result = await getP9x9Catalog();
    assert.equal(result.items.length, 1);
    assert.equal(result.stale, false);
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
    clearP9x9CatalogCache();
  }
});

test('p9x9 fetch failures back off before the next attempt', async () => {
  clearP9x9CatalogCache();
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error('network unavailable');
  };

  try {
    await assert.rejects(getP9x9Catalog(), /Unable to load the p9x9 content list/);
    const callsAfterFirstFailure = calls;
    assert.ok(callsAfterFirstFailure >= 2, 'all candidate data URLs should be tried');
    await assert.rejects(getP9x9Catalog(), /Unable to load the p9x9 content list/);
    assert.equal(calls, callsAfterFirstFailure);
  } finally {
    global.fetch = originalFetch;
    clearP9x9CatalogCache();
  }
});

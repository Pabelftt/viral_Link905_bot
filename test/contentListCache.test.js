const test = require('node:test');
const assert = require('node:assert/strict');
const { clearContentListCache, getCachedContentList } = require('../services/contentListCache');

test('content list cache reuses results and clears them after content updates', async () => {
  clearContentListCache();
  let loads = 0;
  const load = async () => [{ title: `version-${++loads}` }];

  assert.deepEqual(await getCachedContentList('test-list', load), [{ title: 'version-1' }]);
  assert.deepEqual(await getCachedContentList('test-list', load), [{ title: 'version-1' }]);
  assert.equal(loads, 1);

  clearContentListCache();
  assert.deepEqual(await getCachedContentList('test-list', load), [{ title: 'version-2' }]);
  assert.equal(loads, 2);
  clearContentListCache();
});

test('concurrent content list requests share one database load', async () => {
  clearContentListCache();
  let loads = 0;
  let resolveLoad;
  const load = () => {
    loads += 1;
    return new Promise((resolve) => { resolveLoad = resolve; });
  };
  const first = getCachedContentList('concurrent-list', load);
  const second = getCachedContentList('concurrent-list', load);
  await Promise.resolve();
  assert.equal(loads, 1);
  resolveLoad([{ title: 'cached' }]);
  assert.deepEqual(await Promise.all([first, second]), [[{ title: 'cached' }], [{ title: 'cached' }]]);
  clearContentListCache();
});

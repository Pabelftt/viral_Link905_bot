const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTENT_TASK_COUNT, DEFAULT_CONTENT_TASK_LINK, getContentTaskLinks } = require('../services/contentTasks');

test('every content has five task destinations with the default fallback', () => {
  const links = getContentTaskLinks({ taskLinks: ['https://example.test/1', '', 'https://example.test/3'] });
  assert.equal(CONTENT_TASK_COUNT, 5);
  assert.equal(links.length, 5);
  assert.equal(links[0], 'https://example.test/1');
  assert.equal(links[1], DEFAULT_CONTENT_TASK_LINK);
  assert.equal(links[2], 'https://example.test/3');
  assert.equal(links[4], DEFAULT_CONTENT_TASK_LINK);
});

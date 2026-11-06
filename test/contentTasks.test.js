const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTENT_TASK_COUNT,
  CONTENT_UNLOCK_DURATION_MS,
  CONTENT_UNLOCK_REWARD_AMOUNT,
  DEFAULT_CONTENT_TASK_LINK,
  getContentTaskLinks
} = require('../services/contentTasks');

test('every content has five task destinations with the default fallback', () => {
  const links = getContentTaskLinks({ taskLinks: ['https://example.test/1', '', 'https://example.test/3'] });
  assert.equal(CONTENT_TASK_COUNT, 5);
  assert.equal(CONTENT_UNLOCK_DURATION_MS, 60 * 60 * 1000);
  assert.equal(CONTENT_UNLOCK_REWARD_AMOUNT, 50);
  assert.equal(links.length, 5);
  assert.equal(links[0], 'https://example.test/1');
  assert.equal(links[1], DEFAULT_CONTENT_TASK_LINK);
  assert.equal(links[2], 'https://example.test/3');
  assert.equal(links[4], DEFAULT_CONTENT_TASK_LINK);
});

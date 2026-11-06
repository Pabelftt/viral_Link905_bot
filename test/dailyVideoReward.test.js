const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_VIDEO_REWARD_LINK,
  VIDEO_REWARD_AMOUNT,
  VIDEO_WATCH_SECONDS,
  getVideoRewardLinks
} = require('../services/dailyVideoReward');

test('video reward uses the configured link list or the default fallback', () => {
  assert.deepEqual(getVideoRewardLinks([]), [DEFAULT_VIDEO_REWARD_LINK]);
  assert.deepEqual(getVideoRewardLinks(['https://example.test/1', 'https://example.test/2']), [
    'https://example.test/1', 'https://example.test/2'
  ]);
  assert.deepEqual(getVideoRewardLinks(['javascript:alert(1)']), [DEFAULT_VIDEO_REWARD_LINK]);
});

test('video rewards pay 20 taka after a 60-second watch period', () => {
  assert.equal(VIDEO_REWARD_AMOUNT, 20);
  assert.equal(VIDEO_WATCH_SECONDS, 60);
});

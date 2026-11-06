const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/arohi_auth_test';
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-thirty-two-characters';
process.env.BOT_TOKEN = '123456:test-bot-token';

const { verifyTelegramInitData } = require('../services/telegramAuth');

function signedInitData(overrides = {}) {
  const entries = new Map([
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['query_id', 'AAEAA-test-query'],
    ['user', JSON.stringify({ id: 12345, first_name: 'Arohi', username: 'arohi_user' })],
    ...Object.entries(overrides).map(([key, value]) => [key, String(value)])
  ]);
  const checkString = [...entries].sort(([first], [second]) => first.localeCompare(second)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  return `${new URLSearchParams(entries).toString()}&hash=${hash}`;
}

test('accepts a correctly signed Telegram initData payload', () => {
  const result = verifyTelegramInitData(signedInitData({ start_param: 'ref_22' }));
  assert.equal(result.user.id, 12345);
  assert.equal(result.user.first_name, 'Arohi');
  assert.equal(result.startParam, 'ref_22');
});

test('rejects a modified Telegram initData payload', () => {
  const input = signedInitData().replace('Arohi', 'Attacker');
  assert.throws(() => verifyTelegramInitData(input), { status: 401 });
});

test('rejects expired Telegram initData', () => {
  const expired = signedInitData({ auth_date: Math.floor(Date.now() / 1000) - 86401 });
  assert.throws(() => verifyTelegramInitData(expired), { status: 401 });
});

test('rejects malformed or missing user data', () => {
  assert.throws(() => verifyTelegramInitData('not-a-query-string'), { status: 401 });
  const malformedUser = signedInitData({ user: 'not-json' });
  assert.throws(() => verifyTelegramInitData(malformedUser), { status: 401 });
});

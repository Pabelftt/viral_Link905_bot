const test = require('node:test');
const assert = require('node:assert/strict');
const { requireCsrf } = require('../middleware/csrf');

function runMiddleware(token, requestBody = {}) {
  let statusCode = 200;
  let nextCalled = false;
  const req = {
    session: { csrfToken: 'expected-token' },
    body: requestBody,
    get: () => token
  };
  const res = { status(code) { statusCode = code; return this; }, json() {} };
  requireCsrf(req, res, () => { nextCalled = true; });
  return { statusCode, nextCalled };
}

test('CSRF guard accepts the current session token', () => {
  assert.deepEqual(runMiddleware('expected-token'), { statusCode: 200, nextCalled: true });
});

test('CSRF guard rejects a missing or incorrect token', () => {
  assert.deepEqual(runMiddleware('wrong-token'), { statusCode: 403, nextCalled: false });
  assert.deepEqual(runMiddleware(undefined), { statusCode: 403, nextCalled: false });
});

test('CSRF guard accepts a token supplied by an HTML form', () => {
  assert.deepEqual(runMiddleware(undefined, { _csrf: 'expected-token' }), { statusCode: 200, nextCalled: true });
});

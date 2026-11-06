const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { verifyAdminPassword } = require('../services/adminPassword');

test('accepts a matching plain-text admin password', async () => {
  assert.equal(await verifyAdminPassword('plain-secret', 'plain-secret'), true);
});

test('rejects a non-matching plain-text admin password', async () => {
  assert.equal(await verifyAdminPassword('wrong-secret', 'plain-secret'), false);
});

test('continues to accept bcrypt admin password hashes', async () => {
  const hash = await bcrypt.hash('hashed-secret', 4);
  assert.equal(await verifyAdminPassword('hashed-secret', hash), true);
  assert.equal(await verifyAdminPassword('wrong-secret', hash), false);
});

test('rejects login when no admin password is configured', async () => {
  assert.equal(await verifyAdminPassword('any-secret', ''), false);
});

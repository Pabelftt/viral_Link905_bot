const test = require('node:test');
const assert = require('node:assert/strict');
const { WITHDRAWAL_REQUIREMENTS, getWithdrawalStatus } = require('../services/withdrawalRequirements');

test('withdrawal requirements are fixed at 10 referrals, 15 tasks and 20 content unlocks', () => {
  assert.deepEqual(WITHDRAWAL_REQUIREMENTS, { referrals: 10, tasks: 15, unlocks: 20 });
  assert.equal(getWithdrawalStatus(9, 15, 20).canWithdraw, false);
  assert.equal(getWithdrawalStatus(10, 14, 20).canWithdraw, false);
  assert.equal(getWithdrawalStatus(10, 15, 19).canWithdraw, false);
  assert.equal(getWithdrawalStatus(10, 15, 20).canWithdraw, true);
});

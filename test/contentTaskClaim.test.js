const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTENT_TASK_CLAIM_DELAY_MS } = require('../services/contentTasks');
const { getTaskClaimState, getTaskStartedAt } = require('../services/contentTaskClaim');

test('content task claims remain unavailable until one minute after the server start time', () => {
  const startedAt = new Date('2026-11-07T10:00:00.000Z');
  const claimAt = startedAt.getTime() + CONTENT_TASK_CLAIM_DELAY_MS;

  assert.deepEqual(getTaskClaimState(startedAt, claimAt - 1), {
    claimAvailableAt: claimAt,
    remainingSeconds: 1,
    canClaim: false
  });
  assert.deepEqual(getTaskClaimState(startedAt, claimAt), {
    claimAvailableAt: claimAt,
    remainingSeconds: 0,
    canClaim: true
  });
});

test('task start timestamps work with lean records and Mongoose maps', () => {
  const startedAt = new Date('2026-11-07T10:00:00.000Z');
  assert.equal(getTaskStartedAt({ taskStartedAt: { 2: startedAt } }, 2), startedAt.getTime());
  assert.equal(getTaskStartedAt({ taskStartedAt: new Map([['2', startedAt]]) }, 2), startedAt.getTime());
  assert.equal(getTaskStartedAt({ taskStartedAt: {} }, 2), null);
});

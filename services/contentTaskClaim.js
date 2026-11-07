const { CONTENT_TASK_CLAIM_DELAY_MS } = require('./contentTasks');

function getTaskStartedAt(progress, slot) {
  const taskStartedAt = progress?.taskStartedAt;
  const value = taskStartedAt instanceof Map ? taskStartedAt.get(String(slot)) : taskStartedAt?.[slot];
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getTaskClaimState(startedAt, now = Date.now()) {
  const startedAtMs = startedAt === null || startedAt === undefined ? NaN : new Date(startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) return { claimAvailableAt: null, remainingSeconds: null, canClaim: false };
  const claimAvailableAt = startedAtMs + CONTENT_TASK_CLAIM_DELAY_MS;
  const remainingMs = Math.max(0, claimAvailableAt - now);
  return {
    claimAvailableAt,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    canClaim: remainingMs === 0
  };
}

module.exports = { getTaskStartedAt, getTaskClaimState };

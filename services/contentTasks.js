const CONTENT_TASK_COUNT = 5;
const CONTENT_UNLOCK_DURATION_MS = 60 * 60 * 1000;
const CONTENT_UNLOCK_REWARD_AMOUNT = 50;
const CONTENT_TASK_CLAIM_DELAY_MS = 60 * 1000;
const DEFAULT_CONTENT_TASK_LINK = 'https://welcomingexpulsion.com/bqr0ww70a?key=93a942816b667574bfb9c03daa56b8c0';

function getContentTaskLinks(content) {
  return Array.from({ length: CONTENT_TASK_COUNT }, (_, index) =>
    content.taskLinks?.[index]?.trim() || DEFAULT_CONTENT_TASK_LINK
  );
}

module.exports = {
  CONTENT_TASK_COUNT,
  CONTENT_UNLOCK_DURATION_MS,
  CONTENT_UNLOCK_REWARD_AMOUNT,
  CONTENT_TASK_CLAIM_DELAY_MS,
  DEFAULT_CONTENT_TASK_LINK,
  getContentTaskLinks
};

const CONTENT_TASK_COUNT = 5;
const DEFAULT_CONTENT_TASK_LINK = 'https://welcomingexpulsion.com/bqr0ww70a?key=93a942816b667574bfb9c03daa56b8c0';

function getContentTaskLinks(content) {
  return Array.from({ length: CONTENT_TASK_COUNT }, (_, index) =>
    content.taskLinks?.[index]?.trim() || DEFAULT_CONTENT_TASK_LINK
  );
}

module.exports = { CONTENT_TASK_COUNT, DEFAULT_CONTENT_TASK_LINK, getContentTaskLinks };

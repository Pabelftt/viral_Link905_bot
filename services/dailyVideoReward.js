const DEFAULT_VIDEO_REWARD_LINK = 'https://welcomingexpulsion.com/bqr0ww70a?key=93a942816b667574bfb9c03daa56b8c0';
const VIDEO_REWARD_AMOUNT = 20;
const VIDEO_WATCH_SECONDS = 60;

function getVideoRewardLinks(value) {
  const links = Array.isArray(value) ? value : [];
  const safeLinks = links.filter((link) => {
    try {
      const url = new URL(String(link));
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  });
  return safeLinks.length ? safeLinks : [DEFAULT_VIDEO_REWARD_LINK];
}

module.exports = { DEFAULT_VIDEO_REWARD_LINK, VIDEO_REWARD_AMOUNT, VIDEO_WATCH_SECONDS, getVideoRewardLinks };

const ANALYTICS_EVENT_TYPES = ['app_open', 'page_view', 'page_time'];
const ANALYTICS_PERIODS = [7, 30, 90];
const ALLOWED_ANALYTICS_PATHS = new Set(['/', '/earn', '/refer', '/leaderboard', '/profile', '/privacy']);
const ANALYTICS_CACHE_TTL_MS = 10000;
const analyticsCache = new Map();

function normalizeAnalyticsPath(value) {
  if (typeof value !== 'string' || value.length > 200 || !value.startsWith('/') || /[?#\\%]/.test(value)) return null;
  const contentPath = /^\/content\/([a-f\d]{24})$/i.exec(value);
  if (contentPath) return '/content/:id';
  return ALLOWED_ANALYTICS_PATHS.has(value) ? value : null;
}

function getAnalyticsPage(value) {
  const contentPath = typeof value === 'string' && /^\/content\/([a-f\d]{24})$/i.exec(value);
  const path = normalizeAnalyticsPath(value);
  if (!path) return null;
  return { path, contentId: contentPath ? contentPath[1].toLowerCase() : null };
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

async function loadAnalytics(AnalyticsDaily, User, Content, days) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1));
  const match = { dayStart: { $gte: from } };
  const [
    summaryRows, sessionRows, visitorRows, pageRows, dailyRows, userRows, userPageRows, contentRows
  ] = await Promise.all([
    AnalyticsDaily.aggregate([{ $match: match }, {
      $group: {
        _id: null,
        appOpens: { $sum: '$appOpens' },
        pageViews: { $sum: '$pageViews' },
        durationSeconds: { $sum: '$durationSeconds' }
      }
    }]),
    AnalyticsDaily.aggregate([
      { $match: { ...match, appOpens: { $gt: 0 } } },
      { $group: { _id: { userId: '$userId', sessionId: '$sessionId' } } },
      { $count: 'count' }
    ]),
    AnalyticsDaily.aggregate([
      { $match: { ...match, appOpens: { $gt: 0 } } },
      { $group: { _id: '$userId' } },
      { $count: 'count' }
    ]),
    AnalyticsDaily.aggregate([
      { $match: { ...match, $or: [{ pageViews: { $gt: 0 } }, { durationSeconds: { $gt: 0 } }] } },
      { $group: {
        _id: '$path',
        pageViews: { $sum: '$pageViews' },
        durationSeconds: { $sum: '$durationSeconds' }
      } },
      { $sort: { pageViews: -1, durationSeconds: -1 } },
      { $limit: 20 }
    ]),
    AnalyticsDaily.aggregate([
      { $match: match },
      { $group: {
        _id: '$dayStart',
        appOpens: { $sum: '$appOpens' },
        pageViews: { $sum: '$pageViews' }
      } },
      { $sort: { _id: 1 } }
    ]),
    AnalyticsDaily.aggregate([
      { $match: match },
      { $group: {
        _id: '$userId',
        appOpens: { $sum: '$appOpens' },
        pageViews: { $sum: '$pageViews' },
        durationSeconds: { $sum: '$durationSeconds' },
        lastActiveAt: { $max: '$lastActiveAt' }
      } },
      { $sort: { durationSeconds: -1, appOpens: -1 } },
      { $limit: 50 }
    ]),
    AnalyticsDaily.aggregate([
      { $match: { ...match, $or: [{ pageViews: { $gt: 0 } }, { durationSeconds: { $gt: 0 } }] } },
      { $group: {
        _id: { userId: '$userId', path: '$path', contentId: '$contentId' },
        pageViews: { $sum: '$pageViews' },
        durationSeconds: { $sum: '$durationSeconds' },
        lastActiveAt: { $max: '$lastActiveAt' }
      } },
      { $sort: { durationSeconds: -1, pageViews: -1 } },
      { $limit: 100 }
    ]),
    AnalyticsDaily.aggregate([
      { $match: { ...match, contentId: { $ne: null }, $or: [{ pageViews: { $gt: 0 } }, { durationSeconds: { $gt: 0 } }] } },
      { $group: {
        _id: '$contentId',
        pageViews: { $sum: '$pageViews' },
        durationSeconds: { $sum: '$durationSeconds' }
      } },
      { $sort: { pageViews: -1, durationSeconds: -1 } },
      { $limit: 20 }
    ])
  ]);
  const summary = summaryRows[0] || { appOpens: 0, pageViews: 0, durationSeconds: 0 };
  const dayLookup = new Map(dailyRows.map((day) => [day._id.toISOString().slice(0, 10), day]));
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(from.getTime() + index * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    const metrics = dayLookup.get(key) || { appOpens: 0, pageViews: 0 };
    return { date, label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`, ...metrics };
  });
  const userIds = [...new Set([...userRows.map((row) => String(row._id)), ...userPageRows.map((row) => String(row._id.userId))])];
  const contentIds = [...new Set([...contentRows.map((row) => String(row._id)), ...userPageRows.map((row) => row._id.contentId).filter(Boolean).map(String)])];
  const [users, contents] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('firstName lastName username').lean(),
    Content.find({ _id: { $in: contentIds } }).select('title').lean()
  ]);
  const userLookup = new Map(users.map((user) => [String(user._id), user]));
  const contentLookup = new Map(contents.map((content) => [String(content._id), content]));
  const visitors = userRows.map((row) => ({
    ...row,
    user: userLookup.get(String(row._id)) || { firstName: 'Deleted user', lastName: '', username: '' }
  }));
  const visitorPages = userPageRows.map((row) => ({
    ...row,
    path: row._id.path,
    content: row._id.contentId ? contentLookup.get(String(row._id.contentId)) || { title: 'Deleted content' } : null,
    user: userLookup.get(String(row._id.userId)) || { firstName: 'Deleted user', lastName: '', username: '' }
  }));
  const topContents = contentRows.map((row) => ({
    ...row,
    content: contentLookup.get(String(row._id)) || { title: 'Deleted content' }
  }));
  const sessions = sessionRows[0]?.count || 0;
  return {
    from,
    now,
    days,
    metrics: {
      ...summary,
      sessions,
      visitors: visitorRows[0]?.count || 0,
      averageSessionSeconds: sessions ? Math.round(summary.durationSeconds / sessions) : 0
    },
    pages: pageRows.map((page) => ({
      ...page,
      averageSeconds: page.pageViews ? Math.round(page.durationSeconds / page.pageViews) : 0
    })),
    daily,
    visitors,
    visitorPages,
    topContents
  };
}

function getCachedAnalytics(AnalyticsDaily, User, Content, days) {
  const cached = analyticsCache.get(days);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const entry = { expiresAt: Number.POSITIVE_INFINITY, promise: null };
  entry.promise = loadAnalytics(AnalyticsDaily, User, Content, days).then((analytics) => {
    entry.expiresAt = Date.now() + ANALYTICS_CACHE_TTL_MS;
    return analytics;
  }).catch((error) => {
    analyticsCache.delete(days);
    throw error;
  });
  analyticsCache.set(days, entry);
  return entry.promise;
}

module.exports = {
  ANALYTICS_EVENT_TYPES,
  ANALYTICS_PERIODS,
  normalizeAnalyticsPath,
  getAnalyticsPage,
  formatDuration,
  loadAnalytics,
  getCachedAnalytics
};

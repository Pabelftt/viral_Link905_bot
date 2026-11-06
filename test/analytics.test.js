const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration, getAnalyticsPage, loadAnalytics, normalizeAnalyticsPath } = require('../services/analytics');

test('analytics paths include known pages and hide content identifiers', () => {
  assert.equal(normalizeAnalyticsPath('/'), '/');
  assert.equal(normalizeAnalyticsPath('/leaderboard'), '/leaderboard');
  assert.equal(normalizeAnalyticsPath('/privacy'), '/privacy');
  assert.equal(normalizeAnalyticsPath('/content/507f1f77bcf86cd799439011'), '/content/:id');
  assert.equal(normalizeAnalyticsPath('/admin/users'), null);
  assert.equal(normalizeAnalyticsPath('/profile?private=value'), null);
  assert.equal(normalizeAnalyticsPath('//example.test'), null);
  assert.deepEqual(getAnalyticsPage('/content/507f1f77bcf86cd799439011'), {
    path: '/content/:id',
    contentId: '507f1f77bcf86cd799439011'
  });
});

test('analytics duration labels are readable and handle empty values', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(125), '2m 5s');
  assert.equal(formatDuration(3720), '1h 2m');
});

test('analytics report aggregates usage, page time, sessions, users, and content', async () => {
  const userId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const contentId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const today = new Date();
  const dailyRows = [{
    _id: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())),
    appOpens: 2,
    pageViews: 5
  }];
  const AnalyticsDaily = {
    aggregate(pipeline) {
      const group = pipeline.find((stage) => stage.$group)?.$group;
      if (pipeline.some((stage) => stage.$count)) {
        return Promise.resolve([{ count: group._id.sessionId ? 3 : 2 }]);
      }
      if (group._id === null) return Promise.resolve([{ appOpens: 5, pageViews: 12, durationSeconds: 900 }]);
      if (group._id === '$path') return Promise.resolve([{ _id: '/', pageViews: 5, durationSeconds: 300 }]);
      if (group._id === '$dayStart') return Promise.resolve(dailyRows);
      if (group._id === '$userId') return Promise.resolve([{
        _id: userId, appOpens: 2, pageViews: 5, durationSeconds: 600, lastActiveAt: today
      }]);
      if (group._id === '$contentId') return Promise.resolve([{ _id: contentId, pageViews: 4, durationSeconds: 240 }]);
      if (group._id.userId) return Promise.resolve([{
        _id: { userId, path: '/content/:id', contentId }, pageViews: 2, durationSeconds: 120, lastActiveAt: today
      }]);
      throw new Error('Unexpected analytics aggregation.');
    }
  };
  const makeQuery = (result) => ({ select() { return this; }, lean: async () => result });
  const User = { find: () => makeQuery([{ _id: userId, firstName: 'Test', lastName: '', username: 'test' }]) };
  const Content = { find: () => makeQuery([{ _id: contentId, title: 'Trending link' }]) };
  const report = await loadAnalytics(AnalyticsDaily, User, Content, 7);
  assert.equal(report.metrics.appOpens, 5);
  assert.equal(report.metrics.sessions, 3);
  assert.equal(report.metrics.visitors, 2);
  assert.equal(report.metrics.averageSessionSeconds, 300);
  assert.equal(report.daily.length, 7);
  assert.equal(report.pages[0].averageSeconds, 60);
  assert.equal(report.visitors[0].user.username, 'test');
  assert.equal(report.visitorPages[0].content.title, 'Trending link');
  assert.equal(report.topContents[0].content.title, 'Trending link');
});

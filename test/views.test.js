const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { normalizeContentRecord } = require('../services/contentData');

const viewRoot = path.resolve(__dirname, '..', 'views');

function listTemplates(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? listTemplates(file) : file.endsWith('.ejs') ? [file] : [];
  });
}

test('all EJS templates compile', () => {
  const templates = listTemplates(viewRoot);
  assert.ok(templates.length > 0);
  for (const filename of templates) {
    ejs.compile(fs.readFileSync(filename, 'utf8'), { filename });
  }
});

test('home page signs in automatically without a Telegram login button', async () => {
  const rendered = await ejs.renderFile(path.join(viewRoot, 'user/home.ejs'), {
    title: 'Home',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/',
    user: null,
    contents: [],
    banner: '',
    telegramWebAppUrl: 'https://example.test'
  });
  assert.match(rendered, /Welcome to LinkHub/);
  assert.match(rendered, /data-auth-status/);
  assert.doesNotMatch(rendered, /Continue with Telegram|data-telegram-login/);
});

test('home page starts with twenty items and an infinite-scroll sentinel', async () => {
  const contents = Array.from({ length: 20 }, (_, index) => ({
    _id: String(index).padStart(24, 'a'),
    title: `Video ${index + 1}`,
    imageUrl: '',
    date: new Date('2026-01-01T00:00:00Z'),
    totalViews: 0,
    taskProgress: { completed: 0, total: 5 },
    isUnlocked: false
  }));
  const rendered = await ejs.renderFile(path.join(viewRoot, 'user/home.ejs'), {
    title: 'Home',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/',
    user: { firstName: 'Test', username: 'test', photoUrl: '', balance: 0 },
    contents,
    hasMoreContents: true,
    banner: '',
    telegramWebAppUrl: 'https://example.test'
  });
  assert.equal((rendered.match(/class="content-card(?:\s|")/g) || []).length, 20);
  assert.match(rendered, /id="content-scroll-sentinel"/);
  assert.match(rendered, /data-has-more="true"/);
});

test('unlocked home cards get a green badge and balance header hides profile identity', async () => {
  const contents = [{
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    title: 'Unlocked video',
    imageUrl: '',
    date: new Date('2026-01-01T00:00:00Z'),
    totalViews: 0,
    taskProgress: { completed: 5, total: 5, unlockExpiresAt: new Date(Date.now() + 3600000) },
    isUnlocked: true
  }];
  const rendered = await ejs.renderFile(path.join(viewRoot, 'user/home.ejs'), {
    title: 'Home',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/',
    user: { firstName: 'Private Name', username: 'private_user', photoUrl: '', balance: 0 },
    contents,
    hasMoreContents: false,
    banner: '',
    telegramWebAppUrl: 'https://example.test'
  });
  assert.match(rendered, /content-card is-unlocked/);
  assert.match(rendered, /lock-badge unlocked/);
  assert.match(rendered, /MY BALANCE/);
  assert.doesNotMatch(rendered, /Private Name|@private_user/);
});

test('admin dashboard shows active user count and recent last-active times', async () => {
  const now = new Date();
  const rendered = await ejs.renderFile(path.join(viewRoot, 'admin/dashboard.ejs'), {
    title: 'Dashboard',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/admin',
    adminUsername: 'admin',
    stats: {
      totalUsers: 4, activeUsers: 3, suspendedUsers: 0, totalContents: 2, totalCompletions: 1,
      rewardTotal: 50, pendingWithdrawals: 0, approvedWithdrawals: 0, totalReferrals: 1
    },
    presence: {
      activeUsers: 2,
      serverNow: now,
      users: [{
        firstName: 'Active',
        lastName: 'User',
        username: 'active_user',
        lastActiveAt: new Date(now.getTime() - 2 * 60000),
        isOnline: true
      }]
    },
    activities: [],
    recentWithdrawals: []
  });
  assert.match(rendered, /Active now · 5m/);
  assert.match(rendered, /data-active-user-count>2</);
  assert.match(rendered, /@active_user/);
  assert.match(rendered, /Active · 2 min ago/);
  assert.match(rendered, /Recent user activity/);
});

test('admin analytics report renders key usage and page metrics', async () => {
  const now = new Date();
  const rendered = await ejs.renderFile(path.join(viewRoot, 'admin/analytics.ejs'), {
    title: 'Analytics',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/admin/analytics',
    adminUsername: 'admin',
    formatDuration: (seconds) => `${seconds}s`,
    analytics: {
      days: 7,
      from: new Date('2026-11-01T00:00:00Z'),
      now,
      metrics: { appOpens: 10, visitors: 4, pageViews: 35, averageSessionSeconds: 120, sessions: 8, durationSeconds: 960 },
      pages: [{ _id: '/', pageViews: 10, durationSeconds: 300, averageSeconds: 30 }],
      daily: [{ date: now, label: '11/7', appOpens: 2, pageViews: 5 }],
      topContents: [{ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', pageViews: 4, durationSeconds: 180, content: { title: 'Trending link' } }],
      visitors: [{
        _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        appOpens: 3,
        pageViews: 9,
        durationSeconds: 600,
        lastActiveAt: now,
        user: { firstName: 'Test', lastName: 'User', username: 'test_user' }
      }],
      visitorPages: [{
        _id: { userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', path: '/content/:id', contentId: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
        path: '/content/:id',
        pageViews: 2,
        durationSeconds: 90,
        lastActiveAt: now,
        content: { title: 'Trending link' },
        user: { firstName: 'Test', lastName: 'User', username: 'test_user' }
      }]
    }
  });
  assert.match(rendered, /Analytics/);
  assert.match(rendered, /App opens/);
  assert.match(rendered, /Unique visitors/);
  assert.match(rendered, /Most visited pages/);
  assert.match(rendered, /Recent visitor activity/);
  assert.match(rendered, /Most recently active first/);
  assert.match(rendered, /Top content/);
  assert.match(rendered, /User page activity/);
  assert.match(rendered, /Trending link/);
  assert.match(rendered, /test_user/);
  assert.match(rendered, /retained for 180 days/);
  assert.match(rendered, /data-analytics-live-container/);
  assert.match(rendered, /data-analytics-live-status/);
});

test('privacy page explains first-party usage analytics and retention', async () => {
  const rendered = await ejs.renderFile(path.join(viewRoot, 'user/privacy.ejs'), {
    title: 'Privacy & analytics',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/privacy',
    user: { firstName: 'Test', username: 'test', photoUrl: '', balance: 0 }
  });
  assert.match(rendered, /time spent on each page/);
  assert.match(rendered, /up to 180 days/);
  assert.match(rendered, /third-party analytics services/);
  assert.match(rendered, /Privacy details/);
});

test('content page renders five per-content tasks and an initially locked video link', async () => {
  const taskSlots = Array.from({ length: 5 }, (_, slot) => ({
    slot,
    taskLink: 'https://example.test/task',
    started: slot === 2 || slot === 3,
    completed: slot < 2,
    claimReady: slot === 3,
    claimAvailableAt: Date.now() + 35000,
    remainingSeconds: 35
  }));
  const rendered = await ejs.renderFile(path.join(viewRoot, 'user/content.ejs'), {
    title: 'Sample video',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/content/aaaaaaaaaaaaaaaaaaaaaaaa',
    telegramWebAppUrl: 'https://example.test',
    user: { firstName: 'Test', username: 'test', photoUrl: '', balance: 0 },
    content: {
      _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      title: 'Sample video',
      imageUrl: 'https://example.test/image.jpg',
      videoUrl: 'https://example.test/video',
      date: new Date('2026-01-01T00:00:00Z'),
      totalViews: 10
    },
    tasks: taskSlots,
    allDone: false,
    completedTaskCount: 2,
    serverNow: new Date()
  });
  assert.equal((rendered.match(/class="task-card content-task-card"/g) || []).length, 5);
  assert.match(rendered, /2\/5 completed/);
  assert.match(rendered, /Claim Task/);
  assert.match(rendered, /Claim available in <strong data-claim-countdown>00:35<\/strong>/);
  assert.match(rendered, /data-claim-available-at="\d+"/);
  assert.match(rendered, /fa-arrow-up-right-from-square/);
  assert.match(rendered, /fa-circle-check/);
  assert.match(rendered, /fa-circle-check[^>]*><\/i> Claim Task/);
  assert.match(rendered, /fa-circle-check[^>]*><\/i> Completed/);
  assert.match(rendered, /button-success/);
  assert.match(rendered, /Watch \/ Download Now/);
  assert.match(rendered, /data-unlocked-content hidden/);
  assert.match(rendered, /data-unlock-countdown/);
  assert.doesNotMatch(rendered, /https:\/\/example\.test\/video/);

  const unlocked = await ejs.renderFile(path.join(viewRoot, 'user/content.ejs'), {
    title: 'Sample video',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/content/aaaaaaaaaaaaaaaaaaaaaaaa',
    telegramWebAppUrl: 'https://example.test',
    user: { firstName: 'Test', username: 'test', photoUrl: '', balance: 0 },
    content: normalizeContentRecord({
      _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      title: 'Sample video',
      imageUrl: 'https://example.test/image.jpg',
      video_url: 'https://youtube.com/watch?v=sample01',
      date: new Date('2026-01-01T00:00:00Z'),
      totalViews: 10
    }),
    tasks: taskSlots.map((task) => ({ ...task, started: true, completed: true })),
    allDone: true,
    completedTaskCount: 5,
    unlockExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    serverNow: new Date()
  });
  assert.match(unlocked, /href="https:\/\/youtube\.com\/watch\?v=sample01"/);
  assert.doesNotMatch(unlocked, /youtubevideoembed\.onrender\.com\/content\//);
  assert.match(unlocked, /class="button button-primary watch-video-button" data-watch-video target="_blank"/);
  assert.match(unlocked, /data-server-now="\d+"/);
  assert.match(unlocked, /Time remaining: <strong data-unlock-countdown>01:00:00<\/strong>/);
});

test('admin can edit all five per-content task destinations', async () => {
  const rendered = await ejs.renderFile(path.join(viewRoot, 'admin/content-tasks.ejs'), {
    title: 'Content task links',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/admin/content-tasks',
    adminUsername: 'admin',
    defaultTaskLink: 'https://example.test/default',
    contents: [{
      _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      title: 'Sample video',
      taskLinks: ['https://example.test/1']
    }]
  });
  for (let slot = 1; slot <= 5; slot++) assert.match(rendered, new RegExp(`name="taskLink${slot}"`));
  assert.match(rendered, /Use default link/);
});

test('profile shows fixed withdrawal progress and disables requests until all requirements are met', async () => {
  const rendered = await ejs.renderFile(path.join(viewRoot, 'user/profile.ejs'), {
    title: 'Your Profile',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/profile',
    telegramWebAppUrl: 'https://example.test',
    user: { firstName: 'Test', lastName: '', username: 'test', photoUrl: '', telegramId: '123', referralCount: 0, balance: 0 },
    requirements: { referrals: 10, tasks: 15, unlocks: 20, referralCount: 0, completedTasks: 0, unlockedContents: 0, canWithdraw: false },
    withdrawals: [],
    minWithdrawAmount: 100
  });
  assert.match(rendered, /0 \/ 10/);
  assert.match(rendered, /0 \/ 15/);
  assert.match(rendered, /0 \/ 20/);
  assert.match(rendered, /id="withdraw-form"/);
  assert.match(rendered, /type="submit" disabled/);
  assert.match(rendered, /Complete the requirements above/);
});

test('admin can edit a list of rotating video reward links', async () => {
  const rendered = await ejs.renderFile(path.join(viewRoot, 'admin/video-reward-links.ejs'), {
    title: 'Video reward links',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/admin/video-reward-links',
    adminUsername: 'admin',
    links: 'https://example.test/1\nhttps://example.test/2',
    defaultTaskLink: 'https://example.test/default'
  });
  assert.match(rendered, /name="links"/);
  assert.match(rendered, /https:\/\/example\.test\/1/);
  assert.match(rendered, /after watching for one minute/);
});

test('leaderboard offers income and referral tabs with top income selected by default', async () => {
  const rendered = await ejs.renderFile(path.join(viewRoot, 'user/leaderboard.ejs'), {
    title: 'Leaderboard',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/leaderboard',
    user: { firstName: 'Test', username: '', photoUrl: '', balance: 0 },
    type: 'income',
    rankings: [{ user: { firstName: 'Top', lastName: 'Member', username: 'top' }, amount: 150 }]
  });
  assert.match(rendered, /Top Income/);
  assert.match(rendered, /Top Referrals/);
  assert.match(rendered, /aria-selected="true"/);
  assert.match(rendered, /৳150\.00/);
  assert.match(rendered, /Ranks/);
});

test('complex admin management templates render representative records', async () => {
  const common = {
    title: 'Test',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/admin/tasks',
    adminUsername: 'admin',
    items: [],
    users: [],
    contents: [],
    tasks: [],
    pendingCompletions: [],
    pendingSet: new Set(),
    referralSet: new Set(),
    search: '',
    status: '',
    method: '',
    dateFrom: '',
    dateTo: ''
  };
  const content = {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    title: 'Sample link',
    imageUrl: '',
    videoUrl: 'https://example.test/video',
    date: new Date(),
    totalViews: 0,
    requiredTaskCount: 0,
    isActive: true,
    isTrending: false
  };
  const task = {
    _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    title: 'Sample task',
    type: 'partner',
    reward: 2,
    taskLink: 'https://example.test/task',
    verificationCode: '',
    imageUrl: '',
    dailyLimit: 0,
    appliesToAllContents: false,
    selectedContentIds: [],
    isActive: true
  };
  const renderedContents = await ejs.renderFile(path.join(viewRoot, 'admin/section.ejs'), {
    ...common, section: 'contents', items: [content]
  });
  const renderedTasks = await ejs.renderFile(path.join(viewRoot, 'admin/section.ejs'), {
    ...common, section: 'tasks', items: [task], contents: [content]
  });
  assert.match(renderedContents, /Sample link/);
  assert.match(renderedTasks, /Selected contents/);
});

test('admin contents form includes the searchable p9x9 import picker and field previews', async () => {
  const rendered = await ejs.renderFile(path.join(viewRoot, 'admin/section.ejs'), {
    title: 'Viral links',
    csrfToken: 'test-csrf-token',
    appName: 'LinkHub',
    currentPath: '/admin/contents',
    adminUsername: 'admin',
    section: 'contents',
    items: []
  });
  assert.match(rendered, /id="create-content-form"/);
  assert.match(rendered, /data-catalog-picker/);
  assert.match(rendered, /data-catalog-search/);
  assert.match(rendered, /data-catalog-results/);
  assert.match(rendered, /data-preview-image-button/);
  assert.match(rendered, /data-preview-video-button/);
  assert.match(rendered, /data-image-preview/);
  assert.match(rendered, /data-video-preview/);
  assert.match(rendered, /Import from p9x9/);
});

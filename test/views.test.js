const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

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

test('content page renders five per-content tasks and an initially locked video link', async () => {
  const taskSlots = Array.from({ length: 5 }, (_, slot) => ({
    slot,
    taskLink: 'https://example.test/task',
    started: slot === 2,
    completed: slot < 2
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
    completedTaskCount: 2
  });
  assert.equal((rendered.match(/class="task-card content-task-card"/g) || []).length, 5);
  assert.match(rendered, /2\/5 completed/);
  assert.match(rendered, /Claim Task/);
  assert.match(rendered, /fa-arrow-up-right-from-square/);
  assert.match(rendered, /fa-circle-check/);
  assert.match(rendered, /button-success/);
  assert.match(rendered, /Watch \/ Download Now/);
  assert.match(rendered, /data-unlocked-content hidden/);
  assert.doesNotMatch(rendered, /https:\/\/example\.test\/video/);

  const unlocked = await ejs.renderFile(path.join(viewRoot, 'user/content.ejs'), {
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
    tasks: taskSlots.map((task) => ({ ...task, started: true, completed: true })),
    allDone: true,
    completedTaskCount: 5,
    unlockExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
  });
  assert.match(unlocked, /href="\/content\/aaaaaaaaaaaaaaaaaaaaaaaa\/watch"/);
  assert.match(unlocked, /Available for one hour/);
  assert.doesNotMatch(unlocked, /https:\/\/example\.test\/video/);
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

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

test('complex admin management templates render representative records', async () => {
  const common = {
    title: 'Test',
    csrfToken: 'test-csrf-token',
    appName: 'Arohi Mim Viral Link',
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

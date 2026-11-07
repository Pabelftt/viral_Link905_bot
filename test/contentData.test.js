const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeContentRecord } = require('../services/contentData');

test('content records map the supplied snake_case video URL to the watch destination', () => {
  const content = normalizeContentRecord({
    id: 1,
    title: 'Advanced Python Tutorial for Beginners',
    image_url: 'https://picsum.photos/seed/py1/300/200',
    video_url: 'https://youtube.com/watch?v=sample01',
    date: '2026-01-10',
    total_views: 125000
  });

  assert.equal(content.videoUrl, 'https://youtube.com/watch?v=sample01');
  assert.equal(content.imageUrl, 'https://picsum.photos/seed/py1/300/200');
  assert.equal(content.totalViews, 125000);
  assert.equal(content.date, '2026-01-10');
});

test('camelCase content values take precedence while missing values use defaults', () => {
  assert.equal(normalizeContentRecord({
    videoUrl: 'https://example.test/camel',
    video_url: 'https://example.test/snake'
  }).videoUrl, 'https://example.test/camel');
  assert.equal(normalizeContentRecord({
    videoUrl: '',
    video_url: 'https://example.test/snake'
  }).videoUrl, 'https://example.test/snake');
  assert.equal(normalizeContentRecord({ title: 'No links' }).videoUrl, '');
});

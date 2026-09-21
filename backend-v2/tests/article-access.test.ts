import assert from 'node:assert/strict';
import test from 'node:test';
import {
  articleCodeDigest,
  articleIpHash,
  resolveArticleAccessMode,
  validateArticlePassword,
} from '../src/utils/ArticleAccess';
import { buildStaticSeoFiles, buildStaticSnapshotPayloads } from '../src/services/static-snapshot/StaticSnapshotWriter';

test('legacy private mode remains approval while explicit password mode wins', () => {
  assert.equal(resolveArticleAccessMode(undefined, true), 'approval');
  assert.equal(resolveArticleAccessMode('Password', true), 'password');
  assert.equal(resolveArticleAccessMode('Public', true), 'public');
});
test('password and IP digests are scoped and deterministic', () => {
  const pepper = 'x'.repeat(32);
  assert.equal(articleCodeDigest(pepper, 'Test', 'one-time-pass'), articleCodeDigest(pepper, 'Test', 'one-time-pass'));
  assert.notEqual(articleCodeDigest(pepper, 'Test', 'one-time-pass'), articleCodeDigest(pepper, 'Production', 'one-time-pass'));
  assert.notEqual(articleIpHash(pepper, '203.0.113.1'), articleIpHash(pepper, '203.0.113.2'));
  assert.equal(validateArticlePassword('short'), '一次性密码至少需要 8 个字节');
  assert.equal(validateArticlePassword('long-enough'), null);
});

test('domestic static snapshot excludes all private and password-gated entries', () => {
  const posts = [
    {
      id: 'public-post', title: '公开文章', summary: '公开摘要', date: '2026-01-01 00:00',
      category: '测试', tags: [], image: '', isPrivate: false, accessMode: 'public', isPublished: true,
    },
    {
      id: 'approval-post', title: '申请文章', summary: '不可公开', date: '2026-01-01 00:00',
      category: '测试', tags: [], image: '', isPrivate: true, accessMode: 'approval', isPublished: true,
    },
    {
      id: 'password-post', title: '真实标题', summary: '私密摘要', date: '2026-01-01 00:00',
      category: '测试', tags: [], image: '', isPrivate: true, accessMode: 'password', isPublished: true,
      showLockedMetadata: false,
    },
  ];
  const contents = new Map([
    ['public-post', '# public'],
    ['approval-post', '# approval secret'],
    ['password-post', '# password secret'],
  ]);
  const payload = buildStaticSnapshotPayloads(posts, contents, {}, new Date('2026-08-26T00:00:00Z'));

  assert.deepEqual(payload.postsList.data.posts.map(post => post.id), ['public-post']);
  assert.equal(payload.postContents.get('public-post')?.content, '# public');
  assert.equal(payload.postContents.has('approval-post'), false);
  assert.equal(payload.postContents.has('password-post'), false);
});

test('static SEO pages contain only public article bodies and a Beijing sitemap', () => {
  const payload = buildStaticSnapshotPayloads([
    {
      id: 'public-post', title: '公开 <文章>', summary: '摘要', date: '2026-01-01 00:00',
      category: '测试', tags: [], image: '', isPrivate: false, accessMode: 'public', isPublished: true,
    },
    {
      id: 'locked-post', title: '受保护文章', summary: '不可抓取', date: '2026-01-01 00:00',
      category: '测试', tags: [], image: '', isPrivate: true, accessMode: 'password', isPublished: true,
    },
  ], new Map([
    ['public-post', '# 正文\n\n仅公开内容。'],
    ['locked-post', '# 不可公开'],
  ]), { title: 'ZhuiYi', baidu_site_verification: 'verify-token' }, new Date('2026-08-26T00:00:00Z'));

  const files = buildStaticSeoFiles(payload);
  const article = files.get('seo/public-post.html')?.toString('utf8') || '';
  const sitemap = files.get('seo/sitemap.xml')?.toString('utf8') || '';
  assert.match(article, /公开 &lt;文章&gt;/);
  assert.match(article, /baidu-site-verification/);
  assert.match(article, /仅公开内容/);
  assert.equal(files.has('seo/locked-post.html'), false);
  assert.match(sitemap, /https:\/\/cn\.hizhuiyi\.cn\/posts\/public-post/);
  assert.doesNotMatch(sitemap, /locked-post/);
});

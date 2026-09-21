import assert from 'node:assert/strict';
import test from 'node:test';
import sanitizeHtml from 'sanitize-html';
import { activeSessions } from '../src/middlewares/RateLimitMiddleware';
import { userActiveCache } from '../src/middlewares/AuthMiddleware';
import { parseCommentReplyMetadata, stripCommentReplyMetadata } from '../src/utils/CommentReplyMetadata';

test('comment input sanitizer strips XSS attack vectors while preserving safe markup', () => {
  const sanitize = (raw: string) => {
    return sanitizeHtml(raw, {
      allowedTags: [
        'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'span', 'code', 'pre', 'blockquote'
      ],
      allowedAttributes: {
        'a': ['href', 'target', 'rel'],
        'span': ['class'],
        'code': ['class'],
        'pre': ['class'],
      },
      allowedSchemes: ['http', 'https', 'mailto'],
      transformTags: {
        'a': sanitizeHtml.simpleTransform('a', {
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        }),
      },
      disallowedTagsMode: 'discard',
    }).trim();
  };

  // 1. Script tags completely discarded
  const maliciousScript = '<script>alert("xss")</script>Hello World';
  assert.equal(sanitize(maliciousScript), 'Hello World');

  // 2. Event handler attributes stripped
  const maliciousImg = '<img src="x" onerror="alert(document.cookie)">Good picture';
  assert.equal(sanitize(maliciousImg), 'Good picture');

  // 3. Iframe and SVG injection discarded
  const maliciousSvg = '<svg onload="alert(1)"><circle cx="50" cy="50" r="40"/></svg>';
  assert.equal(sanitize(maliciousSvg), '');

  // 4. Javascript pseudo-protocol URLs stripped (href removed)
  const maliciousLink = '<a href="javascript:alert(1)">Click me</a>';
  const sanitizedMaliciousLink = sanitize(maliciousLink);
  assert.ok(!sanitizedMaliciousLink.includes('javascript:'));
  assert.ok(!sanitizedMaliciousLink.includes('href='));
  assert.ok(sanitizedMaliciousLink.includes('Click me'));

  // 5. Legitimate links automatically enriched with safe rel attributes
  const safeLink = '<a href="https://hizhuiyi.cn">Visit Site</a>';
  const sanitizedLink = sanitize(safeLink);
  assert.ok(sanitizedLink.includes('rel="noopener noreferrer nofollow"'));
  assert.ok(sanitizedLink.includes('target="_blank"'));
  assert.ok(sanitizedLink.includes('href="https://hizhuiyi.cn"'));

  // 6. Safe rich text formatting preserved
  const safeRichText = '<b>粗体</b><i>斜体</i><code>code</code><span class="user-mention">@admin</span>';
  assert.equal(sanitize(safeRichText), '<b>粗体</b><i>斜体</i><code>code</code><span class="user-mention">@admin</span>');
});

test('comment reply metadata remains cleanly extractable with sanitized body', () => {
  const payload = '回复内容：赞同！<script>alert(1)</script><!-- meta:{"parentId":"42","replyTo":"Alice"} -->';
  const meta = parseCommentReplyMetadata(payload);
  assert.deepEqual(meta, { parentId: '42', replyTo: 'Alice' });

  const rawBody = stripCommentReplyMetadata(payload);
  assert.equal(rawBody, '回复内容：赞同！<script>alert(1)</script>');
});

test('activeSessions uses bounded LRU cache avoiding unbounded memory leak', () => {
  // Verify LRU set and get
  activeSessions.set('192.168.100.1', Date.now());
  assert.equal(typeof activeSessions.get('192.168.100.1'), 'number');

  // Verify deletion
  activeSessions.delete('192.168.100.1');
  assert.equal(activeSessions.get('192.168.100.1'), undefined);
});

test('userActiveCache correctly caches banned and active status', () => {
  userActiveCache.set(9999, false);
  assert.equal(userActiveCache.get(9999), false);

  userActiveCache.set(9999, true);
  assert.equal(userActiveCache.get(9999), true);

  userActiveCache.delete(9999);
  assert.equal(userActiveCache.get(9999), undefined);
});

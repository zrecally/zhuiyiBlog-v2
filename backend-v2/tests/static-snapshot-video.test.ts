import assert from 'node:assert/strict';
import test from 'node:test';
import { postContentHasVideoMedia } from '../src/services/static-snapshot/StaticSnapshotWriter';

test('百分号编码的 B 站 markdown 链接（飞书真实导出形态）命中', () => {
  const content = '[https://www.bilibili.com/video/BV1GJ411x7h7](https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1GJ411x7h7)';
  assert.equal(postContentHasVideoMedia(content), true);
});

test('百分号编码的 YouTube markdown 链接命中', () => {
  const content = '[https://www.youtube.com/watch?v=dQw4w9WgXcQ](https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ)';
  assert.equal(postContentHasVideoMedia(content), true);
});

test('裸 youtu.be 与 vimeo 链接命中', () => {
  assert.equal(postContentHasVideoMedia('看这个 https://youtu.be/jNQXAC9IVRw 就懂了'), true);
  assert.equal(postContentHasVideoMedia('https://vimeo.com/76979871 是一部短片'), true);
});

test('直链视频文件（含大小写与查询参数）命中', () => {
  assert.equal(postContentHasVideoMedia('https://cdn.example.com/media/clip.mp4'), true);
  assert.equal(postContentHasVideoMedia('https://cdn.example.com/media/clip.MP4?token=1'), true);
  assert.equal(postContentHasVideoMedia('[视频](https://cdn.example.com/a/b.webm)'), true);
  assert.equal(postContentHasVideoMedia('https://live.example.com/stream/index.m3u8'), true);
});

test('显式 video 标签命中', () => {
  assert.equal(postContentHasVideoMedia('正文 <video src="/a.mp4"></video> 结尾'), true);
});

test('纯图片与普通文章不误伤', () => {
  const imageOnly = [
    '![截图](/api/v1/image/abc123)',
    '',
    '普通段落，提到 boggy、logged、jogged 等含 ogg 字样的单词。',
    '[普通链接](https://example.com/page)',
    '![本地图片](/api/v1/image/uploads/1e4b0f2c-1b0a-4a5e-9c1d-000000000000.png)',
  ].join('\n');
  assert.equal(postContentHasVideoMedia(imageOnly), false);
});

test('音频平台与音频文件不拦', () => {
  assert.equal(postContentHasVideoMedia('[歌](https://open.spotify.com/track/abc)'), false);
  assert.equal(postContentHasVideoMedia('https://cdn.example.com/song.mp3'), false);
});

test('畸形百分号编码不抛错且按原文处理', () => {
  const malformed = '[链接](https%3A%2F%2F%E0%A4%A)';
  assert.equal(postContentHasVideoMedia(malformed), false);
  assert.equal(postContentHasVideoMedia('[X](https%3A%2F%2Fyoutu.be%2FjNQXAC9IVRw'), true);
});

test('空内容与空扩展名边界不误伤', () => {
  assert.equal(postContentHasVideoMedia(''), false);
  assert.equal(postContentHasVideoMedia('文件名 x.oggY 不算视频后缀'), false);
});

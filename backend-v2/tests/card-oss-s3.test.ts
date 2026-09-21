import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cardOssApplySettings,
  cardOssPresignGet,
  cardOssReady,
  cardOssSettings,
} from '../src/core/CardOssClient';

/**
 * 卡密对象存储客户端（S3/SigV4 协议）离线单测：
 * 预签名 URL 是纯本地计算，不发网络请求，可完整验证签名 URL 的形态。
 */

const FULL = {
  enabled: true,
  endpoint: 'https://s3.rainyun.example',
  accessKeyId: 'AKIDEXAMPLE',
  accessKeySecret: 'secret-key-for-signing',
  bucket: 'zhuiyi-card',
  keyPrefix: 'card-files/',
  region: 'us-east-1',
  pathStyle: true,
  presignTtlSeconds: 300,
};

test('applySettings requires complete fields when enabling', () => {
  assert.throws(
    () => cardOssApplySettings({ enabled: true, endpoint: '', accessKeyId: '', accessKeySecret: '', bucket: '' }),
    /endpoint \/ accessKeyId \/ accessKeySecret \/ bucket/,
  );
  assert.throws(
    () => cardOssApplySettings({ endpoint: 'ftp://bad' }),
    /http/,
  );
  assert.throws(
    () => cardOssApplySettings({ publicEndpoint: 'ftp://bad' }),
    /publicEndpoint/,
  );
});

test('presigned GET uses SigV4 against the configured endpoint (path-style)', async () => {
  cardOssApplySettings({ ...FULL, publicEndpoint: '' });
  assert.equal(cardOssReady(), true);

  const { url, expiresInSeconds } = await cardOssPresignGet('card-files/demo.zip', 'demo.zip');
  const parsed = new URL(url);

  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.host, 's3.rainyun.example');
  // path-style：桶名在路径里
  assert.equal(parsed.pathname, '/zhuiyi-card/card-files/demo.zip');
  // SigV4 查询签名要素
  assert.equal(parsed.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(parsed.searchParams.get('X-Amz-Signature')?.length, 64);
  assert.match(parsed.searchParams.get('X-Amz-Credential') || '', /^AKIDEXAMPLE\//);
  // 下载附件语义
  assert.match(parsed.searchParams.get('response-content-disposition') || '', /attachment/);
  // TTL 上下限裁剪
  assert.equal(expiresInSeconds, 300);
  const amzDate = parsed.searchParams.get('X-Amz-Date') || '';
  assert.match(amzDate, /^\d{8}T\d{6}Z$/);
});

test('presigned GET re-signs against publicEndpoint so SigV4 host matches', async () => {
  cardOssApplySettings({ ...FULL, publicEndpoint: 'https://cdn.example.com' });
  const { url } = await cardOssPresignGet('card-files/demo.zip', 'demo.zip');
  const parsed = new URL(url);

  assert.equal(parsed.host, 'cdn.example.com', 'public URL must use the public host');
  assert.equal(parsed.pathname, '/zhuiyi-card/card-files/demo.zip');
  assert.equal(parsed.searchParams.get('X-Amz-Signature')?.length, 64);
  cardOssApplySettings({ publicEndpoint: '' });
});

test('one logical grant reproduces the same signed URL and pins object version', async () => {
  cardOssApplySettings({ ...FULL, publicEndpoint: '' });
  const signingDate = new Date('2026-09-20T01:02:03.000Z');
  const first = await cardOssPresignGet('card-files/demo.zip', 'demo.zip', {
    signingDate,
    expiresInSeconds: 900,
    versionId: 'version-7',
  });
  const retried = await cardOssPresignGet('card-files/demo.zip', 'demo.zip', {
    signingDate,
    expiresInSeconds: 900,
    versionId: 'version-7',
  });
  assert.equal(retried.url, first.url, 'a retry must not mint a distinct bearer URL');
  assert.equal(new URL(first.url).searchParams.get('versionId'), 'version-7');
});

test('presign TTL is constrained to the one-hour security ceiling', () => {
  cardOssApplySettings({ ...FULL, presignTtlSeconds: 86_400 });
  assert.equal(cardOssSettings().presignTtlSeconds, 3600);
});

test('settings snapshot keeps secret available for admin view and defaults normalize', () => {
  cardOssApplySettings({ ...FULL, region: '' });
  const settings = cardOssSettings();
  assert.equal(settings.accessKeySecret, 'secret-key-for-signing');
  assert.equal(settings.region, 'us-east-1', 'empty region falls back to us-east-1');
  assert.equal(settings.pathStyle, true);
});

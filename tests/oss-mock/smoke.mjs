// oss-mock 冒烟测试：用 backend-v2 真实的 ali-oss 客户端走完整协议链路。
// 运行：cd backend-v2 && node ../tests/oss-mock/smoke.mjs
// 需要先启动 compose 里的 oss_mock 服务（宿主机端口 9123）。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// 冒烟脚本位于 backend-v2 之外，用 createRequire 借用后端已安装的 ali-oss。
const require = createRequire(new URL('../../backend-v2/package.json', import.meta.url));
const OSS = require('ali-oss');

const endpoint = process.env.OSS_MOCK_ENDPOINT || 'http://oss-mock.localhost:9123';
const bucket = process.env.OSS_MOCK_BUCKET || 'zhuiyi-card-local';

const client = new OSS({
  accessKeyId: 'local-mock-key',
  accessKeySecret: 'local-mock-secret',
  bucket,
  endpoint,
  cname: true,
});

const key = `smoke/${Date.now()}-测试对象.bin`;
const payload = Buffer.from('oss-mock smoke payload 你好');

// 1. PUT（头签名）
const put = await client.put(key, payload);
assert.equal(put.res.status, 200);
assert.match(put.res.headers.etag, /^"[0-9a-f]{32}"$/);
console.log('1. put (header auth) ok, etag=', put.res.headers.etag);

// 2. GET（头签名）
const get = await client.get(key);
assert.equal(get.res.status, 200);
assert.deepEqual(get.content, payload);
console.log('2. get (header auth) ok, content matches');

// 3. HEAD（头签名）
const head = await client.head(key);
assert.equal(head.res.status, 200);
assert.equal(Number(head.res.headers['content-length']), payload.length);
console.log('3. head (header auth) ok, content-length matches');

// 4. 错误凭证应被拒绝
const badClient = new OSS({ ...client.options, accessKeySecret: 'wrong-secret' });
const statusOf = error => error?.status ?? error?.res?.status;
await assert.rejects(() => badClient.get(key), error => statusOf(error) === 403);
console.log('4. wrong secret rejected with 403');

// 5. 预签名 GET + content-disposition 覆写（免鉴头直连）
const url = client.signatureUrl(key, {
  expires: 60,
  response: { 'content-disposition': 'attachment; filename="smoke.bin"' },
});
assert.ok(new URL(url).hostname.startsWith('oss-mock'), url);
assert.ok(url.includes('response-content-disposition='), url);
const presigned = await fetch(url);
assert.equal(presigned.status, 200);
assert.equal(presigned.headers.get('content-disposition'), 'attachment; filename="smoke.bin"');
assert.deepEqual(Buffer.from(await presigned.arrayBuffer()), payload);
console.log('5. presigned GET ok, disposition override applied');

// 6. 篡改签名应被拒绝
const tampered = url.replace(/Signature=./, s => `${s.slice(0, -1)}X`);
const tamperedRes = await fetch(tampered);
assert.equal(tamperedRes.status, 403);
console.log('6. tampered presigned signature rejected with 403');

// 7. 无签名匿名访问应被拒绝
const anonymous = await fetch(`${endpoint}/${encodeURIComponent(key)}`);
assert.equal(anonymous.status, 403);
console.log('7. anonymous access rejected with 403');

// 8. DELETE 后应 404
await client.delete(key);
await assert.rejects(() => client.head(key), error => statusOf(error) === 404);
console.log('8. delete then head -> 404');

console.log('\noss-mock 冒烟测试全部通过');

// oss-mock 上传工具：把本地文件上传到模拟 OSS 的私有桶，并打印预签名下载地址。
// 用法（在 compose 网络内运行）：
//   docker run --rm --network zhuiyi_default -v "$PWD:/repo" -w /repo/backend-v2 \
//     -e OSS_MOCK_ENDPOINT=http://oss-mock:9000 node:22-alpine \
//     node ../tests/oss-mock/upload.mjs <本地文件> [对象key]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(new URL('../../backend-v2/package.json', import.meta.url));
const OSS = require('ali-oss');

const [localFile, keyArg] = process.argv.slice(2);
if (!localFile) {
  console.error('用法: node upload.mjs <本地文件> [对象key]');
  process.exit(1);
}

const endpoint = process.env.OSS_MOCK_ENDPOINT || 'http://oss-mock:9000';
const bucket = process.env.OSS_MOCK_BUCKET || 'zhuiyi-card-local';
const key = keyArg || path.basename(localFile);

const client = new OSS({
  accessKeyId: process.env.OSS_MOCK_ACCESS_KEY_ID || 'local-mock-key',
  accessKeySecret: process.env.OSS_MOCK_ACCESS_KEY_SECRET || 'local-mock-secret',
  bucket,
  endpoint,
  cname: true,
});

const stat = fs.statSync(localFile);
const result = await client.put(key, fs.createReadStream(localFile), {
  mime: 'application/octet-stream',
});
console.log(`已上传: ${key} (${stat.size} bytes), ETag=${result.res.headers.etag}`);

const presigned = client.signatureUrl(key, { expires: 300 });
console.log(`预签名下载地址（5 分钟内有效）:\n${presigned}`);

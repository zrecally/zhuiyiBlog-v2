// 本地阿里云 OSS 协议模拟服务（无第三方依赖）。
// 仅实现 backend-v2 所需的协议子集：头签名鉴权的 PUT/HEAD/DELETE，
// 以及预签名（query 签名）的 GET，支持 response-content-disposition 覆写。
// 寻址同时支持三种形式（按优先级判定）：
//   1. 路径式     /{bucket}/{key}
//   2. 虚拟主机式 Host: {bucket}.任意域名
//   3. CNAME 式   Host 任意（单桶，桶名取 OSS_MOCK_BUCKET）
// 仅供本地开发测试：单桶、明文 HTTP、mock 凭证，严禁用于生产。
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const ACCESS_KEY_ID = process.env.OSS_MOCK_ACCESS_KEY_ID || 'mock-access-key';
const ACCESS_KEY_SECRET = process.env.OSS_MOCK_ACCESS_KEY_SECRET || 'mock-access-secret';
const BUCKET = process.env.OSS_MOCK_BUCKET || 'zhuiyi-card-local';
const DATA_DIR = process.env.OSS_MOCK_DATA_DIR || '/data';
const PORT = Number(process.env.OSS_MOCK_PORT || 9000);
// 管理页面/API 的本地令牌；mock 只应绑定在受信任的网络里。
const ADMIN_TOKEN = process.env.OSS_MOCK_ADMIN_TOKEN || 'local-mock-admin';

const SIGNED_OUT_PARAMS = new Set(['OSSAccessKeyId', 'Expires', 'Signature']);

const safeKeyFor = (rawKey) => {
  const key = decodeURIComponent(rawKey || '').replace(/^\/+/, '');
  if (!key || key.includes('\0') || key.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return null;
  return key;
};

const hmacSha1Base64 = (secret, canonicalString) => (
  createHmac('sha1', secret).update(Buffer.from(canonicalString, 'utf8')).digest('base64')
);

const signaturesEqual = (a, b) => {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

// canonical: VERB\nContent-MD5\nContent-Type\nExpires 或 x-oss-date\n[排序的 x-oss-*]\n/bucket/key[?子资源]
const buildCanonicalString = ({ method, contentMd5, contentType, date, ossHeaders, resource, subResources }) => {
  const lines = [method.toUpperCase(), contentMd5 || '', contentType || '', date || ''];
  lines.push(...Object.keys(ossHeaders).sort().map(name => `${name}:${ossHeaders[name]}`));
  let canonicalizedResource = resource;
  let separator = '?';
  for (const name of Object.keys(subResources).sort()) {
    canonicalizedResource += separator + name;
    if (subResources[name]) canonicalizedResource += `=${subResources[name]}`;
    separator = '&';
  }
  lines.push(canonicalizedResource);
  return lines.join('\n');
};

const collectOssHeaders = (headers) => {
  const collected = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower.startsWith('x-oss-')) collected[lower] = String(value).trim();
  }
  return collected;
};

// 依次尝试路径式、虚拟主机式、CNAME 式；桶固定为 OSS_MOCK_BUCKET。
const resolveTarget = (req, url) => {
  const pathParts = url.pathname.replace(/^\/+/, '').split('/');
  if (pathParts.length >= 2 && pathParts[0] === BUCKET) {
    const key = safeKeyFor(pathParts.slice(1).join('/'));
    if (key) return { bucket: BUCKET, key };
  }
  const host = (req.headers.host || '').split(':')[0];
  const hostLabels = host.split('.');
  if (hostLabels.length > 2 && hostLabels[0] === BUCKET) {
    const key = safeKeyFor(url.pathname);
    if (key) return { bucket: BUCKET, key };
  }
  const key = safeKeyFor(url.pathname);
  return key ? { bucket: BUCKET, key } : null;
};

const verifyHeaderAuth = (req, url) => {
  const match = /^OSS ([^:]+):(.+)$/.exec(req.headers.authorization || '');
  if (!match) return false;
  const [, keyId, signature] = match;
  if (keyId !== ACCESS_KEY_ID) return false;
  // 列举请求（GET 桶根）：ali-oss listV2 把查询参数放 params.query 而非 subres，
  // V1 签名的 canonical resource 是 /bucket/ 且不含 query 参数。
  const isListRequest = url.pathname === '/' || url.pathname === '' || url.pathname === `/${BUCKET}`;
  const target = isListRequest ? { bucket: BUCKET, key: '' } : resolveTarget(req, url);
  if (!target) return false;
  // 分片上传子资源（uploads/uploadId/partNumber）属于 subres，会进入签名
  const subResources = {};
  for (const name of ['uploads', 'uploadId', 'partNumber']) {
    const v = url.searchParams.get(name);
    if (v !== null) subResources[name] = v;
  }
  const canonical = buildCanonicalString({
    method: req.method,
    contentMd5: req.headers['content-md5'],
    contentType: req.headers['content-type'],
    date: req.headers['x-oss-date'] || req.headers.date,
    ossHeaders: collectOssHeaders(req.headers),
    resource: `/${target.bucket}/${target.key}`,
    subResources,
  });
  return signaturesEqual(signature, hmacSha1Base64(ACCESS_KEY_SECRET, canonical));
};

const verifyPresignedGet = (req, url) => {
  const keyId = url.searchParams.get('OSSAccessKeyId');
  const expires = Number(url.searchParams.get('Expires'));
  const signature = url.searchParams.get('Signature');
  if (!keyId || keyId !== ACCESS_KEY_ID || !Number.isFinite(expires) || !signature) return false;
  if (expires * 1000 < Date.now()) return false;
  const subResources = {};
  for (const [name, value] of url.searchParams.entries()) {
    if (!SIGNED_OUT_PARAMS.has(name)) subResources[name] = value;
  }
  const target = resolveTarget(req, url);
  if (!target) return false;
  const canonical = buildCanonicalString({
    method: 'GET',
    ossHeaders: {},
    // ali-oss 预签名把 Expires 放在 canonical 的日期位（第 4 段）
    date: String(expires),
    resource: `/${target.bucket}/${target.key}`,
    subResources,
  });
  const expected = hmacSha1Base64(ACCESS_KEY_SECRET, canonical);
  if (!signaturesEqual(signature, expected) && process.env.OSS_MOCK_DEBUG) {
    console.error('[oss-mock] presigned mismatch');
    console.error('  canonical:', JSON.stringify(canonical));
    console.error('  provided :', signature, ' expected:', expected);
  }
  return signaturesEqual(signature, expected);
};

const objectPathFor = (key) => {
  const filePath = path.resolve(DATA_DIR, BUCKET, key);
  if (!filePath.startsWith(path.resolve(DATA_DIR, BUCKET) + path.sep)) return null;
  return filePath;
};

const send = (res, status, headers = {}, body = '') => {
  res.writeHead(status, headers);
  if (body && typeof body.pipe === 'function') {
    body.on('error', () => res.destroy());
    body.pipe(res);
  } else {
    res.end(body);
  }
};

// Content-Disposition 的 filename 含非 ASCII 时按 RFC 5987 转成 filename*，
// 否则 Node writeHead 会因非法头字符抛 ERR_INVALID_CHAR（真实 OSS 同样遵守该编码）。
const safeContentDisposition = (value) => {
  const match = /^(attachment|inline); filename="(.*)"$/s.exec(value);
  if (!match) return value;
  const [, type, name] = match;
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(name)) return value;
  return `${type}; filename*=UTF-8''${encodeURIComponent(name)}`;
};

const json = (res, status, data) => send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(data));

// ---------- 管理页面与本地管理 API（开发调试用，非 OSS 协议的一部分） ----------

const isAuthorizedAdmin = (req, url) => {
  const provided = req.headers['x-oss-mock-token'] || url.searchParams.get('token') || '';
  const expected = Buffer.from(ADMIN_TOKEN, 'utf8');
  const actual = Buffer.from(String(provided), 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const META_SUFFIXES = ['.meta.etag', '.meta.type'];

const listObjects = async () => {
  const bucketDir = path.join(DATA_DIR, BUCKET);
  const objects = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || META_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) continue;
      const key = path.relative(bucketDir, fullPath).split(path.sep).join('/');
      const stat = await fsp.stat(fullPath);
      const [type, etag] = await Promise.all([
        fsp.readFile(`${fullPath}.meta.type`, 'utf8').catch(() => ''),
        fsp.readFile(`${fullPath}.meta.etag`, 'utf8').catch(() => ''),
      ]);
      objects.push({
        key,
        size: stat.size,
        lastModified: stat.mtime.toISOString(),
        contentType: type.trim() || 'application/octet-stream',
        etag: etag.trim(),
      });
    }
  };
  await walk(bucketDir);
  objects.sort((a, b) => a.key.localeCompare(b.key));
  return objects;
};

const readAdminKey = (url) => safeKeyFor(url.searchParams.get('key') || '');

const presignForAdmin = (key, { ttlSeconds, filename }) => {
  const subResources = {};
  if (filename) {
    subResources['response-content-disposition'] = `attachment; filename="${filename.replace(/["\\]/g, '_')}"`;
  }
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const canonical = buildCanonicalString({
    method: 'GET',
    ossHeaders: {},
    date: String(expires),
    resource: `/${BUCKET}/${key}`,
    subResources,
  });
  const signature = hmacSha1Base64(ACCESS_KEY_SECRET, canonical);
  const query = new URLSearchParams({
    OSSAccessKeyId: ACCESS_KEY_ID,
    Expires: String(expires),
    Signature: signature,
    ...Object.fromEntries(Object.entries(subResources)),
  });
  return query.toString();
};

const fspSyncExists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (process.env.OSS_MOCK_DEBUG) console.error(`[oss-mock] ${req.method} ${url.pathname} query=${JSON.stringify(Object.fromEntries(url.searchParams))}`);

  if (url.pathname === '/healthz') {
    return send(res, 200, { 'Content-Type': 'text/plain' }, 'ok');
  }

  // ListObjects（ali-oss listV2 会带 list-type=2），供后端枚举桶内对象。
  // 必须先于管理页分支判断：两者都可能命中 GET /。
  if (req.method === 'GET' && url.searchParams.has('list-type')) {
    if (!verifyHeaderAuth(req, url)) return send(res, 403, {}, 'signature mismatch');
    const prefix = url.searchParams.get('prefix') || '';
    const maxKeys = Math.min(Number(url.searchParams.get('max-keys')) || 1000, 1000);
    const objects = (await listObjects()).filter(o => o.key.startsWith(prefix)).slice(0, maxKeys);
    const escXml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult>\n  <Name>${escXml(BUCKET)}</Name>\n  <Prefix>${escXml(prefix)}</Prefix>\n  <MaxKeys>${maxKeys}</MaxKeys>\n  <IsTruncated>false</IsTruncated>\n${objects.map(o => `  <Contents>\n    <Key>${escXml(o.key)}</Key>\n    <LastModified>${o.lastModified}</LastModified>\n    <ETag>&quot;${escXml(o.etag)}&quot;</ETag>\n    <Size>${o.size}</Size>\n    <StorageClass>Standard</StorageClass>\n  </Contents>`).join('\n')}\n</ListBucketResult>`;
    if (process.env.OSS_MOCK_DEBUG) console.error(`[oss-mock] list debug:\n${xml}`);
    return send(res, 200, { 'Content-Type': 'application/xml' }, xml);
  }

  // 根路径与 /admin 提供可视化页面；/admin/api/* 为本地管理接口。
  if (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/admin/') {
    const html = await fsp.readFile(path.join(MODULE_DIR, 'ui.html'), 'utf8');
    return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, html.replace('__OSS_MOCK_TOKEN__', ADMIN_TOKEN));
  }

  if (url.pathname.startsWith('/admin/api/')) {
    if (!isAuthorizedAdmin(req, url)) return json(res, 401, { error: 'token 无效' });
    try {
      if (req.method === 'GET' && url.pathname === '/admin/api/list') {
        const objects = await listObjects();
        return json(res, 200, { bucket: BUCKET, objects, totalBytes: objects.reduce((sum, item) => sum + item.size, 0) });
      }
      if (req.method === 'POST' && url.pathname === '/admin/api/upload') {
        const key = readAdminKey(url);
        if (!key) return json(res, 400, { error: 'key 无效' });
        const filePath = objectPathFor(key);
        if (!filePath) return json(res, 400, { error: 'key 无效' });
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        const hash = createHash('md5');
        const tempPath = `${filePath}.${randomUUID()}.part`;
        try {
          await new Promise((resolve, reject) => {
            req.on('data', chunk => hash.update(chunk));
            const file = fs.createWriteStream(tempPath, { mode: 0o600 });
            req.pipe(file);
            file.on('finish', resolve);
            file.on('error', reject);
            req.on('error', reject);
          });
          await fsp.rename(tempPath, filePath);
          const etag = hash.digest('hex');
          await fsp.writeFile(`${filePath}.meta.etag`, etag, { mode: 0o600 });
          if (req.headers['content-type']) {
            await fsp.writeFile(`${filePath}.meta.type`, String(req.headers['content-type']), { mode: 0o600 });
          }
          return json(res, 200, { key, size: Number(req.headers['content-length'] || 0), etag });
        } catch (error) {
          await fsp.unlink(tempPath).catch(() => undefined);
          throw error;
        }
      }
      if (req.method === 'GET' && url.pathname === '/admin/api/presign') {
        const key = readAdminKey(url);
        if (!key) return json(res, 400, { error: 'key 无效' });
        const filePath = objectPathFor(key);
        if (!filePath || !(await fsp.stat(filePath).then(stat => stat.isFile()).catch(() => false))) {
          return json(res, 404, { error: '对象不存在' });
        }
        const ttlSeconds = Math.min(Math.max(Number(url.searchParams.get('ttl')) || 300, 10), 3600);
        const filename = url.searchParams.get('filename') || undefined;
        const query = presignForAdmin(key, { ttlSeconds, filename });
        return json(res, 200, { url: `http://${req.headers.host}/${key.split('/').map(encodeURIComponent).join('/')}?${query}`, ttlSeconds });
      }
      if (req.method === 'DELETE' && url.pathname === '/admin/api/objects') {
        const key = readAdminKey(url);
        if (!key) return json(res, 400, { error: 'key 无效' });
        const filePath = objectPathFor(key);
        if (!filePath) return json(res, 400, { error: 'key 无效' });
        await fsp.unlink(filePath).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        });
        await fsp.unlink(`${filePath}.meta.etag`).catch(() => undefined);
        await fsp.unlink(`${filePath}.meta.type`).catch(() => undefined);
        return json(res, 200, { deleted: key });
      }
      return json(res, 404, { error: '未知管理接口' });
    } catch (error) {
      console.error('[oss-mock] admin api failed:', error);
      return json(res, 500, { error: '内部错误' });
    }
  }

  const target = resolveTarget(req, url);
  if (!target) return send(res, 400, {}, 'invalid object key');
  const filePath = objectPathFor(target.key);
  if (!filePath) return send(res, 400, {}, 'invalid object key');

  // OSS 分片上传子协议：initiate(POST ?uploads) / part(PUT ?partNumber&uploadId) / complete(POST ?uploadId)
  try {
    const isMultipart =
      (req.method === 'POST' && (url.searchParams.has('uploads') || url.searchParams.has('uploadId')))
      || (req.method === 'PUT' && url.searchParams.has('partNumber') && url.searchParams.has('uploadId'));
    if (isMultipart) {
      if (!verifyHeaderAuth(req, url)) return send(res, 403, {}, 'signature mismatch');
      const escXml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

      if (url.searchParams.has('uploads')) {
        // initiate
        const uploadId = randomUUID();
        await fsp.mkdir(path.join(DATA_DIR, '.multipart', uploadId), { recursive: true });
        return send(res, 200, { 'Content-Type': 'application/xml' },
          `<?xml version="1.0" encoding="UTF-8"?>\n<InitiateMultipartUploadResult>\n  <Bucket>${escXml(BUCKET)}</Bucket>\n  <Key>${escXml(target.key)}</Key>\n  <UploadId>${uploadId}</UploadId>\n</InitiateMultipartUploadResult>`);
      }

      if (req.method === 'PUT') {
        // 上传分片
        const partNumber = url.searchParams.get('partNumber');
        const uploadId = url.searchParams.get('uploadId');
        const partDir = path.join(DATA_DIR, '.multipart', uploadId);
        if (!uploadId || uploadId.includes('..') || !fspSyncExists(partDir)) return send(res, 404, {}, 'NoSuchUpload');
        const partPath = path.join(partDir, String(Number(partNumber)));
        const hash = createHash('md5');
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(partPath, { mode: 0o600 });
          req.on('data', chunk => hash.update(chunk));
          req.pipe(file);
          file.on('finish', resolve);
          file.on('error', reject);
          req.on('error', reject);
        });
        return send(res, 200, { ETag: `"${hash.digest('hex')}"` });
      }

      // complete：按 partNumber 数序合并分片
      // 先排空 complete 请求体（XML）；若已读完直接放行
      await new Promise(resolve => {
        if (req.readableEnded) return resolve();
        req.resume();
        req.on('end', resolve);
        req.on('close', resolve);
      });
      const uploadId = url.searchParams.get('uploadId');
      const partDir = path.join(DATA_DIR, '.multipart', uploadId);
      const parts = (await fsp.readdir(partDir).catch(() => [])).map(Number).sort((a, b) => a - b);
      const hash = createHash('md5');
      const out = fs.createWriteStream(filePath, { mode: 0o600 });
      for (const part of parts) {
        await new Promise((resolve, reject) => {
          const rs = fs.createReadStream(path.join(partDir, String(part)));
          rs.pipe(out, { end: false });
          rs.on('end', resolve);
          rs.on('error', reject);
        });
      }
      out.end();
      await new Promise(resolve => out.on('close', resolve));
      const etag = hash.digest('hex');
      await fsp.writeFile(`${filePath}.meta.etag`, etag, { mode: 0o600 }).catch(() => undefined);
      await fsp.rm(partDir, { recursive: true, force: true });
      return send(res, 200, { 'Content-Type': 'application/xml' },
        `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUploadResult>\n  <Location>local</Location>\n  <Bucket>${escXml(BUCKET)}</Bucket>\n  <Key>${escXml(target.key)}</Key>\n  <ETag>&quot;${etag}&quot;</ETag>\n</CompleteMultipartUploadResult>`);
    }
  } catch (error) {
    console.error('[oss-mock] multipart failed:', error);
    return send(res, 500, {}, 'multipart error');
  }




  try {
    if (req.method === 'PUT') {
      if (!verifyHeaderAuth(req, url)) return send(res, 403, {}, 'signature mismatch');
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${randomUUID()}.part`;
      const hash = createHash('md5');
      try {
        await new Promise((resolve, reject) => {
          req.on('data', chunk => hash.update(chunk));
          const file = fs.createWriteStream(tempPath, { mode: 0o600 });
          req.pipe(file);
          file.on('finish', resolve);
          file.on('error', reject);
          req.on('error', reject);
        });
        await fsp.rename(tempPath, filePath);
        const etag = hash.digest('hex');
        await fsp.writeFile(`${filePath}.meta.etag`, etag, { mode: 0o600 });
        if (req.headers['content-type']) {
          await fsp.writeFile(`${filePath}.meta.type`, String(req.headers['content-type']), { mode: 0o600 });
        }
        return send(res, 200, { ETag: `"${etag}"` });
      } catch (error) {
        await fsp.unlink(tempPath).catch(() => undefined);
        throw error;
      }
    }

    if (req.method === 'HEAD' || req.method === 'GET') {
      const presigned = req.method === 'GET' && url.searchParams.has('Signature');
      if (presigned) {
        if (!verifyPresignedGet(req, url)) return send(res, 403, {}, 'signature mismatch or expired');
      } else if (!verifyHeaderAuth(req, url)) {
        return send(res, 403, {}, 'signature mismatch');
      }
      const stat = await fsp.lstat(filePath);
      if (!stat.isFile()) return send(res, 404, {});
      const [etag, storedType] = await Promise.all([
        fsp.readFile(`${filePath}.meta.etag`, 'utf8').catch(() => ''),
        fsp.readFile(`${filePath}.meta.type`, 'utf8').catch(() => ''),
      ]);
      const headers = {
        'Content-Length': String(stat.size),
        'Content-Type': storedType.trim() || 'application/octet-stream',
        ETag: `"${etag.trim()}"`,
      };
      if (req.method === 'HEAD') return send(res, 200, headers);
      const disposition = url.searchParams.get('response-content-disposition');
      if (disposition) headers['Content-Disposition'] = safeContentDisposition(disposition);
      return send(res, 200, headers, fs.createReadStream(filePath));
    }

    if (req.method === 'DELETE') {
      if (!verifyHeaderAuth(req, url)) return send(res, 403, {}, 'signature mismatch');
      await fsp.unlink(filePath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      await fsp.unlink(`${filePath}.meta.etag`).catch(() => undefined);
      await fsp.unlink(`${filePath}.meta.type`).catch(() => undefined);
      return send(res, 204, {});
    }

    return send(res, 405, {}, 'method not allowed');
  } catch (error) {
    if (error.code === 'ENOENT') return send(res, 404, {});
    console.error(`[oss-mock] ${req.method} ${url.pathname} failed:`, error);
    return send(res, 500, {}, 'internal error');
  }
});

server.listen(PORT, () => {
  console.log(`[oss-mock] listening on :${PORT}, bucket=${BUCKET}, data=${DATA_DIR}`);
});

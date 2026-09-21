import * as fs from 'node:fs';
import * as https from 'node:https';

export type MonitorStatus = 'online' | 'warning' | 'offline' | 'not_configured' | 'configured';

export type ProbeResult = {
  status: MonitorStatus;
  latency: number | null;
  message: string;
};

type HttpProbeOptions = {
  url?: string;
  /** Connect to this IP while retaining the URL hostname for SNI and Host. */
  connectIp?: string;
  expectedNode?: string;
  requireCloudflare?: boolean;
};

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Probes a fixed, operator-configured HTTPS health endpoint. The admin API
 * never accepts a URL from a browser, so this cannot be used as an SSRF relay.
 */
export async function probeConfiguredHttpsEndpoint(options: HttpProbeOptions): Promise<ProbeResult> {
  if (!options.url) {
    return { status: 'not_configured', latency: null, message: '未配置独立健康探针' };
  }

  let target: URL;
  try {
    target = new URL(options.url);
  } catch {
    return { status: 'warning', latency: null, message: '健康探针地址格式无效' };
  }
  if (target.protocol !== 'https:') {
    return { status: 'warning', latency: null, message: '健康探针必须使用 HTTPS' };
  }

  const startedAt = Date.now();
  try {
    const response = options.connectIp
      ? await requestFixedHttpsEndpoint(target, options.connectIp)
      : await fetch(target, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'User-Agent': 'zhuiyi-control-plane-monitor/1.0' },
      }).then(response => ({
        statusCode: response.status,
        node: response.headers.get('x-zhuiyi-node'),
        cloudflareRay: response.headers.get('cf-ray'),
      }));
    const latency = Date.now() - startedAt;
    const isCloudflareRedirect = options.requireCloudflare
      && response.statusCode >= 300 && response.statusCode < 400 && Boolean(response.cloudflareRay);
    if ((response.statusCode < 200 || response.statusCode >= 300) && !isCloudflareRedirect) {
      return { status: 'warning', latency, message: `健康端点返回 HTTP ${response.statusCode}` };
    }

    const observedNode = response.node;
    if (options.expectedNode && observedNode !== options.expectedNode) {
      return {
        status: 'warning',
        latency,
        message: observedNode
          ? `响应来自意外节点：${observedNode}`
          : '健康端点缺少节点身份响应头',
      };
    }
    if (options.requireCloudflare && !response.cloudflareRay) {
      return { status: 'warning', latency, message: '响应未经过 Cloudflare 边缘网络' };
    }
    return { status: 'online', latency, message: isCloudflareRedirect ? 'Cloudflare 重定向响应正常' : 'HTTPS 健康探针成功' };
  } catch (error) {
    const latency = Date.now() - startedAt;
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    return { status: 'offline', latency, message: isTimeout ? '健康探针超时' : '健康探针连接失败' };
  }
}

function requestFixedHttpsEndpoint(target: URL, connectIp: string): Promise<{ statusCode: number; node: string | null; cloudflareRay: string | null }> {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      servername: target.hostname,
      headers: { Host: target.host, 'User-Agent': 'zhuiyi-control-plane-monitor/1.0' },
      // Node may request `all: true` internally; honor both lookup callback
      // shapes so the selected origin IP is never silently discarded.
      lookup: (_hostname, lookupOptions, callback) => callback(
        null,
        lookupOptions?.all ? [{ address: connectIp, family: 4 }] : connectIp,
        4,
      ),
      rejectUnauthorized: true,
      timeout: REQUEST_TIMEOUT_MS,
    }, (response) => {
      response.resume();
      resolve({
        statusCode: response.statusCode || 0,
        node: typeof response.headers['x-zhuiyi-node'] === 'string' ? response.headers['x-zhuiyi-node'] : null,
        cloudflareRay: typeof response.headers['cf-ray'] === 'string' ? response.headers['cf-ray'] : null,
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });
}

/**
 * A 404 from the proxy's intentionally empty root proves that both its
 * firewall and mTLS handshake accepted the backend client certificate.
 */
export async function probeMtlsProxy(): Promise<ProbeResult> {
  if (process.env.MTLS_PROXY_ENABLED !== 'true') {
    return { status: 'not_configured', latency: null, message: '未启用 mTLS 第三方代理' };
  }

  const proxyBase = process.env.GITHUB_API_PROXY_BASE;
  const certificatePath = process.env.MTLS_CLIENT_CERT_PATH;
  const keyPath = process.env.MTLS_CLIENT_KEY_PATH;
  const serverCaPath = process.env.MTLS_PROXY_SERVER_CA_CERT_PATH || process.env.MTLS_CA_CERT_PATH;
  if (!proxyBase || !certificatePath || !keyPath || !fs.existsSync(certificatePath) || !fs.existsSync(keyPath)) {
    return { status: 'warning', latency: null, message: '代理地址或客户端证书不可用' };
  }

  let target: URL;
  try {
    target = new URL('/__zhuiyi_monitor__', proxyBase);
  } catch {
    return { status: 'warning', latency: null, message: '代理地址格式无效' };
  }
  if (target.protocol !== 'https:') {
    return { status: 'warning', latency: null, message: 'mTLS 代理必须使用 HTTPS' };
  }

  const startedAt = Date.now();
  try {
    const result = await new Promise<ProbeResult>((resolve) => {
      const request = https.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname,
        method: 'GET',
        cert: fs.readFileSync(certificatePath),
        key: fs.readFileSync(keyPath),
        ...(serverCaPath && fs.existsSync(serverCaPath) ? { ca: fs.readFileSync(serverCaPath) } : {}),
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        timeout: REQUEST_TIMEOUT_MS,
      }, (response) => {
        response.resume();
        const latency = Date.now() - startedAt;
        resolve(response.statusCode === 404
          ? { status: 'online', latency, message: 'mTLS 握手与网关防火墙验证成功' }
          : { status: 'warning', latency, message: `代理探针返回 HTTP ${response.statusCode || 0}` });
      });
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', () => resolve({ status: 'offline', latency: Date.now() - startedAt, message: 'mTLS 连接或证书验证失败' }));
      request.end();
    });
    return result;
  } catch {
    return { status: 'warning', latency: Date.now() - startedAt, message: '读取代理证书失败' };
  }
}

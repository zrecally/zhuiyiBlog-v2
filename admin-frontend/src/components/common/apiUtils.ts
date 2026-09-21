import { reportOperationTrace } from './operationTrace';

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  token?: string;
  body?: unknown;
}

type ApiRequestError = Error & { data?: unknown; status?: number };
const STATIC_SITE_GROUP_WINDOW_MS = 15_000;
let staticSiteOperation: { id: string; startedAt: number } | null = null;

const responseMessage = (data: unknown) => (
  data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
    ? data.message
    : ''
);

const responseIndicatesFailure = (data: unknown) => (
  data && typeof data === 'object' && 'success' in data && data.success === false
);

// Safari 在复用 mTLS 控制面连接时，偶发会在请求尚未抵达服务端前报出
// “Load failed”。同步接口是幂等刷新操作，因此仅对这类没有 HTTP 响应的
// 网络异常重试一次；HTTP 4xx/5xx 永不重试，避免掩盖真实业务错误。
const isRetryableNetworkError = (error: unknown) => (
  error instanceof TypeError || (error instanceof Error && /load failed|failed to fetch|network/i.test(error.message))
);

const waitForRetry = () => new Promise<void>((resolve) => window.setTimeout(resolve, 350));

const describeAdminOperation = (url: string, method: string) => {
  const path = url.split('?')[0];
  const labels: Record<string, string> = {
    '/api/admin/health': '读取后端健康状态',
    '/api/admin/nodes/status': '读取节点健康状态',
    '/api/admin/system/config': method === 'PUT' ? '保存系统配置' : '读取系统配置',
    '/api/admin/cache/clear': '清理内存缓存',
    '/api/admin/static-site/status': '北京静态站同步',
    '/api/admin/static-site/publish': '北京静态站同步',
    '/api/admin/danmaku': method === 'DELETE' ? '删除弹幕' : '读取弹幕列表',
    '/api/admin/comments': method === 'DELETE' ? '删除评论' : '读取评论列表',
    '/api/admin/audit-logs': '读取审计日志',
    '/api/admin/access-requests': '读取访问审批请求',
    '/api/admin/stats': '读取站点统计数据',
    '/api/admin/poll': method === 'PUT' ? '保存投票配置' : '读取投票配置',
    '/api/admin/users': '读取用户列表',
    '/api/admin/friends': '读取友邻列表',
    '/api/admin/totp/setup': '生成两步验证绑定信息',
    '/api/admin/totp/verify': '验证两步验证码',
  };
  if (labels[path]) return labels[path];
  if (path.startsWith('/api/admin/danmaku/')) return '删除弹幕';
  if (path.startsWith('/api/admin/comments/')) return '删除评论';
  if (path.startsWith('/api/admin/sync/')) {
    const module = path.split('/').pop() || '';
    const syncLabels: Record<string, string> = {
      users: '飞书用户数据',
      admins: '管理员白名单',
      posts: '飞书文章数据',
      comments: '评论数据',
      config: '系统配置与国际化',
      blacklist: '访问黑名单',
      'article-access': '一次性文章密码',
    };
    return `同步${syncLabels[module] || '业务数据'}`;
  }
  return `${method} ${path}`;
};

export const authorizationHeaders = (token?: string) => {
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export const apiRequest = async <T>(url: string, options: ApiOptions = {}): Promise<T> => {
  const { token, body, headers, ...rest } = options;

  const defaultHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined && !(body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  const fetchOptions: RequestInit = {
    ...rest,
    headers: {
      ...defaultHeaders,
      ...headers,
    },
  };

  if (body !== undefined) {
    fetchOptions.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  const method = (fetchOptions.method || 'GET').toUpperCase();
  const operationName = describeAdminOperation(url, method);
  const startedAt = Date.now();
  const staticSiteRequest = url.split('?')[0].startsWith('/api/admin/static-site/');
  let operationId = `api-${startedAt}-${Math.floor(Math.random() * 1000)}`;
  if (staticSiteRequest) {
    if (staticSiteOperation && startedAt - staticSiteOperation.startedAt < STATIC_SITE_GROUP_WINDOW_MS) {
      operationId = staticSiteOperation.id;
    } else {
      operationId = `static-site-${startedAt}-${Math.floor(Math.random() * 1000)}`;
      staticSiteOperation = { id: operationId, startedAt };
    }
  }
  reportOperationTrace({
    level: 'info',
    source: '控制面',
    message: operationName,
    detail: `请求已发送 · ${method} ${url}`,
    operationId,
    phase: 'start',
  });

  try {
    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (firstError) {
      if (!isRetryableNetworkError(firstError)) throw firstError;

      reportOperationTrace({
        level: 'info',
        source: '控制面',
        message: operationName,
        detail: '连接短暂中断，正在自动重试一次…',
        operationId,
        phase: 'retry',
      });
      await waitForRetry();
      response = await fetch(url, fetchOptions);
    }
    const elapsed = Date.now() - startedAt;
    const responseData = await response.json().catch(() => null);

    if (!response.ok) {
      // 修复 H7: 丢弃了后端的错误数据结构导致 TOTP 无法正常流转
      // 将整个 errorData 包装成错误抛出，保留 errorData 对象
      const message = responseMessage(responseData) || '网络请求未成功完成';
      reportOperationTrace({
        level: 'error',
        source: '控制面',
        message: operationName,
        detail: `执行失败：${message} · ${elapsed}ms`,
        operationId,
        phase: 'response',
      });
      const err: ApiRequestError = new Error(message);
      err.data = responseData;
      err.status = response.status;
      throw err;
    }

    const failedBusinessResult = responseIndicatesFailure(responseData);
    const message = responseMessage(responseData);
    reportOperationTrace({
      level: failedBusinessResult ? 'error' : 'success',
      source: '控制面',
      message: operationName,
      detail: failedBusinessResult
        ? `执行失败：${message || '后端未说明原因'} · ${elapsed}ms`
        : `执行成功${message ? `：${message}` : ''} · ${elapsed}ms`,
      operationId,
      phase: 'response',
    });
    return responseData as T;
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) throw error;

    const message = error instanceof Error ? error.message : '网络连接失败';
    reportOperationTrace({
      level: 'error',
      source: '控制面',
      message: operationName,
      detail: `执行失败：网络错误 · ${message} · ${Date.now() - startedAt}ms`,
      operationId,
      phase: 'response',
    });
    throw error;
  }
};

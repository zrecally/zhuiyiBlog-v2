export const isStaticSite = import.meta.env.VITE_SITE_MODE?.trim().toLowerCase() === 'static';

// 北京站只提供只读快照，不承载认证或其他业务 API。静态构建中的
// 登录入口必须显式回到香港动态主站，不能使用当前 cn 域名的相对路径。
const configuredDynamicSiteUrl = import.meta.env.VITE_DYNAMIC_SITE_URL?.trim();
const dynamicSiteUrl = (configuredDynamicSiteUrl || 'https://www.hizhuiyi.cn').replace(/\/+$/, '');

export const authApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');

  if (isStaticSite) return `${dynamicSiteUrl}${normalizedPath}`;
  return `${apiBaseUrl || ''}${normalizedPath}`;
};

const configuredStaticDataBase = import.meta.env.VITE_STATIC_DATA_BASE?.trim() || '/data/live';
const staticDataBase = configuredStaticDataBase.replace(/\/+$/, '');

export const staticDataUrl = (fileName: string) => (
  `${staticDataBase}/${fileName.replace(/^\/+/, '')}`
);

export const fetchStaticSnapshot = async <T>(fileName: string): Promise<T> => {
  const response = await fetch(staticDataUrl(fileName), {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Static snapshot ${fileName} returned HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (payload && typeof payload === 'object') {
    const envelope = payload as { success?: boolean; data?: T; message?: string };
    if (envelope.success === false) {
      throw new Error(envelope.message || `Static snapshot ${fileName} is unavailable`);
    }
    if ('data' in envelope) {
      return envelope.data as T;
    }
  }

  return payload as T;
};

export const isApiUrl = (value: string): boolean => {
  try {
    const url = new URL(value, window.location.origin);
    return url.pathname === '/api' || url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
};

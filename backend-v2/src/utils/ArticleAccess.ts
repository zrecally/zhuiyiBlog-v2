import { createHash, createHmac } from 'node:crypto';

export type ArticleAccessMode = 'public' | 'approval' | 'password';

const textValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        return typeof record.name === 'string' ? record.name : typeof record.text === 'string' ? record.text : '';
      }
      return '';
    }).join('').trim();
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return typeof record.name === 'string' ? record.name.trim() : typeof record.text === 'string' ? record.text.trim() : '';
  }
  return '';
};

export const resolveArticleAccessMode = (
  value: unknown,
  legacyPrivate: boolean,
): ArticleAccessMode => {
  const normalized = textValue(value).toLocaleLowerCase();
  if (normalized === 'password' || normalized === '密码') return 'password';
  if (normalized === 'approval' || normalized === '申请') return 'approval';
  if (normalized === 'public' || normalized === '公开') return 'public';
  return legacyPrivate ? 'approval' : 'public';
};

export const normalizeArticlePassword = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

export const validateArticlePassword = (password: string): string | null => {
  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes < 8) return '一次性密码至少需要 8 个字节';
  if (bytes > 72) return '一次性密码不能超过 72 个字节';
  return null;
};

export const articleCodeDigest = (pepper: string, environment: string, password: string): string => (
  createHmac('sha256', pepper).update(`${environment}\0${password}`, 'utf8').digest('hex')
);

export const articleIpHash = (pepper: string, ip: string): string => (
  createHmac('sha256', pepper).update(`ip\0${ip}`, 'utf8').digest('hex')
);

export const articleSessionTokenHash = (token: string): string => (
  createHash('sha256').update(token, 'utf8').digest('hex')
);

export const maskIpForAudit = (ip: string): string => {
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':')}:…`;
  }
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : 'unknown';
};

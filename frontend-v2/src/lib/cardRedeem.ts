export type CardRedeemSuccess = {
  success: true;
  productName: string;
  download: {
    fileName: string;
    mediaType: string;
    fileSize: number;
    url: string;
    expiresAt: string;
  };
  replayed?: boolean;
};

export type CardRedeemFailure = {
  success: false;
  message: string;
};

export type CardRedeemResponse = CardRedeemSuccess | CardRedeemFailure;

export const isCardExperience = (): boolean => {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/card' || path === '/redeem') return true;

  const configuredHosts = (import.meta.env.VITE_CARD_HOSTS || 'card.hizhuiyi.cn,card.localhost')
    .split(',')
    .map((host: string) => host.trim().toLocaleLowerCase())
    .filter(Boolean);
  return configuredHosts.includes(window.location.hostname.toLocaleLowerCase());
};

export const createRedeemRequestId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

const RETRY_STORAGE_KEY = 'zhuiyi_card_redeem_retry_v1';
const RETRY_STORAGE_MS = 30 * 60 * 1000;

const codeFingerprint = async (code: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeCardCode(code)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

/** Preserve only a one-way code fingerprint and request ID across a page reload. */
export const getOrCreateRedeemRequestId = async (code: string): Promise<string> => {
  const fingerprint = await codeFingerprint(code);
  try {
    const saved = JSON.parse(sessionStorage.getItem(RETRY_STORAGE_KEY) || 'null') as {
      fingerprint?: unknown;
      requestId?: unknown;
      expiresAt?: unknown;
    } | null;
    if (
      saved
      && saved.fingerprint === fingerprint
      && typeof saved.requestId === 'string'
      && typeof saved.expiresAt === 'number'
      && saved.expiresAt > Date.now()
    ) return saved.requestId;
  } catch {
    // Storage can be disabled; in-memory retry behavior still works.
  }
  const requestId = createRedeemRequestId();
  try {
    sessionStorage.setItem(RETRY_STORAGE_KEY, JSON.stringify({
      fingerprint,
      requestId,
      expiresAt: Date.now() + RETRY_STORAGE_MS,
    }));
  } catch {
    // Storage can be disabled; do not block redemption.
  }
  return requestId;
};

// 卡密规则 v2（与后端 CardCodeRule.ts 保持一致）：归一化后 20 位字母数字，区分大小写。
const CARD_CODE_PATTERN = /^[A-Za-z0-9]{20}$/;

export const normalizeCardCode = (value: string): string => (
  value.trim().replace(/[\s-]+/g, '')
);

/** 提交前的格式预检（仅 UX），服务端校验仍是唯一权威。 */
export const isPlausibleCardCode = (value: string): boolean => (
  CARD_CODE_PATTERN.test(normalizeCardCode(value))
);

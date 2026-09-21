import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { CARD_CODE_RULE_MESSAGE, isValidCardCode } from './CardCodeRule';

type CardDownloadTicketPayload = {
  version: 1;
  cardId: number;
  expiresAt: number;
  ipHash: string;
};

export const normalizeCardCode = (value: unknown): string => (
  typeof value === 'string'
    ? value.trim().replace(/[\s-]+/g, '')
    : ''
);

export const validateCardCode = (code: string): string | null => (
  isValidCardCode(code) ? null : CARD_CODE_RULE_MESSAGE
);

export const validateRedeemRequestId = (value: unknown): value is string => (
  typeof value === 'string' && /^[A-Za-z0-9-]{16,80}$/.test(value)
);

export const cardCodeDigest = (secret: string, environment: string, code: string): string => (
  createHmac('sha256', secret).update(`card-code\0${environment}\0${code}`, 'utf8').digest('hex')
);

export const cardRequestDigest = (secret: string, environment: string, requestId: string): string => (
  createHmac('sha256', secret).update(`card-request\0${environment}\0${requestId}`, 'utf8').digest('hex')
);

export const cardIssueRequestFingerprint = (
  secret: string,
  environment: string,
  payload: { ossKey: string; productName: string; count: number; expiresInDays?: number | null },
): string => createHmac('sha256', secret)
  .update(`card-issue-request\0${environment}\0${JSON.stringify(payload)}`, 'utf8')
  .digest('hex');

const cardIssueEncryptionKey = (secret: string): Buffer => createHash('sha256')
  .update(`card-issue-receipt\0${secret}`, 'utf8')
  .digest();

/**
 * Keep a recoverable, authenticated copy of a batch response so an administrator
 * can retry the same request after a transport failure. The GC clears it after
 * the configured retention window; individual CardCode rows never store plaintext.
 */
export const encryptCardIssueCodes = (
  secret: string,
  environment: string,
  requestId: string,
  codes: string[],
): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cardIssueEncryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(`${environment}\0${requestId}`, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(codes), 'utf8'),
    cipher.final(),
  ]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
};

export const decryptCardIssueCodes = (
  secret: string,
  environment: string,
  requestId: string,
  ciphertext: string,
): string[] | null => {
  try {
    const [version, ivRaw, tagRaw, encryptedRaw, extra] = ciphertext.split('.');
    if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw || extra) return null;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      cardIssueEncryptionKey(secret),
      Buffer.from(ivRaw, 'base64url'),
    );
    decipher.setAAD(Buffer.from(`${environment}\0${requestId}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    const parsed = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64url')),
      decipher.final(),
    ]).toString('utf8'));
    if (!Array.isArray(parsed) || parsed.some(code => typeof code !== 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const cardIpHash = (secret: string, ip: string): string => (
  createHmac('sha256', secret).update(`card-ip\0${ip}`, 'utf8').digest('hex')
);

export const createCardDownloadTicket = (
  secret: string,
  payload: Omit<CardDownloadTicketPayload, 'version'>,
): string => {
  const encoded = Buffer.from(JSON.stringify({ version: 1, ...payload }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(`card-download\0${encoded}`, 'utf8').digest('base64url');
  return `${encoded}.${signature}`;
};

export const verifyCardDownloadTicket = (secret: string, token: string): CardDownloadTicketPayload | null => {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(`card-download\0${encoded}`, 'utf8').digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<CardDownloadTicketPayload>;
    if (
      payload.version !== 1
      || !Number.isSafeInteger(payload.cardId)
      || Number(payload.cardId) < 1
      || !Number.isSafeInteger(payload.expiresAt)
      || Number(payload.expiresAt) <= Date.now()
      || typeof payload.ipHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(payload.ipHash)
    ) return null;
    return payload as CardDownloadTicketPayload;
  } catch {
    return null;
  }
};

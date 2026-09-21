const STORAGE_KEY = 'zhuiyi_article_access_hints';

type GrantHints = Record<string, string>;

const readHints = (): GrantHints => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as GrantHints;
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed).filter(([, expiresAt]) => Date.parse(expiresAt) > now),
    );
  } catch {
    return {};
  }
};

export const hasArticleAccessHint = (postId: string): boolean => Boolean(readHints()[postId]);

export const rememberArticleAccessHint = (postId: string, expiresAt: unknown): void => {
  if (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) return;
  const hints = readHints();
  hints[postId] = expiresAt;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hints));
};

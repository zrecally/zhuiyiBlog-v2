export type CommentReplyMetadata = {
  parentId: string;
  replyTo?: string;
};

const COMMENT_META_PATTERN = /<!--\s*meta:([\s\S]*?)\s*-->/;

export const parseCommentReplyMetadata = (content: string): CommentReplyMetadata | null => {
  const match = content.match(COMMENT_META_PATTERN);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as { parentId?: unknown; replyTo?: unknown };
    if (typeof value.parentId !== 'string' && typeof value.parentId !== 'number') return null;
    const parentId = String(value.parentId).trim();
    if (!parentId) return null;
    return {
      parentId,
      replyTo: typeof value.replyTo === 'string' ? value.replyTo.trim() : undefined,
    };
  } catch {
    return null;
  }
};

export const stripCommentReplyMetadata = (content: string): string => (
  content.replace(COMMENT_META_PATTERN, '').trim()
);

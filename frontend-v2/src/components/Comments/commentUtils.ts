import { createAvatar } from '@dicebear/core';
import { pixelArt } from '@dicebear/collection';
import { Comment, CommentSortOrder, ParsedComment } from './commentTypes';

const POEMS = [
  '醉后不知天在水，满船清梦压星河',
  '纸上得来终觉浅，绝知此事要躬行',
  '山重水复疑无路，柳暗花明又一村',
  '长风破浪会有时，直挂云帆济沧海',
  '人生若只如初见，何事秋风悲画扇',
  '此情可待成追忆，只是当时已惘然',
  '落霞与孤鹜齐飞，秋水共长天一色',
  '大漠孤烟直，长河落日圆',
  '但愿人长久，千里共婵娟',
  '疏影横斜水清浅，暗香浮动月黄昏',
];

const COMMENT_META_PATTERN = /<!--\s*meta:(.*?)\s*-->/;

export const getRandomPoem = () => POEMS[Math.floor(Math.random() * POEMS.length)];

export const getXianxiaAvatar = (seed: string) => {
  const sum = (seed || '').split('').reduce((total, character) => total + character.charCodeAt(0), 0);
  return `/avatars/xianxia-${(sum % 5) + 1}.png`;
};

const pixelAvatarCache = new Map<string, string>();

export const getPixelAvatar = (seed: string) => {
  const key = seed || '';
  const cached = pixelAvatarCache.get(key);
  if (cached) return cached;
  // pixelArt 风格为 CC0 许可，本地生成 data URI，无外部请求
  const uri = createAvatar(pixelArt, { seed: key }).toDataUri();
  pixelAvatarCache.set(key, uri);
  return uri;
};

export const parseCommentContent = (rawContent: string) => {
  const match = rawContent.match(COMMENT_META_PATTERN);
  if (!match) return { content: rawContent };

  try {
    const metadata = JSON.parse(match[1]) as { parentId?: string | number; replyTo?: string };
    return {
      content: rawContent.replace(COMMENT_META_PATTERN, ''),
      parentId: metadata.parentId,
      replyTo: metadata.replyTo,
    };
  } catch {
    return { content: rawContent };
  }
};

export const formatCommentDate = (dateString: string) => new Date(dateString).toLocaleDateString('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const compareComments = (sortOrder: CommentSortOrder) => (left: ParsedComment, right: ParsedComment) => {
  if (sortOrder === 'desc') return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  if (sortOrder === 'asc') return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

  const likesDifference = (right.likes || 0) - (left.likes || 0);
  return likesDifference || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
};

export const buildCommentTree = (comments: Comment[], sortOrder: CommentSortOrder): ParsedComment[] => {
  const commentsById = new Map<string, ParsedComment>();
  const roots: ParsedComment[] = [];

  const parsedComments = comments.map(comment => {
    const metadata = parseCommentContent(comment.content);
    const rawParentId = comment.parentId || metadata.parentId;
    const parsed: ParsedComment = {
      ...comment,
      content: metadata.content,
      parentId: rawParentId ? String(rawParentId) : undefined,
      replyTo: metadata.replyTo,
      children: [],
    };
    commentsById.set(String(comment.id), parsed);
    return parsed;
  });

  parsedComments.forEach(comment => {
    if (!comment.parentId) {
      roots.push(comment);
      return;
    }

    // Orphaned replies remain hidden, matching the previous CMS-delete behavior.
    commentsById.get(String(comment.parentId))?.children.push(comment);
  });

  roots.sort(compareComments(sortOrder));
  parsedComments.forEach(comment => {
    comment.children.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  });

  return roots;
};

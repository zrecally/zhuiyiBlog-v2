export interface CommentUser {
  username: string;
  avatar: string | null;
  avatarDark?: string | null;
}

export interface Comment {
  id: number | string;
  postId: string;
  content: string;
  user: CommentUser;
  createdAt: string;
  likes?: number;
  dislikes?: number;
  repliesCount?: number;
  parentId?: string | number;
}

export interface ParsedComment extends Comment {
  replyTo?: string;
  children: ParsedComment[];
}

export interface CurrentCommentUser extends CommentUser {
  role?: string;
}

export type CommentSortOrder = 'desc' | 'asc' | 'best';

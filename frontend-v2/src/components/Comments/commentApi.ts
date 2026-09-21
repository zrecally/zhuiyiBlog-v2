import { Comment, CurrentCommentUser } from './commentTypes';
import { apiRequest } from '../common/apiUtils';

export const getCommentAuthToken = () => localStorage.getItem('user_token');

export const getCurrentCommentUser = async (token: string) => {
  return apiRequest<{ success: boolean; user?: CurrentCommentUser }>('/api/v1/user/me', { token });
};

export const getArticleLikes = async (postId: string, token: string | null) => {
  return apiRequest<{ success: boolean; count: number; hasLiked: boolean }>(`/api/v1/posts/${postId}/likes`, { token: token || undefined });
};

export const toggleArticleLike = async (postId: string, token: string) => {
  return apiRequest<{ success: boolean; count: number; hasLiked: boolean; message?: string }>(`/api/v1/posts/${postId}/like`, {
    method: 'POST',
    token
  });
};

export const getComments = async (postId: string) => {
  return apiRequest<{ success: boolean; data: Comment[] }>(`/api/v1/comments/${postId}`, { cache: 'no-store' });
};

export const createComment = async (postId: string, content: string, token: string) => {
  return apiRequest<{ success: boolean; message?: string }>('/api/v1/comments', {
    method: 'POST',
    token,
    body: { postId, content },
  });
};

export const sendCommentMagicLink = async (email: string, returnUrl: string) => {
  return apiRequest<{ success: boolean; message?: string }>('/api/v1/auth/magic-link', {
    method: 'POST',
    body: { email, returnUrl },
  });
};

export const performCommentAction = async (
  commentId: string | number,
  action: 'like' | 'dislike',
  articleId: string,
  token: string | null,
) => {
  return apiRequest<{ success: boolean; count?: number; message?: string }>(`/api/v1/comments/${commentId}/action`, {
    method: 'POST',
    token: token || undefined,
    body: { action, articleId },
  });
};

export const removeComment = async (commentId: string | number, token: string) => {
  return apiRequest<{ success: boolean; message?: string }>(`/api/v1/comments/${commentId}`, {
    method: 'DELETE',
    token,
  });
};

export const uploadCommentImage = async (file: File, token: string) => {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest<{ success: boolean; url: string; message?: string }>('/api/v1/image/comment-upload', {
    method: 'POST',
    token,
    body: formData,
  });
};

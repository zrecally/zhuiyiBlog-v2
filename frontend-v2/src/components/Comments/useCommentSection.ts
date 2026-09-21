import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../Toast';
import {
  getArticleLikes,
  getCommentAuthToken,
  getComments,
  getCurrentCommentUser,
  performCommentAction,
  removeComment,
  sendCommentMagicLink,
  toggleArticleLike,
  uploadCommentImage,
} from './commentApi';
import { Comment, CommentSortOrder, CurrentCommentUser } from './commentTypes';
import { buildCommentTree, getRandomPoem } from './commentUtils';

interface StreamComment extends Comment {
  authorName?: string;
  username?: string;
}

export const useCommentSection = (postId: string) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyContent, setReplyContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [sortOrder, setSortOrder] = useState<CommentSortOrder>('desc');
  const [isExpanded, setIsExpanded] = useState(false);
  const [forceExpanded, setForceExpanded] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentCommentUser | null>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [activeReplyId, setActiveReplyId] = useState<number | string | null>(null);
  const [randomPoem, setRandomPoem] = useState('');
  const [articleLikes, setArticleLikes] = useState(0);
  const [hasLikedArticle, setHasLikedArticle] = useState(false);
  const [isLikingArticle, setIsLikingArticle] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [atMenuPos, setAtMenuPos] = useState({ top: 0, left: 0 });
  const [atFilter, setAtFilter] = useState('');
  const [showMagicInput, setShowMagicInput] = useState(false);
  const [magicEmail, setMagicEmail] = useState('');
  const [isSendingMagic, setIsSendingMagic] = useState(false);
  const [magicMessage, setMagicMessage] = useState('');
  const [countdown, setCountdown] = useState(0);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const replyEditorRef = useRef<HTMLDivElement>(null);
  const { showToast, showConfirm } = useToast();

  const uniqueUsernames = useMemo(() => {
    const names = new Set<string>();
    comments.forEach((comment) => {
      if (comment.user?.username) names.add(comment.user.username);
    });
    return Array.from(names);
  }, [comments]);

  const commentTree = useMemo(
    () => buildCommentTree(comments, sortOrder),
    [comments, sortOrder],
  );

  const fetchComments = useCallback(async () => {
    try {
      const data = await getComments(postId);
      if (data.success) setComments(data.data);
    } catch (error) {
      console.error('获取评论失败', error);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  const fetchArticleLikes = useCallback(async () => {
    try {
      const data = await getArticleLikes(postId, getCommentAuthToken());
      if (data.success) {
        setArticleLikes(data.count);
        setHasLikedArticle(data.hasLiked);
      }
    } catch (error) {
      console.error('获取文章点赞失败', error);
    }
  }, [postId]);

  useEffect(() => {
    setRandomPoem(getRandomPoem());
    const closeEmojiPicker = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', closeEmojiPicker);
    return () => document.removeEventListener('mousedown', closeEmojiPicker);
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    const checkLoginStatus = async () => {
      const token = getCommentAuthToken();
      setIsLoggedIn(Boolean(token));
      if (!token) {
        setCurrentUser(null);
        return;
      }
      try {
        const data = await getCurrentCommentUser(token);
        setCurrentUser(data.success ? data.user || null : null);
      } catch (error) {
        console.error('获取当前用户信息失败:', error);
        setCurrentUser(null);
      }
    };

    void checkLoginStatus();
    void fetchComments();
    void fetchArticleLikes();
    window.addEventListener('user-login-success', checkLoginStatus);
    window.addEventListener('admin-login-success', checkLoginStatus);
    window.addEventListener('logout', checkLoginStatus);
    return () => {
      window.removeEventListener('user-login-success', checkLoginStatus);
      window.removeEventListener('admin-login-success', checkLoginStatus);
      window.removeEventListener('logout', checkLoginStatus);
    };
  }, [fetchArticleLikes, fetchComments, postId]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/v1/comments/stream/${postId}`);
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string; comment?: StreamComment };
        if (data.type !== 'new_comment' || !data.comment) return;
        const incoming = data.comment;
        setComments((current) => {
          if (current.some((comment) => comment.id === incoming.id)) return current;
          return [{
            ...incoming,
            user: incoming.user || {
              username: incoming.authorName || incoming.username || '匿名用户',
              avatar: null,
              avatarDark: null,
            },
          }, ...current];
        });
      } catch (error) {
        console.error('SSE 消息解析失败', error);
      }
    };
    eventSource.onerror = (error) => {
      console.warn('SSE 连接断开或出错，正在尝试重连...', error);
    };
    return () => eventSource.close();
  }, [postId]);

  const escapeHtml = (unsafe: string) => {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const formatText = (command: string, isReply: boolean, value?: string) => {
    const ref = isReply ? replyEditorRef : editorRef;
    const setter = isReply ? setReplyContent : setNewComment;
    if (!ref.current) return;
    ref.current.focus();
    if (command === 'formatBlock' && (value === 'pre' || value === 'blockquote')) {
      const selection = window.getSelection();
      if (selection?.rangeCount) {
        const text = selection.getRangeAt(0).toString();
        const tag = value === 'pre' ? 'code' : 'blockquote';
        const placeholder = value === 'pre' ? '代码写这里...' : '引用内容...';
        // 对选中的文本进行 HTML 转义，防止直接插入时产生 XSS
        const safeText = escapeHtml(text || placeholder);
        document.execCommand('insertHTML', false, `<br><${tag}>\n${safeText}\n</${tag}><br>`);
      }
    } else {
      document.execCommand(command, false, value);
    }
    setter(ref.current.innerHTML);
  };

  const handleEmojiClick = (emoji: { emoji: string }) => {
    formatText('insertText', activeReplyId !== null, emoji.emoji);
    setShowEmojiPicker(false);
  };

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    const token = getCommentAuthToken();
    if (!token) {
      showToast({ message: '请先登录再上传图片呀', type: 'error' });
      return;
    }
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) {
      showToast({ message: '仅支持 JPEG、PNG、GIF 或 WebP 图片', type: 'error' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast({ message: '图片大小不能超过 2MB 呀', type: 'error' });
      return;
    }

    setIsUploadingImage(true);
    try {
      const data = await uploadCommentImage(file, token);
      if (!data.success || !data.url) {
        throw new Error(data.message || '图片上传失败');
      }
      const image = `<img src="${data.url}" alt="uploaded-image" style="max-width: 100%; max-height: 200px; border-radius: 8px; margin: 8px 0; object-fit: contain;" />`;
      formatText('insertHTML', activeReplyId !== null, image);
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : '图片上传失败，请重试', type: 'error' });
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleAtUser = (username: string) => {
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        range.setStart(range.startContainer, Math.max(0, range.startOffset - atFilter.length - 1));
        range.deleteContents();
      }
    }
    // 对用户名进行转义，防止恶意用户名注入 XSS
    const safeUsername = escapeHtml(username);
    formatText('insertHTML', activeReplyId !== null, `<span style="color: #C83C23; font-weight: 500;">@${safeUsername}</span>&nbsp;`);
    setShowAtMenu(false);
    setAtFilter('');
  };

  const handleLikeArticle = async () => {
    if (isLikingArticle) return;
    const token = getCommentAuthToken();
    if (!token) {
      showToast({ message: '请先登录', type: 'error' });
      setIsExpanded(true);
      return;
    }
    setIsLikingArticle(true);
    try {
      const data = await toggleArticleLike(postId, token);
      if (data.success) {
        setArticleLikes(data.count);
        setHasLikedArticle(data.hasLiked);
        showToast({ message: data.hasLiked ? '收藏成功！' : '已取消收藏', type: 'success' });
      } else {
        showToast({ message: data.message || '操作失败', type: 'error' });
      }
    } catch (error) {
      console.error('点赞/收藏文章失败', error);
      showToast({ message: '网络错误，请稍后重试', type: 'error' });
    } finally {
      setIsLikingArticle(false);
    }
  };

  const handleSendMagicLink = async (event: FormEvent) => {
    event.preventDefault();
    if (countdown > 0) return;
    if (!magicEmail.trim() || !magicEmail.includes('@')) {
      setMagicMessage('请输入有效的邮箱');
      window.setTimeout(() => setMagicMessage(''), 3000);
      return;
    }
    setIsSendingMagic(true);
    setMagicMessage('');
    try {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('scroll', Math.round(window.scrollY).toString());
      const data = await sendCommentMagicLink(magicEmail, currentUrl.pathname + currentUrl.search);
      setMagicMessage(data.success ? '链接已发送至邮箱，请查收' : data.message || '发送失败');
      if (data.success) setCountdown(60);
      window.setTimeout(() => setMagicMessage(''), data.success ? 5000 : 3000);
    } catch {
      setMagicMessage('网络错误');
      window.setTimeout(() => setMagicMessage(''), 3000);
    } finally {
      setIsSendingMagic(false);
    }
  };

  const handleAction = async (commentId: string | number, action: 'like' | 'dislike') => {
    try {
      const data = await performCommentAction(commentId, action, postId, getCommentAuthToken());
      if (!data.success) {
        showToast({ message: data.message || '操作失败', type: 'error' });
        return;
      }
      setComments((current) => current.map((comment) => comment.id === commentId ? {
        ...comment,
        likes: action === 'like' ? data.count : comment.likes,
        dislikes: action === 'dislike' ? data.count : comment.dislikes,
      } : comment));
    } catch (error) {
      console.error(error);
      showToast({ message: '网络错误', type: 'error' });
    }
  };

  const handleDeleteComment = (commentId: string | number) => {
    showConfirm({
      message: '确定要删除这条评论吗？删除后不可恢复。',
      onConfirm: async () => {
        const token = getCommentAuthToken();
        if (!token) {
          showToast({ message: '请先登录', type: 'error' });
          return;
        }
        try {
          const data = await removeComment(commentId, token);
          if (data.success) {
            showToast({ message: '评论已删除', type: 'success' });
            setComments((current) => current.filter((comment) => comment.id !== commentId));
          } else {
            showToast({ message: data.message || '删除失败', type: 'error' });
          }
        } catch (error) {
          console.error('删除评论错误', error);
          showToast({ message: '网络错误，删除失败', type: 'error' });
        }
      },
    });
  };

  return {
    activeReplyId, articleLikes, atFilter, atMenuPos, commentTree, comments,
    countdown, currentUser, editorRef, emojiPickerRef, fetchComments,
    fileInputRef, forceExpanded, formatText, handleAction, handleAtUser,
    handleDeleteComment, handleEmojiClick, handleImageUpload, handleLikeArticle,
    handleSendMagicLink, hasLikedArticle, isExpanded, isLikingArticle,
    isLoggedIn, isSendingMagic, isSubmitting, isUploadingImage, loading,
    magicEmail, magicMessage, newComment, randomPoem, replyContent,
    replyEditorRef, setActiveReplyId, setAtFilter, setAtMenuPos, setCurrentUser,
    setForceExpanded, setIsExpanded, setIsSubmitting, setMagicEmail,
    setNewComment, setReplyContent, setShowAtMenu, setShowEditProfile,
    setShowEmojiPicker, setSortOrder, showAtMenu, showEditProfile,
    showEmojiPicker, showMagicInput, showToast, sortOrder, uniqueUsernames,
    setShowMagicInput,
  };
};

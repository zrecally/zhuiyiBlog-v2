import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../Toast';
import { authApiUrl } from '../../lib/siteMode';
import {
  DashboardModal,
  FeedbackType,
  FriendApplicationData,
  UserNotification,
} from './feedbackTypes';

const emptyFriendApplication: FriendApplicationData = {
  name: '',
  link: '',
  avatar: '',
  description: '',
};

export const useFeedbackFloat = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isFriendApplyOpen, setIsFriendApplyOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<DashboardModal>(null);
  const [type, setType] = useState<FeedbackType>('bug');
  const [content, setContent] = useState('');
  const [friendApplyData, setFriendApplyData] = useState<FriendApplicationData>(emptyFriendApplication);
  const [isSubmittingFriend, setIsSubmittingFriend] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [showInitialHint, setShowInitialHint] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showInlineLogin, setShowInlineLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isBanned, setIsBanned] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    // 检查是否是移动端
    const checkMobile = () => {
      // 仅用于触发判断，不需要保存到 state 中
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);

    let hintTimer: number;
    let guideTimer: number;

    // 如果是移动端，直接标记为已引导过，不触发首屏动画
    const guided = localStorage.getItem('zhuiyi_guided');
    if (!guided && window.innerWidth >= 768) {
      setIsFirstVisit(true);
      setShowInitialHint(true);
      // 停留 3.5 秒后，开始移动回右下角
      guideTimer = window.setTimeout(() => {
        setIsFirstVisit(false);
        localStorage.setItem('zhuiyi_guided', 'true');
        // 移动回去后再过几秒隐藏提示
        hintTimer = window.setTimeout(() => setShowInitialHint(false), 5000);
      }, 3500);
    } else if (!guided && window.innerWidth < 768) {
      // 移动端不展示动画，但要标记已访问，防止切换到 PC 后再弹出
      localStorage.setItem('zhuiyi_guided', 'true');
      hintTimer = window.setTimeout(() => setShowInitialHint(false), 7000);
    } else {
      hintTimer = window.setTimeout(() => setShowInitialHint(false), 7000);
    }

    const checkLogin = () => {
      const token = localStorage.getItem('user_token');
      const bannedInfo = localStorage.getItem('banned_info');
      setIsLoggedIn(Boolean(token) && !bannedInfo);
      setIsBanned(Boolean(bannedInfo));
    };
    const handleBan = () => {
      setIsLoggedIn(false);
      setIsBanned(true);
    };

    checkLogin();
    window.addEventListener('admin-login-success', checkLogin);
    window.addEventListener('login-success', checkLogin);
    window.addEventListener('logout', checkLogin);
    window.addEventListener('ip-banned', handleBan);
    return () => {
      window.clearTimeout(hintTimer);
      if (guideTimer) window.clearTimeout(guideTimer);
      window.removeEventListener('admin-login-success', checkLogin);
      window.removeEventListener('login-success', checkLogin);
      window.removeEventListener('logout', checkLogin);
      window.removeEventListener('ip-banned', handleBan);
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  const fetchNotifications = useCallback(async () => {
    const token = localStorage.getItem('user_token');
    if (!token) return;
    try {
      const response = await fetch('/api/v1/notifications', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setNotifications(data.data);
        setUnreadCount(data.unreadCount);
      }
    } catch (error) {
      console.error('获取通知失败', error);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setUnreadCount(0);
      setNotifications([]);
      return;
    }

    void fetchNotifications();
    const token = localStorage.getItem('user_token');
    if (!token) return;

    const socketBaseUrl = import.meta.env.VITE_SOCKET_BASE_URL || '';
    const eventSource = new EventSource(
      `${socketBaseUrl}/api/v1/notifications/stream?token=${token}&_t=${Date.now()}`,
    );
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'connected') void fetchNotifications();
      } catch {
        if (event.data === 'new_notification') void fetchNotifications();
      }
    };
    eventSource.onerror = (error) => {
      console.error('Notification SSE connection error, attempting to reconnect...', error);
    };
    const fallbackRefresh = window.setInterval(() => void fetchNotifications(), 30_000);
    return () => {
      window.clearInterval(fallbackRefresh);
      eventSource.close();
    };
  }, [fetchNotifications, isLoggedIn]);

  const handleMarkAsRead = async (ids?: number[]) => {
    const token = localStorage.getItem('user_token');
    if (!token) return;
    try {
      const body = ids?.length ? { notificationIds: ids } : { all: true };
      const response = await fetch('/api/v1/notifications/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (data.success) await fetchNotifications();
    } catch (error) {
      console.error('标记已读失败', error);
    }
  };

  const handleToggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
    if (isMenuOpen) {
      setShowInlineLogin(false);
      setEmail('');
    }
    setHasInteracted(true);
  };

  const handleSendMagicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      showToast({ message: '请输入有效的邮箱地址', type: 'error' });
      return;
    }
    setIsSending(true);
    try {
      const returnUrl = window.location.pathname + window.location.search;
      const response = await fetch(authApiUrl('/api/v1/auth/magic-link'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, returnUrl }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        showToast({ message: '登录链接已发送至邮箱，请查收', type: 'success' });
        setShowInlineLogin(false);
        setIsMenuOpen(false);
        setEmail('');
      } else {
        showToast({ message: data.message || '发送失败，请稍后重试', type: 'error' });
      }
    } catch {
      showToast({ message: '网络错误，暂无法发送', type: 'error' });
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!content.trim()) {
      showToast({ message: '请输入反馈内容', type: 'error' });
      return;
    }
    try {
      const token = localStorage.getItem('user_token');
      const response = await fetch('/api/v1/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type, content }),
      });
      const data = await response.json();
      if (data.success) {
        showToast({ message: '提交成功，感谢您的反馈！', type: 'success' });
        setIsFeedbackOpen(false);
        setContent('');
      } else {
        showToast({ message: data.message || '提交失败', type: 'error' });
      }
    } catch {
      showToast({ message: '网络错误，请稍后再试', type: 'error' });
    }
  };

  const handleFriendApplySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!friendApplyData.name.trim() || !friendApplyData.link.trim()) {
      showToast({ message: '网站名称与链接为必填项', type: 'error' });
      return;
    }
    if (!/^https?:\/\//i.test(friendApplyData.link)) {
      showToast({ message: '链接需以 http:// 或 https:// 开头', type: 'error' });
      return;
    }
    setIsSubmittingFriend(true);
    try {
      const response = await fetch('/api/v1/friends/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(friendApplyData),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        showToast({ message: '申请已提交，请等待审核', type: 'success' });
        setIsFriendApplyOpen(false);
        setFriendApplyData(emptyFriendApplication);
      } else {
        showToast({ message: data.message || '申请失败，请稍后重试', type: 'error' });
      }
    } catch {
      showToast({ message: '网络错误，提交失败', type: 'error' });
    } finally {
      setIsSubmittingFriend(false);
    }
  };

  return {
    activeModal, content, email, friendApplyData, handleFriendApplySubmit,
    handleMarkAsRead, handleSendMagicLink, handleSubmit, handleToggleMenu,
    hasInteracted, isBanned, isFeedbackOpen, isFriendApplyOpen, isLoggedIn,
    isMenuOpen, isNotificationOpen, isSending, isSubmittingFriend,
    notifications, setActiveModal, setContent, setEmail, setFriendApplyData,
    setIsFeedbackOpen, setIsFriendApplyOpen, setIsLoggedIn, setIsMenuOpen,
    setIsNotificationOpen, setShowInlineLogin, setType, showInitialHint,
    showInlineLogin, showToast, type, unreadCount, isFirstVisit,
  };
};

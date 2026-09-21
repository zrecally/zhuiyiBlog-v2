import React, { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { EditProfileModal } from './Comments/EditProfileModal';
import { X, Clock, Heart, ChevronRight, Trash2 } from 'lucide-react';

interface UserDashboardModalsProps {
  activeModal: 'settings' | 'collections' | 'history' | null;
  onClose: () => void;
}

interface DashboardItem {
  id: number;
  post?: {
    id: string | number;
    image?: string | null;
    title?: string | null;
  } | null;
  viewedAt?: string;
  createdAt?: string;
}

export const UserDashboardModals: React.FC<UserDashboardModalsProps> = ({ activeModal, onClose }) => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ username: string; avatar: string | null; avatarDark?: string | null } | null>(null);
  const [collections, setCollections] = useState<DashboardItem[]>([]);
  const [history, setHistory] = useState<DashboardItem[]>([]);

  useEffect(() => {
    if (!activeModal) return;

    const token = localStorage.getItem('user_token');
    if (!token) {
      onClose();
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      try {
        if (activeModal === 'settings') {
          const res = await fetch('/api/v1/user/me', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.success) {
            setUser({
              ...data.user,
              avatar: data.user.avatar || '/avatars/default.svg',
              avatarDark: data.user.avatarDark || '/avatars/default.svg'
            });
          }
        } else if (activeModal === 'collections') {
          // 加上时间戳防止浏览器缓存 GET 请求，导致无法获取最新数据
          const res = await fetch(`/api/v1/user/collections?_t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.success) setCollections(data.data);
        } else if (activeModal === 'history') {
          const res = await fetch(`/api/v1/user/history?_t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.success) setHistory(data.data);
        }
      } catch (e) {
        showToast({ message: '获取数据失败', type: 'error' });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [activeModal, onClose, showToast]);

  const handleDeleteHistory = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      const token = localStorage.getItem('user_token');
      const res = await fetch(`/api/v1/user/history/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setHistory(prev => prev.filter(h => h.id !== id));
        showToast({ message: '删除成功', type: 'success' });
      }
    } catch (error) {
      showToast({ message: '删除失败', type: 'error' });
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('确定要清空所有浏览历史吗？')) return;
    try {
      const token = localStorage.getItem('user_token');
      const res = await fetch('/api/v1/user/history', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setHistory([]);
        showToast({ message: '已清空浏览历史', type: 'success' });
      }
    } catch (error) {
      showToast({ message: '清空失败', type: 'error' });
    }
  };

  if (!activeModal) return null;

  if (activeModal === 'settings' && user) {
    return (
      <EditProfileModal
        initialUsername={user.username}
        initialAvatar={user.avatar}
        initialAvatarDark={user.avatarDark}
        onClose={onClose}
        onSuccess={(updatedUser) => {
          setUser(updatedUser);
          // 这里可以触发一个全局事件来通知其他组件头像已更新
          window.dispatchEvent(new CustomEvent('profile-updated', { detail: updatedUser }));
        }}
      />
    );
  }

  if (activeModal === 'collections' || activeModal === 'history') {
    const isHistory = activeModal === 'history';
    const title = isHistory ? '浏览历史' : '我的喜欢';
    const items = isHistory ? history : collections;

    return (
      <div className="fixed inset-0 z-[100] bg-neutral-900/40 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto transition-all duration-500">
        <div className="relative bg-white p-6 sm:p-8 rounded-[2rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] max-w-lg w-full mx-4 flex flex-col transform transition-all scale-100 animate-in zoom-in-95 border border-neutral-100 max-h-[80vh]">

          <button
            onClick={onClose}
            className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-full transition-colors z-10"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-3 mb-6 px-2">
            <div className="w-10 h-10 bg-xianxia-jade/10 rounded-full flex items-center justify-center text-xianxia-jade">
              {isHistory ? <Clock className="w-5 h-5" /> : <Heart className="w-5 h-5" />}
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-neutral-800 tracking-tight">{title}</h3>
              <p className="text-xs text-neutral-500 mt-1">{isHistory ? '您最近浏览的 100 篇文章' : '您点赞收藏的文章'}</p>
            </div>
            {isHistory && items.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="text-xs text-neutral-400 hover:text-red-500 transition-colors flex items-center gap-1 px-2 py-1 rounded-md hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                清空
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-xianxia-jade"></div>
              </div>
            ) : items.length === 0 || items.filter(item => item && item.post).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
                <p className="text-sm font-medium">暂无记录</p>
              </div>
            ) : (
              items.filter(item => item && item.post).map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    onClose();
                    // 这里原先可能是触发了 navigate 事件并关闭模态框
                    // 但主页的监听可能存在时序问题，使用更稳定的方式跳转并刷新
                    if (item.post?.id) {
                      window.location.href = `/posts/${item.post.id}`;
                    }
                  }}
                  className="group flex items-center gap-4 p-3 rounded-xl hover:bg-neutral-50 cursor-pointer transition-colors border border-transparent hover:border-neutral-100"
                >
                  {item.post?.image ? (
                    <img src={item.post.image} alt={item.post.title || '文章'} className="w-16 h-12 object-cover rounded-lg bg-neutral-100" />
                  ) : (
                    <div className="w-16 h-12 bg-neutral-100 rounded-lg flex items-center justify-center text-neutral-400 text-xs">无图</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-neutral-800 truncate group-hover:text-xianxia-jade transition-colors">{item.post?.title || '已删除文章'}</h4>
                    <p className="text-xs text-neutral-500 mt-1">
                      {isHistory
                        ? (item.viewedAt ? new Date(item.viewedAt).toLocaleString() : '')
                        : (item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '')}
                    </p>
                  </div>
                  {isHistory ? (
                    <button
                      onClick={(e) => handleDeleteHistory(e, item.id)}
                      className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all opacity-0 group-hover:opacity-100"
                      title="删除记录"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : (
                    <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-xianxia-jade transition-colors" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

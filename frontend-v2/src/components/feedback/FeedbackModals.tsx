import { FormEvent } from 'react';
import { FeedbackType, FriendApplicationData, UserNotification } from './feedbackTypes';

interface FeedbackModalProps {
  open: boolean;
  type: FeedbackType;
  content: string;
  onClose: () => void;
  onTypeChange: (type: FeedbackType) => void;
  onContentChange: (content: string) => void;
  onSubmit: (event: FormEvent) => void;
}

export const FeedbackModal = ({ open, type, content, onClose, onTypeChange, onContentChange, onSubmit }: FeedbackModalProps) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-300">
      <div className="absolute inset-0 bg-xianxia-text/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-white/60 backdrop-blur-2xl border border-xianxia-jade/30 rounded-[2rem] shadow-2xl p-6 md:p-10 animate-in zoom-in-95 duration-300">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-xianxia-red/50 to-transparent opacity-50 rounded-t-[2rem]" />
        <CloseButton onClick={onClose} />
        <div className="text-center mb-6">
          <h3 className="text-xl font-kai font-bold text-xianxia-text tracking-widest">意见反馈</h3>
          <p className="text-xs text-xianxia-text/60 mt-2 font-serif tracking-widest">提交 Bug 或需求建议</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="flex gap-4 w-full">
            <button type="button" onClick={() => onTypeChange('bug')} className={`flex-1 py-2 text-sm font-kai tracking-widest transition-colors border rounded-sm ${type === 'bug' ? 'border-xianxia-red text-xianxia-red bg-xianxia-red/5' : 'border-xianxia-jade/30 text-xianxia-text/60 hover:border-xianxia-jade/60'}`}>提交 Bug</button>
            <button type="button" onClick={() => onTypeChange('requirement')} className={`flex-1 py-2 text-sm font-kai tracking-widest transition-colors border rounded-sm ${type === 'requirement' ? 'border-xianxia-jadeDark text-xianxia-jadeDark bg-xianxia-jadeDark/10 font-bold' : 'border-xianxia-jade/30 text-xianxia-text/60 hover:border-xianxia-jade/60'}`}>需求建议</button>
          </div>
          <textarea value={content} onChange={(event) => onContentChange(event.target.value)} placeholder="请详细描述您遇到的问题或需求建议..." className="w-full h-32 p-4 bg-white/50 border border-xianxia-jade/30 rounded-sm focus:outline-none focus:border-xianxia-red text-xianxia-text placeholder-xianxia-text/30 font-serif text-sm resize-none transition-colors" />
          <button type="submit" className="w-full py-3 bg-xianxia-text hover:bg-xianxia-red text-xianxia-bg rounded-sm text-sm font-kai tracking-[0.2em] transition-colors duration-300 shadow-sm">提交</button>
        </form>
      </div>
    </div>
  );
};

interface FriendApplicationModalProps {
  open: boolean;
  data: FriendApplicationData;
  isSubmitting: boolean;
  onClose: () => void;
  onChange: (data: FriendApplicationData) => void;
  onSubmit: (event: FormEvent) => void;
}

export const FriendApplicationModal = ({ open, data, isSubmitting, onClose, onChange, onSubmit }: FriendApplicationModalProps) => {
  if (!open) return null;
  const fields: Array<{ key: keyof FriendApplicationData; label: string; placeholder: string; type?: string; required?: boolean }> = [
    { key: 'name', label: '网站名称', placeholder: '例如：张三的博客', required: true },
    { key: 'link', label: '网站链接', placeholder: '例如：https://www.example.com', type: 'url', required: true },
    { key: 'avatar', label: '网站图标 (选填)', placeholder: '图片 URL 地址', type: 'url' },
  ];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-300">
      <div className="absolute inset-0 bg-xianxia-text/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-white/60 backdrop-blur-2xl border border-xianxia-jade/30 rounded-[2rem] shadow-2xl p-6 md:p-10 animate-in zoom-in-95 duration-300">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-xianxia-red/50 to-transparent opacity-50 rounded-t-[2rem]" />
        <CloseButton onClick={onClose} />
        <div className="text-center mb-6">
          <h3 className="text-xl font-kai font-bold text-xianxia-text tracking-widest">友链申请</h3>
          <p className="text-xs text-xianxia-text/60 mt-2 font-serif tracking-widest">期待与您的优秀站点互相连接</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-kai text-xianxia-text/80 mb-1">{field.label} {field.required && <span className="text-xianxia-red">*</span>}</label>
              <input type={field.type || 'text'} value={data[field.key]} onChange={(event) => onChange({ ...data, [field.key]: event.target.value })} placeholder={field.placeholder} className="w-full px-4 py-2 bg-white/50 border border-xianxia-jade/30 rounded-sm focus:outline-none focus:border-xianxia-red text-xianxia-text placeholder-xianxia-text/30 font-serif text-sm transition-colors" required={field.required} />
            </div>
          ))}
          <div>
            <label className="block text-xs font-kai text-xianxia-text/80 mb-1">网站简介 (选填)</label>
            <textarea value={data.description} onChange={(event) => onChange({ ...data, description: event.target.value })} placeholder="一句话描述您的站点..." className="w-full h-20 p-4 bg-white/50 border border-xianxia-jade/30 rounded-sm focus:outline-none focus:border-xianxia-red text-xianxia-text placeholder-xianxia-text/30 font-serif text-sm resize-none transition-colors" />
          </div>
          <button type="submit" disabled={isSubmitting} className="w-full py-3 bg-xianxia-text hover:bg-xianxia-red text-xianxia-bg rounded-sm text-sm font-kai tracking-[0.2em] transition-colors duration-300 shadow-sm disabled:opacity-50 mt-4">{isSubmitting ? '提交中...' : '提交申请'}</button>
        </form>
      </div>
    </div>
  );
};

interface NotificationModalProps {
  open: boolean;
  unreadCount: number;
  notifications: UserNotification[];
  onClose: () => void;
  onMarkAsRead: (ids?: number[]) => Promise<void>;
}

export const NotificationModal = ({ open, unreadCount, notifications, onClose, onMarkAsRead }: NotificationModalProps) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-300">
      <div className="absolute inset-0 bg-xianxia-text/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[80vh] flex flex-col bg-white/80 backdrop-blur-2xl border border-xianxia-jade/30 rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-xianxia-red/50 to-transparent opacity-50 rounded-t-[2rem]" />
        <div className="flex items-center justify-between p-6 border-b border-xianxia-jade/20">
          <h3 className="text-lg font-kai font-bold text-xianxia-text tracking-widest">消息中心</h3>
          <div className="flex items-center gap-4">
            {unreadCount > 0 && <button onClick={() => void onMarkAsRead()} className="text-xs font-kai text-xianxia-jade hover:text-xianxia-red transition-colors">全部已读</button>}
            <CloseButton onClick={onClose} inline />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-xianxia-text/40"><p className="font-kai tracking-widest text-sm">暂无新消息</p></div>
          ) : (
            <ul className="divide-y divide-xianxia-jade/10">
              {notifications.map((notification) => (
                <li key={notification.id} className={`p-4 transition-colors hover:bg-white/50 cursor-pointer ${!notification.isRead ? 'bg-xianxia-red/5' : ''}`} onClick={async () => {
                  if (!notification.isRead) await onMarkAsRead([notification.id]);
                  if (notification.link) { onClose(); window.location.href = notification.link; }
                }}>
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-bold text-sm text-xianxia-text flex items-center gap-2">{!notification.isRead && <span className="w-1.5 h-1.5 rounded-full bg-xianxia-red" />}{notification.title}</span>
                    <span className="text-xs text-xianxia-text/40 font-serif">{new Date(notification.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-xianxia-text/70 font-serif line-clamp-2 pl-3 border-l-2 border-xianxia-jade/30 mt-2">{notification.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

const CloseButton = ({ onClick, inline = false }: { onClick: () => void; inline?: boolean }) => (
  <button onClick={onClick} className={inline ? 'text-xianxia-text/40 hover:text-xianxia-red transition-colors p-1' : 'absolute top-6 right-6 text-xianxia-text/40 hover:text-xianxia-red transition-colors'} aria-label="关闭">
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" /></svg>
  </button>
);

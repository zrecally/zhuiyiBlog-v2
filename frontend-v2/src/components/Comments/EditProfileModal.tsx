import React, { useState, useEffect} from'react';
import { User, Loader2, CheckCircle2, X} from'lucide-react';

export const EditProfileModal = ({
 onClose,
 initialUsername,
 initialAvatar,
 initialAvatarDark,
 onSuccess
}: {
 onClose: () => void;
 initialUsername: string;
 initialAvatar: string | null;
 initialAvatarDark?: string | null;
 onSuccess: (user: {username: string, avatar: string | null, avatarDark?: string | null}) => void;
}) => {
 const [username, setUsername] = useState(initialUsername);
 const [previewAvatar, setPreviewAvatar] = useState(initialAvatar ||'');
 const [status, setStatus] = useState<'idle' |'saving' |'success' |'error'>('idle');
 const [message, setMessage] = useState('');

 // 实时预览头像变化，如果链接为空或无效，则使用默认 SVG 头像
 useEffect(() => {
 const timer = setTimeout(() => {
 setPreviewAvatar(initialAvatar || '');
}, 500);
 return () => clearTimeout(timer);
}, [username, initialAvatar]);

 const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setStatus('error');
      setMessage('昵称不能为空');
      return;
    }
    if (trimmedUsername.length > 20) {
      setStatus('error');
      setMessage('昵称不能超过20个字符');
      return;
    }

 setStatus('saving');
 try {
 const token = localStorage.getItem('user_token');
 // 保持原有头像不变
 const avatar = initialAvatar;
 const avatarDark = initialAvatarDark;

 const res = await fetch('/api/v1/user/me', {
 method:'PUT',
 headers: {
'Content-Type':'application/json',
'Authorization': `Bearer ${token}`
},
 body: JSON.stringify({ username, avatar, avatarDark})
});
 const data = await res.json();

 if (res.ok && data.success) {
   if (data.token) {
     localStorage.setItem('user_token', data.token);
   }
   setStatus('success');
   setMessage('资料已更新');
   onSuccess(data.user);
 setTimeout(() => {
 onClose();
}, 1200);
} else {
 setStatus('error');
 setMessage(data.message ||'保存失败');
}
} catch (e) {
 setStatus('error');
 setMessage('网络错误，请稍后再试');
}
};

 return (
 <div className="fixed inset-0 z-[100] bg-neutral-900/40 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto transition-all duration-500">
 <div className="relative bg-white p-8 sm:p-10 rounded-[2rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] (0,0,0,0.2)] max-w-sm w-full mx-4 flex flex-col items-center transform transition-all scale-100 animate-in zoom-in-95 border border-neutral-100">

 {/* 关闭按钮 */}
 <button
 onClick={onClose}
 className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-700 :text-[#C83C23] hover:bg-neutral-100 :bg-[#EAE5D9] rounded-full transition-colors"
 >
 <X className="w-4 h-4" />
 </button>

 <div className="w-full flex flex-col items-center">
 <div className="text-center mb-8">
 <h3 className="text-xl font-bold text-neutral-800 tracking-tight">个人资料</h3>
 <p className="text-sm text-neutral-500 mt-1.5">修改您在评论区展示的身份信息</p>
 </div>

 {status ==='success' ? (
 <div className="w-full py-10 flex flex-col items-center justify-center animate-in fade-in slide-in-from-bottom-4">
 <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-5">
 <CheckCircle2 className="w-8 h-8 text-green-500" />
 </div>
 <p className="text-base font-medium text-neutral-800">{message}</p>
 </div>
 ) : (
 <form onSubmit={handleSave} className="w-full space-y-5 animate-in fade-in">
 {status ==='error' && (
 <div className="w-full p-3 text-[13px] text-red-500 bg-red-50 rounded-xl text-center font-medium">
 {message}
 </div>
 )}

 {/* 头像预览区 */}
 <div className="flex justify-center gap-6 mb-6">
 <div className="relative group flex flex-col items-center">
 <div className="w-16 h-16 rounded-full overflow-hidden">
              <img
                src={previewAvatar || '/avatars/default.svg'}
                alt="Avatar Preview"
                className="w-full h-full object-cover"
 onError={(e) => {
                  (e.target as HTMLImageElement).src = '/avatars/default.svg';
                }}
 />
 </div>
 </div>
 </div>

 <div className="space-y-4">
 {/* 昵称输入框 */}
 <div>
 <label className="block text-[13px] font-semibold text-neutral-700 mb-1.5 ml-1">
 昵称
 </label>
 <div className="relative">
 <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
 <User className="w-4 h-4 text-neutral-400" />
 </div>
 <input
 type="text"
 value={username}
 onChange={(e) => {
   if (e.target.value.length <= 20) {
     setUsername(e.target.value);
     if (status ==='error') setStatus('idle');
   }
 }}
 maxLength={20}
 className="w-full pl-10 pr-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/5 :ring-[#C83C23]/20 focus:border-neutral-400 :border-[#C83C23] transition-all text-[14px] placeholder-neutral-400"
 placeholder="起个好听的名字 (最多20个字符)"
 required
 />
 </div>
 </div>
 </div>

 <button
 type="submit"
 disabled={status ==='saving'}
 className="mt-8 w-full py-3.5 bg-neutral-900 hover:bg-black :bg-[#C83C23] text-white rounded-xl text-[14px] font-semibold transition-colors duration-200 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
 >
 {status ==='saving' ? (
 <>
 <Loader2 className="w-4 h-4 animate-spin" />
 保存中...
 </>
 ) :'保存修改'}
 </button>
 </form>
 )}
 </div>
 </div>
 </div>
 );
};

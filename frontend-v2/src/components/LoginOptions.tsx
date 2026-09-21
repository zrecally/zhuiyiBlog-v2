import React, { useState, useEffect } from 'react';
import { MagicLinkAuth } from './common/MagicLinkAuth';
import { authApiUrl } from '../lib/siteMode';

const PendingProviderButton = ({ provider, children }: { provider: string; children: React.ReactNode }) => (
  <div className="relative shrink-0 group/provider">
    <button
      type="button"
      disabled
      aria-label={`${provider} 登录待上线`}
      className="w-8 h-8 rounded-full bg-white border border-[#2A3B32]/20 flex items-center justify-center opacity-55 cursor-not-allowed"
    >
      {children}
    </button>
    <span
      role="tooltip"
      className="pointer-events-none absolute left-1/2 bottom-full z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#2A3B32] px-2.5 py-1 text-[11px] font-serif text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/provider:opacity-100"
    >
      待上线
    </span>
  </div>
);

export const LoginOptions = ({ compact = false }: { compact?: boolean }) => {
  const [magicEmail, setMagicEmail] = useState('');
  const [isSendingMagic, setIsSendingMagic] = useState(false);
  const [magicMessage, setMagicMessage] = useState('');
  const [showMagicInput, setShowMagicInput] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (countdown > 0) return;
    if (!magicEmail.trim() || !magicEmail.includes('@')) {
      setMagicMessage('请输入有效的邮箱');
      setTimeout(() => setMagicMessage(''), 3000);
      return;
    }

    setIsSendingMagic(true);
    setMagicMessage('');
    try {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('scroll', Math.round(window.scrollY).toString());
      const returnUrl = currentUrl.pathname + currentUrl.search;

      const res = await fetch(authApiUrl('/api/v1/auth/magic-link'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicEmail, returnUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setMagicMessage('链接已发送');
        setCountdown(60);
      } else {
        setMagicMessage(data.message || '发送失败');
      }
    } catch (e) {
      setMagicMessage('网络错误');
    } finally {
      setIsSendingMagic(false);
      setTimeout(() => setMagicMessage(''), 5000);
    }
  };

  return (
    <div className={`relative flex h-8 items-center gap-2 ${compact ? 'justify-center min-w-[240px]' : ''}`}>
      {/* 紧凑遮罩内仅淡出图标；输入框会绝对定位展开，避免整行反复重排。 */}
      <div className={`flex items-center gap-2 transition-opacity duration-150 ${showMagicInput ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
 <button type="button" onClick={(e) => {
   e.preventDefault();
   const currentPath = window.location.pathname + window.location.search;
   window.location.href = `${authApiUrl('/api/v1/auth/github')}?returnTo=${encodeURIComponent(currentPath)}`;
 }} className="w-8 h-8 rounded-full bg-white border border-[#2A3B32]/20 flex items-center justify-center hover:bg-neutral-50 transition-all shadow-sm hover:shadow shrink-0">
 {/* GitHub */}
 <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"><path fillRule="evenodd" clipRule="evenodd" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" fill="#181717" className="" /></svg>
 </button>
 <PendingProviderButton provider="Facebook">
 {/* Facebook */}
 <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
 </PendingProviderButton>
 <PendingProviderButton provider="Apple">
 {/* Apple */}
 <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 384 512"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.1-44.6-35.9-2.8-74.3 22.7-93.1 22.7-18.9 0-48.6-22.1-80.1-21.6-43.2 .5-83 25.4-105.1 64.9-44.6 79.5-11.4 197.6 32.1 260.6 21.1 30.6 45.5 64.7 78.4 63.5 32.1-1.3 44.5-20.9 83.4-20.9 38.6 0 50.1 20.9 83.4 20.3 34.3-.5 54.8-31.5 75.6-62.1 24.2-35.6 34.2-70.1 34.7-71.9-.8-.4-64.8-24.8-65.2-96.1zM240.1 119c22.8-27.6 38.1-66.1 33.9-104-33.5 1.3-73.4 22.3-96.7 49.8-18.4 21.6-36.9 61.1-31.8 98.1 37.1 2.9 74.4-19.1 94.6-43.9z" fill="#000000" className="" /></svg>
 </PendingProviderButton>
 <PendingProviderButton provider="Google">
 {/* Google */}
 <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
 <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
 <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
 <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
 <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
 </svg>
 </PendingProviderButton>
 <PendingProviderButton provider="Microsoft">
 {/* Microsoft */}
 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 23 23">
 <path fill="#f3f3f3" d="M0 0h23v23H0z"/>
 <path fill="#f35325" d="M1 1h10v10H1z"/>
 <path fill="#81bc06" d="M12 1h10v10H12z"/>
 <path fill="#05a6f0" d="M1 12h10v10H1z"/>
 <path fill="#ffba08" d="M12 12h10v10H12z"/>
 </svg>
      </PendingProviderButton>
      </div>

      <MagicLinkAuth
        showMagicInput={showMagicInput}
        setShowMagicInput={setShowMagicInput}
        magicEmail={magicEmail}
        setMagicEmail={setMagicEmail}
        handleSendMagicLink={handleSendMagicLink}
        isSendingMagic={isSendingMagic}
        countdown={countdown}
        magicMessage={magicMessage}
        theme="light"
        compact={compact}
      />
    </div>
  );
};

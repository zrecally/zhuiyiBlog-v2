import React, { FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoginOptions } from './LoginOptions';

type AccessMode = 'approval' | 'password';

interface ArticleAccessGateProps {
  mode: AccessMode;
  variant?: 'card' | 'page';
  title?: string;
  status?: string;
  requesting?: boolean;
  onRequestApproval?: () => Promise<void> | void;
  onRedeemPassword?: (password: string) => Promise<boolean>;
}

export const ArticleAccessGate: React.FC<ArticleAccessGateProps> = ({
  mode,
  variant = 'page',
  title,
  status = 'none',
  requesting = false,
  onRequestApproval,
  onRedeemPassword,
}) => {
  const { t } = useTranslation();
  const passwordInputId = useId();
  const [password, setPassword] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(localStorage.getItem('user_token')));

  useEffect(() => {
    const refresh = () => setIsLoggedIn(Boolean(localStorage.getItem('user_token')));
    window.addEventListener('login_success', refresh);
    window.addEventListener('logout', refresh);
    return () => {
      window.removeEventListener('login_success', refresh);
      window.removeEventListener('logout', refresh);
    };
  }, []);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!password || requesting || !onRedeemPassword) return;
    const unlocked = await onRedeemPassword(password);
    if (unlocked) setPassword('');
  };

  const requestApproval = async () => {
    if (!isLoggedIn) {
      setShowLogin(true);
      return;
    }
    await onRequestApproval?.();
  };

  const wrapper = variant === 'card'
    // Keep list locks in the same visual layer as ordinary article cards.
    // The subtle blur communicates protection without making the card appear
    // as a separate, brighter panel.
    ? 'absolute inset-0 z-40 rounded-xl bg-xianxia-bg/60 backdrop-blur-sm'
    : 'relative w-full min-h-[450px] my-10 rounded-xl border border-[#4A6B58]/10 bg-[#4A6B58]/[0.02] backdrop-blur-md';
  const compactCard = variant === 'card';

  return (
    <div
      className={`${wrapper} flex flex-col items-center justify-center text-center ${compactCard ? 'overflow-visible' : 'overflow-hidden'}`}
      // Keep the locked card from activating its parent link, but do not
      // cancel the default action: cancelling a submit-button click prevents
      // the password form's onSubmit handler from running.
      onClick={(event) => { event.stopPropagation(); }}
    >
      <div className={`${variant === 'card' ? 'w-12 h-12 mb-3' : 'w-20 h-20 mb-6'} bg-[#4A6B58]/5 rounded-full flex items-center justify-center border border-[#4A6B58]/20`}>
        <svg className={variant === 'card' ? 'w-5 h-5 text-[#4A6B58]' : 'w-10 h-10 text-[#4A6B58]'} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7z" />
        </svg>
      </div>
      <h3 className={`${variant === 'card' ? 'text-lg mb-4' : 'text-2xl mb-3'} font-serif font-bold text-xianxia-text tracking-widest`}>
        {title || t('受保护文章')}
      </h3>
      {variant === 'page' && (
        <p className="text-neutral-500 mb-8 px-6 font-serif leading-relaxed">
          {mode === 'password'
            ? t('输入管理员提供的一次性密码即可查看，无需登录。')
            : t('此文章仅管理员或已获授权的用户可以查看。')}
        </p>
      )}

      {mode === 'password' ? (
        <form onSubmit={submitPassword} className={`${compactCard ? 'max-w-[320px] px-4 gap-2' : 'max-w-sm px-6 gap-3'} w-full flex flex-col sm:flex-row`}>
          <label className="sr-only" htmlFor={passwordInputId}>{t('一次性访问密码')}</label>
          <input
            id={passwordInputId}
            type="password"
            autoComplete="one-time-code"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={72}
            placeholder={t('输入一次性访问密码')}
            className={`min-w-0 flex-1 rounded-full border border-[#4A6B58]/40 bg-xianxia-bg/90 text-xianxia-text outline-none focus:border-[#4A6B58] font-serif ${compactCard ? 'px-3 py-2 text-sm' : 'px-4 py-2.5'}`}
          />
          <button
            type="submit"
            disabled={requesting || !password}
            className={`rounded-full border border-[#4A6B58] text-[#4A6B58] hover:bg-[#4A6B58] hover:text-[#F9F6F0] disabled:opacity-50 transition-colors font-serif tracking-widest ${compactCard ? 'px-4 py-2 text-sm' : 'px-6 py-2.5'}`}
          >
            {requesting ? t('验证中…') : t('验证访问')}
          </button>
        </form>
      ) : showLogin && !isLoggedIn ? (
        <div className="absolute inset-0 z-50 rounded-xl bg-[#F9F6F0]/95 backdrop-blur-xl flex flex-col items-center justify-center">
          <p className="text-[13px] font-serif text-[#4A6B58] tracking-widest mb-6">{t('请先验证身份')}</p>
          <LoginOptions compact={compactCard} />
          <button onClick={() => setShowLogin(false)} className="absolute top-4 right-4 p-2 text-[#4A6B58]/50" aria-label={t('关闭登录方式')}>×</button>
        </div>
      ) : (
        <button
          onClick={() => void requestApproval()}
          disabled={requesting || status === 'pending'}
          className={`border border-[#4A6B58] text-[#4A6B58] rounded-full font-serif tracking-widest hover:bg-[#4A6B58] hover:text-[#F9F6F0] disabled:opacity-60 transition-colors ${compactCard ? 'px-5 py-2 text-sm' : 'px-8 py-3'}`}
        >
          {requesting ? t('正在申请...') : status === 'pending' ? t('等待审核') : status === 'rejected' ? t('重新申请') : t('申请查看')}
        </button>
      )}
    </div>
  );
};

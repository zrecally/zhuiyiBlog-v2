import React from 'react';
import { Loader2 } from 'lucide-react';

interface MagicLinkAuthProps {
  showMagicInput: boolean;
  setShowMagicInput: (show: boolean) => void;
  magicEmail: string;
  setMagicEmail: (email: string) => void;
  handleSendMagicLink: (e: React.FormEvent) => void;
  isSendingMagic: boolean;
  countdown: number;
  magicMessage: string;
  theme?: 'light' | 'dark'; // for different places to have slightly different styles if needed
  compact?: boolean;
}

export const MagicLinkAuth: React.FC<MagicLinkAuthProps> = ({
  showMagicInput,
  setShowMagicInput,
  magicEmail,
  setMagicEmail,
  handleSendMagicLink,
  isSendingMagic,
  countdown,
  magicMessage,
  theme = 'light',
  compact = false,
}) => {
  const isDark = theme === 'dark';

  return (
    <div className={`${compact && showMagicInput ? 'absolute left-1/2 -translate-x-1/2 z-30' : 'relative'} flex items-center group/magic ${compact ? '' : 'flex-1'}`}>
      <div
        className={`flex items-center overflow-hidden transition-[width,border-color,box-shadow] duration-200 ease-out will-change-[width] ${
          showMagicInput
            ? `${compact ? 'w-[min(320px,calc(100vw-3rem))]' : 'w-full max-w-[450px]'} rounded-full border ${isDark ? 'border-[#076dd0] ring-[#076dd0]/20' : 'border-[#4A6B58] ring-[#4A6B58]/20'} ring-2 bg-transparent shadow-sm`
            : `w-8 rounded-full border border-[#e6e8ee] bg-white hover:bg-neutral-50 hover:shadow cursor-pointer ${!isDark && 'h-8'}`
        }`}
        style={!isDark ? { height: '32px' } : { height: '32px' }}
        onClick={(e) => {
          if (!showMagicInput) {
            e.preventDefault();
            setShowMagicInput(true);
          }
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            if (showMagicInput) {
              e.stopPropagation();
              setShowMagicInput(false);
            }
          }}
          className={`flex items-center justify-center shrink-0 w-8 h-8 transition-colors z-20 relative ${
            showMagicInput ? 'rounded-full hover:bg-neutral-100 cursor-pointer' : 'cursor-pointer'
          }`}
          title={showMagicInput ? "收起" : ""}
        >
          {isDark ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="4" width="20" height="16" rx="2" fill="#4285F4" fillOpacity="0.1" />
              <path d="M22 6C22 4.9 21.1 4 20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6Z" fill="#4285F4" />
              <path d="M2 6L12 13L22 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="4" width="20" height="16" rx="2" fill="#4A6B58" fillOpacity="0.1" />
              <path d="M22 6C22 4.9 21.1 4 20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6Z" fill="#4A6B58" />
              <path d="M2 6L12 13L22 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>

        <div className={`flex items-center h-full flex-1 transition-opacity duration-300 relative z-10 ${showMagicInput ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
          <input
            type="email"
            placeholder={isDark ? "输入邮箱地址" : "输入邮箱"}
            value={magicEmail}
            onChange={(e) => setMagicEmail(e.target.value)}
            tabIndex={showMagicInput ? 0 : -1}
            className={`flex-1 h-full bg-transparent text-[13px] outline-none w-full min-w-0 placeholder-neutral-400 pl-1 ${isDark ? 'text-[#37475b]' : 'text-[#1A1A1A] font-serif'}`}
            style={{ WebkitBoxShadow: '0 0 0px 1000px transparent inset', transition: 'background-color 5000s ease-in-out 0s' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSendMagicLink(e as unknown as React.FormEvent);
              }
            }}
          />
          <button
            type="button"
            onClick={handleSendMagicLink}
            disabled={isSendingMagic || !magicEmail.trim() || countdown > 0}
            tabIndex={showMagicInput ? 0 : -1}
            className={`px-3 h-full flex items-center justify-center font-bold ${!isDark && 'font-serif text-[12px]'} text-[13px] transition-colors shrink-0 bg-transparent outline-none ${
              magicEmail.trim() && countdown === 0
                ? (isDark ? 'text-[#076dd0] hover:text-[#065baf]' : 'text-[#4A6B58] hover:text-[#2A3B32]')
                : 'text-[#8b98a7] cursor-not-allowed'
            }`}
            title="发送魔法链接"
          >
            {isSendingMagic ? <Loader2 className="w-4 h-4 animate-spin" /> : countdown > 0 ? `${countdown}${isDark ? '秒' : 's'}` : (isDark ? '发送链接' : '发送')}
          </button>
        </div>
      </div>

      {magicMessage && (
        <div className={`absolute ${isDark ? '-top-5' : '-top-6'} left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap transition-all duration-300 animate-in fade-in slide-in-from-bottom-1 z-[99999] ${showMagicInput ? 'opacity-100' : 'opacity-0'} ${magicMessage.includes('发送') ? (isDark ? 'text-[#076dd0]' : 'text-[#4A6B58]') : 'text-red-500'}`}>
          {magicMessage}
        </div>
      )}

      <div className={`absolute bottom-full ${isDark ? 'right-[-10px] sm:right-auto sm:left-4 sm:-translate-x-1/2 mb-2 p-3.5 bg-[#37475b] w-[210px]' : 'right-[-10px] sm:right-auto sm:left-1/2 sm:-translate-x-1/2 mb-3 p-3.5 bg-[#2A3B32] w-[220px]'} text-white rounded-xl pointer-events-none shadow-xl transition-all duration-300 border border-transparent z-[99999] ${showMagicInput ? 'opacity-0 invisible translate-y-1' : 'opacity-0 group-hover/magic:opacity-100 visible translate-y-0'}`}>
        <div className="font-bold text-[13px] mb-1.5 flex items-center gap-1.5"><span className="text-[14px]">✨</span> 魔法登录</div>
        <div className="text-[11.5px] text-[#b4c0cc] leading-[1.6]">
          只需输入邮箱，系统将为您发送一条专属安全链接。<strong className="text-white font-medium">无需密码</strong>，{isDark ? '点击邮件中的链接即可一键认证并参与讨论。' : '一键认证。'}
        </div>
        <div className={`absolute -bottom-[6px] right-[20px] sm:right-auto sm:left-1/2 sm:-translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent ${isDark ? 'border-t-[#37475b]' : 'border-t-[#2A3B32]'}`}></div>
      </div>
    </div>
  );
};

import { UserDashboardModals } from './UserDashboardModals';
import {
  FeedbackModal,
  FriendApplicationModal,
  NotificationModal,
} from './feedback/FeedbackModals';
import { useFeedbackFloat } from './feedback/useFeedbackFloat';
import { authApiUrl } from '../lib/siteMode';

export const FeedbackFloat = () => {
  const {
    activeModal, content, email, friendApplyData, handleFriendApplySubmit,
    handleMarkAsRead, handleSendMagicLink, handleSubmit, handleToggleMenu,
    hasInteracted, isBanned, isFeedbackOpen, isFriendApplyOpen, isLoggedIn,
    isMenuOpen, isNotificationOpen, isSending, isSubmittingFriend,
    notifications, setActiveModal, setContent, setEmail, setFriendApplyData,
    setIsFeedbackOpen, setIsFriendApplyOpen, setIsLoggedIn, setIsMenuOpen,
    setIsNotificationOpen, setShowInlineLogin, setType, showInitialHint,
    showInlineLogin, showToast, type, unreadCount, isFirstVisit,
  } = useFeedbackFloat();

  // 响应式判断被封禁状态
  if (isBanned) {
    return null;
  }

  return (
    <>
      {/* 悬浮菜单展开遮罩 */}
      {isMenuOpen && (
        <div
          className="fixed inset-0 z-[80] bg-transparent"
          onClick={() => {
            setIsMenuOpen(false);
            setShowInlineLogin(false);
            setEmail('');
            setIsNotificationOpen(false);
          }}
        />
      )}

      {/* 悬浮多功能菜单 */}
      <div className={`fixed bottom-[90px] right-8 md:bottom-[100px] md:right-12 z-[90] flex flex-col gap-3 items-end transition-all duration-300 ${isMenuOpen ? 'opacity-100 translate-y-0 visible' : 'opacity-0 translate-y-4 invisible pointer-events-none'}`}>

        {/* 新增消息中心按钮 */}
        {isLoggedIn && (
          <>
            <button
              onClick={() => {
                setIsNotificationOpen(true);
                setIsMenuOpen(false);
              }}
              className="px-4 py-2 bg-xianxia-bg/90 backdrop-blur-md border border-xianxia-jade/30 rounded-full text-xianxia-text text-sm font-kai tracking-widest shadow-lg hover:border-xianxia-red hover:text-xianxia-red transition-all duration-300 hover:-translate-y-1 whitespace-nowrap flex items-center gap-2"
            >
              消息中心
              {unreadCount > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-xianxia-red px-1 text-[10px] text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setActiveModal('settings');
                setIsMenuOpen(false);
              }}
              className="px-4 py-2 bg-xianxia-bg/90 backdrop-blur-md border border-xianxia-jade/30 rounded-full text-xianxia-text text-sm font-kai tracking-widest shadow-lg hover:border-xianxia-red hover:text-xianxia-red transition-all duration-300 hover:-translate-y-1 whitespace-nowrap"
            >
              个人资料
            </button>
            <button
              onClick={() => {
                setActiveModal('collections');
                setIsMenuOpen(false);
              }}
              className="px-4 py-2 bg-xianxia-bg/90 backdrop-blur-md border border-xianxia-jade/30 rounded-full text-xianxia-text text-sm font-kai tracking-widest shadow-lg hover:border-xianxia-red hover:text-xianxia-red transition-all duration-300 hover:-translate-y-1 whitespace-nowrap"
            >
              我的喜欢
            </button>
            <button
              onClick={() => {
                setActiveModal('history');
                setIsMenuOpen(false);
              }}
              className="px-4 py-2 bg-xianxia-bg/90 backdrop-blur-md border border-xianxia-jade/30 rounded-full text-xianxia-text text-sm font-kai tracking-widest shadow-lg hover:border-xianxia-red hover:text-xianxia-red transition-all duration-300 hover:-translate-y-1 whitespace-nowrap"
            >
              浏览历史
            </button>
          </>
        )}

        <button
          onClick={() => {
            setIsMenuOpen(false);
            window.dispatchEvent(new CustomEvent('navigate', { detail: '/danmaku' }));
          }}
          className="px-4 py-2 bg-xianxia-bg/90 backdrop-blur-md border border-xianxia-jade/30 rounded-full text-xianxia-text text-sm font-kai tracking-widest shadow-lg hover:border-xianxia-red hover:text-xianxia-red transition-all duration-300 hover:-translate-y-1 whitespace-nowrap"
        >
          留言弹幕
        </button>
        <button
          onClick={() => {
            if (!isLoggedIn) {
              showToast({ message: '请先登录/验证身份后再申请友链', type: 'info' });
              return;
            }
            setIsMenuOpen(false);
            setIsFriendApplyOpen(true);
          }}
          className="px-4 py-2 bg-xianxia-bg/90 backdrop-blur-md border border-xianxia-jade/30 rounded-full text-xianxia-text text-sm font-kai tracking-widest shadow-lg hover:border-xianxia-red hover:text-xianxia-red transition-all duration-300 hover:-translate-y-1 whitespace-nowrap"
        >
          申请友链
        </button>

        {/* 访客登录 (第三方登录 & 魔法登录) / 问题反馈 & 退出登录 */}
        <div className="relative flex flex-col gap-3 items-end">
          {isLoggedIn ? (
            <>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  setIsFeedbackOpen(true);
                }}
                className="px-4 py-2 bg-xianxia-bg/90 backdrop-blur-md border border-xianxia-jade/30 rounded-full text-xianxia-text text-sm font-kai tracking-widest shadow-lg hover:border-xianxia-red hover:text-xianxia-red transition-all duration-300 hover:-translate-y-1 whitespace-nowrap"
              >
                问题反馈
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem('user_token');
                  setIsLoggedIn(false);
                  setIsMenuOpen(false);
                  window.dispatchEvent(new Event('logout'));
                  showToast({ message: '已退出登录', type: 'info' });
                }}
                className="px-4 py-2 bg-xianxia-bg/90 backdrop-blur-md border border-xianxia-red/50 rounded-full text-xianxia-red text-sm font-kai tracking-widest shadow-lg hover:bg-xianxia-red hover:text-xianxia-bg transition-all duration-300 hover:-translate-y-1 whitespace-nowrap"
              >
                退出登录
              </button>
            </>
          ) : (
            <div className="relative flex items-center justify-end">
              {/* 内联登录表单 (向左滑出) */}
              <div className={`absolute right-full mr-3 flex items-center transition-all duration-300 ease-out origin-right ${showInlineLogin ? 'max-w-[400px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none'}`}>
                {/* 内部容器：在隐藏时使用 overflow-hidden 切断内容，在显示时允许 overflow-visible 以展示外阴影 */}
                <div className={`flex items-center gap-2 bg-xianxia-bg/95 backdrop-blur-md border border-xianxia-jade/30 p-1.5 rounded-full shadow-lg whitespace-nowrap transition-all duration-300 ${showInlineLogin ? 'overflow-visible' : 'overflow-hidden'}`}>
                  {/* 第三方登录 (GitHub) */}
                  <button
                    onClick={() => {
                      const currentPath = window.location.pathname + window.location.search;
                      window.location.href = `${authApiUrl('/api/v1/auth/github')}?returnTo=${encodeURIComponent(currentPath)}`;
                    }}
                    className="w-7 h-7 md:w-8 md:h-8 flex-shrink-0 rounded-full bg-neutral-800 text-white flex items-center justify-center hover:bg-neutral-900 transition-colors shadow-sm ml-1"
                    title="GitHub 登录"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 md:w-5 md:h-5"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.379.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z"></path></svg>
                  </button>

                  <div className="w-px h-5 bg-xianxia-jade/30 mx-1"></div>

                  {/* 魔法登录 */}
                  <form onSubmit={handleSendMagicLink} className="flex items-center gap-2">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="输入邮箱..."
                      className="w-32 md:w-40 px-2 py-1 bg-transparent border-none focus:outline-none shadow-none appearance-none text-sm text-xianxia-text placeholder-xianxia-text/40 font-kai tracking-wider"
                      required
                      disabled={isSending}
                    />
                    <button
                      type="submit"
                      disabled={isSending}
                      className="px-3 py-1 bg-xianxia-text text-xianxia-bg text-xs font-kai rounded-full whitespace-nowrap hover:bg-xianxia-red transition-colors disabled:opacity-50 mr-1"
                    >
                      {isSending ? '发送中' : '邮箱验证'}
                    </button>
                  </form>
                </div>
              </div>

              <button
                onClick={() => setShowInlineLogin(!showInlineLogin)}
                className={`group px-4 py-2 backdrop-blur-md border rounded-full text-sm font-kai tracking-widest shadow-lg transition-all duration-300 hover:-translate-y-1 whitespace-nowrap z-10 relative
                  ${showInlineLogin
                    ? 'bg-xianxia-red text-xianxia-bg border-xianxia-red hover:text-xianxia-bg'
                    : 'bg-xianxia-bg/90 border-xianxia-jade/30 text-xianxia-text hover:border-xianxia-red hover:text-xianxia-red'
                  }`}
              >
                {/* 未展开时显示诱导气泡提示 */}
                {!showInlineLogin && (
                  <div className="absolute -left-3 top-1/2 -translate-y-1/2 -translate-x-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="bg-xianxia-text/90 text-xianxia-bg text-xs py-1.5 px-3 rounded whitespace-nowrap relative">
                      留下足迹，解锁更多交互
                      {/* 右侧小三角 */}
                      <div className="absolute right-[-4px] top-1/2 -translate-y-1/2 border-[5px] border-transparent border-l-xianxia-text/90"></div>
                    </div>
                  </div>
                )}
                {showInlineLogin ? '收起' : '访客登录'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 首次访问遮罩 */}
      <div className={`fixed inset-0 z-[9998] bg-neutral-900/40 backdrop-blur-[2px] transition-opacity duration-[1500ms] ${isFirstVisit ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />

      {/* 悬浮毛笔按钮 (胶囊向上展开 + 笑脸动画) */}
      {/* 首次访问单独分离的大笑脸，完全脱离文档流 */}
      <div className={`fixed z-[9999] pointer-events-none transition-all duration-[1500ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
        isFirstVisit
          ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-100 scale-150'
          : 'top-[calc(100vh-224px)] left-[calc(100vw-56px)] md:top-[calc(100vh-240px)] md:left-[calc(100vw-72px)] -translate-x-1/2 -translate-y-1/2 opacity-0 scale-100'
      }`}>
        <div className="relative w-[32px] h-[32px] text-xianxia-red bg-xianxia-bg rounded-full shadow-[0_0_30px_rgba(163,198,177,0.8)]">
          {/* 首次访问额外的文字提示 (绝对定位在笑脸正上方) */}
          <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-10 whitespace-nowrap text-white font-kai tracking-widest text-xs transition-opacity duration-500 ${isFirstVisit ? 'opacity-100 delay-500' : 'opacity-0'}`}>
            快捷功能看这里！
          </div>
          {/* 补充显示各项功能的文字 */}
          <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-4 whitespace-nowrap flex flex-col items-center gap-1 text-[8px] font-kai tracking-widest text-white transition-opacity duration-500 ${isFirstVisit ? 'opacity-100 delay-700' : 'opacity-0'}`}>
             {isLoggedIn ? '消息 • 设置 • 留言' : '登录 • 留言 • 反馈'}
          </div>

          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
            <g className="smiley-face">
              <path d="M7.5 10v.01" strokeWidth="3" className="smiley-eye" />
              <path d="M16.5 10v.01" strokeWidth="3" className="smiley-eye" />
              <path d="M7.5 15c2.5 3 6.5 3 9 0" strokeWidth="2" />
            </g>
          </svg>
        </div>
      </div>

      {/* 主悬浮按钮包裹器 */}
      <div className="fixed bottom-8 right-8 md:bottom-12 md:right-12 z-[9999] flex flex-col items-end justify-end">
        <button
          onClick={() => {
            if (isFirstVisit) return;
            handleToggleMenu();
          }}
          className={`w-12 flex flex-col items-center justify-end rounded-full bg-xianxia-bg/90 backdrop-blur-md border border-xianxia-jade/30 shadow-[0_4px_20px_-4px_rgba(163,198,177,0.3)] hover:shadow-xianxia-red/20 transition-all duration-500 ease-out group overflow-hidden
            ${isMenuOpen ? 'h-12 bg-xianxia-bg' : ((showInitialHint || isFirstVisit) && !hasInteracted ? 'h-[220px]' : (!hasInteracted ? 'h-12 hover:h-[220px]' : 'h-12'))}
          `}
          title="展开菜单"
        >
          {/* 展开的胶囊内容区 (位于上方) */}
          <div className={`flex flex-col items-center justify-between flex-1 w-full pt-3 pb-2 transition-opacity duration-300 ${
            isMenuOpen || hasInteracted ? 'opacity-0 hidden' : ((showInitialHint || isFirstVisit) ? 'opacity-100 delay-200' : 'opacity-0 group-hover:opacity-100 group-hover:delay-200')
          }`}>
            {/* 胶囊内部原始笑脸动画 (靠上) */}
            <div className={`relative w-[32px] h-[32px] text-xianxia-red flex-shrink-0 transition-opacity duration-500 ${isFirstVisit ? 'opacity-0' : 'opacity-100 delay-[1000ms]'}`}>
              <style>{`
                .smiley-eye { transform-origin: center; animation: face-blink 4s infinite; }
                .smiley-face { animation: face-look 5s infinite ease-in-out; transform-origin: center; }
                @keyframes face-blink { 0%, 92%, 98%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.1); } }
                @keyframes face-look { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(-1px, 1px); } 75% { transform: translate(1px, -1px); } }
              `}</style>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                <g className="smiley-face">
                  <path d="M7.5 10v.01" strokeWidth="3" className="smiley-eye" />
                  <path d="M16.5 10v.01" strokeWidth="3" className="smiley-eye" />
                  <path d="M7.5 15c2.5 3 6.5 3 9 0" strokeWidth="2" />
                </g>
              </svg>
            </div>

            {/* 提示文字组 (靠下，留出间距) */}
            <div className="flex flex-col items-center gap-2 text-[11px] font-kai tracking-widest text-xianxia-text mb-4">
              {isLoggedIn ? (
                <>
                  <span>消息</span>
                  <span className="w-1 h-1 rounded-full bg-xianxia-text/20"></span>
                  <span>设置</span>
                  <span className="w-1 h-1 rounded-full bg-xianxia-text/20"></span>
                  <span>留言</span>
                </>
              ) : (
                <>
                  <span>登录</span>
                  <span className="w-1 h-1 rounded-full bg-xianxia-text/20"></span>
                  <span>留言</span>
                  <span className="w-1 h-1 rounded-full bg-xianxia-text/20"></span>
                  <span>反馈</span>
                </>
              )}
            </div>
          </div>

          {/* 固定尺寸的毛笔图标容器 (位于下方) */}
          <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center relative">
            <svg
              className={`w-6 h-6 text-xianxia-text transition-all duration-300 ${isMenuOpen ? 'rotate-45 text-xianxia-red' : 'group-hover:rotate-12'} ${unreadCount > 0 && !isMenuOpen ? 'animate-bounce text-xianxia-red' : ''}`}
              viewBox="0 0 1024 1024"
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
            >
              <path d="M784.896 160.768c-19.456-25.088-53.76-35.328-86.016-25.6-28.672 8.704-367.616 230.912-421.888 274.944-48.128 38.912-78.848 102.912-88.576 156.672-9.728 53.76-3.072 108.032 15.36 155.648 4.608 11.264 12.8 19.968 23.552 24.576 10.752 4.608 23.552 4.608 34.304 0.512 43.008-16.384 104.96-52.224 153.6-96.256 50.176-45.056 288.768-369.664 300.544-399.872 14.336-35.84 27.648-69.632 28.16-90.112v-0.512c0-26.624-9.216-52.736-24.576-74.752z m-359.936 512.512c-39.424 35.84-93.696 68.608-133.12 84.48-11.776-38.4-15.36-82.944-7.68-125.44 7.68-42.496 32.768-93.696 71.168-124.928 44.544-36.352 286.72-200.704 357.376-246.784-2.56 16.896-10.752 41.984-25.6 78.848-11.264 26.624-219.648 300.544-262.144 333.824z"></path>
              <path d="M228.864 785.408c-19.456 22.528-36.864 45.056-49.152 65.536-12.8 20.48-20.48 40.448-20.992 57.344-0.512 12.288 3.584 24.064 11.264 32.768 7.68 8.704 18.944 13.312 30.72 13.312h1.536c18.432-1.536 39.424-11.776 60.416-26.624 21.504-14.848 43.52-35.328 64.512-58.368 10.752-11.776 10.24-30.208-1.536-41.472-11.776-10.752-30.208-10.24-41.472 1.536-17.408 19.456-35.328 35.84-51.2 46.592-15.36 10.752-27.136 17.408-33.28 17.92 1.536-6.144 6.144-18.432 16.384-34.816 10.752-17.408 26.624-37.376 43.52-57.344 10.24-12.288 8.704-30.72-3.584-40.96-12.8-9.728-31.232-7.68-40.96 4.608z"></path>
            </svg>
          </div>
        </button>

        {/* 独立渲染的新消息红点，绝对定位，避免被 button 的 overflow-hidden 裁切 */}
        {unreadCount > 0 && !isMenuOpen && (
          <span className="absolute bottom-[34px] right-0 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-xianxia-red px-1 text-[10px] text-white shadow-sm ring-2 ring-xianxia-bg pointer-events-none translate-x-1/4">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </div>

      <FeedbackModal
        open={isFeedbackOpen}
        type={type}
        content={content}
        onClose={() => setIsFeedbackOpen(false)}
        onTypeChange={setType}
        onContentChange={setContent}
        onSubmit={handleSubmit}
      />
      <FriendApplicationModal
        open={isFriendApplyOpen}
        data={friendApplyData}
        isSubmitting={isSubmittingFriend}
        onClose={() => setIsFriendApplyOpen(false)}
        onChange={setFriendApplyData}
        onSubmit={handleFriendApplySubmit}
      />
      <NotificationModal
        open={isNotificationOpen}
        unreadCount={unreadCount}
        notifications={notifications}
        onClose={() => setIsNotificationOpen(false)}
        onMarkAsRead={handleMarkAsRead}
      />

      {/* 用户中心聚合弹窗 */}
      <UserDashboardModals
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
      />
    </>
  );
};

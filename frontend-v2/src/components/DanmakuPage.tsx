import React, { useEffect, useState, useRef } from 'react';
import { useToast } from './Toast';
import { SkeletonDanmaku } from './Skeleton';
import { getPixelAvatar } from './Comments/commentUtils';

interface Danmaku {
  id: number;
  text: string;
  color: string;
  createdAt: string;
  user?: {
    username: string;
    avatar: string;
    avatarDark?: string;
  };
  top?: number;
  speed?: number;
  left?: number;
  fontSize?: number;
  opacity?: number;
  animationDelay?: number;
  // 为匿名用户生成一个固定随机头像
  randomAvatar?: string;
}

export const DanmakuPage = () => {
  const [danmakus, setDanmakus] = useState<Danmaku[]>([]);
  const [inputText, setInputText] = useState('');
  const [color, setColor] = useState('#FFFFFF');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [customHex, setCustomHex] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  const colors = [
    '#FFFFFF', // 月白
    '#FFC8C8', // 胭脂淡
    '#FFE8D0', // 鹅黄
    '#D0FFD0', // 嫩绿
    '#C8E8FF', // 天青
    '#E8D0FF'  // 浅紫
  ];

  const extendedColors = [
    '#E9E7EF', // 远山紫
    '#B0A4E3', // 桔梗
    '#B2E5E8', // 晴蓝
    '#82D4D1', // 竹青
    '#F2E6CE', // 缟
    '#F5CFA6', // 麦秆秋
    '#F3A694', // 桃夭
    '#EA7A99', // 酡颜
    '#9B90C2', // 丁香
    '#71A4D9', // 窃蓝
    '#4E8062', // 铜绿
    '#A7535A', // 殷红
  ];

  useEffect(() => {
    // 点击外部关闭颜色选择器
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setIsColorPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    // 检查登录状态以决定按钮文案
    const checkLogin = () => {
      const token = localStorage.getItem('user_token');
      setIsLoggedIn(!!token);
    };
    checkLogin();

    // 监听登录状态变化
    window.addEventListener('admin-login-success', checkLogin);
    window.addEventListener('login-success', checkLogin);
    window.addEventListener('logout', checkLogin);

    return () => {
      window.removeEventListener('admin-login-success', checkLogin);
      window.removeEventListener('login-success', checkLogin);
      window.removeEventListener('logout', checkLogin);
    };
  }, []);

  const fetchDanmakus = async () => {
    try {
      const res = await fetch('/api/v1/danmaku');
      const data = await res.json();
      if (data.success) {
        setDanmakus(prev => {
          // 对比新数据，只把 prev 里没有的新弹幕加上随机属性追加进去
          const newItems = data.data.filter((newItem: Danmaku) => !prev.some(p => p.id === newItem.id));

          if (newItems.length === 0) return prev; // 没有新数据，直接返回，避免任何重渲染

          const processedNew = newItems.map((d: Danmaku) => ({
            ...d,
            top: Math.random() * 80,
            speed: 10 + Math.random() * 15,
            left: 100 + Math.random() * 50,
            fontSize: 14 + Math.random() * 6,
            opacity: 0.85 + Math.random() * 0.15,
            animationDelay: -(Math.random() * 10),
            randomAvatar: !d.user ? getPixelAvatar(String(d.id)) : undefined
          }));

          // 为了确保按时间排序，也可以考虑重新排序，但通常追加在后面即可
          return [...prev, ...processedNew].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        });
      }
    } catch (e) {
      console.error('Failed to fetch danmakus', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // 首次获取历史弹幕
    fetchDanmakus();

    // 建立 SSE 连接监听新弹幕 (如果环境变量指定了独立的 Socket 域名，则使用该域名)
    const socketBaseUrl = import.meta.env.VITE_SOCKET_BASE_URL || '';
    const eventSource = new EventSource(`${socketBaseUrl}/api/v1/danmaku/stream`);

    eventSource.onmessage = (event) => {
      try {
        const newDanmaku = JSON.parse(event.data);
        setDanmakus(prev => {
          if (prev.some(p => p.id === newDanmaku.id)) return prev;

          const processedNew = {
            ...newDanmaku,
            top: Math.random() * 80,
            speed: 10 + Math.random() * 15,
            left: 100 + Math.random() * 50,
            fontSize: 14 + Math.random() * 6,
            opacity: 0.85 + Math.random() * 0.15,
            animationDelay: 0, // 强制取消动画延迟，立即出现
            randomAvatar: !newDanmaku.user ? '/avatars/default.svg' : undefined
          };

          return [...prev, processedNew].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        });
      } catch (e) {
        // 解析空行或心跳注释时忽略
      }
    };

    eventSource.onerror = () => {
      console.error('Danmaku SSE connection error, attempting to reconnect...');
      // EventSource 会自动重连，无需手动干预
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) {
      showToast({ message: '请输入弹幕内容', type: 'error' });
      return;
    }
    if (inputText.length > 100) {
      showToast({ message: '弹幕太长啦，简短一点吧', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('user_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/v1/danmaku', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: inputText, color })
      });
      const data = await res.json();

      if (data.success) {
        setInputText('');
        // 在混合架构中，发送弹幕是走到 Serverless 的，而监听是在 Socket 的。
        // 为了消除两边因网络波动或数据库写入产生的几十毫秒延迟，我们在前端发送成功后，
        // 乐观地 (Optimistically) 在本地模拟追加一条自己发出的弹幕，实现真正的“零延迟”体验。
        const optimisticDanmaku = {
          ...data.data,
          top: Math.random() * 80,
          speed: 10 + Math.random() * 15,
          left: 100 + Math.random() * 50,
          fontSize: 14 + Math.random() * 6,
          opacity: 1,
          animationDelay: 0,
          randomAvatar: !data.data.user ? '/avatars/default.svg' : undefined
        };

        setDanmakus(prev => {
          if (prev.some(p => p.id === optimisticDanmaku.id)) return prev;
          return [...prev, optimisticDanmaku].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        });
      } else {
        showToast({ message: data.message || '发送失败', type: 'error' });
      }
    } catch (e) {
      showToast({ message: '网络错误', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative w-full h-[calc(100vh-200px)] overflow-hidden flex flex-col items-center justify-center animate-in fade-in duration-700">

      {/* 弹幕显示区域 */}
      <div
        ref={containerRef}
        className="absolute inset-0 z-10 overflow-hidden pointer-events-none"
      >
        {isLoading ? (
          // 渲染骨架屏：随机生成 8 个弹幕骨架，带有呼吸动画
          Array.from({ length: 8 }).map((_, i) => (
            <SkeletonDanmaku
              key={`skeleton-${i}`}
              style={{
                top: `${10 + Math.random() * 70}%`,
                left: `${10 + Math.random() * 80}%`,
                animationDelay: `${Math.random() * 2}s`
              }}
            />
          ))
        ) : (
          danmakus.map((d, index) => (
            <div
              key={`${d.id}-${index}`}
              className="group absolute whitespace-nowrap font-kai tracking-wider px-3 py-1.5 md:px-4 md:py-2 rounded-full bg-black/60 border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex items-center justify-center gap-2 hover:z-50 pointer-events-auto hover:![animation-play-state:paused] before:absolute before:-inset-8 before:content-[''] before:z-[-1]"
              style={{
                top: `${d.top}%`,
                color: d.color,
                fontSize: `${d.fontSize}px`,
                opacity: 1,
                // 使用 3D 硬件加速并利用 backface-visibility 防止由于平移引起的文本抗锯齿失效
                transform: 'translateZ(0)',
                WebkitFontSmoothing: 'antialiased',
                // 使用 CSS 动画实现平滑滚动
                animation: `danmakuScroll ${d.speed}s linear infinite`,
                animationDelay: `${d.animationDelay}s`,
              }}
            >
              {/* 用户头像区域 */}
              <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 bg-white/20">
                <img
                  src={d.user ? d.user.avatar : d.randomAvatar}
                  alt="avatar"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>

              {/* 弹幕内容 */}
              <span>{d.text}</span>

              {/* Hover 时上方或下方显示的名字气泡，防止在顶部被遮挡 */}
              <div className={`absolute ${(d.top || 0) < 15 ? '-bottom-10' : '-top-10'} left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none`}>
                <div className="bg-black/80 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap relative border border-white/20 shadow-xl font-song tracking-widest">
                  {d.user ? d.user.username : '匿名'}
                  {/* 气泡的小箭头 */}
                  <div className={`absolute ${(d.top || 0) < 15 ? '-top-1 border-b-4 border-b-black/80' : '-bottom-1 border-t-4 border-t-black/80'} left-1/2 -translate-x-1/2 border-l-4 border-r-4 border-l-transparent border-r-transparent w-0 h-0`}></div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 交互输入区域 */}
      <div className="relative z-20 w-full max-w-2xl px-6 mt-auto mb-32 flex flex-col gap-6 items-center justify-center pointer-events-auto">
        <div className="text-center mb-2 animate-in slide-in-from-bottom-4 duration-700">
          <div className="flex items-center justify-center mb-4">
            <div className="h-[1px] w-12 bg-gradient-to-r from-transparent to-xianxia-jade/50"></div>
            <h2 className="text-3xl font-kai text-xianxia-text tracking-[0.3em] mx-4 drop-shadow-sm">飞花传书</h2>
            <div className="h-[1px] w-12 bg-gradient-to-l from-transparent to-xianxia-jade/50"></div>
          </div>
          <p className="text-sm text-xianxia-text/70 font-song tracking-[0.2em] italic">留下你的足迹，让文字随风飘过</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 w-full bg-transparent p-8 animate-in zoom-in-95 duration-700 delay-150 relative">

          <div className="flex flex-wrap gap-4 justify-center mb-2 items-center">
            {colors.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full transition-all duration-300 border border-xianxia-jade/20 shadow-sm ${color === c ? 'ring-2 ring-offset-2 ring-offset-[#FDFBF7] ring-xianxia-red' : 'hover:scale-110'}`}
                style={{ backgroundColor: c }}
                title="选择颜色"
              />
            ))}

            {/* 自定义颜色选择器 (纯净调色盘图标按钮) */}
            <div
              ref={colorPickerRef}
              className={`relative w-7 h-7 rounded-full transition-all duration-300 flex items-center justify-center cursor-pointer border shadow-sm
                ${!colors.includes(color) && !extendedColors.includes(color)
                  ? 'border-xianxia-red bg-[#FDFBF7] ring-2 ring-offset-2 ring-offset-[#FDFBF7] ring-xianxia-red'
                  : 'border-xianxia-jade/20 bg-[#FDFBF7] hover:scale-110'}`}
              title="更多颜色"
              onClick={() => setIsColorPickerOpen(!isColorPickerOpen)}
            >
              {/* Lucide Palette Icon - 当选中自定义颜色时，图标会被染成那个颜色 */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 transition-colors"
                style={{ color: !colors.includes(color) && !extendedColors.includes(color) ? color : '#8C867A' }}
              >
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
              </svg>

              {/* 自定义颜色弹出层 */}
              {isColorPickerOpen && (
                <div
                  className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 w-64 bg-[#FDFBF7] border border-xianxia-jade/30 rounded-xl shadow-2xl p-4 z-50 cursor-default animate-in fade-in zoom-in-95 duration-200"
                  onClick={(e) => e.stopPropagation()} // 防止点击内部时关闭
                >
                  <div className="text-xs text-xianxia-text/70 font-song mb-3 text-center tracking-widest border-b border-xianxia-jade/20 pb-2">更多传统色</div>

                  {/* 扩展颜色网格 */}
                  <div className="grid grid-cols-6 gap-2 mb-4 px-1">
                    {extendedColors.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setColor(c);
                          setCustomHex(c);
                          setIsColorPickerOpen(false);
                        }}
                        className={`w-6 h-6 rounded-full mx-auto transition-transform duration-200 border border-xianxia-jade/20 shadow-sm ${color === c ? 'ring-2 ring-offset-1 ring-offset-[#FDFBF7] ring-xianxia-red' : 'hover:scale-110'}`}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>

                  {/* HEX 自定义输入 */}
                  <div className="flex items-center gap-1.5 border-t border-xianxia-jade/20 pt-3">
                    <span className="text-xianxia-text/60 font-mono text-xs flex-shrink-0">#</span>
                    <input
                      type="text"
                      value={customHex.replace('#', '')}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomHex(val);
                        if (/^([0-9A-Fa-f]{3}){1,2}$/i.test(val)) {
                          setColor(`#${val}`);
                        }
                      }}
                      placeholder="HEX"
                      className="flex-1 min-w-0 bg-transparent border border-xianxia-jade/30 rounded px-2 py-1 text-xs font-mono text-xianxia-text focus:outline-none focus:border-xianxia-red transition-colors uppercase"
                      maxLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (/^([0-9A-Fa-f]{3}){1,2}$/i.test(customHex.replace('#', ''))) {
                          setColor(`#${customHex.replace('#', '')}`);
                          setIsColorPickerOpen(false);
                        } else {
                          showToast({ message: '请输入正确的 HEX 色值', type: 'error' });
                        }
                      }}
                      className="px-3 py-1 ml-1 flex-shrink-0 bg-xianxia-text text-xianxia-bg text-xs font-kai rounded hover:bg-xianxia-red transition-colors whitespace-nowrap"
                    >
                      确定
                    </button>
                  </div>

                  {/* 弹出层下方的小三角 */}
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-[#FDFBF7] border-b border-r border-xianxia-jade/30 rotate-45"></div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-row w-full md:max-w-lg mx-auto items-center bg-white/10 backdrop-blur-md border border-xianxia-jade/40 rounded-full pl-5 pr-1.5 py-1.5 focus-within:border-xianxia-red focus-within:ring-1 focus-within:ring-xianxia-red/30 transition-all duration-300 shadow-sm">
            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="落笔写下你想说的话..."
              className="flex-1 min-w-0 bg-transparent py-1.5 focus:outline-none text-xianxia-text font-song text-sm md:text-base placeholder-xianxia-text/40"
              maxLength={100}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 md:px-6 py-2 bg-xianxia-text hover:bg-xianxia-red text-xianxia-bg font-kai tracking-[0.2em] text-sm md:text-base transition-all duration-300 disabled:opacity-50 whitespace-nowrap rounded-full"
            >
              {isLoggedIn ? '留言' : '匿名留言'}
            </button>
          </div>
        </form>
      </div>

      {/* 注入弹幕动画的 CSS */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes danmakuScroll {
          from {
            transform: translate3d(100vw, 0, 0);
          }
          to {
            transform: translate3d(-100vw, 0, 0);
          }
        }
      `}} />
    </div>
  );
};

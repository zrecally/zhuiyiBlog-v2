import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { ToastProvider, useToast} from'./components/Toast';
import { Header} from'./components/Header';
import { BackgroundGrid} from'./components/BackgroundGrid';

import { InkEffect} from'./components/InkEffect';
import type { CMSPost } from './lib/cms';
import { AppContentRouter } from './components/AppContentRouter';
import { LoadErrorPage } from './components/LoadErrorPage';
import { SiteFooter } from './components/SiteFooter';
import { isStaticSite } from './lib/siteMode';
import { useTranslation } from 'react-i18next';
import { isCardExperience } from './lib/cardRedeem';
import { useSiteContent } from './hooks/useSiteContent';

// The import is replaced with a non-interactive unavailable page when the
// production card-delivery feature is disabled. This lets card.hizhuiyi.cn
// have a stable landing page without shipping redemption code or API calls.
const CardRedeemPage = lazy(() => import('./pages/CardRedeemPage').then(module => ({ default: module.CardRedeemPage })));
const StaticComplianceFooter = __STATIC_COMPLIANCE_BUILD__
  ? lazy(() => import('./components/StaticComplianceFooter').then(module => ({ default: module.StaticComplianceFooter })))
  : null;
const StartPage = lazy(() => import('./pages/StartPage').then(module => ({ default: module.StartPage })));
const FeedbackFloat = lazy(() => import('./components/FeedbackFloat').then(module => ({ default: module.FeedbackFloat })));
const SearchModal = lazy(() => import('./components/SearchModal').then(module => ({ default: module.SearchModal })));
const EasterEggModal = lazy(() => import('./components/EasterEggModal').then(module => ({ default: module.EasterEggModal })));

const AppContent = () => {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [selectedPost, setSelectedPost] = useState<CMSPost | null>(null);
 const [showEasterEgg, setShowEasterEgg] = useState(false);
 const [easterEggPoem, setEasterEggPoem] = useState({
   text: '床前明月光，疑是地上霜。',
   author: '李白',
 });

  // 增加 currentPath 状态用于简单的客户端路由
 const [currentPath, setCurrentPath] = useState(window.location.pathname + window.location.search);
 const { posts, timelinePosts, siteConfig, loading, timelineLoading, loadError } = useSiteContent(currentPath);
 const [isSearchOpen, setIsSearchOpen] = useState(false); // 从 URL 提取的 token
 const [siteViews, setSiteViews] = useState(0);

 useEffect(() => {
   if (isStaticSite) return;

   let active = true;
   const loadPoem = async () => {
     try {
       const response = await fetch('https://v1.hitokoto.cn/?c=i&c=d&c=k');
       if (!response.ok) return;
       const data = await response.json() as { hitokoto?: string; from?: string; from_who?: string | null };
       if (!active || !data.hitokoto) return;
       setEasterEggPoem({
         text: data.hitokoto,
         author: data.from_who ? `${data.from_who}《${data.from || '佚名'}》` : `《${data.from || '佚名'}》`,
       });
     } catch {
       // 保留内置诗句作为离线或网络失败时的彩蛋内容。
     }
   };

   const openEasterEgg = async () => {
     try {
       const response = await fetch('/api/v1/auth/ip');
       const data = await response.json() as { success?: boolean; isAllowed?: boolean };
       if (data.success && data.isAllowed) {
         showToast({ message: '管理入口已迁移至独立控制台。', type: 'info' });
         return;
       }
     } catch {
       // IP 检查不可用时仍展示彩蛋，不能向访客泄露管理状态。
     }
     setShowEasterEgg(true);
   };

   void loadPoem();
   window.addEventListener('trigger-admin-easter-egg', openEasterEgg);
   return () => {
     active = false;
     window.removeEventListener('trigger-admin-easter-egg', openEasterEgg);
   };
 }, [showToast]);

 useEffect(() => {
   const fontUrl = typeof siteConfig?.custom_font_url === 'string' ? siteConfig.custom_font_url : '';
   const isDynamicFont = /^\/api\/v1\/fonts\/[0-9a-f-]{36}\.(ttf|woff|woff2)$/.test(fontUrl);
   const isStaticFont = /^\/data\/live\/fonts\/[a-f0-9]{64}\.(ttf|woff|woff2)$/.test(fontUrl);
   const styleId = 'zhuiyi-custom-font-face';
   document.getElementById(styleId)?.remove();
   document.documentElement.style.removeProperty('--zhuiyi-site-font');
   if (!isDynamicFont && !isStaticFont) return;

   const extension = fontUrl.split('.').pop()!;
   const format = extension === 'ttf' ? 'truetype' : extension;
   const style = document.createElement('style');
   style.id = styleId;
   style.textContent = `@font-face{font-family:"ZhuiYi Custom";src:url("${fontUrl}") format("${format}");font-display:swap;font-style:normal;font-weight:100 900;}`;
   document.head.appendChild(style);
   document.documentElement.style.setProperty('--zhuiyi-site-font', '"ZhuiYi Custom"');

   return () => {
     style.remove();
     document.documentElement.style.removeProperty('--zhuiyi-site-font');
   };
 }, [siteConfig?.custom_font_url]);

 const hasVerifiedMagicToken = useRef(false);

 useEffect(() => {
 // 手机端访问提示（仅提示一次）
 if (!window.location.pathname.startsWith('/banned') && !sessionStorage.getItem('mobile_prompt_shown')) {
 if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768) {
 setTimeout(() => {
 showToast({ message:'当前为移动端，请切换PC获得完整体验', type:'info'});
 sessionStorage.setItem('mobile_prompt_shown','true');
}, 1000);
}
}

 // 检查 URL 中是否包含魔法链接 Token (形如 /?magic_token=xxx&return_url=yyy)
 const urlParams = new URLSearchParams(window.location.search);
 const returnUrl = urlParams.get('return_url');
 const oauthToken = urlParams.get('token');
 const magicToken = urlParams.get('magic_token');

  if (oauthToken) {
    // 立即从浏览器地址栏抹除 token 参数，杜绝 Referer 泄漏与浏览器历史记录残留
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('token');
    const targetPath = currentUrl.pathname + currentUrl.search;
    window.history.replaceState({}, document.title, targetPath);
    setCurrentPath(targetPath);

    if (!isStaticSite) {
      // 修复 H3: 任意 URL 携带 ?token= 即被持久化为登录态。
      // 需要先验证 token 的有效性，而不是直接存入 localStorage。
      const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
      fetch(`${baseUrl}/v1/user/me`, {
        headers: { 'Authorization': `Bearer ${oauthToken}` }
      }).then(res => res.json()).then(data => {
        // `/v1/user/me` 返回 `{ success: true, user }`。此前误判
        // `data.data`，会将已经通过 JWT 校验的 GitHub 登录错误提示为失效。
        if (data.success && (data.user || data.data)) {
          localStorage.setItem('user_token', oauthToken);
          showToast({ message: '登录成功', type: 'success' });
          window.dispatchEvent(new Event('login-success'));
        } else {
          showToast({ message: '登录授权已过期或无效', type: 'error' });
        }
      }).catch(() => {
        showToast({ message: '登录验证失败', type: 'error' });
      });
    }
  }

 if (!isStaticSite && magicToken && !hasVerifiedMagicToken.current) {
   hasVerifiedMagicToken.current = true;
   // 处理魔法链接登录
   fetch('/api/v1/auth/magic-verify', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ token: magicToken })
   })
   .then(res => res.json())
   .then(data => {
     if (data.success) {
       localStorage.setItem('user_token', data.token);
       showToast({ message: `欢迎，${data.user.username}`, type: 'success' });
       window.dispatchEvent(new Event('login-success'));
       window.dispatchEvent(new Event('user-login-success'));
     } else {
       // 确保这里的 Toast 提示不会被立刻吞掉
       setTimeout(() => {
         showToast({ message: data.message || '链接已失效或过期', type: 'error' });
       }, 100);
     }
   })
   .catch(() => {
     setTimeout(() => {
       showToast({ message: '网络错误，验证失败', type: 'error' });
     }, 100);
   })
   .finally(() => {
     // 优先使用传入的 returnUrl
     const rawTargetPath = returnUrl ? returnUrl : window.location.pathname;

     // 提取 scroll 参数并清理 URL
     let finalUrlParams: URLSearchParams;
     let cleanPath: string;

     if (rawTargetPath.includes('?')) {
       const parts = rawTargetPath.split('?');
       cleanPath = parts[0];
       finalUrlParams = new URLSearchParams(parts[1]);
     } else {
       cleanPath = rawTargetPath;
       finalUrlParams = new URLSearchParams();
     }

     const scrollPos = finalUrlParams.get('scroll');
     if (scrollPos) {
       finalUrlParams.delete('scroll');
       sessionStorage.setItem('pending_scroll', scrollPos);
     }

     const queryString = finalUrlParams.toString();
     const newPath = queryString ? `${cleanPath}?${queryString}` : cleanPath;

     // 防止跳转丢页，强行推进历史记录
     window.history.replaceState({}, document.title, newPath);
     setCurrentPath(newPath);
   });
 }

 // 监听全局搜索呼出事件 (Cmd+K / Ctrl+K)
 const handleOpenSearch = () => setIsSearchOpen(true);
 window.addEventListener('open-search', handleOpenSearch);

 // 监听 Token 过期事件
 const handleTokenExpired = () => {
   showToast({ message: '登录已过期，请重新登录', type: 'error' });
 };
 window.addEventListener('token-expired', handleTokenExpired);

 // 监听 IP 封禁事件
 const handleIpBanned = (e: Event) => {
   // 防止已经处于 /banned 路由时再次触发跳转和弹窗
   if (window.location.pathname.startsWith('/banned')) return;

   const customEvent = e as CustomEvent;
   showToast({ message: customEvent.detail || '您的 IP 已被封禁', type: 'error' });
   // 延迟跳转，让用户看清 Toast
   setTimeout(() => {
     window.dispatchEvent(new CustomEvent('navigate', { detail: '/banned' }));
   }, 1500);
 };
 window.addEventListener('ip-banned', handleIpBanned);

 const handleKeyDown = (e: KeyboardEvent) => {
 if ((e.metaKey || e.ctrlKey) && e.key ==='k') {
 e.preventDefault();
 setIsSearchOpen(true);
}
};
 window.addEventListener('keydown', handleKeyDown);

 // 记录访问量
 if (!isStaticSite && !window.location.pathname.startsWith('/banned')) {
   fetch('/api/v1/visit', { method:'POST'})
   .then(res => res.json())
   .then(data => {
   if (data.success) {
   setSiteViews(data.views);
  }
  })
   .catch(console.error);
 }

 // 监听导航事件，支持无刷新跳转
 const handleNavigation = (e: CustomEvent) => {
 const path = e.detail;
 window.history.pushState({},'', path);
 setCurrentPath(path);
 // 跳转时如果有选中的文章，清空它以返回列表
 setSelectedPost(null);
 window.scrollTo(0, 0);
};

 // 监听浏览器回退前进
 const handlePopState = () => {
 setCurrentPath(window.location.pathname + window.location.search);
 setSelectedPost(null);
};

 window.addEventListener('navigate', handleNavigation as EventListener);
 window.addEventListener('popstate', handlePopState);

 return () => {
 window.removeEventListener('open-search', handleOpenSearch);
 window.removeEventListener('token-expired', handleTokenExpired);
 window.removeEventListener('ip-banned', handleIpBanned);
 window.removeEventListener('keydown', handleKeyDown);
 window.removeEventListener('navigate', handleNavigation as EventListener);
 window.removeEventListener('popstate', handlePopState);
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

 const [runDays, setRunDays] = useState(0);

 useEffect(() => {
 // 设置你的博客建站日期 (格式: YYYY/MM/DD)，默认从环境变量读取，否则为 2026/08/07
 const deployDateStr = import.meta.env.VITE_DEPLOY_DATE ||'2026/08/07';
 const startDate = new Date(deployDateStr).getTime();
 const calculateDays = () => {
 const now = new Date().getTime();
 const diff = now - startDate;
 // 避免出现负数天数
 setRunDays(Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24))));
};
 calculateDays();
 // 每天检查一次是否需要更新天数
 const timer = setInterval(calculateDays, 1000 * 60 * 60 * 24);
 return () => clearInterval(timer);
}, []);

 // 根据 URL 路径自动恢复选中的文章 (解决刷新详情页回到列表的问题)
 useEffect(() => {
 if (posts.length > 0 && currentPath.startsWith('/posts/')) {
 const postId = currentPath.split('/posts/')[1]?.split('?')[0];
 if (postId && (!selectedPost || selectedPost.id !== postId)) {
 const foundPost = posts.find(p => p.id === postId);
 if (foundPost) {
 setSelectedPost(foundPost);
}
}
} else if (currentPath === '/posts' || currentPath === '/') {
    if (selectedPost) {
      setSelectedPost(null);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, currentPath]);

  // 处理全局的滚动位置恢复
  useEffect(() => {
    if (loading) return;

    const pendingScroll = sessionStorage.getItem('pending_scroll');
    if (pendingScroll) {
      const targetScroll = parseInt(pendingScroll, 10);

      // 立即先尝试滚动一次 (用 auto/instant 避免视觉上看到从顶部滑下来)
      window.scrollTo({ top: targetScroll, behavior: 'auto' });

      let attempts = 0;
      const intervalId = setInterval(() => {
        // 如果我们处于文章详情页，且选中的文章还没有加载出来，那么继续等待
        if (currentPath.startsWith('/posts/') && !selectedPost) {
          attempts++;
          if (attempts > 50) { // 等待 5 秒
            sessionStorage.removeItem('pending_scroll');
            clearInterval(intervalId);
          }
          return;
        }

        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        // 如果目标超出了当前页面的最大滚动高度，目标就是最大高度
        const scrollGoal = Math.min(targetScroll, maxScroll);

        // 允许有一点误差，或者超过20次（2秒）就放弃
        if (Math.abs(window.scrollY - scrollGoal) < 5 || attempts > 20) {
          sessionStorage.removeItem('pending_scroll');
          clearInterval(intervalId);
        } else {
          window.scrollTo({ top: targetScroll, behavior: 'auto' });
        }
        attempts++;
      }, 100);

      return () => clearInterval(intervalId);
    }
  }, [loading, currentPath, selectedPost]);

  const [pageTitle, setPageTitle] = useState(() => {
    if (isStaticSite) return 'ZhuiYi 博客';
    const cached = localStorage.getItem('zhuiyi_site_config');
    if (cached) {
      try {
        const config = JSON.parse(cached);
        return config.title || 'ZhuiYi 博客';
      } catch (e) {
        return 'ZhuiYi 博客';
      }
    }
    return 'ZhuiYi 博客';
  });
  const [pageDescription, setPageDescription] = useState('');

 // 更新页面标题
 useEffect(() => {
 if (siteConfig?.title) {
 // 默认标题
 let newTitle = siteConfig.title;
 let newDesc = siteConfig.description || '';

 // 如果进入了文章详情，追加文章标题
 if (selectedPost) {
 newTitle = `${selectedPost.title} - ${siteConfig.title}`;
 newDesc = selectedPost.summary || newDesc;
} else if (currentPath.startsWith('/posts')) {
 newTitle = `${t('文章')} - ${siteConfig.title}`;
} else if (currentPath.startsWith('/projects')) {
 newTitle = `${t('项目')} - ${siteConfig.title}`;
} else if (currentPath.startsWith('/friends')) {
 newTitle = `${t('友邻')} - ${siteConfig.title}`;
} else if (currentPath.startsWith('/album') || currentPath.startsWith('/tools/album')) {
 newTitle = `${t('相册')} - ${siteConfig.title}`;
} else if (currentPath.startsWith('/tools')) {
 newTitle = `${t('产品投票')} - ${siteConfig.title}`;
} else if (currentPath.startsWith('/about')) {
        newTitle = `${t('关于')} - ${siteConfig.title}`;
      }

      setPageTitle(newTitle);
 setPageDescription(newDesc);
}
}, [siteConfig, selectedPost, currentPath, t]);


 // 解析需要隐藏的导航按钮列表（黑名单模式：在 CMS 中填写的按钮将被隐藏）
 let hiddenNavLinks: string[] = [];
 const rawConfigStr = siteConfig?.navLinks || siteConfig?.navlinks ||'';
 if (rawConfigStr) {
 // 支持中英文逗号、顿号、空格等多种分隔符，防止输入格式错误导致解析失败
 hiddenNavLinks = rawConfigStr.split(/[,，、\s]+/).map((s: string) => s.trim()).filter(Boolean);
}
// 北京静态站的项目内容来自经校验的 projects.json 快照。即使动态站
// 配置暂时隐藏“项目”，静态站也必须保留该公开入口，避免已发布数据
// 在无业务 API 的站点中成为不可达内容。
if (isStaticSite) {
  hiddenNavLinks = hiddenNavLinks.filter((link) => !['项目', 'Projects'].includes(link));
}

 const publicSiteUrl = import.meta.env.VITE_SITE_URL || 'https://www.hizhuiyi.cn';
 const canonicalPath = currentPath.split('?')[0] || '/';
 const canonicalUrl = new URL(canonicalPath, publicSiteUrl).toString();
 const rawSocialImage = selectedPost?.image || siteConfig?.avatar || '';
 const socialImage = typeof rawSocialImage === 'string' && /^https:\/\//i.test(rawSocialImage)
   ? rawSocialImage
   : '';
 const isArticlePage = Boolean(selectedPost && currentPath.startsWith('/posts/'));
 const articleDate = isArticlePage && selectedPost?.date
   ? new Date(String(selectedPost.date).replace(/-/g, '/'))
   : null;
 const publishedTime = articleDate && !Number.isNaN(articleDate.getTime())
   ? articleDate.toISOString()
   : '';

 return (
 <div className="relative isolate min-h-screen overflow-x-hidden selection:bg-xianxia-jade/30 :bg-blue-900">
 <Helmet>
   <title>{pageTitle}</title>
   <meta name="description" content={pageDescription} />
   <meta property="og:title" content={pageTitle} />
   <meta property="og:description" content={pageDescription} />
   <meta property="og:url" content={canonicalUrl} />
   <meta property="og:site_name" content="ZhuiYi Blog" />
   <meta property="og:locale" content="zh_CN" />
   <meta property="og:type" content={isArticlePage ? 'article' : 'website'} />
   {socialImage && <meta property="og:image" content={socialImage} />}
   {socialImage && <meta property="og:image:alt" content={pageTitle} />}
   {publishedTime && <meta property="article:published_time" content={publishedTime} />}
   <link rel="canonical" href={canonicalUrl} />
   <meta name="twitter:card" content={socialImage ? 'summary_large_image' : 'summary'} />
   <meta name="twitter:title" content={pageTitle} />
   <meta name="twitter:description" content={pageDescription} />
   {socialImage && <meta name="twitter:image" content={socialImage} />}
   <link rel="alternate" type="application/rss+xml" title={`${siteConfig?.title || 'HI,ZhuiYi'} RSS`} href="/api/v1/feed/rss" />
   <link rel="alternate" type="application/atom+xml" title={`${siteConfig?.title || 'HI,ZhuiYi'} Atom`} href="/api/v1/feed/atom" />
   </Helmet>

      {!isStaticSite && showEasterEgg && (
        <Suspense fallback={null}><EasterEggModal
          open={showEasterEgg}
          poem={easterEggPoem}
          onClose={() => setShowEasterEgg(false)}
        /></Suspense>
      )}



      <BackgroundGrid />
      <InkEffect />
      {currentPath.startsWith('/banned') ? null : <Header title={siteConfig?.title} currentPath={currentPath} hiddenNavLinks={hiddenNavLinks} posts={posts} />}

      {isSearchOpen && <Suspense fallback={null}><SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        posts={posts}
      /></Suspense>}
      <main className={currentPath.startsWith('/banned') ? "relative z-20 min-h-screen" : "pb-20 relative z-20 min-h-[calc(100vh-200px)]"}>
        {loadError && !loading ? (
          <LoadErrorPage />
        ) : (
          <AppContentRouter
            currentPath={currentPath}
            loading={loading}
            timelineLoading={timelineLoading}
            posts={posts}
            selectedPost={selectedPost}
            setCurrentPath={setCurrentPath}
            setSelectedPost={setSelectedPost}
            siteConfig={siteConfig}
            timelinePosts={timelinePosts}
            hiddenNavLinks={hiddenNavLinks}
          />
        )}
      </main>

      {currentPath.startsWith('/banned') ? null : (
        <SiteFooter
          title={siteConfig?.title}
          runDays={runDays}
          siteViews={isStaticSite ? undefined : siteViews}
          compliance={StaticComplianceFooter && isStaticSite
            ? <Suspense fallback={null}><StaticComplianceFooter inline leadingSeparator /></Suspense>
            : null}
        />
      )}

      {!isStaticSite && !currentPath.startsWith('/banned') ? <Suspense fallback={null}><FeedbackFloat /></Suspense> : null}
    </div>
 );
};

function App() {
 if (window.location.pathname === '/start' || window.location.pathname === '/start.html') {
   return <Suspense fallback={null}><StartPage /></Suspense>;
 }

 return (
 <ToastProvider>
 {isCardExperience() && !isStaticSite
   ? <Suspense fallback={null}><CardRedeemPage /></Suspense>
   : <AppContent />}
 </ToastProvider>
 );
}

export default App;

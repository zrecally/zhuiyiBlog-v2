import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CMSPost } from '../lib/cms';
import { isStaticSite } from '../lib/siteMode';

interface HeaderProps {
 title?: string;
 currentPath?: string;
 hiddenNavLinks?: string[];
 posts?: CMSPost[];
}

export const Header = ({ title ='Hi, ZuiYi', currentPath: propPath, hiddenNavLinks = [], posts = []}: HeaderProps) => {
 const { t, i18n } = useTranslation();
  const [isLangOpen, setIsLangOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
 const [isScrolled, setIsScrolled] = useState(false);
 const [localPath, setLocalPath] = useState(window.location.pathname);

 const currentPath = propPath || localPath;
 const [isArticleDropdownOpen, setIsArticleDropdownOpen] = useState(false);
 const [isToolsDropdownOpen, setIsToolsDropdownOpen] = useState(false);
 const [categories, setCategories] = useState<string[]>([]);
 const [titleClickCount, setTitleClickCount] = useState(0);

 useEffect(() => {
   if (isStaticSite || titleClickCount === 0) return;

   if (titleClickCount >= 5) {
     window.dispatchEvent(new CustomEvent('trigger-admin-easter-egg'));
     setTitleClickCount(0);
     return;
   }

   const resetTimer = window.setTimeout(() => setTitleClickCount(0), 1000);
   return () => window.clearTimeout(resetTimer);
 }, [titleClickCount]);

 useEffect(() => {
 const uniqueCategories = Array.from(new Set(
 posts
 .filter((post) => post.title !=='关于' && post.title?.toLowerCase() !=='about')
 .map((post) => post.category)
 .filter(Boolean)
 ));
 setCategories(uniqueCategories);
 }, [posts]);

 useEffect(() => {
 const handleScroll = () => {
 setIsScrolled(window.scrollY > 16);
};

 const handleLocationChange = () => {
 setLocalPath(window.location.pathname);
};

 window.addEventListener('scroll', handleScroll);
 window.addEventListener('navigate', handleLocationChange);
 window.addEventListener('popstate', handleLocationChange);

 return () => {
 window.removeEventListener('scroll', handleScroll);
 window.removeEventListener('navigate', handleLocationChange);
 window.removeEventListener('popstate', handleLocationChange);
};
}, []);

  const handleTitleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isStaticSite) {
      window.dispatchEvent(new CustomEvent('navigate', { detail: '/' }));
      return;
    }
    setTitleClickCount((count) => count + 1);
  };

 // 核心硬编码导航
 const coreLinks = [
 { href:'/', label:'首页'},
 { href:'/posts', label:'文章'},
 { href:'/projects', label:'项目'},
 { href:'/timeline', label:'动态'},
 { href:'/friends', label:'友邻'},
 { href:'/tools/vote', label:'工具'},
 { href:'/album', label:'相册'}
 ].filter((link) => !isStaticSite || link.href !== '/tools/vote');

 const aboutLink = { href:'/about', label:'关于'};

 // 组合最终导航：过滤掉被 CMS 设置为隐藏的按钮
   const allNavLinks = [...coreLinks, aboutLink];
   const activeNavLinks = allNavLinks.filter(link => {
   // 隐藏逻辑：如果 hiddenNavLinks 包含了该按钮的 label，或者该按钮的 label 是空的，则隐藏
   // 需要注意：比对隐藏逻辑时依然使用中文 label（对应 CMS 里的字段）
   // 相册是动态站与北京静态站共同的一级入口，不受旧版工具导航隐藏配置影响。
   if (link.label === '相册') return true;
   return !hiddenNavLinks.includes(link.label) && link.label;
  });

 return (
 <>
 <div className="relative w-full h-20 opacity-0 pointer-events-none"></div>
 <header className={`fixed top-0 z-50 w-full transition-all duration-300 ease-in-out ${isScrolled ?'h-14' :'h-20 absolute'}`}>
 <div className={`absolute inset-0 max-w-5xl mx-auto border-b border-l-0 border-r-0 lg:border-r lg:border-l lg:rounded-b-xl transition-all duration-300 pointer-events-none ${
 isScrolled
 ?'border-xianxia-border/50 bg-xianxia-bg/80 backdrop-blur-2xl'
 :'border-transparent'
}`}></div>
 <div className="relative flex items-center justify-between h-full max-w-5xl pl-6 pr-4 mx-auto select-none transition-all duration-300">
 <a
            href="/"
            onClick={handleTitleClick}
            className="h-5 text-base group relative z-50 flex items-center space-x-2 text-xianxia-red font-semibold cursor-pointer"
          >
            {/* 气泡提示：增加更高的 z-index 并确保不会超出 Header 容器被隐藏 */}
            <div className="absolute top-[120%] left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none flex flex-col items-center z-[100]">
              <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-black/80"></div>
              <div className="bg-black/80 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.15)] font-medium tracking-wide">
                嘘，此间似有玄机...
              </div>
            </div>

            <div className={`w-5 h-5 bg-black rounded-full flex items-center justify-center text-white text-[10px] transition-transform ${titleClickCount > 0 ? 'scale-110' : ''}`}>Z</div>
            <div className={`hidden items-center justify-center border-[1.5px] border-[#C83C23] text-[#C83C23] font-kai p-[2px] rounded-sm shadow-sm transition-transform ${titleClickCount > 0 ? 'scale-110' : ''}`}>
              <span className="text-[10px] leading-none" style={{ writingMode:'vertical-rl'}}>印</span>
              <span className="text-[12px] leading-none ml-[1px]">Z</span>
            </div>
            <span className="text-nowrap font-kai text-lg">{title}</span>
          </a>

 {/* 移动端菜单遮罩 */}
 <div
 onClick={() => setIsMobileMenuOpen(false)}
 className={`fixed inset-0 z-20 w-screen h-screen duration-300 ease-out bg-xianxia-bg/90 sm:hidden ${isMobileMenuOpen ?'block' :'hidden'}`}
 ></div>

 <nav className="relative z-30 flex items-center justify-end w-auto text-sm text-xianxia-text">

 {/* 移动端菜单按钮：纯 CSS 国风错落线条与动效 */}
 <div
 onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
 className="relative flex items-center justify-center w-8 h-8 cursor-pointer sm:hidden group z-50"
 >
 <div className="relative w-5 h-4 flex flex-col justify-between items-end">
   {/* 上线条：全长，关闭时旋转45度并下移 */}
   <span className={`block h-[2px] bg-xianxia-text group-hover:bg-xianxia-red rounded-full transition-all duration-300 ease-in-out transform origin-center ${isMobileMenuOpen ? 'w-5 rotate-45 translate-y-[7px]' : 'w-5'}`}></span>
   {/* 中线条：偏短且右对齐，关闭时隐藏 */}
   <span className={`block h-[2px] bg-xianxia-text group-hover:bg-xianxia-red rounded-full transition-all duration-300 ease-in-out ${isMobileMenuOpen ? 'w-0 opacity-0' : 'w-4'}`}></span>
   {/* 下线条：更短且右对齐，关闭时拉长、旋转-45度并上移 */}
   <span className={`block h-[2px] bg-xianxia-text group-hover:bg-xianxia-red rounded-full transition-all duration-300 ease-in-out transform origin-center ${isMobileMenuOpen ? 'w-5 -rotate-45 -translate-y-[7px]' : 'w-3'}`}></span>
 </div>
 </div>

 {/* 导航菜单 */}
   <div className={`fixed ease-out duration-300 sm:top-0 right-4 sm:right-auto sm:left-0 sm:py-0 pt-2 pb-4 sm:mx-0 z-40 flex-col items-center sm:items-center justify-start h-auto text-sm sm:text-base sm:h-auto sm:relative sm:flex-row sm:text-sm sm:w-auto sm:pr-0 sm:pt-0 ${isScrolled ?'top-[56px]' :'top-[75px]'} ${isMobileMenuOpen ?'flex w-48 rounded-2xl bg-xianxia-card/95 backdrop-blur-md border border-xianxia-border shadow-[0_8px_30px_rgb(0,0,0,0.12)] sm:w-auto sm:rounded-none sm:bg-transparent sm: sm:border-none sm:shadow-none sm:backdrop-blur-none' :'hidden sm:flex'}`}>
   <div className="absolute inset-0 top-0 right-0 block w-full h-full px-3 sm:hidden pointer-events-none">
   </div>

   <div className={`flex flex-col sm:flex-row items-center w-full sm:w-auto gap-4 mt-2 sm:mt-0 relative z-10 py-4 sm:py-0 sm:gap-0 md:gap-0 lg:gap-1`}>
   {activeNavLinks.map((link) => {
   const isPostDetail = currentPath.startsWith('/posts/');
   // 处理顶级导航的高亮
   const isActive = link.href ==='/'
   ? currentPath ==='/'
   : link.href ==='/posts'
   ? currentPath.startsWith('/posts') //'/posts' 或'/posts/...' 都高亮顶部'文章'
   : link.label ==='工具'
   ? currentPath.startsWith('/tools/vote')
   : currentPath.startsWith(link.href);

   // 对 "文章" 按钮进行特殊处理，增加下拉菜单
 if (link.label ==='文章') {
  return (
  <div
  key={link.href}
  className="relative flex flex-col sm:flex-row items-center justify-center w-full sm:w-auto group"
  onMouseEnter={() => window.innerWidth >= 640 && setIsArticleDropdownOpen(true)}
  onMouseLeave={() => window.innerWidth >= 640 && setIsArticleDropdownOpen(false)}
  >
  <button
    onClick={() => {
    // 无论是移动端还是桌面端，直接跳转到文章列表，不再展开下拉菜单
    window.dispatchEvent(new CustomEvent('navigate', { detail: link.href}));
    setIsMobileMenuOpen(false);
   }}
    className={`flex items-center gap-1 ${i18n.language === 'en' ? 'px-1 sm:px-1.5 md:px-2' : 'px-1 sm:px-2 md:px-2.5'} py-1.5 font-medium tracking-wide text-center duration-200 ease-out sm:py-0 sm:mb-0 hover:text-xianxia-red :text-[#C83C23] ${isActive ?'text-xianxia-red font-serif' :'text-xianxia-text'} ${i18n.language === 'en' ? 'text-[11px] sm:text-xs md:text-[13px]' : ''}`}
    >
   {t(link.label)}
 {/* 仅在桌面端显示下拉小三角 */}
 <svg className={`hidden sm:block w-3 h-3 ml-1 transition-transform ${isArticleDropdownOpen ?'rotate-180' :''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
 </svg>
 </button>

{/* 文章分类下拉框（仅在桌面端显示） */}
<div className={`
hidden sm:block
sm:absolute sm:top-full sm:left-1/2 sm:-translate-x-1/2 sm:mt-2 sm:w-32
relative top-0 left-0 mt-0 w-full flex-col items-center nav-glass
rounded-xl transition-all duration-200 z-50 overflow-hidden py-1 sm:py-2
${isArticleDropdownOpen ?'opacity-100 visible sm:translate-y-0 h-auto' :'opacity-0 invisible sm:-translate-y-2 h-0 sm:h-auto'}
`}>
 {categories.length > 0 ? (
 <>
 <a
 href="/posts"
 className={`block w-full text-center px-4 py-2.5 sm:py-2 text-sm font-medium hover:bg-black/5 :bg-white/5 hover:text-xianxia-red :text-[#C83C23] transition-colors ${currentPath ==='/posts' || isPostDetail ?'text-xianxia-red font-serif' :'text-xianxia-text'}`}
 onClick={(e) => {
 e.preventDefault();
 e.stopPropagation();
 window.dispatchEvent(new CustomEvent('navigate', { detail: `/posts`}));
 setIsArticleDropdownOpen(false);
 setIsMobileMenuOpen(false);
}}
 >
 {t('全部文章')}
 </a>
 {categories.map((category) => {
 const isCategoryActive = currentPath === `/posts?category=${encodeURIComponent(category)}`;
 return (
 <a
 key={category}
 href={`/posts?category=${encodeURIComponent(category)}`}
 className={`block w-full text-center px-4 py-2.5 sm:py-2 text-sm hover:bg-black/5 :bg-white/5 hover:text-xianxia-red :text-[#C83C23] transition-colors ${isCategoryActive ?'text-xianxia-red font-serif' :'text-xianxia-text'}`}
 onClick={(e) => {
 e.preventDefault();
 e.stopPropagation();
 window.dispatchEvent(new CustomEvent('navigate', { detail: `/posts?category=${encodeURIComponent(category)}`}));
 setIsArticleDropdownOpen(false);
 setIsMobileMenuOpen(false);
 }}
 >
 {t(category)}
 </a>
 );
 })}
 </>
 ) : (
 <div className="px-4 py-2 text-sm text-xianxia-text/50 italic">暂无分类</div>
 )}
 </div>
 </div>
 );
}

 if (link.label ==='工具') {
 return (
 <div
 key={link.href}
 className="relative flex flex-col sm:flex-row items-center justify-center w-full sm:w-auto group"
 onMouseEnter={() => window.innerWidth >= 640 && setIsToolsDropdownOpen(true)}
 onMouseLeave={() => window.innerWidth >= 640 && setIsToolsDropdownOpen(false)}
 >
 <button
 type="button"
 onClick={() => {
 if (window.innerWidth < 640) {
 setIsToolsDropdownOpen(open => !open);
 return;
 }
 window.dispatchEvent(new CustomEvent('navigate', { detail: '/tools/vote' }));
 }}
 className={`flex items-center gap-1 ${i18n.language === 'en' ? 'px-1 sm:px-1.5 md:px-2' : 'px-1 sm:px-2 md:px-2.5'} py-1.5 font-medium tracking-wide text-center duration-200 ease-out sm:py-0 hover:text-xianxia-red ${isActive ? 'text-xianxia-red font-serif' : 'text-xianxia-text'}`}
 >
 {t(link.label)}
 <svg className={`w-3 h-3 ml-1 transition-transform ${isToolsDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
 </svg>
 </button>
<div className={`sm:absolute sm:top-full sm:left-1/2 sm:-translate-x-1/2 sm:mt-2 sm:w-32 relative top-0 left-0 mt-0 w-full flex-col items-center nav-glass rounded-xl transition-all duration-200 z-50 py-1 sm:py-2 ${isToolsDropdownOpen ? 'flex opacity-100 visible sm:translate-y-0 h-auto' : 'hidden sm:flex opacity-0 invisible sm:-translate-y-2 h-0 sm:h-auto'}`}>
 <a
 href="/tools/vote"
 onClick={(event) => {
 event.preventDefault();
 window.dispatchEvent(new CustomEvent('navigate', { detail: '/tools/vote' }));
 setIsToolsDropdownOpen(false);
 setIsMobileMenuOpen(false);
 }}
 className={`block w-full text-center px-4 py-2.5 sm:py-2 text-sm hover:bg-black/5 transition-colors ${currentPath.startsWith('/tools/vote') ? 'text-xianxia-red font-serif' : 'text-xianxia-text hover:text-xianxia-red'}`}
 >
  {t('产品投票')}
</a>
<a
 href="https://www.cms.so/"
 target="_blank"
 rel="noopener noreferrer"
 className="block w-full text-center px-4 py-2.5 sm:py-2 text-sm text-xianxia-text hover:bg-black/5 hover:text-xianxia-red transition-colors"
 onClick={() => {
 setIsToolsDropdownOpen(false);
 setIsMobileMenuOpen(false);
 }}
 >
  {t('站外工具')}
</a>
 </div>
 </div>
 );
 }

 return (
 <div key={link.href} className="flex items-center justify-center md:w-auto">
 <a
 href={link.href}
 target={link.label ==='动态' ?'_blank' : undefined}
 rel={link.label ==='动态' ?'noopener noreferrer' : undefined}
 onClick={(e) => {
 if (link.label ==='动态') {
 // 让浏览器处理默认的 target="_blank" 行为
 return;
}

 e.preventDefault();
 if (link.href.startsWith('/')) {
     window.dispatchEvent(new CustomEvent('navigate', { detail: link.href}));
    }
     setIsMobileMenuOpen(false);
    }}
     className={`flex items-center ${i18n.language === 'en' ? 'px-1 sm:px-1.5 md:px-2' : 'px-1 sm:px-2 md:px-2.5'} py-1.5 font-medium tracking-wide text-center duration-200 ease-out sm:py-0 sm:mb-0 hover:text-xianxia-red :text-[#C83C23] ${isActive ?'text-xianxia-red font-serif' :'text-xianxia-text'} ${i18n.language === 'en' ? 'text-[11px] sm:text-xs md:text-[13px]' : ''}`}
     >
   {t(link.label)}
   </a>
 </div>
 );
})}
 </div>

 {/* 将主题切换和语言切换放入与 navLinks 同级的 div 中，确保在一行显示 */}
  <div className="flex items-center justify-center md:w-auto ml-0 sm:ml-2 mt-4 sm:mt-0 relative z-10 pb-4 sm:pb-0">
  {/* 搜索按钮：手机端隐藏 (hidden sm:flex) */}
  <button
  onClick={() => window.dispatchEvent(new CustomEvent('open-search'))}
  className="hidden sm:flex items-center justify-center px-2 py-1.5 font-medium tracking-wide text-center duration-200 ease-out sm:py-0 sm:mb-0 text-xianxia-text hover:text-xianxia-red :text-[#C83C23] transition-colors"
  title={t('搜索 (Cmd+K)')}
  >
<Search className="w-[18px] h-[18px]" />
</button>

{/* 语言切换器（仅在桌面端显示） */}
<div className="hidden sm:flex relative flex-col sm:flex-row items-center justify-center w-full sm:w-auto ml-0 sm:ml-1 mt-4 sm:mt-0 group/lang" id="langSwitcher" onMouseLeave={() => setIsLangOpen(false)} onMouseEnter={() => setIsLangOpen(true)}>
<button
type="button"
onClick={() => {
if (window.innerWidth < 640) {
setIsLangOpen(!isLangOpen);
}
}}
 className="flex items-center gap-1 px-3 py-1.5 font-medium tracking-wide text-xianxia-text hover:text-xianxia-red :text-[#C83C23] transition-colors duration-200 sm:py-0 sm:mb-0"
 >
 <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 20c.9-3.068 2.116-6.272 3.689-9.118a.92.92 0 0 1 1.622 0C17.884 13.728 19.1 16.932 20 20m-7.65-3h6.3M4 6h5m0 0h3M9 6V4m3 2h2m-2 0c0 2.39-1.071 4.78-3 6.744m0 0C7.7 14.066 6.012 15.195 4 16m5-3.256C7.887 11.61 7.06 10.335 6.559 9M9 12.744c1 1.018 2.23 1.92 3.662 2.65"></path>
 </svg>
 <svg className={`w-3 h-3 transition-transform ml-1 ${isLangOpen ?'rotate-180' :''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
 </svg>
 </button>

 {/* 语言切换下拉框/内联展开（与文章二级菜单结构对齐） */}
   <div className={`
   sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-28
   relative top-0 right-0 mt-0 w-full flex flex-col items-center sm:shadow-lg
   bg-transparent sm:backdrop-blur-none
   border-none sm:border-none sm:
   rounded-xl transition-all duration-200 z-50 overflow-hidden py-1 sm:py-2
   ${isLangOpen ?'opacity-100 visible sm:translate-y-0 h-auto' :'opacity-0 invisible sm:-translate-y-2 h-0 sm:h-auto'}
   `}>
   <button
   onClick={(e) => {
   e.preventDefault();
   i18n.changeLanguage('zh');
   setIsLangOpen(false);
   setIsMobileMenuOpen(false);
  }}
   className={`block w-full text-center px-4 py-2.5 sm:py-2 text-sm font-medium hover:bg-black/5 :bg-white/5 transition-colors ${i18n.language === 'zh' ? 'text-xianxia-red font-serif' : 'text-xianxia-text hover:text-xianxia-red'}`}
   >中文</button>
   <button
   onClick={(e) => {
   e.preventDefault();
   i18n.changeLanguage('en');
   setIsLangOpen(false);
   setIsMobileMenuOpen(false);
  }}
   className={`block w-full text-center px-4 py-2.5 sm:py-2 text-sm font-medium hover:bg-black/5 :bg-white/5 transition-colors ${i18n.language === 'en' ? 'text-xianxia-red font-serif' : 'text-xianxia-text hover:text-xianxia-red'}`}
   >
   English
   </button>
   </div>
 </div>
 </div>
 </div>
 </nav>
 </div>
 </header>
 </>
 );
};

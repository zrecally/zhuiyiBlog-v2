import React, { useEffect, useState} from'react';
import { useToast} from'./Toast';
import { useTranslation } from 'react-i18next';
import { SkeletonArticleCard } from './Skeleton';
import { ArticleAccessGate } from './ArticleAccessGate';
import { hasArticleAccessHint, rememberArticleAccessHint } from '../lib/articleAccess';
import { isStaticSite } from '../lib/siteMode';
import type { CMSPost } from '../lib/cms';

export const ArticleList = ({ posts, onSelectPost, isArchivePage = false, isLoading = false }: { posts: CMSPost[], onSelectPost: (post: CMSPost) => void, isArchivePage?: boolean, isLoading?: boolean }) => {
 const { t } = useTranslation();
 const [searchQuery, setSearchQuery] = useState('');
 const [fullTextResults, setFullTextResults] = useState<CMSPost[] | null>(null);
 const [isSearchingContent, setIsSearchingContent] = useState(false);
 const [localStatusMap, setLocalStatusMap] = useState<Record<string, string>>({});
 const [requestingId, setRequestingId] = useState<string | null>(null);
 const { showToast} = useToast();

 // 用于控制首页展示文章数量的内部状态，初始为 6 篇
 const [displayCount, setDisplayCount] = useState(6);

 useEffect(() => {
   const hinted: Record<string, string> = {};
   posts
     .filter(post => post.accessMode === 'password' && hasArticleAccessHint(post.id))
     .forEach(post => { hinted[post.id] = 'approved'; });
   setLocalStatusMap(previous => {
     const missingHints = Object.entries(hinted).filter(([postId]) => previous[postId] !== 'approved');
     return missingHints.length > 0 ? { ...previous, ...Object.fromEntries(missingHints) } : previous;
   });
 }, [posts]);

 // 归档页在动态站使用后端全文检索，静态站则保留本地元数据筛选。
 // 这样不会把受保护文章的正文内容打进静态快照，也避免每一次按键都发请求。
 useEffect(() => {
   const query = searchQuery.trim();
   if (!isArchivePage || !query || isStaticSite) {
     setFullTextResults(null);
     setIsSearchingContent(false);
     return;
   }

   const controller = new AbortController();
   const timer = window.setTimeout(async () => {
     setIsSearchingContent(true);
     try {
       const response = await fetch(`/api/v1/posts/search?q=${encodeURIComponent(query)}`, {
         signal: controller.signal,
         credentials: 'same-origin',
         headers: { Accept: 'application/json' },
       });
       const payload = await response.json().catch(() => ({}));
       if (!response.ok || payload.success === false) {
         throw new Error(payload.message || '搜索服务暂不可用');
       }
       setFullTextResults(Array.isArray(payload.data) ? payload.data : []);
     } catch (error) {
       if ((error as Error).name !== 'AbortError') {
         setFullTextResults([]);
         showToast({ message: '全文搜索暂不可用，请稍后重试', type: 'error' });
       }
     } finally {
       if (!controller.signal.aborted) setIsSearchingContent(false);
     }
   }, 280);

   return () => {
     window.clearTimeout(timer);
     controller.abort();
   };
 }, [isArchivePage, searchQuery, showToast]);

 const handleRequestAccess = async (postId: string) => {
 const token = localStorage.getItem('user_token');
 if (!token) return;

 setRequestingId(postId);
 try {
 const res = await fetch(`/api/v1/posts/${postId}/request-access`, {
 method:'POST',
 headers: {'Authorization': `Bearer ${token}`}
});
 const data = await res.json();
 if (data.success) {
 showToast({ message:'申请已提交，请等待审核', type:'success'});
 setLocalStatusMap(prev => ({ ...prev, [postId]:'pending'}));
} else {
 showToast({ message: data.message ||'申请失败', type:'error'});
}
} catch (e) {
 showToast({ message:'网络错误', type:'error'});
} finally {
 setRequestingId(null);
}
};

 const handlePasswordAccess = async (article: CMSPost, password: string) => {
   setRequestingId(article.id);
   try {
     const res = await fetch(`/_access/posts/${encodeURIComponent(article.id)}/redeem`, {
       method: 'POST',
       credentials: 'same-origin',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ password }),
     });
     const data = await res.json().catch(() => ({}));
     if (!res.ok || data.success === false) {
       showToast({ message: data.message || '密码无效、已使用或已过期', type: 'error' });
       return false;
     }
     rememberArticleAccessHint(article.id, data.expiresAt);
     setLocalStatusMap(prev => ({ ...prev, [article.id]: 'approved' }));
     showToast({ message: '密码验证成功', type: 'success' });
     onSelectPost({ ...article, accessStatus: 'approved' });
     return true;
   } catch {
     showToast({ message: '验证服务暂不可用，请稍后重试', type: 'error' });
     return false;
   } finally {
     setRequestingId(null);
   }
 };

  // 统计分类的数量
  const categoryCounts = posts.reduce<Record<string, number>>((acc, post) => {
    if (post.category) {
      acc[post.category] = (acc[post.category] || 0) + 1;
    }
    return acc;
  }, {});
  // 按数量倒序排列
  const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);

  const tagCounts = posts.reduce<Record<string, number>>((acc, post) => {
    if (post.tags && Array.isArray(post.tags)) {
      post.tags.forEach((tag: string) => {
        acc[tag] = (acc[tag] || 0) + 1;
      });
    }
    return acc;
  }, {});

  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

  const FilterOverview = (
    <div className="mb-10 space-y-4 flex flex-col items-start px-2">
      {sortedCategories.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <span className="font-kai text-xianxia-jade/80 font-bold text-sm tracking-widest mr-1">分类：</span>
          {sortedCategories.map(([cat, count], index) => {
            const isActive = searchQuery === cat;
            return (
              <React.Fragment key={cat}>
                <span
                  className={`cursor-pointer flex items-baseline font-kai text-sm tracking-wide transition-all hover:scale-105 dark:scale-100 duration-300 dark:underline ${isActive ? 'text-xianxia-red font-bold underline decoration-dashed underline-offset-4' : 'text-xianxia-text/80 hover:text-xianxia-red dark:text-[#C83C23]'}`}
                  onClick={() => setSearchQuery(isActive ? '' : cat)}
                >
                  {t(cat)} <span className={`text-[10px] ml-1 font-sans ${isActive ? 'text-xianxia-red/70' : 'text-xianxia-text/40'}`}>[{count}]</span>
                </span>
                {index < sortedCategories.length - 1 && (
                  <span className="text-xianxia-jade/30 font-light text-xs mx-1">
                    /
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
      {sortedTags.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 mt-4">
          <span className="font-kai text-xianxia-jade/80 font-bold text-sm tracking-widest mr-1">标签：</span>
          {sortedTags.map(([tag, count], index) => {
            const currentTag = new URLSearchParams(window.location.search).get('tag');
            const isActive = currentTag === tag;
            return (
              <React.Fragment key={tag}>
                <span
                  className={`cursor-pointer flex items-baseline font-kai text-sm tracking-wide transition-all hover:scale-105 dark:scale-100 duration-300 dark:underline ${isActive ? 'text-xianxia-red font-bold underline decoration-dashed underline-offset-4' : 'text-xianxia-text/80 hover:text-xianxia-red dark:text-[#C83C23]'}`}
                  onClick={() => {
                    const urlParams = new URLSearchParams(window.location.search);
                    if (isActive) {
                      urlParams.delete('tag');
                    } else {
                      urlParams.set('tag', tag);
                    }
                    const newSearch = urlParams.toString();
                    window.dispatchEvent(new CustomEvent('navigate', { detail: `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}` }));
                  }}
                >
                  #{t(tag)} <span className={`text-[10px] ml-1 font-sans ${isActive ? 'text-xianxia-red/70' : 'text-xianxia-text/40'}`}>[{count}]</span>
                </span>
                {index < sortedTags.length - 1 && (
                  <span className="text-xianxia-jade/30 font-light text-xs mx-1">
                    /
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );

 // 首页只显示 displayCount 篇文章，归档页（/posts）显示全部
 const displayPosts = isArchivePage ? posts : posts.slice(0, displayCount);
 const isFullTextSearch = isArchivePage && Boolean(searchQuery.trim()) && !isStaticSite;
 const searchablePosts = isFullTextSearch ? (fullTextResults || []) : displayPosts;

  const filteredPosts = searchablePosts.filter(post => {
    const urlParams = new URLSearchParams(window.location.search);
    const selectedTag = urlParams.get('tag');

    // 如果有 URL 参数中的 tag，先按照 tag 过滤
    if (selectedTag) {
      if (!post.tags || !post.tags.includes(selectedTag)) {
        return false;
      }
    }

    // 再按照搜索框关键词过滤
    if (searchQuery && !isFullTextSearch) {
      const q = searchQuery.toLowerCase();
      return post.title.toLowerCase().includes(q) ||
             (post.summary && post.summary.toLowerCase().includes(q)) ||
             (post.category && post.category.toLowerCase().includes(q)) ||
             (post.tags && post.tags.some((tag: string) => tag.toLowerCase().includes(q)));
    }

    return true;
  });

  return (
 <>
 {!isArchivePage && (
 <div className="flex items-center justify-center my-20">
   <div className="h-[2px] w-20 md:w-40 bg-gradient-to-r from-transparent via-xianxia-jade/40 to-xianxia-jade/80"></div>
   <span className="px-6 font-kai text-xl md:text-2xl text-xianxia-text tracking-[0.5em] ml-[0.5em]">{t('文章录')}</span>
   <div className="h-[2px] w-20 md:w-40 bg-gradient-to-l from-transparent via-xianxia-jade/40 to-xianxia-jade/80"></div>
   </div>
   )}

   {!isArchivePage && (
   <div className="relative flex items-center justify-center w-full max-w-4xl px-0 mx-auto my-12 hidden">
   <div className="relative w-full pl-5 overflow-x-hidden md:pl-0">
   <div className="absolute w-full h-px bg-gradient-to-r from-transparent to-[#F7F4EB] md:from-[#F7F4EB] md:via-transparent md:to-[#F7F4EB]"></div>
   <div className="w-full h-px border-t border-dashed border-[#E2DDCF]"></div>
   </div>
   <div className="absolute flex items-center justify-center w-auto h-auto px-3 py-1.5 uppercase tracking-[0.2em] space-x-1 text-xs md:-translate-x-1/2 -translate-y-1/2 border rounded-sm bg-[#EAE5D9] text-[#4A4A4A] font-serif left-0 md:ml-0 ml-5 md:left-1/2 border-[#E2DDCF] shadow-sm">
   <p className="leading-none">{t('文章录')}</p>
 <div className="flex items-center justify-center w-5 h-5 translate-x-1 border rounded-sm border-[#E2DDCF] bg-[#F7F4EB]">
 <svg className="w-3 h-3 text-[#888]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l6.75-6.75M12 19.5l-6.75-6.75"></path>
 </svg>
 </div>
 </div>
 </div>
 )}

 {isArchivePage && (
 <div className="max-w-4xl mx-auto px-7 xl:px-0 mt-20 md:mt-24 mb-12">
 <div className="relative z-20 w-full mx-auto lg:mx-0 text-center">
 <h2 className="text-3xl font-bold tracking-[0.5em] text-xianxia-text sm:text-4xl lg:text-5xl :text-3xl :text-4xl mb-6 font-kai ml-[0.5em]">
 文章
 </h2>

 <div className="flex items-center justify-center w-full max-w-xs mx-auto opacity-40 mb-10">
 <div className="h-px w-full bg-gradient-to-r from-transparent to-xianxia-jade"></div>
 <div className="w-1.5 h-1.5 rounded-full border border-xianxia-red mx-3 flex-shrink-0 animate-pulse"></div>
 <div className="h-px w-full bg-gradient-to-l from-transparent to-xianxia-jade"></div>
 </div>

 {/* 在现代主题(水墨风)下隐藏原本杂乱的 FilterOverview，保持极致素雅；在暗色模式下保留 */}
 <div className="hidden">
 {FilterOverview}
 </div>
 </div>
 {/* 顶部标签云已被隐藏 */}

        <div className="z-50 flex flex-col w-full max-w-xl mx-auto gap-4 my-8">
 <label className="sr-only" htmlFor="searchInput">{t('搜索关键词...')}</label>
   <div className="relative flex items-center w-full">
   <input
   id="searchInput"
   type="search"
   placeholder={t('搜索关键词...')}
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full px-6 py-4 text-sm md:text-base border border-dashed rounded-full outline-none bg-xianxia-bg/40 backdrop-blur-sm border-xianxia-jade/30 focus:border-xianxia-jade focus: focus:ring-1 focus:ring-xianxia-jade :ring-0 transition-colors text-center text-xianxia-text/80 placeholder:text-xianxia-text/30 font-serif"
 autoComplete="off"
 />
 </div>
 <div className="text-xs text-xianxia-text/40 text-center font-serif tracking-widest mt-4">
   <span className="">{t('共收录')}</span>
   <span id="resultsCount" className="text-xianxia-jade/80 text-sm mx-1">{filteredPosts.length}</span>
   <span className="">{t('篇文章')}</span>
   </div>
 {isSearchingContent && (
   <div className="text-xs text-xianxia-jade/70 text-center font-serif tracking-widest animate-pulse">
     正在检索文章正文…
   </div>
 )}
 {filteredPosts.length === 0 && (
   <div className="text-sm text-xianxia-text/50 text-center font-serif mt-4">
   {isSearchingContent ? '正在匹配文章内容…' : `${t('没有匹配的文章')}，${t('换个关键词试试')}。`}
   </div>
   )}
 </div>
 </div>
 )}

 <section className="max-w-4xl mx-auto px-7 xl:px-0">
 {!isArchivePage && (
 <div className="mb-10">
 <h2 className="text-2xl font-bold leading-10 tracking-tight text-[#1A1A1A] font-sans mb-5 hidden">
 文章
 </h2>
 {FilterOverview}
 </div>
 )}

 <div className="flex flex-col gap-4">
 {isLoading ? (
   // 渲染骨架屏
   Array.from({ length: displayCount }).map((_, i) => (
     <SkeletonArticleCard key={`skeleton-${i}`} />
   ))
 ) : (
   filteredPosts.map((article, i) => {
 const currentAccessStatus = localStatusMap[article.id] || article.accessStatus ||'none';
 const isLocked = article.isPrivate && currentAccessStatus !== 'approved';

 return (
 <div
 key={i}
 className={`relative block p-6 sm:p-8 group transition-all duration-500 rounded-xl overflow-visible ${!isLocked ?'cursor-pointer' :''}`}
 onClick={() => {
 // 受保护文章在卡片遮罩内先完成验证；卡片本身不是链接，
 // 因此不能经由浏览器默认导航绕过这一步直接进入文章页。
 if (!isLocked) {
 onSelectPost({
   ...article,
   searchQuery: article.matchedInContent ? searchQuery.trim() : undefined,
 }); // 维持现有的 SPA 状态切换逻辑
}
}}
 tabIndex={0}
 >
 {/* 私密遮罩层 */}
 {isLocked && (
 <ArticleAccessGate
   mode={article.accessMode === 'password' ? 'password' : 'approval'}
   variant="card"
   title={article.title}
   status={currentAccessStatus}
   requesting={requestingId === article.id}
   onRequestApproval={() => handleRequestAccess(article.id)}
   onRedeemPassword={(password) => handlePasswordAccess(article, password)}
 />
 )}

 {/* 优雅的底层承托：与主背景同色，依靠细微的阴影和边框勾勒形状 */}
 <div className="absolute inset-0 z-10 w-full h-full bg-xianxia-bg/60 backdrop-blur-md rounded-xl border border-xianxia-jade/20 shadow-[0_4px_20px_-4px_rgba(163,198,177,0.1)] (0,0,0,0.02)] transition-all duration-500 ease-out group-hover:bg-xianxia-bg/80 group-hover:border-xianxia-jade/40 :border-neutral-300/50 group-hover:shadow-[0_8px_30px_-4px_rgba(163,198,177,0.2)] :shadow-[0_8px_30px_-4px_rgba(0,0,0,0.06)] group-hover:-translate-y-1"></div>

 {/* 极简的侧边点缀线，暗示这是一个独立的区块 */}
 <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-12 bg-xianxia-jade/30 rounded-r-full z-20 transition-all duration-500 group-hover:bg-xianxia-red/50 :bg-[#C83C23]/50 group-hover:h-20 :h-12"></div>

 {/* 长条状标签印章 */}
 <div className="absolute bottom-6 right-6 md:bottom-8 md:right-8 z-10 pointer-events-none opacity-40 group-hover:opacity-90 :opacity-80 group-focus:opacity-90 :opacity-80 transition-all duration-700 flex flex-col items-end mix-blend-multiply">
 {(article.tags && article.tags.length > 0 ? article.tags : [article.category ||'藏卷']).map((tag: string, tagIndex: number) => (
 <div
 key={tagIndex}
 className={`border-[2px] border-xianxia-red/90 rounded-[4px] px-3 py-1 flex items-center justify-center bg-xianxia-red/5 shadow-sm transform transition-transform duration-500 group-hover:scale-105 group-focus:scale-105 max-w-[200px] md:max-w-[300px] ${
 ['-rotate-3 translate-x-0','rotate-6 -translate-x-4 -mt-1','-rotate-6 -translate-x-1 -mt-2','rotate-3 -translate-x-5 -mt-1'][tagIndex % 4]
}`}
 style={{
 maskImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 6 -2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' fill='white' filter='url(%23noise)'/%3E%3C/svg%3E")`,
 WebkitMaskImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 6 -2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' fill='white' filter='url(%23noise)'/%3E%3C/svg%3E")`
}}
 >
 <span className="font-serif font-black text-xianxia-red/90 text-[11px] md:text-xs leading-tight tracking-[0.1em] truncate">
 {t(tag)}
 </span>
 </div>
 ))}
 </div>

 <div className="flex relative z-30 transition-transform duration-500 ease-out group-hover:-translate-y-1 group-focus:-translate-y-1">
 {/* 封面图片：默认隐藏，hover/focus时在左侧优雅展开 */}
 {(!isLocked && article.image) && (
 <div className="hidden md:block shrink-0 relative overflow-hidden rounded-lg shadow-sm border border-xianxia-border mt-1 transition-all duration-700 ease-[cubic-bezier(0.4,0,0.2,1)] w-0 h-28 opacity-0 mr-0 group-hover:w-32 group-hover:opacity-100 group-hover:mr-6 group-focus:w-32 group-focus:opacity-100 group-focus:mr-6">
 <img
 src={article.image}
 alt={article.title}
 className="absolute inset-0 w-full h-full object-cover transition-all duration-500 group-hover:scale-105"
 />
 </div>
 )}

 <div className="flex-1 pr-4 md:pr-16">
 <h2 className="mb-4">
 <span className="text-xl sm:text-2xl text-xianxia-text font-kai font-semibold tracking-wide group-hover:text-xianxia-red :text-[#C83C23] transition-colors duration-300">
 {article.title}
 </span>
 </h2>
 <p className="text-sm md:text-base text-xianxia-text/80 line-clamp-3 break-all font-serif leading-loose mb-6">
 {article.matchedSnippet || article.summary}
 </p>
 {article.matchedInContent && (
   <span className="inline-flex mb-5 text-xs font-serif tracking-wider text-xianxia-jade/80">
     正文命中
   </span>
 )}

 {/* 元信息：清晰但克制 */}
 <div className="flex items-center text-xs text-xianxia-text/50 font-serif">
 <span>{article.date}</span>
 <span className="mx-4 text-xianxia-jade/30">|</span>
 <span className="group-hover:text-xianxia-red/80 :text-[#C83C23] transition-colors duration-300">
 {t(article.category)}
 </span>
 </div>
 </div>
 </div>
 </div>
 );
})
)}
 </div>

 {!isArchivePage && posts.length > displayCount && !isLoading && (
 <div className="flex justify-center mt-12 mb-4">
 <button
 onClick={() => {
 setDisplayCount(prev => prev + 6);
}}
 className="px-8 py-2.5 bg-xianxia-bg/80 hover:bg-xianxia-jade/20 :bg-neutral-700 text-xianxia-text/60 rounded-full text-sm font-medium transition-colors duration-300 shadow-sm"
   >
   {t('查看更多')}
   </button>
 </div>
 )}
 </section>
 </>
 );
};

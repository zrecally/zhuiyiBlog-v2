import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CommentSection } from './Comments/CommentSection';
import { useToast } from './Toast';
import { MarkdownContent } from './markdown/MarkdownContent';
import { ArticleSideToc } from './markdown/ArticleSideToc';
import { extractHeadings } from './markdown/markdownUtils';
import { isStaticSite, staticDataUrl } from '../lib/siteMode';
import { ArticleAccessGate } from './ArticleAccessGate';

interface MarkdownViewerProps {
  post: {
    id: string;
    title: string;
    date: string;
    category: string;
    image: string;
    content: string;
    isPrivate?: boolean;
    accessMode?: 'public' | 'approval' | 'password';
    tags?: string[];
    views?: number; // 新增，修复 TypeScript 报错
  };
  onBack: () => void;
  hideComments?: boolean; // 新增属性，用于隐藏评论区
  searchQuery?: string;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ post, onBack, hideComments = false, searchQuery = ''}) => {
 const [content, setContent] = useState(post.content ||'');
 const [loading, setLoading] = useState(!post.content);
 const [accessStatus, setAccessStatus] = useState<string>('none');
 const [requesting, setRequesting] = useState(false);
  const [currentViews, setCurrentViews] = useState<number | undefined>(post.views);
  const articleContentRef = useRef<HTMLElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    const terms = searchQuery.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const article = articleContentRef.current;
    if (loading || !content || !article || terms.length === 0) return;

    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        expression.lastIndex = 0;
        const matches = expression.test(node.textContent || '');
        return !parent?.closest('pre, code, mark') && matches
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const matchedNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) matchedNodes.push(node as Text);

    let firstMatch: HTMLElement | null = null;
    matchedNodes.forEach((textNode) => {
      const fragment = document.createDocumentFragment();
      const text = textNode.textContent || '';
      let lastIndex = 0;
      expression.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = expression.exec(text))) {
        fragment.append(text.slice(lastIndex, match.index));
        const mark = document.createElement('mark');
        mark.dataset.searchHit = 'true';
        mark.className = 'rounded bg-xianxia-jade/30 px-0.5 text-inherit transition-colors';
        mark.textContent = match[0];
        fragment.append(mark);
        firstMatch ||= mark;
        lastIndex = match.index + match[0].length;
      }
      fragment.append(text.slice(lastIndex));
      textNode.replaceWith(fragment);
    });

    if (firstMatch) {
      requestAnimationFrame(() => firstMatch?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }, [content, loading, searchQuery]);

  useEffect(() => {

 // 新增：如果用户已登录，记录浏览历史
 const token = isStaticSite ? null : localStorage.getItem('user_token');
 if (token) {
   // 在新架构中，Anti-Replay 会对非 GET 拦截并强制签名，
   // 但是如果请求过快，可能导致时间戳或 nonce 不一致被 403 拦截，或者由于 JSON 序列化不一致导致签名失败
   const bodyObj = { postId: post.id, postTitle: post.title };
   fetch('/api/v1/user/history', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${token}`
     },
     body: JSON.stringify(bodyObj)
   }).then(res => {
     if (res.status === 403) {
       console.warn('[History] 防重放校验失败，可能是并发或签名不一致导致');
     }
   }).catch(console.error);
 }

 // 检查登录状态
 const currentToken = isStaticSite
   ? null
   : localStorage.getItem('user_token');

 // 强制同步设置 loading，防止首屏出现内容闪烁
 const shouldLoad = !post.content;
 setLoading(shouldLoad);

 // 如果已经有正文内容，直接使用缓存的内容，不再发起网络请求
 if (!shouldLoad) {
 setContent(post.content);
 // 即使有缓存，如果它是私密文章，也需要后端接口确认权限，这里可以简单地依赖外层组件是否把它渲染出来了
 return;
}

 // 重置状态
 setContent('');

 if (shouldLoad) {
   const headers: Record<string, string> = {};
   if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;

  // 传递语言标识到后端
  const currentLang = localStorage.getItem('i18nextLng') || 'zh';

  // CDN 加速开发预留逻辑（暂不实装，默认保留原逻辑）
  const useCdn = import.meta.env.VITE_USE_CDN_CACHE === 'true';
  const cdnBaseUrl = import.meta.env.VITE_CDN_BASE_URL || '';
  const url = post.accessMode === 'password'
    ? `/_access/posts/${encodeURIComponent(post.id)}/content`
    : isStaticSite
    ? staticDataUrl(`post_${encodeURIComponent(post.id)}.json`)
    : useCdn && cdnBaseUrl && !post.isPrivate
      ? `${cdnBaseUrl}/cache/post_${post.id}.json`
      : `/api/v1/posts/${post.id}/content?lang=${currentLang}`;

  // 这里直接发起 fetch，依赖 useEffect 避免重复发起
  fetch(url, { headers, credentials: 'same-origin' })
    .then(res => res.json())
    .then(data => {
      const snapshotContent = data.content ?? data.data?.content;
      if (data.success !== false && typeof snapshotContent === 'string') {
        setContent(snapshotContent);
        if (data.isPrivate) {
          setAccessStatus(data.accessStatus || 'none');
        }
      } else if (data.isPrivate) {
        setAccessStatus(data.accessStatus || 'none');
        setContent('PRIVATE_LOCKED');
      } else {
        setContent('加载失败，请稍后重试');
      }
    })
    .catch(err => {
      console.error("加载文章失败:", err);
      setContent('网络错误，加载文章失败。');
    })
    .finally(() => {
      setLoading(false);
    });

  // 每次组件挂载（也就是文章被打开）时增加文章的访问量
  if (!isStaticSite) {
    fetch(`/api/v1/posts/${post.id}/visit`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.views !== undefined) {
          setCurrentViews(data.views);
        }
      })
      .catch(console.error);
  }
}
}, [post.id, post.content, post.isPrivate, post.accessMode, post.title]); // 仅依赖参与加载和浏览历史的文章字段

 // 轮询检查文章申请状态
 useEffect(() => {
 let intervalId: NodeJS.Timeout;

 if (!isStaticSite && post.accessMode !== 'password' && accessStatus ==='pending' && content ==='PRIVATE_LOCKED') {
 intervalId = setInterval(async () => {
 const token = localStorage.getItem('user_token');
 const headers: Record<string, string> = {};
 if (token) headers['Authorization'] = `Bearer ${token}`;

 try {
   const currentLang = localStorage.getItem('i18nextLng') || 'zh';

   // 轮询权限状态，只能请求后端接口，不能走 CDN
   const url = `/api/v1/posts/${post.id}/content?lang=${currentLang}`;

   const res = await fetch(url, { headers});
 const data = await res.json();

 if (data.success && data.content) {
 // 申请已通过，自动解锁并展示正文
 setContent(data.content);
 setAccessStatus('approved');
 clearInterval(intervalId);
} else if (data.isPrivate && data.accessStatus) {
 if (data.accessStatus !=='pending') {
 setAccessStatus(data.accessStatus);
 if (data.accessStatus ==='rejected') {
 clearInterval(intervalId);
}
}
}
} catch (err) {
 console.error("轮询状态失败:", err);
}
}, 3000); // 每 3 秒检查一次
}

 return () => {
 if (intervalId) clearInterval(intervalId);
};
}, [accessStatus, content, post.id, post.accessMode]);

 const handleRequestAccess = async () => {
 if (isStaticSite) {
 showToast({ message:'该功能未在静态站开放', type:'info'});
 return;
 }

 const token = localStorage.getItem('user_token');
 if (!token) return;

 setRequesting(true);
 try {
 const res = await fetch(`/api/v1/posts/${post.id}/request-access`, {
 method:'POST',
 headers: {
'Authorization': `Bearer ${token}`
}
});
 const data = await res.json();
 if (data.success) {
 showToast({ message: data.message, type:'success'});
 setAccessStatus('pending');
} else {
 showToast({ message: data.message ||'申请失败', type:'error'});
}
} catch (e) {
 showToast({ message:'网络错误', type:'error'});
} finally {
 setRequesting(false);
}
};

 const handlePasswordAccess = async (password: string) => {
   setRequesting(true);
   try {
     const redeemResponse = await fetch(`/_access/posts/${encodeURIComponent(post.id)}/redeem`, {
       method: 'POST',
       credentials: 'same-origin',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ password }),
     });
     const redeemData = await redeemResponse.json().catch(() => ({}));
     if (!redeemResponse.ok || redeemData.success === false) {
       showToast({ message: redeemData.message || '密码无效、已使用或已过期', type: 'error' });
       return false;
     }

     const contentResponse = await fetch(`/_access/posts/${encodeURIComponent(post.id)}/content`, {
       credentials: 'same-origin',
       headers: { Accept: 'application/json' },
     });
     const contentData = await contentResponse.json().catch(() => ({}));
     if (!contentResponse.ok || !contentData.success || typeof contentData.content !== 'string') {
       showToast({ message: contentData.message || '正文暂不可用，请稍后重试', type: 'error' });
       return false;
     }
     setContent(contentData.content);
     setAccessStatus('approved');
     showToast({ message: '密码验证成功', type: 'success' });
     return true;
   } catch {
     showToast({ message: '验证服务暂不可用，请稍后重试', type: 'error' });
     return false;
   } finally {
     setRequesting(false);
   }
 };

 const renderPrivateLock = () => {
 return (
 <ArticleAccessGate
   mode={post.accessMode === 'password' ? 'password' : 'approval'}
   variant="page"
   title={post.title}
   status={accessStatus}
   requesting={requesting}
   onRequestApproval={handleRequestAccess}
   onRedeemPassword={handlePasswordAccess}
 />
 );
};

  const [isTocOpen, setIsTocOpen] = useState(false);
  const headings = useMemo(() => extractHeadings(content), [content]);

  const topTocRef = useRef<HTMLDivElement>(null);
  const [showSideToc, setShowSideToc] = useState(false);
  const [activeId, setActiveId] = useState<string>('');

  // 监听顶部目录是否离开可视区域，控制侧边目录的显示与隐藏
  useEffect(() => {
    if (!topTocRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowSideToc(!entry.isIntersecting);
      },
      { rootMargin: '-100px 0px 0px 0px' }
    );
    observer.observe(topTocRef.current);
    return () => observer.disconnect();
  }, []);

  // 监听文章标题滚动位置，实现滚动高亮
  useEffect(() => {
    const headingElements = headings.map(h => document.getElementById(h.id)).filter(Boolean);
    if (headingElements.length === 0) return;

    const callback: IntersectionObserverCallback = (entries) => {
      const visible = entries.filter(e => e.isIntersecting);
      if (visible.length > 0) {
        // 取最上方可见的标题作为当前高亮项
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActiveId(visible[0].target.id);
      }
    };

    const observer = new IntersectionObserver(callback, {
      rootMargin: '-100px 0px -40% 0px'
    });

    headingElements.forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

 return (
 <div className="w-full mt-4 md:mt-8 px-4 sm:px-6">
 <div className="max-w-4xl mx-auto relative group">
 {/* “冂”字形背景与边框（恢复原先的水墨边框参数） */}
 <div
 className="absolute inset-0 bg-transparent border-t border-x border-xianxia-jade/20/60 rounded-t-2xl shadow-[0_8px_30px_rgb(0,0,0,0.02)] pointer-events-none transition-all duration-300 group-hover:shadow-[0_15px_40px_rgb(0,0,0,0.06)]"
 style={{
 maskImage:
"linear-gradient(to bottom, black 60%, transparent 100%)",
 WebkitMaskImage:
"linear-gradient(to bottom, black 60%, transparent 100%)",
}}
 ></div>

 {/* 左上角翻页/折角效果（作为返回按钮），已改为圆角卷边并与边框优雅衔接 */}
 <button
 onClick={onBack}
 className="absolute -top-[1px] -left-[1px] w-12 h-12 z-30 cursor-pointer outline-none focus:outline-none group/corner overflow-hidden rounded-tl-2xl"
 aria-label="返回上一页"
 title="返回"
 >
 {/*
 折角的本体（圆角卷起部分）
 加入 border 与主体边框保持一致，消除割裂感
 */}
 <div className="absolute top-0 left-0 w-[28px] h-[28px]
 bg-white/80 backdrop-blur-sm
 border-b border-r border-xianxia-text/20
 rounded-br-[14px]
 shadow-[2px_2px_5px_rgba(0,0,0,0.08)] (0,0,0,0.08)]
 transition-all duration-300 ease-out origin-top-left
 group-hover/corner:w-[36px] group-hover/corner:h-[36px]
 group-hover/corner:shadow-[3px_3px_8px_rgba(0,0,0,0.15)]
 group-hover/corner:bg-white :bg-[#EAE5D9]
"></div>

 {/* 卷角的阴影遮罩（制造立体感） */}
 <div className="absolute top-0 left-0 w-[40px] h-[40px] -translate-x-[20px] -translate-y-[20px] rotate-45 bg-gradient-to-br from-transparent via-xianxia-text/10 to-transparent pointer-events-none transition-all duration-300 group-hover/corner:w-[50px] group-hover/corner:h-[50px] group-hover/corner:-translate-x-[25px] group-hover/corner:-translate-y-[25px]"></div>

 {/* 底下的纸张缺角修饰（圆角镂空效果，完美匹配底色，制造出真正的镂空错觉） */}
 <div className="absolute top-0 left-0 w-[28px] h-[28px]
 bg-xianxia-bg
 rounded-br-[14px]
 transition-all duration-300 ease-out origin-top-left -z-10
 group-hover/corner:w-[36px] group-hover/corner:h-[36px]
"></div>
 </button>

 {/* 顶部导航与标题区域内容 */}
 <div className="relative z-10 px-6 pt-16 sm:px-14 sm:pt-20 pb-8 min-h-[200px]">
          <h1 className="w-full max-w-2xl mx-auto text-3xl font-bold text-left md:mb-8 md:text-4xl lg:text-5xl leading-tight flex items-center gap-3">
            {post.isPrivate && (
              <svg className="w-8 h-8 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7z" />
              </svg>
            )}
            {post.title}
          </h1>

          <div className="w-full max-w-2xl mx-auto mb-6 font-semibold text-neutral-500 flex items-center flex-wrap gap-y-2 gap-x-1 text-sm md:text-base">
            <span>{post.date}</span>
            <span className="mx-2">·</span>
            <span className="hover:underline decoration-dashed underline-offset-4 cursor-pointer dark:text-[#C83C23] transition-colors">{post.category}</span>
            {currentViews !== undefined && (
              <>
                <span className="mx-2 text-xianxia-jade/30">|</span>
                <span className="flex items-center gap-1.5 text-xianxia-text/70">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  {currentViews}
                </span>
              </>
            )}
          </div>

        {/* 顶部目录 */}
        <div className="w-full max-w-2xl mx-auto mb-4" ref={topTocRef}>
          <details
            className="group border border-neutral-200 rounded-xl bg-white/50"
            open={isTocOpen}
            onClick={(e) => {
              e.preventDefault();
              setIsTocOpen(!isTocOpen);
            }}
          >
            <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none">
              <span className="text-xs font-semibold tracking-[0.14em] uppercase text-neutral-500">目录</span>
              <span className={`text-xs text-neutral-500 ${isTocOpen ? 'hidden' : 'inline'}`}>展开</span>
              <span className={`text-xs text-neutral-500 ${isTocOpen ? 'inline' : 'hidden'}`}>收起</span>
            </summary>
            {isTocOpen && (
              <nav aria-label="文章目录" className="mt-2 px-4 pb-4 space-y-2 text-sm text-neutral-600 max-h-96 overflow-y-auto">
                {headings.length > 0 ? (
                  <ul className="space-y-2">
                    {headings.map((heading, index) => (
                      <li key={index} style={{ paddingLeft: `${(heading.level - 1) * 1}rem` }}>
                        <a
                          href={`#${heading.id}`}
                          className="hover:text-neutral-900 dark:text-[#C83C23] transition-colors block truncate relative before:absolute before:-left-3 before:top-1/2 before:-translate-y-1/2 before:w-1 before:h-1 before:bg-neutral-300 dark:bg-[#888] before:rounded-full"
                          onClick={(e) => {
                            e.preventDefault();
                            const target = document.getElementById(heading.id);
                            if (target) {
                              // 考虑到顶部有可能会被遮挡，稍微加上一点偏移量
                              const top = target.getBoundingClientRect().top + window.scrollY - 100;
                              window.scrollTo({ top, behavior: 'smooth' });
                            }
                          }}
                        >
                          {heading.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="italic text-neutral-400">本文暂无目录</div>
                )}
              </nav>
            )}
          </details>
        </div>

 </div>
 </div>

 {/* 首图（移出边框外） */}
 {post.image && (
 <div className="relative z-10 w-full max-w-4xl mx-auto mb-12 px-4 sm:px-6">
 <div className="w-full max-w-2xl mx-auto rounded-2xl overflow-hidden bg-neutral-100 aspect-[21/9]">
 <img src={post.image} alt={post.title} className="w-full h-full object-cover transition-all duration-700" />
 </div>
 </div>
 )}

 {/* 正文区域（接在敞开的口子下方） */}
 <section className="relative w-full max-w-2xl mx-auto mb-20 px-6 sm:px-12 lg:px-0 min-h-[70vh]">
 <article ref={articleContentRef} className="w-full max-w-2xl mx-auto prose-sm prose lg:prose-lg prose-h3:font-bold prose-h4:font-bold prose-code:font-medium prose-code:before:content-none prose-code:after:content-none prose-a:underline prose-a:decoration-dashed prose-a:decoration-neutral-300 prose-a:underline-offset-4 prose-a:text-inherit prose-a:font-normal :font-serif :text-[#1A1A1A] :text-[#1A1A1A] :font-serif :decoration-[#888] :prose-a:text-[#C83C23] :text-[#1A1A1A] :font-serif :text-[#1A1A1A] :font-serif :text-[#C83C23] :bg-[#EAE5D9] :px-1.5 :py-0.5 :rounded-md :bg-[#EAE5D9] :text-[#1A1A1A] :text-[#1A1A1A] :text-[#1A1A1A]">
 {loading ? (
 <div className="flex flex-col items-center justify-center my-20 gap-4">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-neutral-900"></div>
 <p className="text-neutral-500 text-sm animate-pulse">
 正在加载文章内容...
 </p>
 </div>
 ) : content ==='PRIVATE_LOCKED' ? (
 renderPrivateLock()
 ) : (
 <MarkdownContent content={content} />
 )}
 </article>
 </section>

      <ArticleSideToc headings={headings} activeId={activeId} visible={showSideToc} />

 {/* 底部导航与评论区（根据属性决定是否显示评论） */}
 <div className="max-w-4xl mx-auto px-4 sm:px-6 mt-12 pb-12">
 {loading ? null : !isStaticSite && !hideComments && (
 <div className="max-w-2xl mx-auto px-7 lg:px-0">
 <CommentSection postId={post.id} />
 </div>
 )}
 </div>
 </div>
 );
};

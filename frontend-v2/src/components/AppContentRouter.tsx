import { lazy, Suspense, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArticleList } from './ArticleList';
import { BannedPage } from './BannedPage';
import { FriendsPage } from './FriendsPage';
import { Hero } from './Hero';
import { Projects } from '../pages/Projects';
import { NotFoundPage } from '../pages/NotFoundPage';
import { isStaticSite } from '../lib/siteMode';
import type { CMSPost, SiteConfig } from '../lib/cms';

const AboutPage = lazy(() => import('./AboutPage').then(module => ({ default: module.AboutPage })));
const DanmakuPage = lazy(() => import('./DanmakuPage').then(module => ({ default: module.DanmakuPage })));
const MarkdownViewer = lazy(() => import('./MarkdownViewer').then(module => ({ default: module.MarkdownViewer })));
const TimelinePage = lazy(() => import('./TimelinePage').then(module => ({ default: module.TimelinePage })));
const AlbumPage = lazy(() => import('../pages/AlbumPage').then(module => ({ default: module.AlbumPage })));
const VotingPage = lazy(() => import('../pages/VotingPage').then(module => ({ default: module.VotingPage })));

const RouteBoundary = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-sm text-xianxia-text/55">正在加载页面...</div>}>
    {children}
  </Suspense>
);

const StaticUnavailablePage = () => (
  <div className="min-h-[60vh] flex flex-col items-center justify-center gap-5 px-6 text-center">
    <p className="text-xl font-kai tracking-widest text-xianxia-text">该功能未在静态站开放</p>
    <a
      href="/"
      onClick={(event) => {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('navigate', { detail: '/' }));
      }}
      className="text-sm font-serif text-xianxia-red hover:underline underline-offset-4"
    >
      返回首页
    </a>
  </div>
);

interface AppContentRouterProps {
  currentPath: string;
  loading: boolean;
  timelineLoading: boolean;
  posts: CMSPost[];
  selectedPost: CMSPost | null;
  setCurrentPath: (path: string) => void;
  setSelectedPost: (post: CMSPost | null) => void;
  siteConfig: SiteConfig | null;
  timelinePosts: CMSPost[];
  hiddenNavLinks?: string[];
}

export const AppContentRouter = ({
  currentPath,
  loading,
  timelineLoading,
  posts,
  selectedPost,
  setCurrentPath,
  setSelectedPost,
  siteConfig,
  timelinePosts,
  hiddenNavLinks = [],
}: AppContentRouterProps) => {
 const { t } = useTranslation();
 const visiblePosts = isStaticSite
   ? posts.filter((post) => !post.isPrivate || post.accessMode === 'password')
   : posts;
 const unavailableStaticPaths = ['/admin', '/auth', '/login', '/danmaku', '/tools/vote', '/test-'];

 if (isStaticSite && unavailableStaticPaths.some((path) => currentPath.startsWith(path))) {
    return <StaticUnavailablePage />;
  }

   // 优先处理文章详情页的路由匹配
  if (currentPath.startsWith('/posts/')) {
    const postId = currentPath.split('/posts/')[1]?.split('?')[0];
    const searchQuery = new URLSearchParams(currentPath.split('?')[1] || '').get('q') || '';
    if (postId) {
      if (selectedPost && selectedPost.id === postId) {
        // 已经加载并匹配到了对应的文章
        return (
          <div className="min-h-[100vh] w-full">
            <RouteBoundary><MarkdownViewer key={`${selectedPost.id}:${searchQuery}`} post={selectedPost} searchQuery={searchQuery} hideComments={isStaticSite} onBack={() => {
              setSelectedPost(null);
              const backPath ='/posts';
              window.history.pushState({},'', backPath);
              setCurrentPath(backPath);
            }} /></RouteBoundary>
          </div>
        );
      } else {
        // 正在等待 posts 加载，或者文章不存在
        if (loading) {
          return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-xianxia-text"></div>
              <p className="text-xianxia-text/60 text-sm animate-pulse">稍等，正在获取文章...</p>
            </div>
          );
        } else {
          return <div className="text-center my-32 text-xianxia-text/60">文章不存在或已被删除</div>;
        }
      }
    }
  }

  if (currentPath ==='/posts' || currentPath.startsWith('/posts?')) {
    // 提取可能的分类查询参数
    const urlParams = new URLSearchParams(currentPath.split('?')[1] ||'');
    const categoryFilter = urlParams.get('category');

    const filteredPosts = (categoryFilter
      ? visiblePosts.filter(post => post.category === categoryFilter)
      : visiblePosts).filter(post => post.title !=='关于' && post.title.toLowerCase() !=='about');

    return (
      <div className="w-full">
        {loading ? (
          <div className="flex flex-col items-center justify-center my-32 gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-xianxia-text"></div>
            <p className="text-xianxia-text/60 text-sm animate-pulse">
              稍等，正在获取文章列表...
            </p>
          </div>
        ) : (
          <ArticleList posts={filteredPosts} onSelectPost={(post) => {
            setSelectedPost(post);
            const query = typeof post.searchQuery === 'string' && post.searchQuery.trim()
              ? `?q=${encodeURIComponent(post.searchQuery.trim())}`
              : '';
            const newPath = `/posts/${post.id}${query}`;
            window.history.pushState({},'', newPath);
            setCurrentPath(newPath);
          }} isArchivePage={true} />
        )}
      </div>
    );
  }

  if (currentPath.startsWith('/timeline')) {
    return (
      <div className="w-full">
        {timelineLoading ? (
          <div className="flex flex-col items-center justify-center my-32 gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-xianxia-text"></div>
            <p className="text-xianxia-text/60 text-sm animate-pulse">
              正在加载动态...
            </p>
          </div>
        ) : (
          <RouteBoundary><TimelinePage posts={timelinePosts} /></RouteBoundary>
        )}
      </div>
    );
  }

 if (currentPath.startsWith('/projects')) {
    if (hiddenNavLinks.some(link => ['站外工具', 'External Tools', '项目', 'Projects'].includes(link))) {
      return <NotFoundPage />;
    }
    return (
      <div className="w-full">
        <Projects />
      </div>
    );
  }

  if (currentPath.startsWith('/friends')) {
    return (
      <div className="w-full">
        <FriendsPage />
      </div>
    );
  }

  if (currentPath.startsWith('/about')) {
    const aboutPost = visiblePosts.find(post => post.title ==='关于' || post.title.toLowerCase() ==='about');
    return (
      <div className="w-full">
        {loading ? (
          <div className="flex flex-col items-center justify-center my-32 gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-xianxia-text"></div>
            <p className="text-xianxia-text/60 text-sm animate-pulse">
              正在加载关于内容...
            </p>
          </div>
        ) : aboutPost ? (
          <RouteBoundary><AboutPage post={aboutPost} /></RouteBoundary>
        ) : (
          <div className="flex flex-col items-center justify-center my-32 gap-4">
            <p className="text-xianxia-text/60 text-sm font-serif">
              暂无关于内容，请在 CMS 文章列表中添加一篇标题为“关于”的文章。
            </p>
          </div>
        )}
      </div>
    );
  }

 if (currentPath.startsWith('/danmaku')) {
   return (
     <div className="w-full">
       <RouteBoundary><DanmakuPage /></RouteBoundary>
     </div>
   );
 }

 if (currentPath.startsWith('/tools/vote')) {
    if (hiddenNavLinks.some(link => ['产品投票', 'Roadmap', 'Vote', '投票'].includes(link))) {
      return <NotFoundPage />;
    }
    return <RouteBoundary><VotingPage /></RouteBoundary>;
  }

  if (currentPath.startsWith('/album') || currentPath.startsWith('/tools/album')) {
    if (hiddenNavLinks.some(link => ['相册', 'Album'].includes(link))) {
      return <NotFoundPage />;
    }
    return <RouteBoundary><AlbumPage /></RouteBoundary>;
  }

  if (currentPath.startsWith('/banned')) {
    return (
      <div className="w-full">
        <BannedPage />
      </div>
    );
  }

  // 默认首页
  if (currentPath === '/' || currentPath === '/index.html' || currentPath === '') {
    return (
      <>
        <Hero config={siteConfig || undefined} />
        {loading ? (
          <div className="flex flex-col items-center justify-center my-32 gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-xianxia-text"></div>
            <p className="text-xianxia-text/60 text-sm animate-pulse">
              稍等，正在获取文章列表...
            </p>
          </div>
        ) : (
          <>
            <ArticleList posts={visiblePosts.filter(post => post.title !== '关于' && post.title.toLowerCase() !== 'about')} onSelectPost={(post) => {
              setSelectedPost(post);
              const newPath = `/posts/${post.id}`;
              window.history.pushState({}, '', newPath);
              setCurrentPath(newPath);
            }} isArchivePage={false} />

            <div className="flex items-center justify-center my-20">
              <div className="h-[2px] w-20 md:w-40 bg-gradient-to-r from-transparent via-xianxia-jade/40 to-xianxia-jade/80"></div>
              <span className="px-6 font-kai text-xl md:text-2xl text-xianxia-text tracking-[0.5em] ml-[0.5em]">{t('项目集')}</span>
              <div className="h-[2px] w-20 md:w-40 bg-gradient-to-l from-transparent via-xianxia-jade/40 to-xianxia-jade/80"></div>
            </div>
            <Projects isHome={true} />

            <div className="flex items-center justify-center my-20">
              <div className="h-[2px] w-20 md:w-40 bg-gradient-to-r from-transparent via-xianxia-jade/40 to-xianxia-jade/80"></div>
              <span className="px-6 font-kai text-xl md:text-2xl text-xianxia-text tracking-[0.5em] ml-[0.5em]">{t('友邻录')}</span>
              <div className="h-[2px] w-20 md:w-40 bg-gradient-to-l from-transparent via-xianxia-jade/40 to-xianxia-jade/80"></div>
            </div>
            <FriendsPage isHome={true} />
          </>
        )}
      </>
    );
  }

  // 兜底 404 页面
  return <NotFoundPage />;
};

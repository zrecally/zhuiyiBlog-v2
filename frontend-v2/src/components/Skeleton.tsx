import React from 'react';

// 基础占位块 (水墨呼吸)
export const SkeletonBlock = ({ className = '' }: { className?: string }) => (
  <div className={`bg-xianxia-jade/10 animate-pulse rounded-sm ${className}`} />
);

// 文章列表骨架屏
export const SkeletonArticleCard = () => (
  <article className="group cursor-pointer py-10 transition-all duration-500 hover:-translate-y-1 relative">
    <div className="absolute inset-0 bg-gradient-to-br from-xianxia-jade/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-sm" />
    <div className="flex flex-col md:flex-row gap-8 relative z-10">
      {/* 日期骨架 */}
      <div className="md:w-32 flex-shrink-0 pt-1">
        <SkeletonBlock className="h-4 w-20 mb-2" />
        <SkeletonBlock className="h-3 w-16" />
      </div>

      {/* 内容骨架 */}
      <div className="flex-1 space-y-4">
        {/* 标题 */}
        <SkeletonBlock className="h-7 w-3/4 max-w-sm" />
        {/* 摘要 (两行) */}
        <div className="space-y-2 pt-2">
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-5/6" />
        </div>
        {/* 底部信息栏 */}
        <div className="flex items-center gap-4 pt-4 border-t border-xianxia-border/30">
          <SkeletonBlock className="h-3 w-12" />
          <SkeletonBlock className="h-3 w-12" />
          <SkeletonBlock className="h-3 w-12" />
        </div>
      </div>
    </div>
  </article>
);

// 弹幕留言骨架屏
export const SkeletonDanmaku = ({ style }: { style?: React.CSSProperties }) => (
  <div
    className="absolute whitespace-nowrap px-4 py-2 rounded-full border border-xianxia-jade/20 bg-xianxia-bg/80 backdrop-blur-sm shadow-sm flex items-center gap-3 animate-pulse"
    style={style}
  >
    <div className="w-6 h-6 rounded-full bg-xianxia-jade/20" />
    <div className="h-4 w-24 bg-xianxia-jade/10 rounded-sm" />
  </div>
);

import React, { useMemo} from'react';
import { CMSPost} from'../lib/cms';

interface TimelinePageProps {
 posts: CMSPost[];
}

export const TimelinePage: React.FC<TimelinePageProps> = ({ posts}) => {
 // 按日期降序排列
 const timelinePosts = useMemo(() => {
 return [...posts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}, [posts]);

 // 按年份和月份分组
 const groupedPosts = useMemo(() => {
 const groups: { [year: string]: { [month: string]: CMSPost[]}} = {};

 timelinePosts.forEach(post => {
 const date = new Date(post.date);
 const year = date.getFullYear().toString();
 const month = (date.getMonth() + 1).toString().padStart(2,'0');

 if (!groups[year]) groups[year] = {};
 if (!groups[year][month]) groups[year][month] = [];

 groups[year][month].push(post);
});

 const sortedYears = Object.keys(groups).sort((a, b) => parseInt(b) - parseInt(a));

 return sortedYears.map(year => {
 const monthsObj = groups[year];
 const sortedMonths = Object.keys(monthsObj).sort((a, b) => parseInt(b) - parseInt(a));

 return {
 year,
 months: sortedMonths.map(month => ({
 month,
 posts: monthsObj[month]
}))
};
});
}, [timelinePosts]);

 return (
 <div className="max-w-3xl mx-auto px-7 xl:px-0 mt-20 md:mt-24 mb-12 relative z-10 font-serif selection:bg-neutral-900 selection:text-white :bg-white :text-neutral-900">

 {/* 极简页头 */}
 <div className="relative z-20 w-full mx-auto lg:mx-0 text-center mb-16 md:mb-24">
 <h2 className="text-3xl font-bold tracking-[0.5em] text-xianxia-text sm:text-4xl lg:text-5xl :text-3xl :text-4xl mb-6 font-kai ml-[0.5em]">
 动态
 </h2>

 <div className="flex items-center justify-center w-full max-w-xs mx-auto opacity-40 mb-10">
 <div className="h-px w-full bg-gradient-to-r from-transparent to-xianxia-red"></div>
 <div className="w-1.5 h-1.5 rounded-full border border-xianxia-red mx-3 flex-shrink-0 animate-pulse"></div>
 <div className="h-px w-full bg-gradient-to-l from-transparent to-xianxia-red"></div>
 </div>
 </div>

 {timelinePosts.length === 0 ? (
 <div className="text-center py-20 animate-in fade-in duration-1000">
 <p className="text-neutral-400 tracking-widest text-sm font-light">这人太懒了，连个动态都没发过。</p>
 </div>
 ) : (
 <div className="space-y-32">
 {groupedPosts.map((yearGroup, yearIndex) => (
 <div key={yearGroup.year} className="animate-in fade-in slide-in-from-bottom-8 duration-1000" style={{ animationDelay: `${yearIndex * 150}ms`}}>

 {/* 年份分割线 */}
 <div className="flex items-center gap-6 mb-16 md:mb-20">
 <h2 className="text-2xl md:text-3xl font-light text-neutral-900 tracking-widest">
 {yearGroup.year}
 </h2>
 <div className="flex-1 h-px bg-neutral-200"></div>
 </div>

 <div className="space-y-20 md:space-y-28 relative">
 {/* 贯穿全年的竖轴 (取消 hidden sm:block，改为所有端显示，并调整手机端的 left 值使其靠左) */}
 <div className="absolute left-[15px] sm:left-[88px] top-4 bottom-0 w-px bg-gradient-to-b from-neutral-200 via-neutral-200 to-transparent"></div>

 {yearGroup.months.map((monthGroup) => (
 <div key={monthGroup.month} className="relative">
 <div className="space-y-16 md:space-y-24">
 {monthGroup.posts.map(post => {
 const dateObj = new Date(post.date);
 const monthStr = (dateObj.getMonth() + 1).toString().padStart(2,'0');
 const dayStr = dateObj.getDate().toString().padStart(2,'0');

 return (
 <article
 key={post.id}
 className="group flex flex-col sm:flex-row gap-6 sm:gap-12 items-start relative z-10 pl-10 sm:pl-0"
 >
 {/* 移除了导致点击跳转的 <a> 标签，使文章在动态页只作为展示，不被查看详情 */}

 {/* 竖轴上的时间锚点 (取消 hidden sm:block，修改 left 位置使其在手机端对齐竖线) */}
 <div className="absolute left-[12.5px] sm:left-[85.5px] top-2.5 sm:top-2.5 w-1.5 h-1.5 rounded-full bg-neutral-300 group-hover:bg-neutral-900 :bg-white transition-colors duration-700 z-10"></div>

 {/* 日期列 - 移除移动端上方边框，并将其移入右侧内容区，PC端在左侧 */}
 <div className="w-full sm:w-16 flex-shrink-0 pt-0 sm:pt-1 text-left sm:text-right">
 <span className="text-sm font-light text-neutral-400 tracking-widest block">
 {monthStr}.{dayStr}
 </span>
 </div>

 {/* 内容列 */}
 <div className="flex-1 min-w-0 w-full">
 <h3 className="text-lg md:text-xl font-medium text-neutral-900 mb-4 group-hover:text-neutral-400 :text-neutral-500 transition-colors duration-500 leading-relaxed tracking-wide">
 {post.title}
 </h3>

 {post.summary && (
 <p className="text-[13px] md:text-sm text-neutral-500 leading-loose tracking-wide font-light text-justify">
 {post.summary}
 </p>
 )}

 {post.tags && post.tags.length > 0 && (
 <div className="mt-6 flex flex-wrap gap-4">
 {post.tags.map(tag => (
 <span key={tag} className="text-[10px] tracking-[0.15em] text-neutral-400 uppercase">
 {tag}
 </span>
 ))}
 </div>
 )}
 </div>

 {/* 图片列 */}
 {post.image && (
 <div className="w-full sm:w-48 lg:w-56 aspect-[4/3] sm:aspect-[3/4] flex-shrink-0 overflow-hidden mt-2 sm:mt-0">
 <img
 src={post.image}
 alt={post.title}
 className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-1000 ease-out group-hover:scale-105"
 />
 </div>
 )}
 </article>
 );
})}
 </div>
 </div>
 ))}
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 );
};

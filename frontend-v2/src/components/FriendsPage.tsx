import { useState, useEffect} from'react';
import { fetchStaticSnapshot, isStaticSite } from '../lib/siteMode';

interface Friend {
 id: string;
 name: string;
 link?: string;
 avatar?: string;
 description?: string;
 order?: number;
}

export const FriendsPage = ({ isHome = false}: { isHome?: boolean}) => {
 const [friends, setFriends] = useState<Friend[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 const fetchFriends = async () => {
 try {
 if (isStaticSite) {
 const snapshot = await fetchStaticSnapshot<Friend[] | { friends?: Friend[] }>('friends.json');
 setFriends(Array.isArray(snapshot) ? snapshot : snapshot.friends || []);
 return;
 }

 const res = await fetch('/api/v1/friends');
 const data = await res.json();
 if (data.success && data.data) {
 setFriends(data.data);
}
} catch (error) {
 console.error("Failed to fetch friends:", error);
} finally {
 setLoading(false);
}
};
 fetchFriends();
}, []);

 if (loading) {
 return (
 <div className="w-full">
 <div className="flex flex-col items-center justify-center my-32 gap-4">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-xianxia-text"></div>
 <p className="text-xianxia-text/60 text-sm animate-pulse">
 正在寻访友邻...
 </p>
 </div>
 </div>
 );
}

 return (
 <div className={`max-w-4xl mx-auto px-7 xl:px-0 ${isHome ?'mt-4 mb-8' :'mt-20 md:mt-24 mb-12'}`}>
 {!isHome && (
 <div className="relative z-20 w-full mx-auto lg:mx-0 text-center">
 <h2 className="text-3xl font-bold tracking-[0.5em] text-xianxia-text sm:text-4xl lg:text-5xl :text-3xl :text-4xl mb-6 font-kai ml-[0.5em]">
 友邻
 </h2>

 <div className="flex items-center justify-center w-full max-w-xs mx-auto opacity-40 mb-10">
 <div className="h-px w-full bg-gradient-to-r from-transparent to-xianxia-jade"></div>
 <div className="w-1.5 h-1.5 rounded-full border border-xianxia-red mx-3 flex-shrink-0 animate-pulse"></div>
 <div className="h-px w-full bg-gradient-to-l from-transparent to-xianxia-jade"></div>
 </div>
 </div>
 )}

 <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 ${isHome ?'mt-4' :'mt-12'}`}>
 {friends.length === 0 ? (
 <div className="col-span-full text-center text-xianxia-text/60 font-serif my-20">
 暂无友邻数据，请在 CMS 中添加
 </div>
 ) : (
 friends.map((friend) => {
 // 确保链接始终带有 http/https 前缀，否则 React Router 可能会将其当作相对路径处理
 const safeLink = friend.link && !/^https?:\/\//i.test(friend.link) && friend.link !=='#'
 ? `https://${friend.link}`
 : friend.link;

 return (
 <a
 key={friend.id}
 href={safeLink}
 target="_blank"
 rel="noopener noreferrer"
 className="group relative flex items-center gap-4 p-4 rounded-xl bg-xianxia-bg/40 backdrop-blur-sm border border-xianxia-jade/20 hover:border-xianxia-jade/50 :border-neutral-300 transition-all duration-300 hover:-translate-y-1 shadow-sm hover:shadow-md"
 >
 <div className="w-14 h-14 rounded-full overflow-hidden shrink-0 border-2 border-xianxia-bg shadow-sm group-hover:scale-105 transition-transform duration-300">
              <img
                src={friend.avatar || '/avatars/default.svg'}
                alt={friend.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/avatars/default.svg';
                }}
 />
 </div>
 <div className="flex-1 min-w-0">
 <h3 className="text-base font-kai font-bold text-xianxia-text truncate group-hover:text-xianxia-red :text-[#C83C23] transition-colors">
 {friend.name}
 </h3>
 <p className="text-xs text-xianxia-text/60 font-serif truncate mt-1">
 {friend.description ||'一位路过的修仙者'}
 </p>
 </div>
 </a>
 );
})
 )}
 </div>
 </div>
 );
};

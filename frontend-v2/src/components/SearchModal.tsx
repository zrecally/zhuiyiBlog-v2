import { useState, useEffect, useRef} from'react';
import { Search, X, Hash} from'lucide-react';
import { isStaticSite } from '../lib/siteMode';

interface Post {
  id: string;
  title: string;
  description?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  date: string;
  content?: string;
  matchedSnippet?: string;
  matchedInContent?: boolean;
}

interface SearchModalProps {
 isOpen: boolean;
 onClose: () => void;
 posts?: Post[];
}

export const SearchModal = ({ isOpen, onClose, posts = []}: SearchModalProps) => {
 const [query, setQuery] = useState('');
 const [results, setResults] = useState<Post[]>([]);
 const inputRef = useRef<HTMLInputElement>(null);

 useEffect(() => {
 if (isOpen) {
 setTimeout(() => {
 inputRef.current?.focus();
}, 100);
 setQuery('');
 setResults([]);
 document.body.style.overflow ='hidden';
} else {
 document.body.style.overflow ='';
}

 return () => {
 document.body.style.overflow ='';
};
}, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    if (isStaticSite) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      setResults(posts.filter((post) => {
        const searchable = [
          post.title,
          post.description,
          post.summary,
          post.category,
          ...(post.tags || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return terms.every((term) => searchable.includes(term));
      }).slice(0, 15));
      return;
    }

    const token = localStorage.getItem('user_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/posts/search?q=${encodeURIComponent(query)}`, { headers });
        const data = await res.json();
        if (data.success) {
          setResults(data.data);
        }
      } catch (error) {
        console.error("搜索失败:", error);
      }
    }, 300); // 300ms 防抖

    return () => clearTimeout(timer);
  }, [query, posts]);

 if (!isOpen) return null;

 return (
 <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] sm:pt-[20vh] p-4 transition-opacity duration-300">
 {/* 独立的背景遮罩层，应用毛玻璃 */}
 <div
 className="absolute inset-0 bg-black/40 backdrop-blur-sm"
 onClick={onClose}
 ></div>

 {/* 内容层 */}
 <div
 className="relative w-full max-w-2xl bg-white/60 backdrop-blur-2xl rounded-2xl shadow-2xl border border-xianxia-jade/20 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
 onClick={(e) => e.stopPropagation()}
 >
 {/* 搜索输入区 */}
 <div className="flex items-center px-4 py-4 border-b border-xianxia-jade/10">
 <Search className="w-6 h-6 text-xianxia-jade ml-2 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="搜索文章、内容、标签..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none px-4 text-lg text-xianxia-text placeholder:text-xianxia-text/30 dark:text-neutral-600"
        />
 <button
 onClick={onClose}
 className="p-1 rounded-md hover:bg-black/5 :bg-white/10 text-xianxia-text/50 transition-colors"
 >
 <X className="w-5 h-5" />
 </button>
 </div>

 {/* 搜索结果区 */}
 <div className="max-h-[60vh] overflow-y-auto">
 {query.trim() && results.length === 0 ? (
 <div className="py-14 flex flex-col items-center justify-center text-xianxia-text/40">
 <span className="text-xl font-kai mb-2">这啥呀，根本搜不到！</span>
 <span className="text-sm">要不换个词试试？我也不是神仙</span>
 </div>
 ) : results.length > 0 ? (
 <ul className="py-2">
 {results.map((post) => (
 <li key={post.id}>
 <a
 href={`/posts/${post.id}${post.matchedInContent ? `?q=${encodeURIComponent(query)}` : ''}`}
 onClick={(e) => {
 e.preventDefault();
 window.dispatchEvent(new CustomEvent('navigate', { detail: `/posts/${post.id}${post.matchedInContent ? `?q=${encodeURIComponent(query)}` : ''}`}));
 onClose();
}}
 className="flex flex-col px-6 py-3 hover:bg-xianxia-jade/5 :bg-white/5 transition-colors group cursor-pointer"
 >
 <div className="flex items-center justify-between mb-1">
 <h4 className="text-base font-bold font-kai text-xianxia-text group-hover:text-xianxia-red :text-[#C83C23] transition-colors line-clamp-1">
 {post.title}
 </h4>
 <span className="text-xs text-xianxia-text/40 flex-shrink-0 ml-4 font-serif">
 {post.date}
 </span>
 </div>

 {post.description && (
 <p className="text-sm text-xianxia-text/60 line-clamp-1 mb-1.5 font-serif">
 {post.description}
 </p>
 )}

 {post.matchedSnippet && (
 <p className="text-sm text-xianxia-text/65 line-clamp-2 mb-1.5 font-serif">
 <span className="mr-2 text-[10px] tracking-widest text-xianxia-jade">正文命中</span>
 {post.matchedSnippet}
 </p>
 )}

 <div className="flex items-center gap-3">
 {post.category && (
 <span className="text-xs text-xianxia-jade">
 {post.category}
 </span>
 )}
 {post.tags && post.tags.length > 0 && (
 <div className="flex items-center gap-1.5">
 {post.tags.map(tag => (
 <span key={tag} className="flex items-center text-[11px] text-xianxia-text/40">
 <Hash className="w-3 h-3 mr-0.5" />
 {tag}
 </span>
 ))}
 </div>
 )}
 </div>
 </a>
 </li>
 ))}
 </ul>
 ) : (
 <div className="py-10 px-6 flex items-center justify-center gap-4 text-sm text-xianxia-text/40 font-serif">
 <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/5 border border-black/10">
 <span>⌘</span>
 <span>K</span>
 </div>
 <span>随时唤醒搜索</span>
 </div>
 )}
 </div>

 {/* 底部装饰 */}
 <div className="h-1 w-full bg-gradient-to-r from-transparent via-xianxia-jade/20 to-transparent"></div>
 </div>
 </div>
 );
};

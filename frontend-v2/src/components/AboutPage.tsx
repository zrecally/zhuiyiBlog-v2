import { useState, useEffect} from'react';
import ReactMarkdown from'react-markdown';
import remarkGfm from'remark-gfm';
import rehypeRaw from'rehype-raw';
import remarkMath from'remark-math';
import rehypeKatex from'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import { Prism as SyntaxHighlighter} from'react-syntax-highlighter';
import { vscDarkPlus} from'react-syntax-highlighter/dist/esm/styles/prism';
import { isStaticSite, staticDataUrl } from '../lib/siteMode';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AboutPage = ({ post}: { post: any}) => {
 const [content, setContent] = useState(post.content ||'');
 const [loading, setLoading] = useState(!post.content);

 useEffect(() => {
 if (!post.content) {
 setLoading(true);
 const token = isStaticSite
   ? null
   : localStorage.getItem('user_token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const currentLang = localStorage.getItem('i18nextLng') || 'zh';

  // CDN 加速开发预留逻辑（暂不实装，默认保留原逻辑）
  const useCdn = import.meta.env.VITE_USE_CDN_CACHE === 'true';
  const cdnBaseUrl = import.meta.env.VITE_CDN_BASE_URL || '';
  const url = isStaticSite
    ? staticDataUrl(`post_${encodeURIComponent(post.id)}.json`)
    : useCdn && cdnBaseUrl && !post.isPrivate
      ? `${cdnBaseUrl}/cache/post_${post.id}.json`
      : `/api/v1/posts/${post.id}/content?lang=${currentLang}`;

  fetch(url, { headers })
 .then(res => res.json())
 .then(data => {
 const snapshotContent = data.content ?? data.data?.content;
 if (data.success !== false && typeof snapshotContent === 'string') {
 setContent(snapshotContent);
} else {
 setContent('加载内容失败...');
}
})
 .catch(() => setContent('网络错误，无法加载关于内容。'))
 .finally(() => setLoading(false));
}
}, [post.id, post.content, post.isPrivate]);

 return (
 <div className="w-full max-w-2xl mx-auto px-6 py-12 md:py-20 mt-8">
 <div className="flex flex-col gap-12 items-center">
 {/* 上方个人信息，去除了背景框和边框 */}
 <div className="w-full flex flex-col items-center text-center p-4">
 <div className="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-4 border-xianxia-bg shadow-lg mb-6 group">
 {post.image ? (
 <img src={post.image} alt={post.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
 ) : (
 <div className="w-full h-full bg-xianxia-jade/10 flex items-center justify-center text-4xl text-xianxia-jade">
 {post.title.charAt(0)}
 </div>
 )}
 </div>
 <h1 className="text-3xl font-kai font-bold text-xianxia-text mb-3 tracking-widest">{post.title}</h1>
 <p className="text-xianxia-text/70 font-serif text-sm tracking-widest leading-relaxed max-w-2xl">
 {post.summary ||'在这里记录正在发生的事，也收纳那些值得慢慢回看的想法。'}
 </p>
 <div className="mt-12 flex items-center gap-4 opacity-60">
 <div className="w-12 h-px bg-xianxia-text"></div>
 <div className="w-2 h-2 rotate-45 bg-xianxia-red"></div>
 <div className="w-12 h-px bg-xianxia-text"></div>
 </div>
 </div>

 {/* 下方正文内容，去除了背景框和边框，直接融合进页面 */}
 <div className="w-full min-h-[500px]">
 {loading ? (
 <div className="flex flex-col items-center justify-center h-full gap-4 opacity-60 pt-20">
 <div className="w-8 h-8 border-2 border-xianxia-text border-t-transparent rounded-full animate-spin"></div>
 <p className="font-serif tracking-widest text-sm">正在展卷...</p>
 </div>
 ) : (
 <article className="prose prose-sm md:prose-base max-w-none prose-headings:font-kai prose-headings:text-xianxia-text :text-[#1A1A1A] prose-p:font-serif prose-p:text-xianxia-text/90 :text-[#333] prose-a:text-xianxia-red :text-[#C83C23] prose-a:decoration-dashed prose-a:underline-offset-4 prose-img:rounded-2xl prose-img:shadow-md">
 <ReactMarkdown
 remarkPlugins={[remarkGfm, remarkMath]}
 rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeKatex]}
 components={{
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 table(props: any) {
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const {node, ...rest} = props;
 return (
 <div className="w-full overflow-x-auto custom-scrollbar my-6">
 <table {...rest} className="min-w-full" />
 </div>
 );
},
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 code(props: any) {
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const {children, className, node, ...rest} = props;
 const match = /language-(\w+)/.exec(className ||'');
 return match ? (
 <SyntaxHighlighter
 {...rest}
 PreTag="div"
 children={String(children).replace(/\n$/,'')}
 language={match[1]}
 style={vscDarkPlus}
 customStyle={{
 borderRadius:'0.5rem',
 margin:'0',
 padding:'1em',
 backgroundColor:'#1E1E1E'
}}
 />
 ) : (
 <code {...rest} className={className}>
 {children}
 </code>
 );
}
}}
 >
 {content}
 </ReactMarkdown>
 </article>
 )}
 </div>
 </div>
 </div>
 );
};

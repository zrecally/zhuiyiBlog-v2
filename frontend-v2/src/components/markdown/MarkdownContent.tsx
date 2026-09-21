import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import 'katex/dist/katex.min.css';
import { slugifyHeading } from './markdownUtils';

const languages = {
  tsx,
  typescript,
  ts: typescript,
  javascript,
  js: javascript,
  jsx,
  bash,
  sh: bash,
  json,
  css,
  markdown,
  md: markdown,
  python,
  py: python,
  go,
};

Object.entries(languages).forEach(([name, grammar]) => {
  SyntaxHighlighter.registerLanguage(name, grammar);
});

const FEISHU_LANGUAGE_MAP: Record<string, string> = {
  '1': 'text', '2': 'abap', '3': 'ada', '4': 'apache', '5': 'apex', '6': 'assembly', '7': 'bash', '8': 'csharp', '9': 'cpp', '10': 'c',
  '11': 'cobol', '12': 'css', '13': 'coffeescript', '14': 'd', '15': 'dart', '16': 'delphi', '17': 'django', '18': 'dockerfile', '19': 'erlang', '20': 'fortran',
  '21': 'foxpro', '22': 'go', '23': 'groovy', '24': 'html', '25': 'htmlbars', '26': 'http', '27': 'haskell', '28': 'json', '29': 'java', '30': 'javascript',
  '31': 'julia', '32': 'kotlin', '33': 'latex', '34': 'lisp', '35': 'logo', '36': 'lua', '37': 'matlab', '38': 'makefile', '39': 'markdown', '40': 'nginx',
  '41': 'objectivec', '42': 'openedge', '43': 'python', '44': 'php', '45': 'perl', '46': 'postscript', '47': 'powershell', '48': 'prolog', '49': 'protobuf', '50': 'r',
  '51': 'rpg', '52': 'ruby', '53': 'rust', '54': 'sas', '55': 'scss', '56': 'sql', '57': 'scala', '58': 'scheme', '59': 'scratch', '60': 'shell',
  '61': 'swift', '62': 'thrift', '63': 'typescript', '64': 'vbscript', '65': 'vb', '66': 'xml', '67': 'yaml',
};

const HlsPlayer = ({ url }: { url: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      return;
    }

    let disposed = false;
    let instance: { destroy: () => void } | null = null;
    void import('hls.js').then(({ default: Hls }) => {
      if (disposed || !Hls.isSupported()) return;
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      instance = hls;
    });
    return () => {
      disposed = true;
      instance?.destroy();
    };
  }, [url]);

  return <video ref={videoRef} className="w-full h-full object-contain bg-black" controls playsInline preload="metadata" />;
};

const renderMediaEmbed = (url: string, key?: string) => {
  let embedUrl = '';

  if (url.includes('youtube.com/watch?v=')) {
    const id = url.match(/v=([^&]+)/)?.[1];
    if (id) embedUrl = `https://www.youtube.com/embed/${id}`;
  } else if (url.includes('youtu.be/')) {
    const id = url.match(/youtu\.be\/([^?]+)/)?.[1];
    if (id) embedUrl = `https://www.youtube.com/embed/${id}`;
  } else if (url.includes('bilibili.com/video/')) {
    const id = url.match(/video\/(BV[a-zA-Z0-9]+)/)?.[1];
    if (id) embedUrl = `//player.bilibili.com/player.html?bvid=${id}&page=1&high_quality=1&danmaku=0`;
  } else if (url.includes('spotify.com/')) {
    const path = url.match(/spotify\.com\/([a-zA-Z0-9/]+)/)?.[1];
    if (path) embedUrl = `https://open.spotify.com/embed/${path}`;
  } else if (url.includes('soundcloud.com/')) {
    embedUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true`;
  } else if (url.includes('vimeo.com/')) {
    const id = url.match(/vimeo\.com\/(\d+)/)?.[1];
    if (id) embedUrl = `https://player.vimeo.com/video/${id}`;
  } else if (/\.(mp4|webm|ogg)(?:[?#]|$)/i.test(url)) {
    return (
      <div key={key || url} className="not-prose my-8 w-full rounded-xl overflow-hidden shadow-lg border border-neutral-200 bg-neutral-100" style={{ aspectRatio: '16/9' }}>
        <video src={url} className="w-full h-full object-contain bg-black" controls playsInline preload="metadata" />
      </div>
    );
  } else if (/\.(mp3|wav|ogg)(?:[?#]|$)/i.test(url)) {
    return (
      <div key={key || url} className="not-prose my-6 w-full max-w-md mx-auto rounded-full overflow-hidden shadow-sm border border-neutral-200 bg-neutral-50 p-2">
        <audio src={url} className="w-full h-12" controls preload="metadata" />
      </div>
    );
  } else if (/\.m3u8(?:[?#]|$)/i.test(url)) {
    return (
      <div key={key || url} className="not-prose my-8 w-full rounded-xl overflow-hidden shadow-lg border border-neutral-200 bg-neutral-100 relative" style={{ aspectRatio: '16/9' }}>
        <HlsPlayer url={url} />
      </div>
    );
  }

  if (!embedUrl) return null;
  const isAudioEmbed = embedUrl.includes('spotify') || embedUrl.includes('soundcloud');

  return (
    <div
      key={key || embedUrl}
      className="not-prose my-8 w-full rounded-xl overflow-hidden shadow-lg border border-neutral-200 bg-neutral-100"
      style={{
        aspectRatio: isAudioEmbed ? 'auto' : '16/9',
        minHeight: embedUrl.includes('spotify') ? '152px' : embedUrl.includes('soundcloud') ? '166px' : 'auto',
      }}
    >
      <iframe
        src={embedUrl}
        className="w-full h-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
};

const flattenHeading = (text: string, child: React.ReactNode): string => {
  if (typeof child === 'string') return text + child;
  if (!React.isValidElement(child)) return text;
  return React.Children.toArray((child.props as { children?: React.ReactNode }).children).reduce(flattenHeading, text);
};

const createHeadingRenderer = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  const tag = `h${level}` as keyof React.JSX.IntrinsicElements;
  return ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
    const text = React.Children.toArray(children).reduce(flattenHeading, '');
    return React.createElement(tag, { ...props, id: slugifyHeading(text) }, children);
  };
};

const decodeUrl = (value: string) => {
  try {
    return value.includes('%') ? decodeURIComponent(value) : value;
  } catch {
    return value;
  }
};

const markdownComponents = {
  h1: createHeadingRenderer(1),
  h2: createHeadingRenderer(2),
  h3: createHeadingRenderer(3),
  h4: createHeadingRenderer(4),
  h5: createHeadingRenderer(5),
  h6: createHeadingRenderer(6),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  p: ({ node: _node, children, ...props }: any) => <p {...props} style={{ color: 'inherit' }}>{children}</p>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  span: ({ node: _node, children, style, ...props }: any) => <span {...props} style={style}>{children}</span>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  a: ({ node: _node, href, children, ...props }: any) => {
    const cleanHref = typeof href === 'string' ? href.trim() : '';
    const text = React.Children.toArray(children).reduce(flattenHeading, '').trim();
    const decodedHref = decodeUrl(cleanHref);
    const decodedText = decodeUrl(text);
    const isBareMediaLink = cleanHref && (
      text === cleanHref
      || decodedText === decodedHref
      || cleanHref.includes(text)
      || text.startsWith('http')
      || decodedText.startsWith('http')
    );

    if (isBareMediaLink) {
      const media = renderMediaEmbed(decodedHref, `a-${cleanHref}`);
      if (media) return media;
    }
    return <a href={href} {...props}>{children}</a>;
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  table: ({ node: _node, ...props }: any) => (
    <div className="not-prose w-full overflow-x-auto custom-scrollbar my-4 border border-neutral-200/60 rounded-xl shadow-sm bg-black/[0.02]">
      <table {...props} className="w-full text-left border-collapse text-sm prose-table-override" style={{ backgroundColor: 'transparent' }} />
    </div>
  ),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  thead: ({ node: _node, ...props }: any) => <thead {...props} className="border-b border-neutral-200/80 bg-black/[0.03]" style={{ backgroundColor: 'transparent' }} />,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  th: ({ node: _node, ...props }: any) => <th {...props} className="px-4 py-3 font-bold text-neutral-800 whitespace-nowrap" style={{ backgroundColor: 'transparent' }} />,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  td: ({ node: _node, ...props }: any) => <td {...props} className="px-4 py-3 border-b border-neutral-200/50 text-neutral-700 min-w-[120px]" style={{ backgroundColor: 'transparent' }} />,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  img: ({ node: _node, src, alt, ...props }: any) => {
    if (typeof src === 'string' && /\.(mp4|webm|ogg|mp3|wav|m3u8)(?:[?#]|$)/i.test(src.trim())) {
      const media = renderMediaEmbed(src.trim(), `img-${src.trim()}`);
      if (media) return media;
    }
    return <img src={src} alt={alt || '图片'} {...props} loading="lazy" />;
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  code: ({ children, className, node: _node, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    let language = match?.[1] || '';
    if (/^\d+$/.test(language)) language = FEISHU_LANGUAGE_MAP[language] || 'text';

    const text = typeof children === 'string' ? children : '';
    const isInline = !language && typeof children === 'string' && !children.includes('\n');
    if (isInline) {
      const media = renderMediaEmbed(decodeUrl(text), `code-${text}`);
      if (text.startsWith('http') && media) return media;
      if (decodeUrl(text).startsWith('http') && media) return media;
    }

    const isBlock = language || (!isInline && String(children).includes('\n'));
    if (!isBlock) return <code {...props} className={className}>{text || children}</code>;

    return (
      <div className="not-prose relative group/codeblock bg-black/[0.02] rounded-xl transition-all hover:bg-black/[0.03] mt-0 mb-1">
        <button
          onClick={event => {
            navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
            const button = event.currentTarget;
            const originalHtml = button.innerHTML;
            button.innerHTML = '<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
            setTimeout(() => { button.innerHTML = originalHtml; }, 2000);
          }}
          className="absolute top-2 right-2 p-1.5 rounded-md bg-white/60 hover:bg-white text-neutral-500 hover:text-neutral-800 transition-all opacity-0 group-hover/codeblock:opacity-100 z-20 shadow-sm border border-black/5 backdrop-blur-sm"
          title="复制代码"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
        <SyntaxHighlighter
          {...props}
          PreTag="div"
          language={language || 'text'}
          style={oneLight}
          showLineNumbers
          wrapLines
          customStyle={{ margin: 0, padding: '0.5rem 1rem', backgroundColor: 'transparent', fontSize: '0.875rem', lineHeight: '1.6' }}
          codeTagProps={{ style: { backgroundColor: 'transparent' } }}
          lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: '#b3b3b3', textAlign: 'right', userSelect: 'none' }}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    );
  },
};

const markdownRemarkPlugins = [remarkGfm, remarkMath];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const markdownRehypePlugins: any = [
  rehypeRaw,
  [rehypeSanitize, {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames || []), 'kbd', 'mark', 'sub', 'sup', 'del', 'u', 'details', 'summary'],
  }],
  rehypeKatex,
];

export const MarkdownContent = ({ content }: { content: string }) => (
  <ReactMarkdown
    remarkPlugins={markdownRemarkPlugins}
    rehypePlugins={markdownRehypePlugins}
    components={markdownComponents}
  >
    {content}
  </ReactMarkdown>
);

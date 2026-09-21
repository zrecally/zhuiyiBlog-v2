import { QRCodeSVG } from 'qrcode.react';
import { MarkdownHeading } from './markdownUtils';

interface ArticleSideTocProps {
  headings: MarkdownHeading[];
  activeId: string;
  visible: boolean;
}

export const ArticleSideToc = ({ headings, activeId, visible }: ArticleSideTocProps) => {
  if (headings.length === 0) return null;
  const scrollToHeading = (id: string) => {
    const target = document.getElementById(id);
    if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 100, behavior: 'smooth' });
  };

  return (
    <div className={`hidden xl:block fixed top-32 left-1/2 ml-[380px] w-56 z-40 transition-all duration-700 ease-out group/sidetoc ${visible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-4 opacity-0 pointer-events-none'}`}>
      <div className="relative">
        <div className="mb-6 pl-5 relative group/qr">
          <h3 className="text-[10px] font-bold tracking-[0.25em] text-neutral-400/80 uppercase mb-2 transition-opacity duration-300 opacity-0 group-hover/sidetoc:opacity-100">跨屏接力</h3>
          <div className="w-8 h-8 rounded border border-neutral-200 bg-white p-1 opacity-0 group-hover/sidetoc:opacity-100 transition-all duration-300 cursor-pointer overflow-hidden"><QRCodeSVG value={window.location.href} size={24} className="opacity-40" /></div>
          <div className="absolute top-0 left-0 -translate-x-[calc(100%+16px)] bg-white p-3 rounded-xl shadow-xl border border-neutral-100 opacity-0 scale-95 origin-right pointer-events-none transition-all duration-300 group-hover/qr:opacity-100 group-hover/qr:scale-100 group-hover/qr:pointer-events-auto z-50">
            <div className="bg-white p-2 rounded-lg"><QRCodeSVG value={window.location.href} size={140} level="L" includeMargin={false} /></div>
            <p className="text-xs text-center mt-3 text-neutral-500 font-serif tracking-widest">扫码在移动端继续阅读</p>
          </div>
        </div>
        <div className="absolute left-0 top-1 bottom-1 w-px bg-gradient-to-b from-neutral-200/50 via-neutral-200/80 to-transparent" />
        <h3 className="text-[10px] font-bold tracking-[0.25em] text-neutral-400/80 uppercase mb-4 pl-5 transition-opacity duration-300 opacity-0 group-hover/sidetoc:opacity-100">目录</h3>
        <ul className="space-y-3 max-h-[calc(100vh-240px)] overflow-y-auto pb-10 pr-2" style={{ scrollbarWidth: 'none' }}>
          {headings.map((heading, index) => {
            const isActive = activeId === heading.id || (!activeId && index === 0 && visible);
            return (
              <li key={heading.id} className="relative pl-5 group/item">
                <div className={`absolute left-5 top-1/2 -translate-y-1/2 h-px transition-all duration-300 ease-out origin-left group-hover/sidetoc:scale-x-0 group-hover/sidetoc:opacity-0 ${isActive ? 'w-4 bg-neutral-800' : 'w-2 bg-neutral-300'}`} style={{ marginLeft: `${(heading.level - 1) * 0.4}rem` }} />
                <div className={`absolute left-[-3px] top-[7px] w-[7px] h-[7px] rounded-full transition-all duration-300 opacity-0 group-hover/sidetoc:opacity-100 ${isActive ? 'bg-neutral-600 ring-4 ring-[#f9f9f9] scale-100' : 'bg-transparent scale-0'}`} />
                <a href={`#${heading.id}`} style={{ marginLeft: `${(heading.level - 1) * 0.6}rem` }} className={`block text-[13px] transition-all duration-300 truncate opacity-0 -translate-x-2 group-hover/sidetoc:opacity-100 group-hover/sidetoc:translate-x-0 ${isActive ? 'text-neutral-800 font-medium' : 'text-neutral-400/80 hover:text-neutral-600'}`} onClick={(event) => { event.preventDefault(); scrollToHeading(heading.id); }}>{heading.text}</a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

import type { ReactNode } from 'react';

interface SiteFooterProps {
  title?: string;
  runDays: number;
  siteViews?: number;
  compliance?: ReactNode;
}

export const SiteFooter = ({ title, runDays, siteViews, compliance }: SiteFooterProps) => (
  <section className="text-xianxia-text/60 bg-transparent border-t border-xianxia-border/50 relative z-20 mt-10 md:mt-20">
    <div className="container flex flex-col items-center justify-center py-16 mx-auto px-7 max-w-7xl relative">
      <div className="z-10 flex w-full flex-nowrap items-center justify-center gap-3 overflow-x-auto whitespace-nowrap text-[11px] font-serif tracking-widest text-xianxia-text/50">
        <a href="/" className="group relative flex items-center space-x-2 text-xianxia-text hover:text-xianxia-red transition-colors duration-300 mr-2">
          <div className="flex items-center justify-center bg-black text-white w-4 h-4 rounded-full shadow-sm group-hover:scale-110 transition-transform duration-300">
            <span className="text-[10px] leading-none font-medium">Z</span>
          </div>
          <span className="font-kai text-sm tracking-widest font-bold">{title || '加载中'}</span>
        </a>
        <Separator />
        <span className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-xianxia-jade animate-pulse" />已运行 {runDays} 天</span>
        {siteViews !== undefined && <><Separator /><span className="flex items-center gap-1.5">访问量 {siteViews} 次</span></>}
        <Separator />
        <p>© {new Date().getFullYear()} {title || 'Loading'}. All Rights Reserved.</p>
        {compliance}
      </div>
    </div>
  </section>
);

const Separator = () => <span className="text-xianxia-jade/30">|</span>;

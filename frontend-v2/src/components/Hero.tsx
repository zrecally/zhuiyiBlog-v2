import { Rss, Send, Mail} from'lucide-react';
import { SiteConfig} from'../lib/cms';
import { useToast } from './Toast';
import { isStaticSite } from '../lib/siteMode';

interface HeroProps {
 config?: SiteConfig;
}

export const Hero = ({ config}: HeroProps) => {
 const { showToast } = useToast();

 const handleRssClick = (e: React.MouseEvent) => {
   e.preventDefault();
   if (isStaticSite) return;
   const rssUrl = `${window.location.origin}/api/v1/feed/rss`;
   navigator.clipboard.writeText(rssUrl).then(() => {
     showToast({ message: 'RSS 订阅链接已复制到剪贴板', type: 'success' });
   }).catch(() => {
     showToast({ message: '复制失败，请手动复制: ' + rssUrl, type: 'error' });
   });
 };

 return (
 <div className="relative z-20 w-full max-w-4xl mx-auto mt-16 px-7 md:mt-24 xl:px-0">
 <div className="flex flex-col items-center md:flex-row">
 <div className="relative w-full md:w-1/2">
 <h1 className="mb-5 text-4xl font-bold leading-tight md:text-4xl lg:text-6xl text-xianxia-text font-song">
 {config?.title}
 </h1>
 <p className="font-semibold mb-6 text-base text-xianxia-text/90 font-kai">
 {config?.subtitle}
 </p>
 <p className="mb-2 text-xianxia-text/70 font-kai">
 {config?.description}
 </p>
 <div className="flex items-center gap-5 mt-6 text-xianxia-text/50">
 {!isStaticSite && <a href="/api/v1/feed/rss" onClick={handleRssClick} className="hover:text-xianxia-red :text-[#C83C23] transition-colors cursor-pointer" title="复制 RSS 订阅链接"><Rss className="w-5 h-5" /></a>}

 {config?.twitter && (
 <a href={config.twitter} target="_blank" rel="noopener noreferrer" className="hover:text-xianxia-red :text-[#C83C23] transition-colors">
 <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.008 5.96H5.078z"></path></svg>
 </a>
 )}

 {config?.github && (
 <a href={config.github} target="_blank" rel="noopener noreferrer" className="hover:text-xianxia-red :text-[#C83C23] transition-colors">
 <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"></path></svg>
 </a>
 )}

 {config?.telegram && (
 <a href={config.telegram} target="_blank" rel="noopener noreferrer" className="hover:text-xianxia-red :text-[#C83C23] transition-colors"><Send className="w-5 h-5" /></a>
 )}

 {config?.email && (
 <a href={`mailto:${config.email}`} className="hover:text-xianxia-red :text-[#C83C23] transition-colors"><Mail className="w-5 h-5" /></a>
 )}
 </div>
 </div>

 <div className="relative justify-end w-full mt-10 md:flex md:pl-10 md:w-1/2 md:mt-0 md:translate-y-4 xl:translate-y-0">
 {/* 头像容器：现代模式下保持原样，水墨模式下变成带有手绘粗糙边缘的画框 */}
 <div className="relative z-30 max-w-80 w-full aspect-square rounded-3xl bg-neutral-200 shadow-xl flex items-center justify-center">

 {/* 水墨模式特有：手绘风粗糙边框 (利用多重 box-shadow 模拟) */}
 <div className="hidden absolute inset-0 border-[3px] border-[#1A1A1A] pointer-events-none rounded-[4%_6%_3%_5%/5%_3%_6%_4%]"></div>
 <div className="hidden absolute inset-0.5 border-[2px] border-[#1A1A1A]/60 pointer-events-none rounded-[5%_3%_6%_4%/4%_6%_3%_5%]"></div>

 <div className="w-full h-full rounded-3xl overflow-hidden">
 {config?.avatar ? (
 <img
 src={config.avatar.replace(/`/g,'')}
 alt={config.title}
 className="w-full h-full object-cover transition-all duration-700"
 />
 ) : (
              <>
                <img src={'/avatars/default.svg'} alt="avatar" className="w-full h-full object-cover block" />
                <img src={'/avatars/default.svg'} alt="avatar" className="w-full h-full object-cover hidden opacity-95" />
              </>
 )}
 </div>

 {/* 水墨模式：红印章遮罩装饰 - 调整位置以适应圆形头像 */}
 <div className="hidden absolute bottom-8 right-8 border-2 border-[#C83C23]/80 text-[#C83C23]/80 font-kai p-1.5 rounded-sm rotate-[-8deg] backdrop-blur-sm transition-opacity duration-500 hover:opacity-0 pointer-events-none z-40 bg-[#F7F4EB]/50">
 <span className="text-sm leading-none" style={{ writingMode:'vertical-rl'}}>醉意<br/>藏卷</span>
 </div>
 </div>

 {/* 水墨模式：侧边竖排诗句 */}
 <div className="hidden md: absolute left-0 lg:left-8 xl:-left-4 top-12 pointer-events-none opacity-60">
 <div className="font-kai text-[#1A1A1A]/40 text-2xl leading-[2.5] tracking-[0.4em]" style={{ writingMode:'vertical-rl'}}>
 <p>落花踏尽游何处</p>
 <p className="mt-4">山水绕城春作伴</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
};

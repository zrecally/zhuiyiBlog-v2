import { Feather, Send } from 'lucide-react';

const PigeonPostPreviewPage = () => (
  <main className="min-h-full bg-[#F8F5ED] p-5 sm:p-10 text-[#35493d] font-serif">
    <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-[#4A6B58]/20 bg-white/75 shadow-[0_18px_50px_-30px_rgba(46,70,57,0.6)]">
      <div className="flex items-center justify-between border-b border-[#4A6B58]/10 px-6 py-4">
        <span className="inline-flex items-center gap-2 text-sm tracking-[0.18em] text-[#4A6B58]"><Feather className="h-4 w-4" />云笺投递处</span>
        <span className="text-[11px] tracking-widest text-[#4A6B58]/50">演示模式</span>
      </div>
      <div className="p-6 sm:p-10">
        <p className="text-xs tracking-[0.2em] text-[#C8785D]">WRITE A LETTER</p>
        <h2 className="mt-3 text-2xl sm:text-3xl tracking-[0.12em]">写一封信</h2>
        <p className="mt-3 text-sm leading-7 text-[#4A6B58]/65">以信件形式留下想法。投递动画、状态提示与真实发送将在功能上线后启用。</p>
        <label className="mt-8 block text-xs tracking-widest text-[#4A6B58]/70">主题</label>
        <div className="mt-2 border-b border-[#4A6B58]/25 py-3 text-sm text-[#4A6B58]/35">想对站点说的话</div>
        <label className="mt-6 block text-xs tracking-widest text-[#4A6B58]/70">信笺正文</label>
        <div className="mt-2 min-h-36 rounded-xl border border-dashed border-[#4A6B58]/25 bg-[#F8F5ED]/70 p-4 text-sm leading-7 text-[#4A6B58]/35">在这里写下你的建议、感受或问题……</div>
        <div className="mt-7 flex items-center justify-between gap-4">
          <span className="text-xs text-[#4A6B58]/45">功能演示不会提交真实反馈</span>
          <button type="button" className="inline-flex items-center gap-2 rounded-full bg-[#4A6B58] px-5 py-2.5 text-xs tracking-widest text-white transition-transform hover:-translate-y-0.5"><Send className="h-3.5 w-3.5" />投递信笺</button>
        </div>
      </div>
    </div>
  </main>
);

export default PigeonPostPreviewPage;

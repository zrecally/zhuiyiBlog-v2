import { RadioTower, Send } from 'lucide-react';

const FaxMachinePreviewPage = () => (
  <main className="min-h-full bg-[#ECE8DF] p-5 sm:p-10 text-[#303331] font-mono">
    <div className="mx-auto grid max-w-3xl gap-5 md:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-xl border border-[#2F3431]/35 bg-[#3D433F] p-5 text-[#E9E6DC] shadow-xl">
        <div className="flex items-center justify-between border-b border-white/15 pb-4 text-xs tracking-[0.16em]"><span>FAX-01</span><RadioTower className="h-4 w-4 text-[#B8D7BF]" /></div>
        <div className="mt-7 rounded bg-[#202521] p-4 text-xs leading-7 text-[#B8D7BF]">
          STATUS: READY<br />
          LINE: CONNECTED<br />
          QUEUE: 00
        </div>
        <div className="mt-7 grid grid-cols-3 gap-2 text-center text-xs text-white/65">
          {['拨号', '扫描', '发送', '暂停', '重拨', '清除'].map(key => <span key={key} className="rounded border border-white/15 py-2">{key}</span>)}
        </div>
      </section>
      <section className="rotate-[0.4deg] border border-[#B8B2A6] bg-[#FFFDF7] p-6 shadow-[6px_8px_0_rgba(53,57,53,0.18)] sm:p-8">
        <p className="text-[10px] tracking-[0.24em] text-[#6C716D]">TRANSMISSION SHEET</p>
        <h2 className="mt-4 border-y border-dashed border-[#B8B2A6] py-4 text-xl tracking-[0.12em]">反馈传真</h2>
        <div className="mt-6 space-y-4 text-xs leading-6 text-[#555A56]">
          <p>TO: HI,ZhuiYi</p>
          <p>SUBJECT: 产品建议</p>
          <div className="min-h-32 border border-dashed border-[#B8B2A6] p-3 text-[#90948F]">输入要传送的内容……</div>
        </div>
        <button type="button" className="mt-7 inline-flex items-center gap-2 border border-[#3D433F] px-4 py-2 text-xs tracking-widest text-[#3D433F] hover:bg-[#3D433F] hover:text-white"><Send className="h-3.5 w-3.5" />开始传送</button>
        <p className="mt-4 text-[10px] text-[#90948F]">预览模式，不会提交真实反馈。</p>
      </section>
    </div>
  </main>
);

export default FaxMachinePreviewPage;

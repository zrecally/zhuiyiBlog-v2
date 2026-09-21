import { Helmet } from 'react-helmet-async';
import { BackgroundGrid } from '../components/BackgroundGrid';

export const CardRedeemPage = () => (
  <div className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 text-center text-xianxia-text">
    <Helmet>
      <title>卡密提取暂未开放 - Hi, ZuiYi</title>
      <meta name="robots" content="noindex,nofollow" />
      <link rel="canonical" href="https://card.hizhuiyi.cn/" />
    </Helmet>
    <BackgroundGrid />
    <main className="relative z-10 w-full max-w-xl rounded-2xl border border-xianxia-border bg-[#fffdf9]/80 p-8 shadow-[0_28px_80px_-48px_rgba(42,42,42,0.55)] backdrop-blur-sm sm:p-12">
      <p className="text-sm tracking-[0.18em] text-xianxia-text/45">HI,ZHUIYI</p>
      <h1 className="mt-5 font-kai text-3xl font-semibold tracking-[0.08em]">卡密提取暂未开放</h1>
      <p className="mt-5 text-base leading-8 text-xianxia-text/65">
        当前线上版本不提供卡密核销、文件交付或站内付款。已购内容请暂时按照原销售平台的交付与售后说明处理。
      </p>
      <a className="mt-8 inline-flex min-h-11 items-center justify-center rounded-full border border-xianxia-border bg-white/60 px-6 text-sm transition hover:border-xianxia-jade" href="https://www.hizhuiyi.cn/">
        返回动态站
      </a>
    </main>
  </div>
);

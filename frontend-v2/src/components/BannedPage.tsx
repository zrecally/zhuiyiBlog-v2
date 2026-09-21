import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';

export const BannedPage = () => {
  const { t } = useTranslation();

  return (
    <div className="w-full animate-in fade-in duration-700">
      <Helmet>
        <title>{t('访问受限')} - ZuiYi</title>
        <meta name="robots" content="noindex,nofollow,noarchive" />
      </Helmet>

      <article className="max-w-3xl mx-auto py-12 px-6 sm:px-12 md:py-20">
        <header className="mb-12 text-center">
          <h1 className="text-3xl sm:text-4xl font-kai text-xianxia-text tracking-widest font-bold mb-6">
            {t('访问受限：IP 封禁说明')}
          </h1>
          <div className="flex items-center justify-center gap-4 text-xs text-xianxia-text/60 font-serif tracking-widest">
            <span>{t('发布于')} 2026-08-10</span>
            <span>•</span>
            <span>{t('系统公告')}</span>
          </div>
        </header>

        <div className="prose prose-sm sm:prose-base prose-slate max-w-none
          prose-headings:font-kai prose-headings:text-xianxia-text prose-headings:font-bold
          prose-p:font-song prose-p:text-xianxia-text/80 prose-p:leading-relaxed prose-p:tracking-wide
          prose-strong:text-xianxia-text prose-strong:font-kai prose-strong:font-bold
          prose-blockquote:border-xianxia-jade/30 prose-blockquote:bg-white/30 prose-blockquote:not-italic prose-blockquote:py-1
          prose-li:font-song prose-li:text-xianxia-text/80
          prose-code:text-xianxia-red prose-code:bg-white/50 prose-code:px-1 prose-code:rounded
          prose-a:text-xianxia-jadeDark hover:prose-a:text-xianxia-red prose-a:transition-colors
          prose-img:rounded-sm prose-img:shadow-lg prose-img:mx-auto
          prose-hr:border-xianxia-jade/20"
        >
          <p>
            尊敬的访客，当您看到这篇说明时，意味着您当前的 IP 地址触发了博客系统的<strong>安全防刷机制</strong>，已被暂时或永久封禁。
          </p>

          <h3>为什么会被封禁？</h3>
          <p>
            为了保障博客的稳定运行和防御恶意攻击（如 DDoS、恶意灌水、暴力破解等），系统内置了全局频率限制与安全防护网。以下行为可能会触发封禁：
          </p>
          <ul>
            <li><strong>高频访问</strong>：每分钟请求超过 150 次。</li>
            <li><strong>恶意灌水</strong>：频繁发送内容雷同的留言、弹幕或评论。</li>
            <li><strong>接口滥用</strong>：利用脚本高频调用邮件发送、登录等敏感接口。</li>
            <li><strong>触发安全规则</strong>：系统检测到恶意注入或非法的访问路径。</li>
          </ul>

          <h3>封禁规则</h3>
          <blockquote>
            <p><strong>临时封禁</strong>：对于普通的频率超限，系统会自动封禁该 IP 地址 24 小时。24 小时后会自动解封。</p>
            <p><strong>永久封禁</strong>：对于被判定为恶意攻击或多次违规的 IP，系统会将其上报至管理员后台的黑名单中，进行永久封禁。</p>
          </blockquote>

          <h3>如何解封？</h3>
          <p>
            如果您是普通访客，因为误操作（如疯狂刷新页面）导致被误封：
          </p>
          <ol>
            <li>请耐心等待 <strong>24 小时</strong>，系统将自动清除缓存并解封。</li>
            <li>
              如果您认为是被永久误封，可以通过其他网络环境（如切换手机流量）提交
              <a href="mailto:zhuiyipost@email.hizhuiyi.cn?subject=IP解封申请&body=请填写您的IP地址以及申诉原因：" className="mx-1 font-bold underline decoration-xianxia-jade/50 underline-offset-4">
                解封申请
              </a>
              联系管理员。
            </li>
          </ol>

          <p className="mt-8 text-center text-xianxia-text/50 text-sm">
            <em>落笔生花，静水流深。感谢您的理解与支持，共同维护这方净土。</em>
          </p>
        </div>
      </article>
    </div>
  );
};

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, Download, File as FileIcon, FileArchive, KeyRound, Loader2, RotateCcw } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { BackgroundGrid } from '../components/BackgroundGrid';
import {
  CardRedeemResponse,
    CardRedeemSuccess,
    createRedeemRequestId,
    getOrCreateRedeemRequestId,
  isPlausibleCardCode,
} from '../lib/cardRedeem';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

const Brand = () => {
  const blogHome = import.meta.env.VITE_BLOG_HOME_URL || '/';
  return (
    <a href={blogHome} className="inline-flex items-center gap-2 text-xianxia-text hover:text-xianxia-red transition-colors">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-medium text-white">Z</span>
      <span className="font-kai text-lg font-semibold">Hi, ZuiYi</span>
    </a>
  );
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const isArchiveMediaType = (mediaType: string): boolean => [
  'application/zip',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-tar',
  'application/gzip',
].includes(mediaType);

type DownloadState = 'idle' | 'checking' | 'started' | 'blocked' | 'expired' | 'error';

const ResultPanel = ({ result, onReset }: { result: CardRedeemSuccess; onReset: () => void }) => {
  const [now, setNow] = useState(() => Date.now());
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const downloadStartedRef = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expiresAtMs = new Date(result.download.expiresAt).getTime();
  const remainingSec = Math.max(0, Math.ceil((expiresAtMs - now) / 1000));
  const expired = remainingSec <= 0;
  const expireTimeText = new Date(result.download.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const countdownText = `${String(Math.floor(remainingSec / 60)).padStart(2, '0')}:${String(remainingSec % 60).padStart(2, '0')}`;
  const downloadDisabled = expired || ['checking', 'started', 'blocked', 'expired'].includes(downloadState);

  const startDownload = async () => {
    if (downloadStartedRef.current || expired) return;
    downloadStartedRef.current = true;
    setDownloadState('checking');
    try {
      const response = await fetch(result.download.url, {
        method: 'HEAD',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.status === 409) {
        setDownloadState('blocked');
        return;
      }
      if (response.status === 410) {
        setDownloadState('expired');
        return;
      }
      if (!response.ok) {
        downloadStartedRef.current = false;
        setDownloadState('error');
        return;
      }

      setDownloadState('started');
      window.location.assign(result.download.url);
    } catch {
      downloadStartedRef.current = false;
      setDownloadState('error');
    }
  };

  return (
  <section className="overflow-hidden rounded-2xl border border-xianxia-border bg-[#fffdf9]/80 shadow-[0_24px_70px_-45px_rgba(42,42,42,0.45)] backdrop-blur-sm">
    <div className="flex items-start justify-between gap-4 border-b border-xianxia-border/80 px-5 py-5 sm:px-7">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-xianxia-jade/25 text-[#4f7761]">
          <Check className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-xianxia-text">提取成功</h2>
          <p className="mt-1 text-sm leading-6 text-xianxia-text/60">请<strong className="text-xianxia-red">立即下载</strong>文件，下载后请勿刷新或关闭本页面。</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-xianxia-text/65 hover:text-xianxia-red focus:outline-none focus:ring-2 focus:ring-xianxia-jade/50"
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">提取其他文件</span>
      </button>
    </div>

    <div className="px-5 py-6 sm:px-7">
      <div className="rounded-xl border border-xianxia-border/80 bg-xianxia-card/45 p-5">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/55 text-xianxia-red">
            {isArchiveMediaType(result.download.mediaType)
              ? <FileArchive className="h-5 w-5" aria-hidden="true" />
              : <FileIcon className="h-5 w-5" aria-hidden="true" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm text-xianxia-text/50">{result.productName}</p>
            <p className="mt-1 break-all text-base font-medium text-xianxia-text">{result.download.fileName}</p>
            <p className="mt-1 text-sm text-xianxia-text/45">
              {isArchiveMediaType(result.download.mediaType) ? '压缩包' : '文件'} · {formatFileSize(result.download.fileSize)}
            </p>
          </div>
        </div>
        {expired || downloadState === 'expired' ? (
          <>
            <div aria-live="polite" className="mt-5 rounded-xl border border-xianxia-red/20 bg-xianxia-red/5 px-4 py-3 text-sm leading-6 text-xianxia-red">
              下载链接已失效（原有效期至 {expireTimeText}），本次提取无法继续下载。
              提取码已核销，如尚未保存文件，请联系销售方重新发卡。
            </div>
            <button
              type="button"
              onClick={onReset}
              className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-xianxia-border bg-white/60 px-5 text-base font-medium text-xianxia-text/70 focus:outline-none focus:ring-4 focus:ring-xianxia-jade/15"
            >
              <RotateCcw className="h-5 w-5" aria-hidden="true" />
              重新输入提取码
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={startDownload}
            disabled={downloadDisabled}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-xianxia-red px-5 text-base font-medium tracking-[0.08em] text-white shadow-sm transition-colors hover:bg-xianxia-redHover focus:outline-none focus:ring-4 focus:ring-xianxia-red/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloadState === 'checking'
              ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              : <Download className="h-5 w-5" aria-hidden="true" />}
            {downloadState === 'checking'
              ? '正在准备下载'
              : downloadState === 'started'
                ? '下载已开始'
                : downloadState === 'blocked'
                  ? '下载机会已使用'
                  : isArchiveMediaType(result.download.mediaType) ? '下载压缩包' : '下载文件'}
          </button>
        )}
        {downloadState === 'blocked' && (
          <p role="alert" className="mt-3 rounded-xl border border-xianxia-red/20 bg-xianxia-red/5 px-4 py-3 text-sm leading-6 text-xianxia-red">
            本次下载机会已使用，不会再次生成文件。请从浏览器下载记录查看或续传之前的下载。
          </p>
        )}
        {downloadState === 'error' && (
          <p role="alert" className="mt-3 rounded-xl border border-xianxia-red/20 bg-xianxia-red/5 px-4 py-3 text-sm leading-6 text-xianxia-red">
            暂时无法确认下载状态，请检查网络后重试。
          </p>
        )}
        <p aria-live="polite" className="mt-5 rounded-xl border border-xianxia-jade/25 bg-xianxia-jade/5 px-4 py-3 text-sm leading-6 text-xianxia-text/70">
          下载按钮只能成功使用一次；点击后由浏览器接管传输。若网络中断，请尽快从浏览器下载记录续传，不要再次点击或转发下载地址。
        </p>
        <p aria-live="polite" className={`mt-3 text-center text-sm leading-6 ${expired || downloadState === 'expired' ? 'text-xianxia-red' : 'text-xianxia-text/45'}`}>
          {expired || downloadState === 'expired'
            ? `下载链接已失效（原有效期至 ${expireTimeText}）`
            : `下载链接有效至 ${expireTimeText}（剩余 ${countdownText}）`}
        </p>
      </div>
    </div>
  </section>
  );
};

export const CardRedeemPage = () => {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<CardRedeemSuccess | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const requestIdRef = useRef(createRedeemRequestId());
  const submittedCodeRef = useRef('');
  const cardSiteUrl = import.meta.env.VITE_CARD_SITE_URL || '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = code.trim();
    if (!input) {
      setStatus('error');
      setMessage('请输入提取码');
      return;
    }
    if (!isPlausibleCardCode(input)) {
      setStatus('error');
      setMessage('提取码格式不正确：应为 20 位字母数字（区分大小写），可含连字符或空格分组，请核对后重试。');
      return;
    }
    // 格式通过后再弹窗确认：兑换不可逆，让用户在决策时刻看到一次性提示
    setConfirmOpen(true);
  };

  const confirmRedeem = async () => {
    const input = code.trim();
    setConfirmOpen(false);
    if (!input) return;

    if (submittedCodeRef.current !== input) {
      requestIdRef.current = await getOrCreateRedeemRequestId(input);
      submittedCodeRef.current = input;
    }
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch(`${apiBaseUrl}/v1/cards/redeem`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: input, requestId: requestIdRef.current }),
      });
      const data = await response.json().catch(() => null) as CardRedeemResponse | null;
      if (!data) {
        setStatus('error');
        setMessage(response.status === 404
          ? '文件提取服务尚未开启，请联系销售方。'
          : '提取服务返回了无效响应，请稍后重试。');
        return;
      }
      if (!response.ok || !data.success) {
        setStatus('error');
        setMessage(data.success ? '提取失败，请稍后重试' : data.message);
        return;
      }
      setResult(data);
      setCode('');
      setStatus('success');
    } catch {
      setStatus('error');
      setMessage('网络连接失败。请尽快直接重试，同一次提取会安全恢复，不会重复核销。');
    }
  };

  const reset = () => {
    setResult(null);
    setStatus('idle');
    setMessage('');
    submittedCodeRef.current = '';
    requestIdRef.current = createRedeemRequestId();
  };

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-x-hidden text-xianxia-text selection:bg-xianxia-jade/35">
      <Helmet>
        <title>文件提取 - Hi, ZuiYi</title>
        <meta name="description" content="输入已购买的提取码，下载对应文件或压缩包。" />
        <meta name="robots" content="noindex,nofollow" />
        {cardSiteUrl && <link rel="canonical" href={cardSiteUrl} />}
      </Helmet>
      <BackgroundGrid />

      <header className="relative z-20 border-b border-xianxia-border/70 bg-xianxia-bg/45 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 sm:px-7">
          <Brand />
          <span className="text-sm tracking-[0.12em] text-xianxia-text/50">文件提取</span>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-12 sm:px-7 sm:py-20">
        {result ? (
          <ResultPanel result={result} onReset={reset} />
        ) : (
          <section className="grid overflow-hidden rounded-2xl border border-xianxia-border bg-[#fffdf9]/80 shadow-[0_28px_80px_-48px_rgba(42,42,42,0.55)] backdrop-blur-sm md:grid-cols-[0.72fr_1.28fr]">
            <div className="border-b border-xianxia-border bg-xianxia-card/55 p-6 md:border-b-0 md:border-r md:p-8">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-xianxia-red/20 bg-xianxia-red/10 text-xianxia-red">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <h1 className="mt-7 font-kai text-2xl font-semibold tracking-[0.08em] text-xianxia-text">提取已购内容</h1>
              <p className="mt-4 text-base leading-7 text-xianxia-text/65">
                输入第三方平台发放的提取码。验证通过后，可下载对应文件或压缩包。
              </p>
              <div className="mt-7 border-l-2 border-xianxia-jade px-3 text-sm leading-6 text-xianxia-text/55">
                每个提取码仅可提取一次。点击「提取文件」后会说明兑换规则。
              </div>
            </div>

            <form onSubmit={submit} className="p-6 sm:p-8" noValidate>
              <label htmlFor="card-code" className="text-sm font-medium text-xianxia-text">提取码</label>
              <div className="mt-3">
                <input
                  id="card-code"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    if (status === 'error') {
                      setStatus('idle');
                      setMessage('');
                    }
                  }}
                  autoComplete="one-time-code"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={96}
                  placeholder="请输入提取码"
                  aria-describedby="card-code-help card-code-message"
                  aria-invalid={status === 'error'}
                  className="min-h-12 w-full rounded-xl border border-xianxia-border bg-white/60 px-4 py-3.5 text-base tracking-[0.08em] text-xianxia-text outline-none placeholder:tracking-normal placeholder:text-xianxia-text/35 focus:border-xianxia-jadeDark focus:ring-4 focus:ring-xianxia-jade/15"
                />
              </div>
              <p id="card-code-help" className="mt-3 text-sm leading-6 text-xianxia-text/50">
                提取码为 20 位字母数字，区分大小写，通常按 4 组展示（如 XXXXX-XXXXX-XXXXX-XXXXX）。支持直接粘贴，空格和连接符会自动处理。
              </p>

              <div id="card-code-message" aria-live="polite" className="min-h-12 pt-3">
                {status === 'error' && (
                  <p className="rounded-lg border border-xianxia-red/15 bg-xianxia-red/5 px-3 py-2 text-sm leading-6 text-xianxia-red">
                    {message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={status === 'submitting'}
                className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-xianxia-red px-5 text-base font-medium tracking-[0.08em] text-white shadow-sm transition-colors hover:bg-xianxia-redHover focus:outline-none focus:ring-4 focus:ring-xianxia-red/20 disabled:cursor-wait disabled:opacity-65"
              >
                {status === 'submitting' ? (
                  <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />正在验证</>
                ) : '提取文件'}
              </button>

              <p className="mt-5 text-center text-sm leading-6 text-xianxia-text/45">
                售后请以原销售平台说明为准。
              </p>
            </form>
          </section>
        )}
      </main>

      <footer className="relative z-10 border-t border-xianxia-border/60 px-5 py-8 text-center text-sm text-xianxia-text/45">
        Hi, ZuiYi · 文件提取
      </footer>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-xianxia-text/45 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="redeem-confirm-title"
          onClick={(event) => {
            if (event.target === event.currentTarget && status !== 'submitting') setConfirmOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-xianxia-border bg-[#fffdf9] p-6 shadow-[0_28px_80px_-40px_rgba(42,42,42,0.6)] sm:p-7">
            <h3 id="redeem-confirm-title" className="font-kai text-lg font-semibold text-xianxia-text">兑换前请确认</h3>
            <ul className="mt-4 space-y-2.5 pl-5 text-sm leading-6 text-xianxia-text/75">
              <li className="list-disc">兑换后<strong className="text-xianxia-red">立即失效</strong>，无法撤销或退回；</li>
              <li className="list-disc">下载机会<strong className="text-xianxia-red">仅一次</strong>，兑换后请立即下载，期间请勿刷新或关闭本页面；</li>
              <li className="list-disc">请在网络稳定的环境下操作，确认文件完整保存后再离开。</li>
            </ul>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={status === 'submitting'}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-xianxia-border bg-white/60 px-4 text-sm font-medium text-xianxia-text/70 transition-colors hover:bg-white focus:outline-none focus:ring-4 focus:ring-xianxia-jade/15 disabled:opacity-50"
              >
                再想想
              </button>
              <button
                type="button"
                onClick={confirmRedeem}
                disabled={status === 'submitting'}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-xianxia-red px-4 text-sm font-medium tracking-[0.08em] text-white shadow-sm transition-colors hover:bg-xianxia-redHover focus:outline-none focus:ring-4 focus:ring-xianxia-red/20 disabled:cursor-wait disabled:opacity-65"
              >
                {status === 'submitting'
                  ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />正在验证</>
                  : '确认兑换'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

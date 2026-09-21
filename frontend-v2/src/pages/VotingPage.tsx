import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BarChart3, Check, ExternalLink, Eye, LockKeyhole, Send, X } from 'lucide-react';
import { useToast } from '../components/Toast';

const PigeonPreviewPage = lazy(() => import('./labs/PigeonPostPreviewPage'));
const FaxPreviewPage = lazy(() => import('./labs/FaxMachinePreviewPage'));

const POLL_ID = 'product-roadmap-2026';

type ProductPollPreview = 'pigeon' | 'fax' | null;
type Selections = Record<string, string>;

interface PollOption {
  id: string;
  title: string;
  description: string;
  preview: ProductPollPreview;
  previewEnabled: boolean;
  previewUrl: string;
}

interface PollCategory {
  id: 'feedback-ui' | 'next-module';
  title: string;
  description: string;
  options: PollOption[];
}

interface PollDefinition {
  enabled: boolean;
  title: string;
  description: string;
  categories: PollCategory[];
}

interface PollResults {
  totalVotes: number;
  categories: Record<string, Record<string, number>>;
}

interface PollState {
  definition: PollDefinition;
  totalVotes: number;
  hasVoted: boolean;
  selections: Selections | null;
  results: PollResults | null;
  requiresLogin: boolean;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('user_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function categoryVoteCount(results: PollResults | null, categoryId: string): number {
  if (!results) return 0;
  return Object.values(results.categories[categoryId] || {}).reduce((total, count) => total + count, 0);
}

function resultPercent(results: PollResults | null, categoryId: string, optionId: string): number {
  const categoryTotal = categoryVoteCount(results, categoryId);
  if (categoryTotal === 0) return 0;
  const count = results?.categories[categoryId]?.[optionId] || 0;
  return Math.round((count / categoryTotal) * 100);
}

const FeaturePreview = ({ preview, previewUrl, title, onClose }: { preview: Exclude<ProductPollPreview, null>; previewUrl: string; title: string; onClose: () => void }) => {
  const Preview = preview === 'pigeon' ? PigeonPreviewPage : FaxPreviewPage;
  const externalPreview = previewUrl.trim();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-neutral-950/55 backdrop-blur-sm p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={`${title}功能预览`}>
      <div className="w-full max-w-4xl max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-4rem)] bg-xianxia-bg border border-xianxia-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <header className="h-14 shrink-0 px-4 sm:px-6 border-b border-xianxia-border bg-xianxia-card flex items-center justify-between">
          <div>
            <p className="text-xs tracking-widest text-xianxia-text font-kai">{title}</p>
            <p className="text-[10px] mt-1 text-xianxia-text/45 font-serif">{externalPreview ? '外部静态预览，不会提交真实反馈' : '功能演示不会提交真实反馈'}</p>
          </div>
          <div className="flex items-center gap-1">
            {externalPreview && (
              <a
                href={externalPreview}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 px-2 text-[10px] tracking-wider text-xianxia-jade hover:text-xianxia-red"
              >
                新标签打开<ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button type="button" onClick={onClose} className="w-9 h-9 flex items-center justify-center text-xianxia-text/55 hover:text-xianxia-red" aria-label="关闭预览">
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto bg-white">
          {externalPreview ? (
            <iframe
              title={`${title}外部预览`}
              src={externalPreview}
              sandbox="allow-forms allow-modals allow-popups allow-scripts"
              referrerPolicy="strict-origin-when-cross-origin"
              className="block h-full min-h-[520px] w-full border-0 bg-white"
            />
          ) : (
            <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-neutral-500">正在加载预览...</div>}>
              <Preview />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
};

export const VotingPage = () => {
  const { showToast } = useToast();
  const [selections, setSelections] = useState<Selections>({});
  const [pollState, setPollState] = useState<PollState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [previewOption, setPreviewOption] = useState<{ preview: Exclude<ProductPollPreview, null>; previewUrl: string; title: string } | null>(null);

  const categories = pollState?.definition.categories || [];
  const selectedCount = categories.filter(category => selections[category.id]).length;
  const complete = categories.length > 0 && selectedCount === categories.length;

  const loadPoll = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/polls/${POLL_ID}`, { headers: authHeaders() });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || '读取投票失败');
      setPollState(payload.data);
      if (payload.data.selections) setSelections(payload.data.selections);
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : '读取投票失败', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadPoll();
    const handleLogin = () => void loadPoll();
    const handleLogout = () => {
      setSelections({});
      void loadPoll();
    };
    window.addEventListener('login-success', handleLogin);
    window.addEventListener('admin-login-success', handleLogin);
    window.addEventListener('logout', handleLogout);
    return () => {
      window.removeEventListener('login-success', handleLogin);
      window.removeEventListener('admin-login-success', handleLogin);
      window.removeEventListener('logout', handleLogout);
    };
  }, [loadPoll]);

  const selectOption = (categoryId: string, optionId: string) => {
    if (pollState?.hasVoted || !pollState?.definition.enabled) return;
    setSelections(current => ({ ...current, [categoryId]: optionId }));
  };

  const submitVote = async () => {
    const token = localStorage.getItem('user_token');
    if (!token) {
      showToast({ message: '请先使用右下角的访客登录，再提交投票', type: 'info', duration: 4500 });
      return;
    }
    if (!complete) {
      showToast({ message: '请完成全部选择后再提交', type: 'info' });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/v1/polls/${POLL_ID}/votes`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        if (response.status === 401) window.dispatchEvent(new Event('token-expired'));
        throw new Error(payload.message || '投票提交失败');
      }
      setPollState(current => current ? {
        ...current,
        totalVotes: payload.data.results.totalVotes,
        hasVoted: true,
        selections: payload.data.selections,
        results: payload.data.results,
        requiresLogin: false,
      } : current);
      showToast({ message: payload.message || '投票提交成功', type: 'success' });
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : '投票提交失败', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const results = pollState?.results || null;

  return (
    <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 mt-20 md:mt-24 pb-24 font-kai text-xianxia-text">
      <section className="relative z-20 w-full max-w-3xl mx-auto text-center mb-16 md:mb-24">
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-[0.5em] leading-tight ml-[0.5em]">
            {pollState?.definition.title || (loading ? '正在加载...' : '产品功能投票')}
        </h1>

        <div className="flex items-center justify-center w-full max-w-xs mx-auto opacity-40 mt-6 mb-9">
          <div className="h-px w-full bg-gradient-to-r from-transparent to-xianxia-red" />
          <div className="w-1.5 h-1.5 rounded-full border border-xianxia-red mx-3 flex-shrink-0 animate-pulse" />
          <div className="h-px w-full bg-gradient-to-l from-transparent to-xianxia-red" />
        </div>

        <p className="max-w-2xl mx-auto text-sm sm:text-base leading-8 tracking-wider text-xianxia-text/65 font-serif">
          {pollState?.definition.description || '投票内容暂时无法加载。'}
        </p>
        <div className="mt-8 grid w-full gap-x-10 gap-y-5 text-left sm:grid-cols-2">
          {categories.map(category => {
            const categoryTotal = categoryVoteCount(results, category.id);
            return (
              <div key={category.id} className="font-serif">
                <div className="flex items-center justify-between gap-3 text-xs tracking-widest text-xianxia-text/70">
                  <span className="inline-flex items-center gap-2"><BarChart3 className="h-3.5 w-3.5 text-xianxia-jade" />{category.title}</span>
                  <strong className="shrink-0 font-semibold text-xianxia-jade">{categoryTotal} 票</strong>
                </div>
                <div className="mt-3 space-y-2.5">
                  {category.options.map(option => {
                    const count = results?.categories[category.id]?.[option.id] || 0;
                    const percentage = resultPercent(results, category.id, option.id);
                    return (
                      <div key={option.id}>
                        <div className="mb-1 flex justify-between gap-3 text-[10px] tracking-wider text-xianxia-text/50">
                          <span className="truncate">{option.title}</span>
                          <span className="shrink-0">{count} 票 · {percentage}%</span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-xianxia-border/35" role="progressbar" aria-label={`${category.title}：${option.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
                          <div className="h-full rounded-full bg-gradient-to-r from-xianxia-jade/50 to-xianxia-jade transition-[width] duration-700 ease-out" style={{ width: `${percentage}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-serif tracking-widest text-xianxia-text/55">
          <span className="inline-flex items-center gap-2"><Check className="w-4 h-4 text-xianxia-red" />已选择 {selectedCount}/{categories.length}</span>
          <span className="inline-flex items-center gap-2"><LockKeyhole className="w-4 h-4" />匿名统计</span>
        </div>
      </section>

      {!loading && pollState && !pollState.definition.enabled && (
        <div className="mt-8 border border-xianxia-border bg-xianxia-card/60 px-5 py-4 text-sm font-serif tracking-wider text-xianxia-text/65">
          当前投票暂未开放，你仍可以查看功能介绍和预览。
        </div>
      )}

      <div className="space-y-12">
        {categories.map((category, categoryIndex) => (
          <fieldset key={category.id} className="min-w-0">
            <legend className="sr-only">{category.title}</legend>
            <div className="flex items-start gap-4 mb-5">
              <span className="font-serif text-[10px] tracking-[0.24em] text-xianxia-red pt-1 whitespace-nowrap">
                {String(categoryIndex + 1).padStart(2, '0')}
              </span>
              <div>
                <h2 className="text-xl sm:text-2xl tracking-[0.1em]">{category.title}</h2>
                <p className="mt-2 text-xs sm:text-sm font-serif leading-6 tracking-wider text-xianxia-text/55">{category.description}</p>
              </div>
            </div>

            <div className={`grid gap-3 sm:gap-4 sm:pl-9 ${category.options.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
              {category.options.map(option => {
                const selected = selections[category.id] === option.id;
                const percentage = resultPercent(results, category.id, option.id);
                const count = results?.categories[category.id]?.[option.id] || 0;
                return (
                  <div
                    key={option.id}
                    className={`flex min-h-[190px] flex-col overflow-hidden border transition-all duration-300 bg-xianxia-card/65 backdrop-blur-sm ${
                      selected
                        ? 'border-xianxia-red/70 shadow-[0_12px_35px_-25px_rgba(200,60,35,0.8)]'
                        : 'border-xianxia-border/70 hover:border-xianxia-jade/60'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={loading || pollState?.hasVoted || !pollState?.definition.enabled}
                      onClick={() => selectOption(category.id, option.id)}
                      className="block w-full flex-1 text-left p-5 sm:p-6 disabled:cursor-default"
                    >
                      <span className="flex items-start justify-between gap-4">
                        <span className={`w-9 h-9 shrink-0 border flex items-center justify-center text-sm transition-colors ${selected ? 'border-xianxia-red text-xianxia-red' : 'border-xianxia-border text-xianxia-text/50'}`}>
                          {selected ? <Check className="w-4 h-4" /> : option.title.slice(0, 1)}
                        </span>
                      </span>
                      <span className={`block mt-5 text-lg tracking-[0.12em] ${selected ? 'text-xianxia-red' : 'text-xianxia-text'}`}>{option.title}</span>
                      <span className="block mt-2 text-xs sm:text-sm font-serif leading-6 tracking-wider text-xianxia-text/58">{option.description}</span>
                      {results && (
                        <span className="block mt-5" aria-label={`${option.title}当前获得 ${count} 票，占 ${percentage}%`}>
                          <span className="mb-2 flex items-center justify-between text-[10px] font-serif tracking-widest text-xianxia-text/50">
                            <span>支持票数</span>
                            <span className="text-xianxia-jade">{count} 票 · {percentage}%</span>
                          </span>
                          <span
                            className="block h-1.5 overflow-hidden rounded-full bg-xianxia-border/30"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={percentage}
                          >
                            <span
                              className="block h-full rounded-full bg-gradient-to-r from-xianxia-jade/55 to-xianxia-jade transition-[width] duration-700 ease-out"
                              style={{ width: `${percentage}%` }}
                            />
                          </span>
                        </span>
                      )}
                    </button>
                    <div className="mx-5 flex min-h-10 items-center justify-between border-t border-xianxia-border/45 text-[10px] font-serif tracking-widest">
                      <span className={selected ? 'text-xianxia-red' : 'text-xianxia-text/35'}>{selected ? '已选择' : ''}</span>
                      {option.preview && option.previewEnabled && (
                        <button
                          type="button"
                          onClick={() => setPreviewOption({ preview: option.preview as Exclude<ProductPollPreview, null>, previewUrl: option.previewUrl || '', title: option.title })}
                          className="inline-flex items-center gap-1.5 text-xianxia-jade hover:text-xianxia-red transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />查看预览
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <section className="mt-14 border-t border-xianxia-border/70 pt-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="font-serif text-xs leading-6 tracking-wider text-xianxia-text/52">
          {pollState?.hasVoted
            ? '投票已提交，上方显示当前统计结果。'
            : !pollState?.definition.enabled
              ? '当前投票未开放。'
              : pollState?.requiresLogin
                ? '提交投票前，请先使用右下角的访客登录。'
                : '请完成全部选择后提交，每个账号只能提交一次。'}
        </div>
        <button
          type="button"
          onClick={submitVote}
          disabled={loading || submitting || pollState?.hasVoted || !pollState?.definition.enabled}
          className="group min-w-[190px] px-7 py-3.5 border border-xianxia-text bg-xianxia-text text-xianxia-bg hover:border-xianxia-red hover:bg-xianxia-red disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-serif text-xs tracking-[0.22em] inline-flex items-center justify-center gap-3"
        >
          {pollState?.hasVoted ? <><Check className="w-4 h-4" />投票已提交</> : submitting ? '正在提交...' : <><Send className="w-4 h-4" />提交投票</>}
        </button>
      </section>

      {previewOption && (
        <FeaturePreview preview={previewOption.preview} previewUrl={previewOption.previewUrl} title={previewOption.title} onClose={() => setPreviewOption(null)} />
      )}
    </div>
  );
};

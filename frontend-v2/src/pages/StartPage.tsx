import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import './StartPage.css';
import { StartWeather } from '../components/start/StartWeather';
import { StartSearch } from '../components/start/StartSearch';
import { SearchEngineId, SEARCH_ENGINES, SEARCH_ENGINE_STORAGE_KEY, getSearchUrl as getUrl } from '../lib/startSearch';
import {
  BookOpen,
  ExternalLink,
  FolderOpen,
  Image,
  Link2,
  Mail,
  MessageCircle,
  Pencil,
  PenLine,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';

const StaticComplianceFooter = __STATIC_COMPLIANCE_BUILD__
  ? lazy(() => import('../components/StaticComplianceFooter').then(module => ({ default: module.StaticComplianceFooter })))
  : null;

interface Shortcut {
  label: string;
  url: string;
  icon: string;
}

const ICONS = [
  { id: 'folder', label: '文件夹', Icon: FolderOpen },
  { id: 'book', label: '书页', Icon: BookOpen },
  { id: 'image', label: '图片', Icon: Image },
  { id: 'pen', label: '书写', Icon: PenLine },
  { id: 'message', label: '留言', Icon: MessageCircle },
  { id: 'mail', label: '信件', Icon: Mail },
  { id: 'sparkle', label: '灵感', Icon: Sparkles },
];

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { label: '自定义', url: '', icon: 'folder' },
  { label: '自定义', url: '', icon: 'book' },
  { label: '自定义', url: '', icon: 'image' },
  { label: '自定义', url: '', icon: 'pen' },
  { label: '自定义', url: '', icon: 'message' },
  { label: '自定义', url: '', icon: 'mail' },
  { label: '自定义', url: '', icon: 'sparkle' },
];

const SHORTCUT_STORAGE_KEY = 'zhuiyi_start_page_shortcuts_v1';

const readShortcuts = (): Shortcut[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) || '[]');
    if (!Array.isArray(saved) || saved.length !== DEFAULT_SHORTCUTS.length) return DEFAULT_SHORTCUTS;
    return saved.map((item, index) => ({
      label: typeof item?.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 12) : '自定义',
      url: typeof item?.url === 'string' ? item.url.trim().slice(0, 2048) : '',
      icon: ICONS.some(({ id }) => id === item?.icon) ? item.icon : DEFAULT_SHORTCUTS[index].icon,
    }));
  } catch {
    return DEFAULT_SHORTCUTS;
  }
};

const getLunarDate = (date: Date): string => {
  try {
    return new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' })
      .format(date)
      .replace('年', '')
      .replace('月', '月');
  } catch {
    return '农历待定';
  }
};

export const StartPage = ({ blogHref = '/' }: { blogHref?: string } = {}) => {
  const [now, setNow] = useState(() => new Date());
  const [engineId, setEngineId] = useState<SearchEngineId>(() => {
    try {
      const saved = localStorage.getItem(SEARCH_ENGINE_STORAGE_KEY);
      return SEARCH_ENGINES.some((engine) => engine.id === saved) ? saved as SearchEngineId : 'bing';
    } catch {
      return 'bing';
    }
  });
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(readShortcuts);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Shortcut>(DEFAULT_SHORTCUTS[0]);

  const engine = useMemo(
    () => SEARCH_ENGINES.find((item) => item.id === engineId) || SEARCH_ENGINES[0],
    [engineId],
  );

  const dateText = useMemo(
    () => new Intl.DateTimeFormat('zh-CN', {
      month: 'long', day: 'numeric', weekday: 'long',
    }).format(now),
    [now],
  );
  const timeText = useMemo(
    () => new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now),
    [now],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SEARCH_ENGINE_STORAGE_KEY, engineId); } catch { /* Storage may be disabled. */ }
  }, [engineId]);

  useEffect(() => {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts));
  }, [shortcuts]);

  const openShortcut = (index: number) => {
    const shortcut = shortcuts[index];
    if (shortcut.url) {
      window.location.assign(getUrl(shortcut.url, engine));
      return;
    }
    setDraft(shortcut);
    setEditingIndex(index);
  };

  const saveShortcut = () => {
    if (editingIndex === null) return;
    setShortcuts((items) => items.map((item, index) => (
      index === editingIndex
        ? {
          label: draft.label.trim().slice(0, 12) || '自定义',
          url: draft.url.trim().slice(0, 2048),
          icon: ICONS.some(({ id }) => id === draft.icon) ? draft.icon : item.icon,
        }
        : item
    )));
    setEditingIndex(null);
  };

  const resetShortcut = () => {
    if (editingIndex === null) return;
    setShortcuts((items) => items.map((item, index) => index === editingIndex ? DEFAULT_SHORTCUTS[index] : item));
    setEditingIndex(null);
  };

  return (
    <div className="start-page relative isolate text-xianxia-text">
      <Helmet>
        <title>起始页</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div
        aria-hidden="true"
        className="start-page__background pointer-events-none absolute inset-0 z-0"
      />

      <a
        className="start-page__brand absolute z-10 flex items-center gap-2.5 text-xianxia-red transition-opacity hover:opacity-75"
        href={blogHref}
        title="打开 HI,ZhuiYi 博客"
      >
        <span className="start-page__brand-mark flex items-center justify-center rounded-full bg-[#1e1e1e] text-white shadow-sm">Z</span>
        <span className="font-kai text-xl tracking-wide">HI,ZhuiYi</span>
      </a>

      <main className="start-page__main relative mx-auto flex w-full flex-col items-center">
        <section className="flex w-full flex-col items-center text-center">
          <time className="start-page__clock text-[#252525]">
            {timeText}
          </time>
          <p className="start-page__date font-kai text-xianxia-text/75">
            {dateText} <span className="mx-2 text-xianxia-jadeDark">·</span> {getLunarDate(now)}
          </p>
          <p className="start-page__quote font-kai text-xianxia-text/75">清风有度，心自从容。</p>

          <StartSearch engine={engine} onEngineChange={setEngineId} />

          <nav className="start-page__shortcuts relative z-10" aria-label="快捷入口">
              <a
                className="start-page__shortcut group"
                href={blogHref}
                title="打开 HI,ZhuiYi 博客"
              >
                <span className="start-page__shortcut-icon start-page__brand-mark flex items-center justify-center rounded-full bg-[#1e1e1e] text-white">Z</span>
                <span className="mt-2 font-kai text-xs leading-4 text-xianxia-red">HI,ZhuiYi<br />博客</span>
              </a>

              {shortcuts.map((shortcut, index) => {
                const icon = ICONS.find((item) => item.id === shortcut.icon) || ICONS[0];
                const Icon = icon.Icon;
                return (
                  <button
                    className="start-page__shortcut group relative"
                    key={`${shortcut.label}-${index}`}
                    onClick={() => openShortcut(index)}
                    title={shortcut.url ? `打开 ${shortcut.label}` : `编辑第 ${index + 1} 个快捷入口`}
                    type="button"
                  >
                    <Icon className="start-page__shortcut-icon text-xianxia-text" strokeWidth={1.7} />
                    <span className="mt-3 max-w-full truncate font-kai text-sm text-xianxia-text">{shortcut.label}</span>
                    <Pencil className="absolute right-2 top-2 h-3 w-3 text-xianxia-text/0 transition-colors group-hover:text-xianxia-text/50" strokeWidth={1.7} />
                  </button>
                );
              })}
          </nav>
        </section>
      </main>

      <div className="start-page__footer absolute z-10 flex items-center gap-2">
        <StartWeather lunarDate={getLunarDate(now)} />
        <button
          className="start-page__settings flex items-center justify-center rounded-full text-xianxia-text transition-transform hover:rotate-12"
          onClick={() => { setDraft(shortcuts[0]); setEditingIndex(0); }}
          title="管理快捷入口"
          type="button"
        >
          <Settings className="h-5 w-5" strokeWidth={1.7} />
        </button>
      </div>
      <p className="absolute inset-x-0 bottom-14 z-10 px-4 text-center text-[10px] text-xianxia-text/45">
        搜索联想词会发送至所选搜索服务；天气定位仅在你明确授权后使用，快捷入口仅保存在当前浏览器。
      </p>
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-nowrap items-center justify-center gap-3 overflow-x-auto whitespace-nowrap px-4 pb-4 text-[10px] text-xianxia-text/45">
        <span>© {new Date().getFullYear()} HI,ZhuiYi. All Rights Reserved.</span>
        {StaticComplianceFooter
          ? <Suspense fallback={null}><StaticComplianceFooter source="/site-compliance.json" inline leadingSeparator /></Suspense>
          : null}
      </div>

      {editingIndex !== null && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#302e29]/25 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="编辑快捷入口">
          <div className="w-full max-w-md rounded-[24px] border border-white/90 bg-[#fcfaf6]/95 p-6 shadow-[0_24px_65px_rgba(48,46,41,0.22)] backdrop-blur-2xl sm:p-7">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-kai text-xl text-xianxia-text">自定义快捷入口</p>
                <p className="mt-1 text-sm text-xianxia-text/55">填写名称与网址，内容仅保存于当前浏览器。</p>
              </div>
              <button className="rounded-full p-2 text-xianxia-text/60 hover:bg-xianxia-jade/15" onClick={() => setEditingIndex(null)} type="button" aria-label="关闭">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-6 block text-sm text-xianxia-text/70">
              名称
              <input className="mt-2 h-11 w-full rounded-xl border border-xianxia-border bg-white/55 px-3 font-kai outline-none transition focus:border-xianxia-jadeDark" maxLength={12} onChange={(event) => setDraft((value) => ({ ...value, label: event.target.value }))} value={draft.label} />
            </label>
            <label className="mt-4 block text-sm text-xianxia-text/70">
              网址
              <div className="relative mt-2">
                <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-xianxia-text/45" />
                <input className="h-11 w-full rounded-xl border border-xianxia-border bg-white/55 py-0 pl-9 pr-3 font-sans text-sm outline-none transition focus:border-xianxia-jadeDark" onChange={(event) => setDraft((value) => ({ ...value, url: event.target.value }))} placeholder="https://example.com" value={draft.url} />
              </div>
            </label>
            <div className="mt-5">
              <p className="text-sm text-xianxia-text/70">图标</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {ICONS.map(({ id, label, Icon }) => (
                  <button className={`flex h-10 w-10 items-center justify-center rounded-xl border transition ${draft.icon === id ? 'border-xianxia-jadeDark bg-xianxia-jade/15 text-xianxia-text' : 'border-xianxia-border bg-white/50 text-xianxia-text/65 hover:bg-xianxia-jade/10'}`} key={id} onClick={() => setDraft((value) => ({ ...value, icon: id }))} title={label} type="button">
                    <Icon className="h-5 w-5" strokeWidth={1.7} />
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-7 flex items-center justify-between gap-3">
              <button className="rounded-xl px-3 py-2 text-sm text-xianxia-text/60 hover:bg-xianxia-jade/10" onClick={resetShortcut} type="button">恢复空白</button>
              <div className="flex gap-2">
                <button className="rounded-xl px-4 py-2 text-sm text-xianxia-text/70 hover:bg-xianxia-jade/10" onClick={() => setEditingIndex(null)} type="button">取消</button>
                <button className="flex items-center gap-2 rounded-xl bg-xianxia-text px-4 py-2 text-sm text-white shadow-sm transition hover:bg-xianxia-red" onClick={saveShortcut} type="button"><ExternalLink className="h-4 w-4" />保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

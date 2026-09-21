import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ArrowUpLeft, ChevronDown, Globe2, Loader2, Search } from 'lucide-react';
import { canSuggest, getSearchUrl, nextSuggestionIndex, SEARCH_ENGINES, SEARCH_SUGGEST_STORAGE_KEY, SearchEngine, SearchEngineId } from '../../lib/startSearch';
import { useSearchSuggestions } from './useSearchSuggestions';

export function StartSearch({ engine, onEngineChange }: { engine: SearchEngine; onEngineChange: (id: SearchEngineId) => void }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [engineOpen, setEngineOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem(SEARCH_SUGGEST_STORAGE_KEY) !== 'off'; } catch { return true; } });
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const compositionEnded = useRef(0);
  const showing = focused && enabled && !engineOpen && !dismissed && !composing && canSuggest(query);
  const suggestions = useSearchSuggestions(engine.id, query, showing);
  const selected = showing ? suggestions.items[activeIndex] : undefined;

  useEffect(() => { try { localStorage.setItem(SEARCH_SUGGEST_STORAGE_KEY, enabled ? 'on' : 'off'); } catch { /* Session setting still works. */ } }, [enabled]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) { setFocused(false); setEngineOpen(false); setActiveIndex(-1); }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useEffect(() => { if (selected) document.getElementById(`start-suggestion-${activeIndex}`)?.scrollIntoView({ block: 'nearest' }); }, [activeIndex, selected]);

  const search = (text: string, suggestion = false) => {
    if (!text.trim()) return;
    setFocused(false);
    setDismissed(true);
    window.location.assign(getSearchUrl(text, engine, suggestion));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (composingRef.current || Date.now() - compositionEnded.current < 80) return;
    search(selected || query, Boolean(selected));
  };
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setDismissed(false); setEngineOpen(false);
      setActiveIndex(index => nextSuggestionIndex(index, event.key === 'ArrowDown' ? 1 : -1, suggestions.items.length));
    } else if (event.key === 'Escape') {
      event.preventDefault(); setDismissed(true); setEngineOpen(false); setActiveIndex(-1);
    } else if (event.key === 'Tab') { setDismissed(true); setActiveIndex(-1); }
  };

  return <form ref={formRef} className="start-page__search relative z-20 w-full" onSubmit={submit}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setFocused(false); setEngineOpen(false); } }}>
    <div className="start-page__search-surface" data-expanded={showing}>
    <div className="start-page__search-field flex items-center">
      <Search className="h-5 w-5 shrink-0 text-xianxia-text/70" strokeWidth={1.6} />
      <input ref={inputRef} aria-label="搜索或输入网址" role="combobox" aria-autocomplete="list" aria-expanded={showing && suggestions.items.length > 0}
        aria-controls={showing && suggestions.items.length ? 'start-search-suggestions' : undefined}
        aria-activedescendant={selected ? `start-suggestion-${activeIndex}` : undefined}
        autoComplete="off" spellCheck={false} maxLength={2048}
        className="h-full min-w-0 flex-1 bg-transparent px-3 font-kai text-base text-xianxia-text outline-none placeholder:text-xianxia-text/45"
        onFocus={() => { setFocused(true); setDismissed(false); }}
        onChange={event => { setQuery(event.target.value); setActiveIndex(-1); setDismissed(false); setEngineOpen(false); }}
        onCompositionStart={() => { composingRef.current = true; setComposing(true); setActiveIndex(-1); }}
        onCompositionEnd={event => { composingRef.current = false; compositionEnded.current = Date.now(); setComposing(false); setQuery(event.currentTarget.value); }}
        onKeyDown={handleKey} placeholder="搜索或输入网址" value={query} />
      <div className="relative ml-1 shrink-0 border-l border-xianxia-border/70 pl-2">
        <button type="button" aria-expanded={engineOpen} aria-haspopup="listbox" aria-label={`选择搜索引擎：${engine.name}`} aria-controls="start-search-engines"
          className="flex h-8 items-center gap-1 rounded-full px-2 font-kai text-sm text-xianxia-text/70 transition-colors hover:bg-xianxia-jade/15"
          onClick={() => { setEngineOpen(value => !value); setActiveIndex(-1); }} onKeyDown={event => { if (event.key === 'Escape') setEngineOpen(false); }}>
          <Globe2 className="h-4 w-4" /><span className="hidden sm:inline">{engine.name}</span><ChevronDown className="h-4 w-4" />
        </button>
        {engineOpen && <div className="start-page__engines absolute right-0 top-11 z-30 w-44 rounded-2xl p-1.5 text-left">
          <div id="start-search-engines" role="listbox" aria-label="搜索引擎">
            {SEARCH_ENGINES.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === engine.id}
              className={`flex w-full rounded-xl px-3 py-2 text-left font-kai text-sm ${item.id === engine.id ? 'bg-xianxia-jade/20' : 'hover:bg-xianxia-jade/10'}`}
              onClick={() => { onEngineChange(item.id); setEngineOpen(false); setActiveIndex(-1); setDismissed(false); inputRef.current?.focus(); }}>{item.name}</button>)}
          </div>
          <button type="button" className="mt-1 flex w-full justify-between border-t border-xianxia-border/60 px-3 py-2 text-xs" aria-pressed={enabled} onClick={() => setEnabled(value => !value)}>联网联想<span>{enabled ? '开启' : '关闭'}</span></button>
        </div>}
      </div>
    </div>
    {showing && <div className="start-page__suggestions overflow-hidden text-left">
      {suggestions.items.length > 0 ? <ul id="start-search-suggestions" role="listbox" aria-label="搜索联想" className="start-page__suggestion-list p-1.5">
        {suggestions.items.map((item, index) => <li key={item} id={`start-suggestion-${index}`} role="option" aria-selected={activeIndex === index}>
          <button type="button" tabIndex={-1} className={`start-page__suggestion flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left font-kai text-sm ${activeIndex === index ? 'is-active' : ''}`}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => search(item, true)}>
            <Search className="h-3.5 w-3.5 shrink-0 opacity-45" /><span className="min-w-0 flex-1 truncate">{item}</span><ArrowUpLeft className="h-3.5 w-3.5 shrink-0 opacity-40" />
          </button>
        </li>)}
      </ul> : <p role="status" className="flex items-center gap-2 px-5 py-4 text-xs text-xianxia-text/60">
        {suggestions.status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {suggestions.status === 'loading' ? '正在获取联想…' : suggestions.status === 'error' ? '联想暂不可用，可按回车正常搜索' : '暂无联想词，可按回车搜索'}
      </p>}
      <div className="flex items-center justify-between gap-3 border-t border-xianxia-border/60 px-5 py-2.5 text-[11px] text-xianxia-text/55">
        <span>输入词经本站发送至{engine.name} · 不保存搜索历史</span>
        <button type="button" className="shrink-0 underline" onClick={() => { setEnabled(false); setActiveIndex(-1); }} aria-label="关闭搜索联想">关闭</button>
      </div>
    </div>}
    </div>
  </form>;
}

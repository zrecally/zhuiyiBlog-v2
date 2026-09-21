import { useEffect, useRef, useState } from 'react';
import { canSuggest, createSuggestionClient, SearchEngineId, SUGGEST_DEBOUNCE_MS } from '../../lib/startSearch';

export function useSearchSuggestions(engine: SearchEngineId, query: string, enabled: boolean) {
  const client = useRef(createSuggestionClient());
  const [result, setResult] = useState<{ key: string; items: string[]; status: 'loading' | 'ready' | 'error' }>({ key: '', items: [], status: 'ready' });
  const normalized = query.trim();
  const key = `${engine}:${normalized}`;
  const active = enabled && canSuggest(query);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setResult({ key, items: [], status: 'loading' });
      void client.current(engine, normalized, controller.signal).then(items => {
        if (!controller.signal.aborted) setResult({ key, items, status: 'ready' });
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ key, items: [], status: 'error' });
      });
    }, SUGGEST_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [engine, normalized, key, active]);
  return active ? result.key === key ? result : { key, items: [], status: 'loading' as const }
    : { key, items: [], status: 'idle' as const };
}

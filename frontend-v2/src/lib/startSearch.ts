export type SearchEngineId = 'bing' | 'baidu' | 'google' | 'duckduckgo';
export interface SearchEngine { id: SearchEngineId; name: string; endpoint: string }
export const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'bing', name: '必应', endpoint: 'https://www.bing.com/search?q=' },
  { id: 'baidu', name: '百度', endpoint: 'https://www.baidu.com/s?wd=' },
  { id: 'google', name: 'Google', endpoint: 'https://www.google.com/search?q=' },
  { id: 'duckduckgo', name: 'DuckDuckGo', endpoint: 'https://duckduckgo.com/?q=' },
];
export const SEARCH_ENGINE_STORAGE_KEY = 'zhuiyi_start_page_engine_v1';
export const SEARCH_SUGGEST_STORAGE_KEY = 'zhuiyi_start_page_suggestions_v1';
export const SUGGEST_DEBOUNCE_MS = 300;

const domain = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#].*)?$/i;
export function getSearchUrl(value: string, engine: SearchEngine, suggestion = false): string {
  const query = value.trim();
  // Suggestions are always search terms, never destinations supplied by a third party.
  if (!suggestion) {
    if (/^https?:\/\//i.test(query)) return query;
    if (domain.test(query)) return `https://${query}`;
  }
  return `${engine.endpoint}${encodeURIComponent(query)}`;
}

export function canSuggest(value: string): boolean {
  const query = value.trim();
  return query.length > 0 && query.length <= 100 && !domain.test(query)
    && !/(?:[a-z][a-z\d+.-]*:\/\/|@|^\/|^localhost(?:[:/]|$)|^\S+:)/i.test(query);
}

export function parseSearchSuggestions(payload: unknown, query: string): string[] {
  if (!Array.isArray(payload) || typeof payload[0] !== 'string' || !Array.isArray(payload[1])) throw new Error('联想返回格式无效');
  if (payload[0].trim().toLocaleLowerCase() !== query.trim().toLocaleLowerCase()) throw new Error('联想返回了其他查询');
  const seen = new Set([query.trim().toLocaleLowerCase()]);
  return payload[1].flatMap((item: unknown) => {
    if (typeof item !== 'string') return [];
    const text = item.replace(/[\uE000\uE001]/g, '').replace(/\s+/g, ' ').trim();
    const key = text.toLocaleLowerCase();
    if (!text || text.length > 160 || seen.has(key)) return [];
    seen.add(key);
    return [text];
  }).slice(0, 8);
}

export function nextSuggestionIndex(index: number, direction: 1 | -1, count: number) {
  if (!count) return -1;
  return index < 0 ? direction === 1 ? 0 : count - 1 : (index + direction + count) % count;
}

export function createSuggestionClient(fetcher: typeof fetch = fetch) {
  // Memory-only, bounded cache. Never save query history in localStorage.
  const cache = new Map<string, { at: number; items: string[] }>();
  return async (engine: SearchEngineId, value: string, signal: AbortSignal): Promise<string[]> => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!SEARCH_ENGINES.some(item => item.id === engine) || !canSuggest(value)) return [];
    const query = value.trim();
    const key = `${engine}:${query}`;
    const saved = cache.get(key);
    if (saved && Date.now() - saved.at < 5 * 60 * 1000) return saved.items;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(abort, 6000);
    try {
      const response = await fetcher(`/_start/suggest/${engine}?${new URLSearchParams({ q: query })}`, {
        signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error',
      });
      if (!response.ok) throw new Error('联想服务暂不可用');
      const body = await response.text();
      if (signal.aborted || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (body.length > 64000) throw new Error('联想返回过大');
      const items = parseSearchSuggestions(JSON.parse(body), query);
      cache.delete(key);
      if (cache.size >= 50) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: Date.now(), items });
      return items;
    } finally { clearTimeout(deadline); signal.removeEventListener('abort', abort); }
  };
}

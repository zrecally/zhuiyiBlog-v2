import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/startSearch.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } });
const search = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const signal = () => new AbortController().signal;
const ok = payload => ({ ok: true, text: async () => JSON.stringify(payload) });

test('keywords qualify but blank, URLs, email and excessively long input do not', () => {
  for (const value of ['搜索', ' 中 ', 'weather tomorrow', 'C++']) assert.equal(search.canSuggest(value), true, value);
  for (const value of ['', ' ', 'a'.repeat(101), 'https://example.com/private', 'example.com/a?secret=1', 'user@example.com', '/private/path', 'localhost:3000', '127.0.0.1', 'javascript:alert(1)', 'file:///secret']) assert.equal(search.canSuggest(value), false, value);
});

test('manual URLs still open directly, while all remote suggestions are searched as text', () => {
  const engine = search.SEARCH_ENGINES[0];
  assert.equal(search.getSearchUrl(' example.com ', engine), 'https://example.com');
  assert.equal(search.getSearchUrl('https://example.com/?q=1', engine), 'https://example.com/?q=1');
  for (const item of search.SEARCH_ENGINES) {
    assert.equal(search.getSearchUrl('搜索 & test', item, true), `${item.endpoint}${encodeURIComponent('搜索 & test')}`);
    assert.equal(search.getSearchUrl('https://example.com', item, true), `${item.endpoint}${encodeURIComponent('https://example.com')}`);
  }
});

test('OpenSearch payloads from the four engines parse to plain text', () => {
  for (const suffix of [[], [[], {}]]) {
    assert.deepEqual(search.parseSearchSuggestions(['搜索', ['搜索引擎', '搜索图片'], ...suffix], '搜索'), ['搜索引擎', '搜索图片']);
  }
});

test('deduplication, highlight removal and eight-result limit', () => {
  assert.deepEqual(search.parseSearchSuggestions(['test', ['Test', 'Hello', ' hello ', null, {}, '', 'a'.repeat(161), '\uE000World\uE001', 'a   b']], 'test'), ['Hello', 'World', 'a b']);
  assert.equal(search.parseSearchSuggestions(['q', Array.from({ length: 20 }, (_, i) => `q ${i}`)], 'q').length, 8);
});

test('malformed or stale response is rejected, not converted to fake suggestions', () => {
  for (const payload of [{}, null, [], ['搜索', {}], ['other', ['other result']]]) assert.throws(() => search.parseSearchSuggestions(payload, '搜索'));
  assert.deepEqual(search.parseSearchSuggestions(['搜索', []], '搜索'), []);
});

test('keyboard selection wraps predictably', () => {
  assert.equal(search.nextSuggestionIndex(-1, 1, 3), 0);
  assert.equal(search.nextSuggestionIndex(-1, -1, 3), 2);
  assert.equal(search.nextSuggestionIndex(2, 1, 3), 0);
  assert.equal(search.nextSuggestionIndex(0, -1, 3), 2);
  assert.equal(search.nextSuggestionIndex(0, 1, 0), -1);
});

test('requests use same-origin allowlisted paths and omit cookies, referrers and redirects', async () => {
  let calls = 0;
  const client = search.createSuggestionClient(async (url, options) => {
    calls++;
    assert.equal(url, '/_start/suggest/baidu?q=%E6%90%9C%E7%B4%A2+%26+test');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    return ok(['搜索 & test', ['搜索 & test result']]);
  });
  assert.deepEqual(await client('baidu', ' 搜索 & test ', signal()), ['搜索 & test result']);
  assert.deepEqual(await client('untrusted', 'keyword', signal()), []);
  assert.deepEqual(await client('bing', 'https://private.example', signal()), []);
  assert.equal(calls, 1);
});

test('cache is separated by engine and query, and reused within a client', async () => {
  let calls = 0;
  const client = search.createSuggestionClient(async url => {
    calls++;
    const q = new URL(url, 'http://localhost').searchParams.get('q');
    return ok([q, [q + ' result']]);
  });
  await client('bing', '搜索', signal());
  await client('bing', '搜索', signal());
  await client('baidu', '搜索', signal());
  await client('bing', '天气', signal());
  assert.equal(calls, 3);
});

test('cache expires after five minutes', async () => {
  const original = Date.now;
  let now = 1000, calls = 0;
  Date.now = () => now;
  try {
    const client = search.createSuggestionClient(async () => { calls++; return ok(['搜索', ['搜索引擎']]); });
    await client('bing', '搜索', signal());
    now += 299999;
    await client('bing', '搜索', signal());
    assert.equal(calls, 1);
    now += 2;
    await client('bing', '搜索', signal());
    assert.equal(calls, 2);
  } finally { Date.now = original; }
});

test('memory cache is bounded to fifty queries', async () => {
  let calls = 0;
  const client = search.createSuggestionClient(async url => {
    calls++;
    const q = new URL(url, 'http://localhost').searchParams.get('q');
    return ok([q, [q + ' result']]);
  });
  for (let i = 0; i < 51; i++) await client('bing', `query ${i}`, signal());
  await client('bing', 'query 0', signal());
  assert.equal(calls, 52);
});

test('already-aborted and in-flight requests cannot return or cache stale candidates', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const client = search.createSuggestionClient(async () => { calls++; return ok(['搜索', ['搜索引擎']]); });
  await assert.rejects(client('bing', '搜索', controller.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
  const inflight = new AbortController();
  const pendingClient = search.createSuggestionClient(async (_url, options) => {
    inflight.abort();
    assert.equal(options.signal.aborted, true);
    return ok(['搜索', ['搜索引擎']]);
  });
  await assert.rejects(pendingClient('bing', '搜索', inflight.signal), { name: 'AbortError' });
});

test('HTTP, HTML fallback, oversized responses and network failures surface as errors', async () => {
  for (const fetcher of [async () => ({ ok: false }), async () => ({ ok: true, text: async () => '<html>SPA</html>' }), async () => ({ ok: true, text: async () => 'x'.repeat(64001) }), async () => { throw new Error('offline'); }]) {
    await assert.rejects(search.createSuggestionClient(fetcher)('bing', '搜索', signal()));
  }
});

test('timeout cancels the upstream request', async () => {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (callback, milliseconds) => {
    assert.equal(milliseconds, 6000);
    return original(callback, 1);
  };
  try {
    const client = search.createSuggestionClient((_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true });
    }));
    await assert.rejects(client('bing', '搜索', signal()), { name: 'AbortError' });
  } finally { globalThis.setTimeout = original; }
});

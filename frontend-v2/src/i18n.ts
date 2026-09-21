import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { isStaticSite } from './lib/siteMode';

const getApiUrl = () => {
  const url = import.meta.env.VITE_API_BASE_URL || '/api';
  return url.endsWith('/') ? url.slice(0, -1) : url;
};

// 缓存请求，因为静态站和动态站的 API 都一次性返回了所有语言
type TranslationDictionary = Record<string, Record<string, string>>;
type DictionaryEnvelope = { success?: boolean; data?: TranslationDictionary } & TranslationDictionary;

let dictPromise: Promise<DictionaryEnvelope> | null = null;

const customBackend = {
  type: 'backend' as const,
  read: async (language: string, _namespace: string, callback: (errorValue: unknown, data: Record<string, string> | false) => void) => {
    try {
      if (!dictPromise) {
        const url = isStaticSite ? '/data/live/i18n.json' : `${getApiUrl()}/v1/i18n/dict`;
        dictPromise = fetch(url).then(async res => {
          if (!res.ok) throw new Error(`i18n dictionary request failed: ${res.status}`);
          return res.json() as Promise<DictionaryEnvelope>;
        });
      }
      const json = await dictPromise;
      const allData = (json.success && json.data) ? json.data : json;
      callback(null, allData[language] || {});
    } catch (e) {
      callback(e, false);
    }
  }
};

i18n
  .use(customBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false,
    },
    // Missing keys may occur during ordinary rendering. Reporting each one
    // from every browser turns a harmless fallback into an unbounded write
    // stream, so translation gaps are maintained through the admin workflow.
    saveMissing: false,
  });

export default i18n;

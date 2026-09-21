// Independent of the blog API: usable on both dynamic and static start pages.
export const WEATHER_REFRESH_MS = 15 * 60 * 1000;
export const WEATHER_LOCATION_KEY = 'zhuiyi_start_weather_city_v1';

export interface WeatherLocation {
  name: string;
  detail: string;
  latitude: number;
  longitude: number;
  source: 'city' | 'geolocation';
}

export interface WeatherReading {
  temperature: number;
  code: number;
  isDay: boolean;
  time: number;
}

export interface AirQualityReading {
  value: number;
  time: number;
}

export interface WeatherSnapshot {
  weather: WeatherReading | null;
  air: AirQualityReading | null;
  weatherError: boolean;
  airError: boolean;
  fetchedAt: number;
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validTime = (value: unknown): value is number => finite(value) && value > 0;

export const validCoordinates = (latitude: unknown, longitude: unknown): boolean => (
  finite(latitude) && finite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
);

export const locationKey = (location: WeatherLocation): string => `${location.latitude},${location.longitude}`;

export const readSavedWeatherCity = (storage: Pick<Storage, 'getItem'>): WeatherLocation | null => {
  try {
    const city = object(JSON.parse(storage.getItem(WEATHER_LOCATION_KEY) || 'null'));
    if (city.source !== 'city' || typeof city.name !== 'string' || !city.name.trim()
      || !validCoordinates(city.latitude, city.longitude)) return null;
    return {
      name: city.name.slice(0, 80), detail: typeof city.detail === 'string' ? city.detail.slice(0, 160) : '',
      latitude: city.latitude as number, longitude: city.longitude as number, source: 'city',
    };
  } catch { return null; }
};

export type WeatherLocationMode = 'none' | 'city' | 'geolocation';

export function readWeatherPreference(storage: Pick<Storage, 'getItem'>): { mode: WeatherLocationMode; location: WeatherLocation | null } {
  try {
    const saved = object(JSON.parse(storage.getItem(WEATHER_LOCATION_KEY) || 'null'));
    if (saved.version === 1 && saved.mode === 'geolocation') return { mode: 'geolocation', location: null };
    // Keep existing manual-city preferences compatible; old device-coordinate
    // objects are not treated as consent for automatic positioning.
    const location = readSavedWeatherCity(storage);
    return { mode: location ? 'city' : 'none', location };
  } catch { return { mode: 'none', location: null }; }
}

export function saveWeatherPreference(storage: Pick<Storage, 'setItem' | 'removeItem'>, location: WeatherLocation | null) {
  if (!location) { storage.removeItem(WEATHER_LOCATION_KEY); return; }
  // Remember the user's mode, not their device coordinates or resolved address.
  const value = location.source === 'geolocation' ? { version: 1, mode: 'geolocation' } : {
    name: location.name, detail: location.detail, latitude: location.latitude, longitude: location.longitude, source: 'city',
  };
  storage.setItem(WEATHER_LOCATION_KEY, JSON.stringify(value));
}

export function shouldRestoreWeatherLocation(mode: WeatherLocationMode, permission: LocationPermission, attempted: boolean, visible: boolean) {
  return mode === 'geolocation' && permission === 'granted' && !attempted && visible;
}

export const weatherDescription = (code: number): string => {
  const labels: Record<number, string> = {
    0: '晴', 1: '晴间多云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
    51: '小毛毛雨', 53: '毛毛雨', 55: '强毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
    80: '小阵雨', 81: '阵雨', 82: '强阵雨', 85: '阵雪', 86: '强阵雪',
    95: '雷雨', 96: '雷雨伴冰雹', 99: '强雷雨伴冰雹',
  };
  return labels[code] || '天气状态未知';
};

// Open-Meteo returns the US index, not China's AQI; the UI always says US AQI.
export const describeUsAqi = (value: number | null) => {
  if (value === null || !Number.isFinite(value) || value < 0) return { label: '暂无数据', color: '#8a8983' };
  if (value <= 50) return { label: '优', color: '#6f967c' };
  if (value <= 100) return { label: '中等', color: '#ac8c35' };
  if (value <= 150) return { label: '敏感人群不健康', color: '#c58243' };
  if (value <= 200) return { label: '不健康', color: '#bd5d53' };
  if (value <= 300) return { label: '非常不健康', color: '#947091' };
  return { label: '危险', color: '#89465e' };
};

async function requestJson(url: URL, signal: AbortSignal, fetcher: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 12000);
  try {
    const response = await fetcher(url.toString(), {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
    if (!response.ok) throw new Error(`数据服务暂不可用（HTTP ${response.status}）`);
    const data: unknown = await response.json();
    if (object(data).error) throw new Error('数据服务未返回有效结果');
    return data;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

export async function searchWeatherCities(query: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<WeatherLocation[]> {
  if (query.trim().length < 2) return [];
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: query.trim().slice(0, 80), count: '8', language: 'zh', format: 'json' }).toString();
  const data = object(await requestJson(url, signal, fetcher));
  if (!Array.isArray(data.results)) return [];
  return data.results.flatMap(value => {
    const city = object(value);
    if (typeof city.name !== 'string' || !city.name.trim() || !validCoordinates(city.latitude, city.longitude)) return [];
    return [{
      name: city.name.slice(0, 80), latitude: city.latitude as number, longitude: city.longitude as number,
      detail: [...new Set([city.admin1, city.country].filter((item): item is string => typeof item === 'string' && Boolean(item)))].join(' · '),
      source: 'city' as const,
    }];
  });
}

export function parseWeatherLocationName(payload: unknown): Pick<WeatherLocation, 'name' | 'detail'> | null {
  const data = object(payload);
  // Never present an IP-derived locality as the device's authorized position.
  if (!['coordinates', 'reverseGeocoding'].includes(String(data.lookupSource))) return null;
  const name = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 80) : '';
  const city = name(data.city);
  const province = name(data.principalSubdivision);
  const administrative = object(data.localityInfo).administrative;
  const district = data.countryCode === 'CN' && Array.isArray(administrative)
    ? administrative.map(object).find(area => /^\d{4}(?!00$)\d{2}$/.test(String(area.chinaAdminCode)) && name(area.name)) : undefined;
  const locality = name(district?.name) || name(data.locality);
  const parts = [...new Set([city || province, locality].filter(Boolean))];
  if (!parts.length) return null;
  return {
    name: parts.join(' · '),
    detail: [...new Set([name(data.countryName), province, city, locality].filter(Boolean))].join(' · '),
  };
}

// Client-only: call once with a freshly authorized device position, never a saved
// city, server-side coordinates, batch jobs, or the provider's IP fallback.
export async function resolveWeatherLocationName(location: WeatherLocation, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (location.source !== 'geolocation' || !validCoordinates(location.latitude, location.longitude)) throw new Error('仅支持本次授权的设备定位');
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  url.search = new URLSearchParams({
    latitude: location.latitude.toFixed(2), longitude: location.longitude.toFixed(2), localityLanguage: 'zh',
  }).toString();
  const result = parseWeatherLocationName(await requestJson(url, signal, fetcher));
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!result) throw new Error('未能获取坐标对应的地名');
  return result;
}

export function parseWeatherReading(data: unknown): WeatherReading | null {
  const current = object(object(data).current);
  if (!finite(current.temperature_2m) || !finite(current.weather_code) || !validTime(current.time)) return null;
  return { temperature: current.temperature_2m, code: current.weather_code, isDay: current.is_day !== 0, time: current.time * 1000 };
}

export function parseAirQualityReading(data: unknown): AirQualityReading | null {
  const current = object(object(data).current);
  if (!finite(current.us_aqi) || current.us_aqi < 0 || !validTime(current.time)) return null;
  return { value: Math.round(current.us_aqi), time: current.time * 1000 };
}

export async function fetchWeatherSnapshot(location: Pick<WeatherLocation, 'latitude' | 'longitude'>, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<WeatherSnapshot> {
  if (!validCoordinates(location.latitude, location.longitude)) throw new Error('位置坐标无效');
  const params = { latitude: String(location.latitude), longitude: String(location.longitude), timeformat: 'unixtime', timezone: 'auto' };
  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
  weatherUrl.search = new URLSearchParams({ ...params, current: 'temperature_2m,weather_code,is_day', forecast_days: '1' }).toString();
  const airUrl = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  airUrl.search = new URLSearchParams({ ...params, current: 'us_aqi', forecast_days: '1' }).toString();
  // A failed AQI request must not discard successfully loaded weather, or vice versa.
  const [weatherResult, airResult] = await Promise.allSettled([
    requestJson(weatherUrl, signal, fetcher), requestJson(airUrl, signal, fetcher),
  ]);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const weather = weatherResult.status === 'fulfilled' ? parseWeatherReading(weatherResult.value) : null;
  const air = airResult.status === 'fulfilled' ? parseAirQualityReading(airResult.value) : null;
  return { weather, air, weatherError: !weather, airError: !air, fetchedAt: Date.now() };
}

export function mergeWeatherSnapshot(previous: WeatherSnapshot | null, next: WeatherSnapshot): WeatherSnapshot {
  return { ...next, weather: next.weather || previous?.weather || null, air: next.air || previous?.air || null };
}

export function readingIsStale(time: number, now: number, maximumAge: number): boolean {
  return now - time > maximumAge || time - now > 15 * 60 * 1000;
}

export type LocationPermission = PermissionState | 'checking' | 'unknown' | 'insecure' | 'unsupported' | 'policy-blocked';

export function locationCapability(environment: { secure: boolean; supported: boolean; policyAllowed?: boolean }): LocationPermission | null {
  if (!environment.secure) return 'insecure';
  if (!environment.supported) return 'unsupported';
  if (environment.policyAllowed === false) return 'policy-blocked';
  return null;
}

export function locationPermissionFeedback(state: LocationPermission) {
  const messages: Record<LocationPermission, { label: string; hint: string }> = {
    checking: { label: '检查中', hint: '正在读取浏览器权限状态，不会读取你的位置。' },
    prompt: { label: '等待授权', hint: '点击定位按钮后，请留意浏览器地址栏附近的授权提示；网页不能替你开启权限。' },
    granted: { label: '站点已允许', hint: '浏览器已允许此站点定位，通常不会再次弹窗；仍需系统定位服务可用。' },
    denied: { label: '已阻止', hint: '浏览器报告定位被阻止，不一定会再次弹窗。请检查本站的位置权限和系统定位服务，修改后再重试。' },
    unknown: { label: '无法读取权限状态', hint: '可以点击定位按钮尝试；若内置浏览器没有授权窗口，请在系统浏览器中打开本页，或手动选城。' },
    insecure: { label: '需要安全连接', hint: '请通过 HTTPS 或本机 localhost / 127.0.0.1 打开；普通 HTTP 局域网地址不支持定位。' },
    unsupported: { label: '浏览器不支持', hint: '当前浏览器未提供定位接口，请在支持定位的浏览器中打开本页，或手动选城。' },
    'policy-blocked': { label: '页面策略已禁用', hint: '页面或嵌入容器的 Permissions-Policy 禁用了定位，无法弹出授权。请手动选城，或联系站点管理员检查策略。' },
  };
  return { ...messages[state], canRequest: !['insecure', 'unsupported', 'policy-blocked'].includes(state) };
}

// Called after an explicit click, or to restore the saved automatic mode only
// when the browser still reports granted permission. Never auto-prompt.
// Do not persist device coordinates, watch position, or infer a city from IP.
// Locality lookup is a separate workflow and must not delay weather.
export function locateWeatherPosition(geolocation: Pick<Geolocation, 'getCurrentPosition'>, signal?: AbortSignal): Promise<WeatherLocation> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('定位请求已取消', 'AbortError')); return; }
    let settled = false;
    const finish = (value: WeatherLocation | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      if (value instanceof Error) reject(value); else resolve(value);
    };
    const abort = () => finish(new DOMException('定位请求已取消', 'AbortError'));
    // The browser's position timeout excludes time waiting for permission. Some
    // embedded browsers never answer; bound the UI wait and ignore late callbacks.
    const deadline = setTimeout(() => finish(new Error('未收到浏览器定位结果。若没有弹窗，请检查地址栏的位置权限，或在系统浏览器中打开本页；也可以手动选城。')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    try { geolocation.getCurrentPosition(position => {
      const { latitude, longitude } = position.coords;
      if (!validCoordinates(latitude, longitude)) { finish(new Error('定位结果无效，请手动选择城市')); return; }
      finish({
        name: '当前位置', detail: '', source: 'geolocation',
        latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)),
      });
    }, error => {
      finish(new Error(error.code === 1 ? '定位权限被拒绝或被浏览器、系统拦截。请检查本站的位置权限与系统定位服务，修改后再重试；也可以手动选城。'
        : error.code === 3 ? '定位超时，请重试或手动选择城市' : '无法获取位置，请检查系统定位服务或手动选择城市'));
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 });
    } catch { finish(new Error('浏览器无法发起定位，请在系统浏览器中打开本页或手动选择城市。')); }
  });
}

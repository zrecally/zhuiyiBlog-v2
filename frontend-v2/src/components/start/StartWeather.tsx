import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Loader2, LocateFixed, MapPin, Moon, RefreshCw, Search, Sun, X } from 'lucide-react';
import {
  describeUsAqi, locateWeatherPosition, locationKey, locationPermissionFeedback, readWeatherPreference, readingIsStale,
  resolveWeatherLocationName, saveWeatherPreference, searchWeatherCities, shouldRestoreWeatherLocation,
  weatherDescription, WeatherLocation, WeatherReading,
} from '../../lib/startWeather';
import { useStartWeather } from './useStartWeather';
import { getLocationCapability, useLocationPermission } from './useLocationPermission';

function WeatherIcon({ reading }: { reading: WeatherReading | null }) {
  const code = reading?.code;
  const Icon = code === undefined ? CloudSun : code === 0 ? reading?.isDay ? Sun : Moon
    : code >= 95 ? CloudLightning : [71, 73, 75, 77, 85, 86].includes(code) ? CloudSnow
      : code >= 51 ? CloudRain : [45, 48].includes(code) ? CloudFog : code === 3 ? Cloud : CloudSun;
  return <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} />;
}

const formatTime = (time: number | undefined) => time ? new Date(time).toLocaleString('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}) : '尚无数据';

export function StartWeather({ lunarDate }: { lunarDate: string }) {
  const [initialPreference] = useState(() => {
    try { return readWeatherPreference(localStorage); } catch { return { mode: 'none' as const, location: null }; }
  });
  const [mode, setMode] = useState(initialPreference.mode);
  const [preferenceSaved, setPreferenceSaved] = useState(initialPreference.mode !== 'none');
  const [location, setLocation] = useState<WeatherLocation | null>(initialPreference.location);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cities, setCities] = useState<WeatherLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState('');
  const [searched, setSearched] = useState(false);
  const [nameState, setNameState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const positionRequest = useRef<AbortController | null>(null);
  const nameRequest = useRef<AbortController | null>(null);
  const locationRequest = useRef(0);
  const restoreAttempted = useRef(false);
  const permission = useLocationPermission(open || mode === 'geolocation');
  const permissionFeedback = locationPermissionFeedback(permission);
  const { data, loading, refresh } = useStartWeather(location);
  const weather = data?.weather || null;
  const air = data?.air || null;
  const weatherStale = Boolean(weather && (data?.weatherError || readingIsStale(weather.time, Date.now(), 90 * 60 * 1000)));
  const airStale = Boolean(air && (data?.airError || readingIsStale(air.time, Date.now(), 3 * 60 * 60 * 1000)));
  const aqi = describeUsAqi(air?.value ?? null);
  const weatherText = weather ? `${Math.round(weather.temperature)}°C · ${weatherDescription(weather.code)}` : loading ? '获取天气中…' : '天气暂不可用';

  useEffect(() => () => { searchRequest.current?.abort(); locationRequest.current += 1; positionRequest.current?.abort(); nameRequest.current?.abort(); }, []);

  // A dialog, not another navigation destination; trap focus and restore it on close.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    panelRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key === 'Tab') {
        const elements = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], summary') || [])]
          .filter(element => element.getClientRects().length > 0);
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      searchRequest.current?.abort();
      trigger?.focus();
    };
  }, [open]);

  const chooseLocation = useCallback((next: WeatherLocation | null) => {
    searchRequest.current?.abort();
    locationRequest.current += 1;
    positionRequest.current?.abort();
    nameRequest.current?.abort();
    setNameState('idle');
    setSearching(false);
    setLocating(false);
    setMessage('');
    setLocation(next);
    setMode(next?.source || 'none');
    setPreferenceSaved(false);
    try {
      saveWeatherPreference(localStorage, next);
      setPreferenceSaved(Boolean(next));
    } catch { setMessage('浏览器未允许保存设置；本次页面仍可使用，但重新打开时无法保证恢复。'); }
  }, []);

  const resolveLocationName = useCallback(async (position: WeatherLocation) => {
    const controller = new AbortController();
    nameRequest.current?.abort();
    nameRequest.current = controller;
    setNameState('loading');
    try {
      const label = await resolveWeatherLocationName(position, controller.signal);
      if (!controller.signal.aborted) {
        setLocation(current => current === position ? { ...current, ...label } : current);
        setNameState('idle');
      }
    } catch {
      if (!controller.signal.aborted) setNameState('failed');
    }
  }, []);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    searchRequest.current?.abort();
    setCities([]);
    setSearched(false);
    setMessage('');
    if (query.trim().length < 2) { setMessage('请输入至少两个字，例如「上海」或「London」。'); return; }
    const request = new AbortController();
    searchRequest.current = request;
    setSearching(true);
    try {
      const results = await searchWeatherCities(query, request.signal);
      if (!request.signal.aborted) { setCities(results); setSearched(true); }
    } catch {
      if (!request.signal.aborted) setMessage('城市查询失败，请检查网络后重试。');
    } finally { if (!request.signal.aborted) setSearching(false); }
  };

  const locate = useCallback(async () => {
    restoreAttempted.current = true;
    const unavailable = getLocationCapability();
    if (unavailable) { setMessage(locationPermissionFeedback(unavailable).hint); return; }
    const request = ++locationRequest.current;
    positionRequest.current?.abort();
    const controller = new AbortController();
    positionRequest.current = controller;
    setLocating(true);
    setMessage('');
    try {
      // Manual requests remain in the click handler; automatic calls are gated
      // by a saved mode and an already-granted browser permission below.
      const position = await locateWeatherPosition(navigator.geolocation, controller.signal);
      if (request === locationRequest.current) {
        chooseLocation(position);
        // Weather begins immediately; a slow/failed place-name lookup cannot block it.
        void resolveLocationName(position);
      }
    } catch (error) {
      if (request === locationRequest.current) setMessage(error instanceof Error ? error.message : '定位失败，请手动选择城市');
    } finally { if (request === locationRequest.current) setLocating(false); }
  }, [chooseLocation, resolveLocationName]);

  useEffect(() => {
    const restore = () => {
      if (!location && shouldRestoreWeatherLocation(mode, permission, restoreAttempted.current, document.visibilityState === 'visible')) {
        void locate();
      }
    };
    // Defer until effect setup has settled, so StrictMode cleanup does not abort
    // the only attempt and leave the second mount stuck without weather.
    const timer = window.setTimeout(restore, 0);
    document.addEventListener('visibilitychange', restore);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', restore); };
  }, [mode, permission, location, locate]);

  useEffect(() => {
    if (mode !== 'geolocation' || permission !== 'denied') return;
    // Stop using an in-memory device position after an observed revocation.
    locationRequest.current += 1;
    positionRequest.current?.abort();
    nameRequest.current?.abort();
    setLocation(null);
    setLocating(false);
    setNameState('idle');
  }, [mode, permission]);

  const emptyWeatherText = locating ? '正在定位 · 更新天气' : mode !== 'geolocation' ? '选择城市 · 查看天气'
    : permission === 'checking' ? '检查定位权限…' : permission === 'granted' ? (message ? '定位失败 · 点击重试' : '正在恢复自动定位…')
      : permission === 'denied' ? '定位已被阻止 · 点击查看' : '自动定位待授权 · 点击查看';

  return <>
    <button
      ref={triggerRef} type="button" className="start-page__weather start-weather__trigger flex items-center gap-2.5 rounded-full px-4 font-kai text-xs text-xianxia-text/75"
      aria-label="天气与位置设置" aria-haspopup="dialog" aria-expanded={open}
      title={location ? `${location.name}（${location.source === 'city' ? '手动选择城市' : '浏览器授权定位'}） · ${weatherText} · 点击查看来源与更新时间` : mode === 'geolocation' ? '已记住自动定位模式；只有仍获授权时才自动读取位置' : '选择城市或授权定位后获取天气'}
      onClick={() => { setSearching(false); setOpen(true); }}
    >
      {loading || locating ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <WeatherIcon reading={weather} />}
      <span className="min-w-0 truncate">{location ? `${location.name} ${weatherText}` : emptyWeatherText}</span>
      {(weatherStale || airStale) && <span className="shrink-0 text-amber-800">未更新</span>}
      {location && <span className="start-weather__aqi items-center gap-1.5" title={`US AQI · ${aqi.label}${airStale ? '（旧数据）' : ''}`}>
        <span className="h-3 w-px bg-xianxia-border" />
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: airStale ? '#8a8983' : aqi.color }} />
        {air ? `US AQI ${air.value}` : loading ? 'AQI 获取中' : 'AQI 暂不可用'}
      </span>}
      <span className="start-weather__lunar items-center gap-2.5"><span className="h-3 w-px bg-xianxia-border" />{lunarDate}</span>
    </button>

    {open && createPortal(
      <div className="start-weather__overlay" onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="start-weather-title" className="start-weather__panel text-xianxia-text">
          <div className="flex items-center justify-between gap-3">
            <h2 id="start-weather-title" className="font-kai text-xl">天气与位置</h2>
            <button type="button" aria-label="关闭天气设置" className="start-weather__icon-button" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
          </div>
          <p className="mt-2 text-sm text-xianxia-text/60">选择城市，或由你决定是否授权浏览器定位。</p>
          <div className="mt-3 text-xs leading-6 text-xianxia-text/70" aria-live="polite">
            <p>定位权限：<span className="font-medium">{permissionFeedback.label}</span></p>
            <p>{permissionFeedback.hint}</p>
          </div>
          {mode === 'geolocation' && <p className="mt-2 text-xs leading-6 text-xianxia-jadeDark">{preferenceSaved ? '已记住自动定位模式：以后打开本页，浏览器仍允许定位时会自动更新；权限失效时不会自动弹窗。只保存模式，不保存设备坐标或地名。' : '当前定位仅本次页面有效，浏览器未允许保存自动定位设置。'}</p>}

          {location && <section className="start-weather__readings" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0"><p className="break-words font-kai text-lg">{location.name}</p><p className="text-xs text-xianxia-text/55">{location.source === 'city' ? '手动选择 · 非设备定位' : '浏览器授权定位 · 大致区域 · 非精确地址'}</p></div>
              <button type="button" disabled={loading} onClick={refresh} className="start-weather__icon-button" aria-label="刷新天气"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
            {location.detail && <p className="mt-2 break-words text-xs leading-6 text-xianxia-text/60">{location.detail}</p>}
            {location.source === 'geolocation' && <>
              {nameState === 'loading' && <p role="status" className="mt-2 text-xs text-xianxia-text/60">正在识别城市与地区…</p>}
              {nameState === 'failed' && <p role="status" className="mt-2 text-xs leading-6 text-amber-800">已获取定位，但地名查询暂不可用，不影响天气。可重新点击「使用当前位置」或手动选城。</p>}
              <p className="mt-2 text-xs leading-6 text-xianxia-text/55">查询坐标（约）：{location.latitude.toFixed(2)}°, {location.longitude.toFixed(2)}°<br />经纬度已取两位小数，附近区县名称可能有偏差。</p>
            </>}
            <p className="mt-4 flex items-center gap-2"><WeatherIcon reading={weather} />{weatherText}{weatherStale && <span className="text-xs text-amber-800">旧数据</span>}</p>
            <p className="mt-2 text-sm">{air ? `US AQI ${air.value} · ${aqi.label}` : loading ? '空气质量获取中…' : '空气质量暂不可用'}{airStale && <span className="ml-2 text-xs text-amber-800">旧数据</span>}</p>
            <p className="mt-3 text-xs leading-6 text-xianxia-text/60">天气数据时刻：{formatTime(weather?.time)}<br />空气质量时刻：{formatTime(air?.time)}</p>
            {!loading && (data?.weatherError || data?.airError) && <p role="status" className="mt-2 text-xs text-amber-800">{data.weatherError ? '天气' : ''}{data.weatherError && data.airError ? '与' : ''}{data.airError ? '空气质量' : ''}更新失败，请检查网络后重试。已有数据仅供参考。</p>}
            <p className="mt-2 text-xs text-xianxia-text/50">页面可见时每 15 分钟更新；时间按设备时区显示。</p>
          </section>}

          <form onSubmit={search} className="mt-5">
            <label htmlFor="start-weather-city" className="text-sm">城市名称</label>
            <div className="mt-2 flex gap-2">
              <input id="start-weather-city" value={query} maxLength={80} placeholder="例如：上海、北京、London" autoComplete="off" className="min-w-0 flex-1 rounded-xl border border-xianxia-border bg-white/50 px-3 py-2 text-sm outline-none focus:border-xianxia-jadeDark"
                onChange={event => { searchRequest.current?.abort(); setSearching(false); setQuery(event.target.value); setCities([]); setSearched(false); setMessage(''); }} />
              <button type="submit" disabled={searching} className="start-weather__action"><Search className="h-4 w-4" />{searching ? '查询中' : '查询'}</button>
            </div>
          </form>
          {cities.length > 0 && <ul className="start-weather__cities" aria-label="城市搜索结果">
            {cities.map((city, index) => <li key={`${locationKey(city)}-${index}`}><button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-xianxia-jade/15" onClick={() => { chooseLocation(city); setCities([]); setSearched(false); }}><MapPin className="h-4 w-4 shrink-0 text-xianxia-jadeDark" /><span><span className="block text-sm">{city.name}</span><span className="text-xs text-xianxia-text/55">{city.detail}</span></span></button></li>)}
          </ul>}
          {searched && !cities.length && <p role="status" className="mt-3 text-sm text-xianxia-text/60">没有匹配城市，请尝试城市全称或英文名。</p>}
          {message && <p role="status" className="mt-3 text-sm text-amber-800">{message}</p>}

          <div className="mt-5 border-t border-xianxia-border/70 pt-4">
            <p className="text-xs leading-6 text-xianxia-text/60">城市查询词会发送至 Open-Meteo。选择城市后保存于本浏览器，并按该城市坐标查询。</p>
            <p className="mt-2 text-xs leading-6 text-xianxia-text/60">首次点击下方按钮申请定位，成功后记住自动定位模式；以后打开本页，仅在浏览器权限仍为允许时自动读取一次当前位置。权限需重新询问时由你手动确认，不反复弹窗。经纬度取两位小数后发送至 Open-Meteo 查询天气，并发送至 BigDataCloud 识别城市与地区；该服务会结合请求 IP 与坐标改进其定位数据。不发送给博客后端、不持久保存设备坐标，也不使用 IP 位置作为替代。手动选城或清除位置可关闭自动定位。</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button type="button" disabled={locating || !permissionFeedback.canRequest} className="start-weather__action" onClick={() => void locate()}><LocateFixed className="h-4 w-4" />{locating ? '等待浏览器定位…' : permission === 'granted' ? '使用当前位置' : permission === 'denied' ? '修改权限后重试' : '授权定位并查询'}</button>
              {(location || mode === 'geolocation') && <button type="button" className="rounded-lg px-2 py-2 text-xs text-xianxia-text/60 hover:text-xianxia-red" title="清除位置并关闭自动定位" onClick={() => chooseLocation(null)}>清除位置</button>}
            </div>
            {locating && <p role="status" className="mt-2 text-xs leading-6 text-xianxia-text/60">请查看浏览器的权限提示；如果没有收到定位结果，30 秒内会结束等待，不会自动改用 IP 定位。</p>}
            <details className="mt-3 text-xs leading-6 text-xianxia-text/65">
              <summary className="cursor-pointer">没有弹出授权？</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>在当前浏览器的「网站设置 / 网站权限」中，将本站的「位置」改为「询问」或「允许」，再点定位按钮。localhost 与 127.0.0.1 是不同站点，需要分别检查。</li>
                <li>检查系统定位服务是否开启，以及当前浏览器是否获准访问位置；站点已允许不代表系统也已允许。</li>
                <li>若应用内置浏览器始终没有授权窗口，可在 Chrome / Safari 中打开相同地址，或直接手动选城。网页无法替你开启浏览器或系统权限。</li>
              </ol>
              <a href="https://support.google.com/chrome/answer/142065?hl=zh-Hans" target="_blank" rel="noreferrer" className="underline">查看 Chrome 官方位置权限说明</a>
            </details>
          </div>
          <div className="mt-5 border-t border-xianxia-border/70 pt-3 text-xs leading-6 text-xianxia-text/55">
            数据来源：<a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">Open-Meteo</a> · <a href="https://atmosphere.copernicus.eu/" target="_blank" rel="noreferrer" className="underline">CAMS</a> · <a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="underline">GeoNames</a>
            <p>定位地名：<a href="https://www.bigdatacloud.com/geocoding-apis/free-reverse-geocode-to-city-api" target="_blank" rel="noreferrer" className="underline">BigDataCloud</a>（城市／附近地区，非精确地址）。</p>
            <p>天气和空气质量为模型估算，并非设备传感器或附近监测站实测；US AQI 使用美国标准，不等同于中国 AQI。</p>
          </div>
        </div>
      </div>, document.body,
    )}
  </>;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Test the real dependency-free TS module without adding another runtime package.
const source = await readFile(new URL('../src/lib/startWeather.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } });
const weather = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const city = { name: '测试城市', detail: '', latitude: 31.23, longitude: 121.47, source: 'city' };
const weatherPayload = { current: { temperature_2m: 0, weather_code: 0, is_day: 0, time: 1788499800 } };
const airPayload = { current: { us_aqi: 0, time: 1788498000 } };
const ok = data => ({ ok: true, status: 200, json: async () => data });

test('blank, corrupt, denied storage and device coordinates never become a default city', () => {
  for (const raw of [null, '{', '{}', JSON.stringify({ ...city, latitude: 91 }), JSON.stringify({ ...city, source: 'geolocation' })]) {
    assert.equal(weather.readSavedWeatherCity({ getItem: () => raw }), null);
  }
  assert.equal(weather.readSavedWeatherCity({ getItem: () => { throw new Error('blocked'); } }), null);
  assert.deepEqual(weather.readSavedWeatherCity({ getItem: () => JSON.stringify(city) }), city);
});

test('zero values remain valid, null/missing values do not become zero degrees or good AQI', () => {
  assert.equal(weather.parseWeatherReading(weatherPayload).temperature, 0);
  assert.equal(weather.parseWeatherReading(weatherPayload).isDay, false);
  assert.equal(weather.parseAirQualityReading(airPayload).value, 0);
  assert.equal(weather.parseWeatherReading({ current: { ...weatherPayload.current, temperature_2m: null } }), null);
  assert.equal(weather.parseAirQualityReading({ current: { us_aqi: null, time: 1788498000 } }), null);
  assert.equal(weather.parseWeatherReading({}), null);
  assert.equal(weather.parseAirQualityReading({ current: { us_aqi: -1, time: 1788498000 } }), null);
});

test('US AQI bands and all supported WMO codes have explicit labels', () => {
  const cases = [[0, '优'], [50, '优'], [51, '中等'], [100, '中等'], [101, '敏感人群不健康'], [150, '敏感人群不健康'], [151, '不健康'], [200, '不健康'], [201, '非常不健康'], [300, '非常不健康'], [301, '危险'], [null, '暂无数据']];
  cases.forEach(([value, label]) => assert.equal(weather.describeUsAqi(value).label, label));
  [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].forEach(code => assert.notEqual(weather.weatherDescription(code), '天气状态未知'));
  assert.equal(weather.weatherDescription(999), '天气状态未知');
});

test('city lookup requires deliberate input and discards invalid coordinates', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(new URL(url).searchParams.get('name'), '上海');
    assert.equal(options.credentials, 'omit');
    return ok({ results: [{ ...city, admin1: '上海市', country: '中国' }, { name: 'bad', latitude: 91, longitude: 1 }] });
  };
  assert.deepEqual(await weather.searchWeatherCities('上', new AbortController().signal, fetcher), []);
  assert.equal(calls, 0);
  const results = await weather.searchWeatherCities(' 上海 ', new AbortController().signal, fetcher);
  assert.equal(results.length, 1);
  assert.equal(results[0].detail, '上海市 · 中国');
});

test('weather and AQI use public endpoints, omit cookies, and return provider timestamps', async () => {
  const calls = [];
  const data = await weather.fetchWeatherSnapshot(city, new AbortController().signal, async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers, undefined);
    assert.equal(new URL(url).searchParams.get('timeformat'), 'unixtime');
    return ok(url.includes('air-quality') ? airPayload : weatherPayload);
  });
  assert.equal(calls.length, 2);
  assert.equal(data.weather.time, 1788499800000);
  assert.equal(data.air.time, 1788498000000);
  assert.equal(data.weatherError, false);
  assert.equal(data.airError, false);
});

test('AQI errors do not remove valid weather; total failure never falls back to Beijing sample data', async () => {
  const data = await weather.fetchWeatherSnapshot(city, new AbortController().signal, async url => {
    if (url.includes('air-quality')) return { ok: false, status: 429 };
    return ok(weatherPayload);
  });
  assert.equal(data.weather.temperature, 0);
  assert.equal(data.air, null);
  assert.equal(data.airError, true);
  const failed = await weather.fetchWeatherSnapshot(city, new AbortController().signal, async () => { throw new Error('offline'); });
  assert.equal(failed.weather, null);
  assert.equal(failed.air, null);
  assert.equal(failed.weatherError, true);
});

test('stale cached readings preserve old timestamps and carry an error state', () => {
  const previous = { weather: weather.parseWeatherReading(weatherPayload), air: weather.parseAirQualityReading(airPayload), fetchedAt: 1, weatherError: false, airError: false };
  const merged = weather.mergeWeatherSnapshot(previous, { weather: null, air: null, fetchedAt: 2, weatherError: true, airError: true });
  assert.equal(merged.weather.time, previous.weather.time);
  assert.equal(merged.weatherError, true);
  assert.equal(merged.airError, true);
  assert.equal(weather.readingIsStale(1000, 1000 + 91 * 60000, 90 * 60000), true);
  assert.equal(weather.readingIsStale(1000 + 16 * 60000, 1000, 90 * 60000), true);
});

test('cancellation prevents a late result from being applied to another city', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(weather.fetchWeatherSnapshot(city, controller.signal, async () => ok(weatherPayload)), { name: 'AbortError' });
});

test('location is an explicit one-shot request with reduced coordinate precision', async () => {
  let calls = 0;
  const location = await weather.locateWeatherPosition({ getCurrentPosition: (success, failure, options) => {
    calls++;
    assert.equal(options.enableHighAccuracy, false);
    assert.equal(options.timeout, 10000);
    success({ coords: { latitude: 31.234567, longitude: 121.478999 } });
  } });
  assert.equal(calls, 1);
  assert.equal(location.latitude, 31.23);
  assert.equal(location.longitude, 121.48);
  assert.equal(location.source, 'geolocation');
  assert.equal(location.name, '当前位置');
});

test('denied and timed-out location have actionable messages, not guessed cities', async () => {
  for (const [code, message] of [[1, /权限被拒绝/], [2, /无法获取位置/], [3, /定位超时/]]) {
    await assert.rejects(weather.locateWeatherPosition({ getCurrentPosition: (success, failure) => failure({ code }) }), message);
  }
});

test('location capability distinguishes insecure pages, missing API and permissions policy', () => {
  assert.equal(weather.locationCapability({ secure: false, supported: true }), 'insecure');
  assert.equal(weather.locationCapability({ secure: true, supported: false }), 'unsupported');
  assert.equal(weather.locationCapability({ secure: true, supported: true, policyAllowed: false }), 'policy-blocked');
  assert.equal(weather.locationCapability({ secure: true, supported: true }), null);
  assert.equal(weather.locationCapability({ secure: true, supported: true, policyAllowed: true }), null);
});

test('permission feedback explains missing prompts without claiming permission is granted', () => {
  assert.equal(weather.locationPermissionFeedback('prompt').label, '等待授权');
  assert.equal(weather.locationPermissionFeedback('denied').label, '已阻止');
  assert.match(weather.locationPermissionFeedback('granted').hint, /不会再次弹窗/);
  assert.equal(weather.locationPermissionFeedback('unknown').canRequest, true);
  assert.equal(weather.locationPermissionFeedback('denied').canRequest, true);
  ['insecure', 'unsupported', 'policy-blocked'].forEach(state => assert.equal(weather.locationPermissionFeedback(state).canRequest, false));
});

test('a silent browser cannot leave location waiting forever or apply a late position', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let success;
  const result = weather.locateWeatherPosition({ getCurrentPosition: callback => { success = callback; } });
  const rejected = assert.rejects(result, /未收到浏览器定位结果/);
  context.mock.timers.tick(30000);
  await rejected;
  success({ coords: { latitude: 31.23, longitude: 121.47 } });
  await assert.rejects(result, /未收到浏览器定位结果/);
});

test('cancelled, invalid and synchronously broken geolocation fail safely', async () => {
  const controller = new AbortController();
  let success;
  const pending = weather.locateWeatherPosition({ getCurrentPosition: callback => { success = callback; } }, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  success({ coords: { latitude: 31.23, longitude: 121.47 } });
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(weather.locateWeatherPosition({ getCurrentPosition: () => assert.fail('cancelled request must not read location') }, controller.signal), { name: 'AbortError' });
  await assert.rejects(weather.locateWeatherPosition({ getCurrentPosition: success => success({ coords: { latitude: 999, longitude: 1 } }) }), /定位结果无效/);
  await assert.rejects(weather.locateWeatherPosition({ getCurrentPosition: () => { throw new Error('unavailable'); } }), /浏览器无法发起定位/);
});

const placePayload = { lookupSource: 'coordinates', countryCode: 'CN', countryName: '中国', principalSubdivision: '北京市', city: '北京市', locality: '测试街道', localityInfo: { administrative: [
  { name: '中国', chinaAdminCode: '100000' }, { name: '北京市', chinaAdminCode: '110000' }, { name: '朝阳区', chinaAdminCode: '110105' },
] } };
const devicePosition = { ...city, source: 'geolocation' };

test('device place names show city and district, deduplicating municipality names', () => {
  const result = weather.parseWeatherLocationName(placePayload);
  assert.equal(result.name, '北京市 · 朝阳区');
  assert.equal(result.detail, '中国 · 北京市 · 朝阳区');
  assert.equal(weather.parseWeatherLocationName({ ...placePayload, city: '北京市', locality: '北京市', localityInfo: null }).name, '北京市');
});

test('place names handle international localities, rural areas and missing city data', () => {
  assert.equal(weather.parseWeatherLocationName({ lookupSource: 'reverseGeocoding', countryName: 'United Kingdom', city: 'London', locality: 'Westminster' }).name, 'London · Westminster');
  assert.equal(weather.parseWeatherLocationName({ lookupSource: 'coordinates', principalSubdivision: '某省', locality: '某县' }).name, '某省 · 某县');
  assert.equal(weather.parseWeatherLocationName({ lookupSource: 'coordinates', locality: '某镇' }).name, '某镇');
  assert.equal(weather.parseWeatherLocationName({ lookupSource: 'coordinates', countryName: '中国', city: ' ' }), null);
});

test('IP-derived, missing-source and malformed place names are never accepted as GPS names', () => {
  [null, {}, { ...placePayload, lookupSource: 'ipGeolocation' }, { ...placePayload, lookupSource: undefined }, { lookupSource: 'coordinates', city: {}, locality: 123 }].forEach(payload => assert.equal(weather.parseWeatherLocationName(payload), null));
});

test('reverse lookup sends only rounded coordinates with no cookies, credentials or referrer', async () => {
  let calls = 0;
  const result = await weather.resolveWeatherLocationName({ ...devicePosition, latitude: 31.23456, longitude: 121.4789 }, new AbortController().signal, async (address, options) => {
    calls++;
    const url = new URL(address);
    assert.equal(url.origin, 'https://api.bigdatacloud.net');
    assert.equal(url.pathname, '/data/reverse-geocode-client');
    assert.equal(url.searchParams.get('latitude'), '31.23');
    assert.equal(url.searchParams.get('longitude'), '121.48');
    assert.equal(url.searchParams.get('localityLanguage'), 'zh');
    assert.equal([...url.searchParams].length, 3);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers, undefined);
    return ok(placePayload);
  });
  assert.equal(calls, 1);
  assert.equal(result.name, '北京市 · 朝阳区');
  // Enrichment retains device origin: it must never become a saved city.
  assert.equal(weather.readSavedWeatherCity({ getItem: () => JSON.stringify({ ...devicePosition, ...result }) }), null);
});

test('no reverse requests for manual cities, missing coordinates, or aborted requests', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return ok(placePayload); };
  for (const location of [city, { ...devicePosition, latitude: undefined }, { ...devicePosition, longitude: 181 }]) {
    await assert.rejects(weather.resolveWeatherLocationName(location, new AbortController().signal, fetcher));
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(weather.resolveWeatherLocationName(devicePosition, controller.signal, fetcher), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('reverse lookup handles service failures and cancellation without inventing a city', async () => {
  await assert.rejects(weather.resolveWeatherLocationName(devicePosition, new AbortController().signal, async () => ({ ok: false, status: 402 })), /HTTP 402/);
  await assert.rejects(weather.resolveWeatherLocationName(devicePosition, new AbortController().signal, async () => ok({ ...placePayload, lookupSource: 'ipGeolocation' })), /未能获取/);
  const controller = new AbortController();
  await assert.rejects(weather.resolveWeatherLocationName(devicePosition, controller.signal, async () => {
    controller.abort();
    return ok(placePayload);
  }), { name: 'AbortError' });
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test('a successful device position remembers automatic mode without retaining coordinates or names', () => {
  const storage = memoryStorage();
  weather.saveWeatherPreference(storage, { ...devicePosition, name: '设备所在地', detail: '不应保存的地名' });
  assert.deepEqual(JSON.parse(storage.getItem(weather.WEATHER_LOCATION_KEY)), { version: 1, mode: 'geolocation' });
  assert.deepEqual(weather.readWeatherPreference(storage), { mode: 'geolocation', location: null });
  assert.equal(weather.readSavedWeatherCity(storage), null);
});

test('reopening an opted-in page can acquire a fresh position when permission is still granted', async () => {
  const storage = memoryStorage();
  weather.saveWeatherPreference(storage, devicePosition);
  const restored = weather.readWeatherPreference(storage);
  assert.equal(weather.shouldRestoreWeatherLocation(restored.mode, 'granted', false, true), true);
  let calls = 0;
  const freshPosition = await weather.locateWeatherPosition({ getCurrentPosition: success => {
    calls++;
    success({ coords: { latitude: 35.123, longitude: 120.123 } });
  } });
  assert.equal(calls, 1);
  assert.equal(freshPosition.latitude, 35.12);
  assert.notEqual(freshPosition.latitude, devicePosition.latitude);
  assert.equal(weather.shouldRestoreWeatherLocation(restored.mode, 'granted', true, true), false);
});

test('automatic restoration never runs without opt-in, granted permission, or a visible page', () => {
  ['none', 'city'].forEach(mode => assert.equal(weather.shouldRestoreWeatherLocation(mode, 'granted', false, true), false));
  ['prompt', 'denied', 'checking', 'unknown', 'insecure', 'unsupported', 'policy-blocked'].forEach(permission => {
    assert.equal(weather.shouldRestoreWeatherLocation('geolocation', permission, false, true), false);
  });
  assert.equal(weather.shouldRestoreWeatherLocation('geolocation', 'granted', false, false), false);
  assert.equal(weather.shouldRestoreWeatherLocation('geolocation', 'granted', false, true), true);
});

test('manual city selection and clearing disable automatic restoration across reopening', () => {
  const storage = memoryStorage();
  weather.saveWeatherPreference(storage, devicePosition);
  weather.saveWeatherPreference(storage, city);
  assert.deepEqual(weather.readWeatherPreference(storage), { mode: 'city', location: city });
  weather.saveWeatherPreference(storage, devicePosition);
  weather.saveWeatherPreference(storage, null);
  assert.equal(storage.getItem(weather.WEATHER_LOCATION_KEY), null);
  assert.deepEqual(weather.readWeatherPreference(storage), { mode: 'none', location: null });
});

test('legacy saved cities remain usable; corrupt storage and old device coordinates do not grant automatic consent', () => {
  const storage = memoryStorage();
  storage.setItem(weather.WEATHER_LOCATION_KEY, JSON.stringify(city));
  assert.deepEqual(weather.readWeatherPreference(storage), { mode: 'city', location: city });
  for (const raw of ['{', '{}', JSON.stringify(devicePosition), '{"mode":"geolocation"}', '{"version":2,"mode":"geolocation"}']) {
    storage.setItem(weather.WEATHER_LOCATION_KEY, raw);
    assert.deepEqual(weather.readWeatherPreference(storage), { mode: 'none', location: null });
  }
  assert.deepEqual(weather.readWeatherPreference({ getItem: () => { throw new Error('disabled'); } }), { mode: 'none', location: null });
  assert.throws(() => weather.saveWeatherPreference({ setItem: () => { throw new Error('storage full'); } }, devicePosition), /storage full/);
});

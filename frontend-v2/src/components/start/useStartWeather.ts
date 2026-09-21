import { useCallback, useEffect, useState } from 'react';
import { fetchWeatherSnapshot, locationKey, mergeWeatherSnapshot, WEATHER_REFRESH_MS, WeatherLocation, WeatherSnapshot } from '../../lib/startWeather';

export function useStartWeather(location: WeatherLocation | null) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data: WeatherSnapshot | null; loading: boolean }>({ key: '', data: null, loading: false });
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const key = location ? locationKey(location) : '';
  const latitude = location?.latitude;
  const longitude = location?.longitude;

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) { setState({ key: '', data: null, loading: false }); return; }
    const controller = new AbortController();
    let inFlight = false;
    let lastAttemptAt = 0;
    const load = async () => {
      if (inFlight || controller.signal.aborted || document.visibilityState === 'hidden') return;
      inFlight = true;
      lastAttemptAt = Date.now();
      setState(previous => ({ key, data: previous.key === key ? previous.data : null, loading: true }));
      try {
        const result = await fetchWeatherSnapshot({ latitude, longitude }, controller.signal);
        if (!controller.signal.aborted) {
          setState(previous => ({ key, data: mergeWeatherSnapshot(previous.key === key ? previous.data : null, result), loading: false }));
        }
      } catch {
        if (!controller.signal.aborted) {
          setState(previous => ({ key, data: mergeWeatherSnapshot(previous.key === key ? previous.data : null, {
            weather: null, air: null, weatherError: true, airError: true, fetchedAt: Date.now(),
          }), loading: false }));
        }
      } finally { inFlight = false; }
    };
    const refreshIfDue = () => { if (Date.now() - lastAttemptAt >= WEATHER_REFRESH_MS) void load(); };
    void load();
    const interval = window.setInterval(refreshIfDue, WEATHER_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfDue);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfDue);
    };
  }, [latitude, longitude, key, revision]);

  // Never render the previous city's readings while a new city's request is in flight.
  return { data: state.key === key ? state.data : null, loading: Boolean(location) && (state.key !== key || state.loading), refresh };
}

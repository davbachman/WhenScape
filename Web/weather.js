/**
 * Weather estimates for a place and instant, independent of the renderer.
 * Sources: https://open-meteo.com/en/docs and /en/docs/historical-weather-api
 * The public endpoints are for non-commercial use. Attribution is required.
 * Units: Celsius, m/s, degrees FROM north, metres visibility/depth,
 * mm per preceding hour of precipitation, cm per preceding hour of snowfall.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const COMMON = ['temperature_2m', 'cloud_cover', 'precipitation', 'rain', 'snowfall',
  'wind_speed_10m', 'wind_direction_10m', 'snow_depth'];
// Nice to have. If the service rejects a request that includes them, it is
// repeated without them, so they can never cost the essential values.
const EXTRAS = ['apparent_temperature', 'wind_gusts_10m'];

function finite(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function nonnegative(value) { const v = finite(value); return v === null || v < 0 ? null : v; }
function percentage(value) { const v = finite(value); return v === null || v < 0 || v > 100 ? null : v; }
function datePart(date) { return date.toISOString().slice(0, 10); }
function utcMidnight(date) { return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }
function abortError() { return new DOMException('Weather request cancelled.', 'AbortError'); }
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }

/** Calendar-day boundaries, explicitly UTC, agree with the API's timezone=GMT. */
export function classifyTime(time, now = new Date()) {
  const date = new Date(time), today = new Date(now);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(today.getTime())) throw new RangeError('Invalid date.');
  // The current hour is the latest forecast estimate, even if UI/network latency
  // makes the selected instant a few seconds older than the wall clock.
  if (Math.floor(date.getTime() / HOUR) < Math.floor(today.getTime() / HOUR)) return 'historical';
  return utcMidnight(date) < utcMidnight(today) + 16 * DAY ? 'forecast' : 'seasonal';
}

/** A five-year sample ending before the current year, not a 30-year climate normal. */
export function seasonalWindows(time, now = new Date(), count = 5) {
  const target = new Date(time);
  if (!Number.isFinite(target.getTime())) throw new RangeError('Invalid date.');
  return Array.from({ length: count }, (_, i) => {
    const year = new Date(now).getUTCFullYear() - 1 - i;
    // February 29 maps to February 28 in non-leap years, never silently to March 1.
    const lastDay = new Date(Date.UTC(year, target.getUTCMonth() + 1, 0)).getUTCDate();
    const middle = Date.UTC(year, target.getUTCMonth(), Math.min(target.getUTCDate(), lastDay));
    return { year, start: datePart(new Date(middle - 3 * DAY)), end: datePart(new Date(middle + 3 * DAY)) };
  });
}

function parseTimestamp(value) {
  if (typeof value === 'number') return value * 1000; // timeformat=unixtime
  if (typeof value !== 'string') return NaN;
  // Open-Meteo ISO strings omit Z even when timezone=GMT.
  return Date.parse(/[zZ]$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

/** Select the containing UTC hour. Never silently use the nearest distant sample. */
export function hourlySample(hourly, time) {
  if (!hourly || !Array.isArray(hourly.time)) return null;
  const target = Math.floor(new Date(time).getTime() / HOUR) * HOUR;
  const index = hourly.time.findIndex(value => parseTimestamp(value) === target);
  if (index < 0) return null;
  const at = name => Array.isArray(hourly[name]) ? hourly[name][index] : null;
  const rain = nonnegative(at('rain'));
  const showers = nonnegative(at('showers'));
  const hasShowers = Array.isArray(hourly.showers);
  const direction = finite(at('wind_direction_10m'));
  return {
    temperature: finite(at('temperature_2m')),
    apparentTemperature: finite(at('apparent_temperature')),
    cloudCover: percentage(at('cloud_cover')),
    precipitation: nonnegative(at('precipitation')),
    rain: rain === null || (hasShowers && showers === null) ? null : rain + (showers ?? 0),
    snowfall: nonnegative(at('snowfall')),
    windSpeed: nonnegative(at('wind_speed_10m')),
    windGust: nonnegative(at('wind_gusts_10m')),
    windDirection: direction === null || direction < 0 || direction > 360 ? null : direction % 360,
    visibility: nonnegative(at('visibility')),
    snowDepth: nonnegative(at('snow_depth')),
    precipitationProbability: percentage(at('precipitation_probability')),
    validAt: new Date(target).toISOString()
  };
}

function hasData(sample) {
  return sample && ['temperature', 'cloudCover', 'precipitation', 'windSpeed'].some(k => sample[k] !== null);
}

function mean(values) {
  const valid = values.filter(x => finite(x) !== null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

/** Average wind vectors across north correctly; an opposing/calm vector has no direction. */
export function meanWind(samples) {
  const valid = samples.filter(s => finite(s.windDirection) !== null && finite(s.windSpeed) !== null);
  if (!valid.length) return null;
  const x = mean(valid.map(s => Math.sin(s.windDirection * Math.PI / 180) * s.windSpeed));
  const y = mean(valid.map(s => Math.cos(s.windDirection * Math.PI / 180) * s.windSpeed));
  if (Math.hypot(x, y) < 0.05) return null;
  return ((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360;
}

export function aggregateSeasonal(samples) {
  const fields = ['temperature', 'apparentTemperature', 'cloudCover', 'precipitation', 'rain', 'snowfall', 'windSpeed', 'windGust'];
  const output = Object.fromEntries(fields.map(name => [name, mean(samples.map(s => s[name]))]));
  const temperatures = samples.map(s => s.temperature).filter(x => finite(x) !== null).sort((a, b) => a - b);
  const precipitation = samples.map(s => s.precipitation).filter(x => finite(x) !== null);
  return {
    ...output,
    windDirection: meanWind(samples),
    visibility: null, snowDepth: null, precipitationProbability: null,
    wetHourFrequency: precipitation.length ? 100 * precipitation.filter(x => x > 0.1).length / precipitation.length : null,
    temperatureRange: temperatures.length ? [temperatures[Math.floor((temperatures.length - 1) * 0.1)], temperatures[Math.ceil((temperatures.length - 1) * 0.9)]] : null,
    sampleCount: samples.length,
    // A mean rainfall rate does not predict continuous drizzle or falling snow.
    renderPrecipitation: false
  };
}

function missing(time, fetchedAt, detail, error) {
  return {
    kind: 'missing', label: 'Weather unavailable',
    temperature: null, apparentTemperature: null, cloudCover: null, precipitation: null, rain: null, snowfall: null,
    windSpeed: null, windGust: null, windDirection: null, visibility: null, snowDepth: null,
    precipitationProbability: null, renderPrecipitation: false,
    fetchedAt, validAt: new Date(time).toISOString(), detail, ...(error ? { error } : {})
  };
}

/** Cancels the consumer while allowing a bounded shared download to finish for other users. */
function abortable(promise, signal) {
  if (!signal) return promise;
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(abortError()); };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export class WeatherController {
  constructor({ fetch: fetchFunction = globalThis.fetch?.bind(globalThis), now = () => new Date(), timeoutMs = 12_000, maxEntries = 64 } = {}) {
    this.fetch = fetchFunction;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.maxEntries = Math.max(1, maxEntries);
    this.cache = new Map();
    this.inflight = new Map();
  }

  clearCache() { this.cache.clear(); }

  async getConditions({ latitude, longitude, time, signal } = {}) {
    checkAbort(signal);
    const date = new Date(time);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(date.getTime())) {
      throw new RangeError('A valid latitude, longitude and date are required.');
    }
    const now = new Date(this.now());
    const kind = classifyTime(date, now);
    if (date.getUTCFullYear() < 1940) {
      return missing(date, now.toISOString(), 'The historical weather source starts in 1940. Astronomy remains available.');
    }
    try {
      if (kind === 'seasonal') return await this.seasonal(latitude, longitude, date, now, signal);
      const { sample, entry, recent } = await this.hour(latitude, longitude, date, kind, now, signal);
      if (!hasData(sample)) {
        return missing(date, entry.fetchedAt,
          kind === 'historical' ? 'No historical estimate is available for this hour.' : 'The provider has no forecast values for this hour.');
      }
      return {
        ...sample, kind,
        label: kind === 'forecast' ? 'Forecast' : 'Historical estimate',
        fetchedAt: entry.fetchedAt,
        source: 'Open-Meteo', sourceURL: kind === 'forecast' || recent ? 'https://open-meteo.com/en/docs' : 'https://open-meteo.com/en/docs/historical-weather-api',
        renderPrecipitation: true,
        detail: kind === 'forecast'
          ? 'Hourly model forecast for the surrounding grid. Clouds and precipitation placement are illustrative; wind is estimated at 10 m.'
          : recent
            ? 'Hourly model estimate for a recent past hour, from the forecast service because the historical archive does not cover it yet. Not an observation at this exact spot. Clouds and precipitation placement are illustrative; wind is estimated at 10 m.'
            : 'Hourly gridded historical model estimate, not an observation at this exact spot. Clouds and precipitation placement are illustrative; wind is estimated at 10 m.'
      };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError();
      return missing(date, now.toISOString(),
        kind === 'historical' ? 'Historical weather could not be loaded. Astronomy remains available.' : 'Weather could not be loaded. Astronomy remains available.',
        error instanceof Error ? error.message : 'Weather service unavailable.');
    }
  }

  /**
   * Hourly samples across an interval, for a timeline. Hours beyond the
   * forecast window are omitted rather than filled with seasonal averages,
   * and an hour whose day cannot be loaded is omitted too. At most four days.
   */
  async getSeries({ latitude, longitude, start, end, signal } = {}) {
    checkAbort(signal);
    const first = Math.floor(new Date(start).getTime() / HOUR) * HOUR, last = new Date(end).getTime();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(first) || !Number.isFinite(last)) {
      throw new RangeError('A valid latitude, longitude and interval are required.');
    }
    const now = new Date(this.now());
    const samples = [];
    for (let hour = first; hour <= last && samples.length < 96 && hour - first < 4 * DAY; hour += HOUR) {
      const date = new Date(hour);
      const kind = classifyTime(date, now);
      if (kind === 'seasonal' || date.getUTCFullYear() < 1940) continue;
      try {
        const { sample } = await this.hour(latitude, longitude, date, kind, now, signal);
        if (hasData(sample)) samples.push({ ...sample, time: hour, kind });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw abortError();
      }
    }
    return samples;
  }

  /**
   * One hour's sample for a forecast or past instant. The historical archive
   * runs several days behind, while the forecast service keeps about three
   * months of past hours, so recent past hours use whichever has them: the
   * forecast service first within the last week, the archive first before that.
   */
  async hour(latitude, longitude, date, kind, now, signal) {
    const day = datePart(date);
    const age = now.getTime() - date.getTime();
    const sources = kind === 'forecast' ? ['forecast']
      : age < 7 * DAY ? ['forecast', 'historical'] : age < 85 * DAY ? ['historical', 'forecast'] : ['historical'];
    let failure, empty;
    for (const source of sources) {
      try {
        const entry = await this.load(latitude, longitude, day, day, source, signal);
        const sample = hourlySample(entry.data.hourly, date);
        const found = { sample, entry, recent: kind === 'historical' && source === 'forecast' };
        if (hasData(sample)) return found;
        empty ??= found;
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw abortError();
        failure ??= error;
      }
    }
    if (empty) return empty;
    throw failure;
  }

  async seasonal(latitude, longitude, date, now, signal) {
    const windows = seasonalWindows(date, now);
    const loaded = [];
    // Two concurrent requests maximum, with cache reuse for every hour of this date.
    for (let offset = 0; offset < windows.length; offset += 2) {
      checkAbort(signal);
      const results = await Promise.allSettled(windows.slice(offset, offset + 2).map(async window => ({
        window, entry: await this.load(latitude, longitude, window.start, window.end, 'seasonal', signal)
      })));
      checkAbort(signal);
      for (const result of results) if (result.status === 'fulfilled') loaded.push(result.value);
    }
    const samples = [], years = new Set();
    for (const { window, entry } of loaded) {
      for (const timestamp of entry.data.hourly?.time ?? []) {
        const instant = new Date(parseTimestamp(timestamp));
        if (instant.getUTCHours() !== date.getUTCHours()) continue;
        const sample = hourlySample(entry.data.hourly, instant);
        if (hasData(sample)) { samples.push(sample); years.add(window.year); }
      }
    }
    if (years.size < 3 || samples.length < 14) {
      return missing(date, now.toISOString(), 'Insufficient historical samples to estimate typical seasonal conditions (at least three years required).');
    }
    const baselineYears = [...years].sort((a, b) => a - b);
    const oldestFetch = loaded.map(x => x.entry.fetchedAt).sort()[0] ?? now.toISOString();
    return {
      ...aggregateSeasonal(samples), kind: 'seasonal', label: 'Typical seasonal conditions',
      validAt: date.toISOString(), fetchedAt: oldestFetch, baselineYears,
      source: 'Open-Meteo / ERA5', sourceURL: 'https://open-meteo.com/en/docs/historical-weather-api',
      detail: `Sample of ${samples.length} hours across ${years.size} years (${baselineYears[0]}–${baselineYears.at(-1)}), within ±3 calendar days at the same UTC hour. This recent historical average is not a forecast or a 30-year climate normal. Average precipitation is not rendered as falling rain or snow.`
    };
  }

  load(latitude, longitude, start, end, kind, signal) {
    // ~100 m coordinate precision matches or exceeds the weather grids and saves requests.
    const params = new URLSearchParams({
      latitude: latitude.toFixed(3), longitude: longitude.toFixed(3), start_date: start, end_date: end,
      timezone: 'GMT', timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'ms', precipitation_unit: 'mm',
      hourly: [...COMMON, ...(kind === 'forecast' ? ['showers', 'visibility', 'precipitation_probability'] : [])].join(',')
    });
    if (kind === 'seasonal') params.set('models', 'era5');
    const endpoint = kind === 'forecast' ? FORECAST : ARCHIVE;
    const essential = `${endpoint}?${params}`;
    params.set('hourly', `${params.get('hourly')},${EXTRAS.join(',')}`);
    const url = `${endpoint}?${params}`;
    const timestamp = new Date(this.now()).getTime();
    const cached = this.cache.get(url);
    if (cached && timestamp < cached.expiresAt) {
      this.cache.delete(url); this.cache.set(url, cached); // LRU
      if (cached.error) return abortable(Promise.reject(cached.error), signal);
      return abortable(Promise.resolve(cached), signal);
    }
    if (this.inflight.has(url)) return abortable(this.inflight.get(url), signal);
    const request = this.download(url).catch(error => {
      if (error?.status !== 400) throw error;
      return this.download(essential);
    }).then(data => {
      const ttl = kind === 'forecast' ? 30 * 60_000 : kind === 'seasonal' ? 7 * DAY : DAY;
      const entry = { data, fetchedAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now()).getTime() + ttl };
      this.remember(url, entry);
      return entry;
    }, error => {
      // Brief failure cache prevents a scrubber from repeatedly hitting an unavailable service.
      this.remember(url, { error, expiresAt: new Date(this.now()).getTime() + 30_000 });
      throw error;
    }).finally(() => this.inflight.delete(url));
    this.inflight.set(url, request);
    return abortable(request, signal);
  }

  remember(key, entry) {
    this.cache.delete(key); this.cache.set(key, entry);
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
  }

  async download(url) {
    if (!this.fetch) throw new Error('Networking is unavailable.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw Object.assign(new Error(`Weather service returned HTTP ${response.status}.`), { status: response.status });
      const data = await response.json();
      if (data.error || !data.hourly || !Array.isArray(data.hourly.time)) throw new Error('The weather service returned an unusable response.');
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('The weather service timed out.');
      throw error;
    } finally { clearTimeout(timer); }
  }
}

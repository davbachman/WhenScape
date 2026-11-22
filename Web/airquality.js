// Air quality for a place and time, from Open-Meteo's air quality service,
// which serves the Copernicus Atmosphere Monitoring Service (CAMS) models:
// worldwide on a grid of about 45 km (11 km in Europe), from August 2022 to
// about five days ahead. https://open-meteo.com/en/docs/air-quality-api
//
// The headline is the US Air Quality Index: the worst of its pollutants'
// indices, with particles averaged over the preceding 24 hours and ozone
// over 8, as the US EPA defines it.

const DAY = 86_400_000;
const ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const INDICES = {
  us_aqi_pm2_5: 'fine particles (PM2.5)', us_aqi_pm10: 'coarse particles (PM10)', us_aqi_ozone: 'ozone',
  us_aqi_nitrogen_dioxide: 'nitrogen dioxide', us_aqi_sulphur_dioxide: 'sulphur dioxide', us_aqi_carbon_monoxide: 'carbon monoxide',
};
const HOURLY = ['us_aqi', ...Object.keys(INDICES), 'pm2_5', 'ozone'];

/** The service's range: global estimates begin in August 2022 and forecasts run about five days ahead. */
export const AIR_QUALITY_FROM = Date.UTC(2022, 7, 1);
export const AIR_QUALITY_DAYS_AHEAD = 5;

/** Whether the service can answer for an instant: 'available', 'too-early' or 'too-far-ahead'. */
export function airQualityCoverage(time, now = Date.now()) {
  if (time < AIR_QUALITY_FROM) return 'too-early';
  if (time > now + AIR_QUALITY_DAYS_AHEAD * DAY) return 'too-far-ahead';
  return 'available';
}

/** The US AQI category for an index value, and its colour on the EPA's scale. */
export function aqiCategory(aqi) {
  if (aqi == null || !Number.isFinite(aqi)) return null;
  if (aqi <= 50) return { name: 'Good', color: '#00e400' };
  if (aqi <= 100) return { name: 'Moderate', color: '#ffff00' };
  if (aqi <= 150) return { name: 'Unhealthy for sensitive groups', color: '#ff7e00' };
  if (aqi <= 200) return { name: 'Unhealthy', color: '#ff0000' };
  if (aqi <= 300) return { name: 'Very unhealthy', color: '#8f3f97' };
  return { name: 'Hazardous', color: '#7e0023' };
}

const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Hourly samples from a response, oldest first: { time (ms), aqi, pollutant
 * (the one setting the index), pm25 and ozone (µg/m³) }. Hours without an
 * index are left out.
 */
export function parseAirQuality(json) {
  const hourly = json?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) return [];
  const samples = [];
  hourly.time.forEach((seconds, i) => {
    const aqi = finite(hourly.us_aqi?.[i]);
    if (aqi == null || !Number.isFinite(seconds)) return;
    let pollutant = null, highest = -1;
    for (const [key, name] of Object.entries(INDICES)) {
      const value = finite(hourly[key]?.[i]);
      if (value != null && value > highest) { highest = value; pollutant = name; }
    }
    samples.push({ time: seconds * 1000, aqi: Math.round(aqi), pollutant, pm25: finite(hourly.pm2_5?.[i]), ozone: finite(hourly.ozone?.[i]) });
  });
  return samples.sort((a, b) => a.time - b.time);
}

/** The sample nearest an instant, if one is within three hours (the global model is three-hourly). */
export function sampleAt(samples, time) {
  let best = null;
  for (const sample of samples ?? []) {
    if (Math.abs(sample.time - time) <= 3 * 3_600_000 && (!best || Math.abs(sample.time - time) < Math.abs(best.time - time))) best = sample;
  }
  return best;
}

/** The worst hour from `start` to `end`, or null if none falls between them. */
export function worstBetween(samples, start, end) {
  let worst = null;
  for (const sample of samples ?? []) {
    if (sample.time >= start - 1_800_000 && sample.time <= end + 1_800_000 && (!worst || sample.aqi > worst.aqi)) worst = sample;
  }
  return worst;
}

const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

/** Fetches and keeps hourly air quality, by place and UTC day range. */
export class AirQualityClient {
  constructor(fetchImpl = globalThis.fetch?.bind(globalThis)) {
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  /**
   * Hourly samples covering `start` to `end` (epoch ms), at most eight days,
   * clipped to what the service covers. Rejects if the request fails. The
   * requests are small and kept for reuse, so they are not cancelled; a
   * caller that has moved on simply ignores the answer.
   */
  async getSamples({ latitude, longitude, start, end, now = Date.now() }) {
    const first = Math.max(start, AIR_QUALITY_FROM);
    const last = Math.min(end, first + 7 * DAY, now + (AIR_QUALITY_DAYS_AHEAD + 1) * DAY);
    if (last < first) return [];
    const params = new URLSearchParams({ latitude: latitude.toFixed(4), longitude: longitude.toFixed(4), hourly: HOURLY.join(','),
      timezone: 'GMT', timeformat: 'unixtime', start_date: isoDay(first), end_date: isoDay(last) });
    const url = `${ENDPOINT}?${params}`;
    if (!this.cache.has(url)) {
      const request = this.fetch(url).then(async response => {
        if (!response.ok) throw new Error(`Air quality request failed (${response.status})`);
        return parseAirQuality(await response.json());
      });
      this.cache.set(url, request);
      // A failure is forgotten, so the next attempt asks again.
      request.catch(() => this.cache.delete(url));
      if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(url);
  }
}

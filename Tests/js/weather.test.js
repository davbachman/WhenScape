import test from 'node:test';
import assert from 'node:assert/strict';
import { WeatherController, classifyTime, seasonalWindows, hourlySample, meanWind, aggregateSeasonal, blendSamples } from '../../Web/weather.js';

const NOW = new Date('2026-11-16T14:30:00Z');
const base = { latitude: 34.0967, longitude: -117.7198 };
const hour = 3_600_000;
function responseFor(url, transform = x => x) {
  const query = new URL(url).searchParams;
  const first = Date.parse(`${query.get('start_date')}T00:00:00Z`);
  const last = Date.parse(`${query.get('end_date')}T23:00:00Z`);
  const times = Array.from({ length: (last - first) / hour + 1 }, (_, i) => (first + i * hour) / 1000);
  const hourly = { time: times };
  const values = { temperature_2m: 12, cloud_cover: 70, precipitation: 0.5, rain: 0.4, showers: 0.1,
    snowfall: 0.1, wind_speed_10m: 3, wind_direction_10m: 350, snow_depth: 0.02, visibility: 9000, precipitation_probability: 80 };
  for (const key of query.get('hourly').split(',')) hourly[key] = times.map(() => values[key]);
  return { ok: true, status: 200, json: async () => transform({ hourly }) };
}
const make = (overrides = {}) => new WeatherController({ now: () => NOW, fetch: async url => responseFor(url), ...overrides });

test('routes current hour, historical hours and UTC forecast horizon without DST ambiguity', () => {
  assert.equal(classifyTime('2026-11-16T14:00:00Z', NOW), 'forecast');
  assert.equal(classifyTime('2026-11-16T13:59:59Z', NOW), 'historical');
  assert.equal(classifyTime('2026-12-01T23:59:59Z', NOW), 'forecast');
  assert.equal(classifyTime('2026-12-02T00:00:00Z', NOW), 'seasonal');
  assert.equal(classifyTime('2026-11-01T01:30:00-07:00', NOW), 'historical');
  assert.throws(() => classifyTime('bad', NOW), RangeError);
});

test('five complete prior years handle leap day and windows crossing New Year', () => {
  const leap = seasonalWindows('2028-02-29T18:00:00Z', NOW);
  assert.equal(leap.length, 5);
  assert.deepEqual(leap[0], { year: 2025, start: '2025-02-25', end: '2025-03-03' });
  assert.deepEqual(leap[1], { year: 2024, start: '2024-02-26', end: '2024-03-03' });
  const january = seasonalWindows('2027-01-01T12:00:00Z', NOW);
  assert.deepEqual(january[0], { year: 2025, start: '2024-12-29', end: '2025-01-04' });
});

test('hour selection is UTC, preserves zero and never turns missing into clear weather', () => {
  const sample = hourlySample({ time: ['2026-11-16T14:00'], temperature_2m: [0], rain: [null], cloud_cover: [null], wind_direction_10m: [360], visibility: [-1] }, '2026-11-16T14:59:00Z');
  assert.equal(sample.temperature, 0);
  assert.equal(sample.rain, null);
  assert.equal(sample.cloudCover, null);
  assert.equal(sample.windDirection, 0);
  assert.equal(sample.visibility, null);
  assert.equal(hourlySample({ time: ['2026-11-16T14:00'], rain: [null], showers: [0] }, '2026-11-16T14:00Z').rain, null);
  assert.equal(hourlySample({ time: ['2026-11-16T14:00'] }, '2026-11-17T14:00Z'), null);
});

test('wind direction uses vectors across north and does not invent direction for opposing winds', () => {
  assert.ok(Math.abs(meanWind([{ windDirection: 350, windSpeed: 4 }, { windDirection: 10, windSpeed: 4 }])) < 1e-8);
  assert.equal(meanWind([{ windDirection: 90, windSpeed: 4 }, { windDirection: 270, windSpeed: 4 }]), null);
  assert.equal(meanWind([{ windDirection: null, windSpeed: 4 }]), null);
});

test('seasonal means explicitly suppress falling precipitation and accumulated snow', () => {
  const result = aggregateSeasonal([
    { temperature: 10, cloudCover: 100, precipitation: 5, rain: 5, snowfall: 0, windSpeed: 2, windDirection: 180 },
    { temperature: 20, cloudCover: 0, precipitation: 0, rain: 0, snowfall: 0, windSpeed: 2, windDirection: 180 }
  ]);
  assert.equal(result.precipitation, 2.5);
  assert.equal(result.renderPrecipitation, false);
  assert.equal(result.snowDepth, null);
  assert.equal(result.wetHourFrequency, 50);
  assert.equal(result.precipitationProbability, null);
  assert.deepEqual(result.temperatureRange, [10, 20]);
});

test('forecast requests correct units, and caches the entire day while scrubbing', async () => {
  const urls = [];
  const controller = make({ fetch: async url => { urls.push(url); return responseFor(url); } });
  const result = await controller.getConditions({ ...base, time: '2026-11-16T15:45:00Z' });
  const later = await controller.getConditions({ ...base, time: '2026-11-16T18:00:00Z' });
  assert.equal(urls.length, 1);
  assert.equal(new URL(urls[0]).origin, 'https://api.open-meteo.com');
  assert.equal(new URL(urls[0]).searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(result.kind, 'forecast');
  assert.equal(result.rain, 0.5); // Rain plus convective showers.
  assert.equal(result.precipitationProbability, 80);
  assert.equal(result.windSpeed, 3);
  assert.equal(result.validAt, '2026-11-16T15:00:00.000Z');
  assert.equal(later.validAt, '2026-11-16T18:00:00.000Z');
});

test('past weather comes from the archive and unavailable visibility remains unknown', async () => {
  let requested;
  const result = await make({ fetch: async url => { requested = url; return responseFor(url); } }).getConditions({ ...base, time: '2020-05-01T05:00:00Z' });
  assert.equal(new URL(requested).origin, 'https://archive-api.open-meteo.com');
  assert.equal(result.kind, 'historical');
  assert.equal(result.visibility, null);
  assert.equal(result.precipitationProbability, null);
  assert.match(result.detail, /not an observation/);
});

test('far-future scene uses actual five-year ERA5 samples with bounded concurrency and cache reuse', async () => {
  const urls = [];
  let active = 0, maximum = 0;
  const controller = make({ fetch: async url => {
    urls.push(url); maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return responseFor(url);
  } });
  const first = await controller.getConditions({ ...base, time: '2030-06-15T18:00:00Z' });
  const second = await controller.getConditions({ ...base, time: '2030-06-15T19:00:00Z' });
  assert.equal(urls.length, 5);
  assert.equal(maximum, 2);
  assert.ok(urls.every(url => new URL(url).searchParams.get('models') === 'era5'));
  assert.equal(first.kind, 'seasonal');
  assert.equal(first.sampleCount, 35);
  assert.deepEqual(first.baselineYears, [2021, 2022, 2023, 2024, 2025]);
  assert.equal(first.renderPrecipitation, false);
  assert.equal(second.temperature, 12);
});

test('insufficient seasonal history yields missing rather than fabricated averages', async () => {
  const result = await make({ fetch: async url => {
    const start = new URL(url).searchParams.get('start_date');
    if (!start.startsWith('2025')) throw new Error('Unavailable');
    return responseFor(url);
  } }).getConditions({ ...base, time: '2028-06-15T18:00:00Z' });
  assert.equal(result.kind, 'missing');
  assert.match(result.detail, /Insufficient historical/);
  assert.equal(result.cloudCover, null);
});

test('null rows and HTTP errors produce clearly unavailable weather, not sunshine', async () => {
  const empty = await make({ fetch: async url => responseFor(url, data => {
    for (const key of Object.keys(data.hourly)) if (key !== 'time') data.hourly[key].fill(null);
    return data;
  }) }).getConditions({ ...base, time: '2026-11-16T15:00:00Z' });
  assert.equal(empty.kind, 'missing');
  const failed = await make({ fetch: async () => ({ ok: false, status: 429 }) }).getConditions({ ...base, time: '2026-11-16T15:00:00Z' });
  assert.equal(failed.kind, 'missing');
  assert.match(failed.error, /429/);
  assert.equal(failed.renderPrecipitation, false);
});

test('a cancelled subscriber does not poison a shared successful request', async () => {
  let finish, count = 0;
  const controller = make({ fetch: url => { count++; return new Promise(resolve => { finish = () => resolve(responseFor(url)); }); } });
  const abort = new AbortController();
  const cancelled = controller.getConditions({ ...base, time: '2026-11-16T15:00:00Z', signal: abort.signal });
  const other = controller.getConditions({ ...base, time: '2026-11-16T16:00:00Z' });
  abort.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  finish();
  assert.equal((await other).kind, 'forecast');
  assert.equal((await controller.getConditions({ ...base, time: '2026-11-16T17:00:00Z' })).kind, 'forecast');
  assert.equal(count, 1);
});

test('requests expire and cached failures back off rather than hammering the API', async () => {
  let count = 0, now = NOW;
  const controller = make({ now: () => now, fetch: async () => { count++; throw new Error('Offline'); } });
  const args = { ...base, time: '2026-11-16T15:00:00Z' };
  await controller.getConditions(args);
  await controller.getConditions(args);
  assert.equal(count, 1);
  now = new Date(+NOW + 31_000);
  await controller.getConditions(args);
  assert.equal(count, 2);
});

test('timeout is reported as unavailable and validation avoids accidental network requests', async () => {
  const controller = make({ timeoutMs: 5, fetch: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) });
  const result = await controller.getConditions({ ...base, time: '2026-11-16T15:00:00Z' });
  assert.equal(result.kind, 'missing');
  assert.match(result.error, /timed out/);
  await assert.rejects(controller.getConditions({ ...base, latitude: 100, time: NOW }), RangeError);
  await assert.rejects(controller.getConditions({ ...base, time: 'invalid' }), RangeError);
  assert.equal((await controller.getConditions({ ...base, time: '1900-01-01T00:00:00Z' })).kind, 'missing');
});

test('cache has a fixed upper bound', async () => {
  const controller = make({ maxEntries: 2 });
  for (const latitude of [10, 11, 12]) await controller.getConditions({ ...base, latitude, time: '2026-11-16T15:00:00Z' });
  assert.equal(controller.cache.size, 2);
});

test('an hourly series covers an interval and carries feels-like and gusts', async () => {
  const requests = [];
  const controller = new WeatherController({
    now: () => new Date('2026-11-19T10:00:00Z'),
    fetch: async url => {
      requests.push(url);
      const query = new URL(url).searchParams;
      const begin = Date.parse(query.get('start_date') + 'T00:00:00Z') / 1000;
      const times = Array.from({ length: 24 }, (_, i) => begin + i * 3600);
      const hourly = { time: times };
      for (const key of query.get('hourly').split(',')) hourly[key] = times.map((_, i) => key === 'temperature_2m' ? i : key === 'apparent_temperature' ? i - 2 : key === 'wind_gusts_10m' ? 9 : 1);
      return { ok: true, status: 200, json: async () => ({ hourly }) };
    }
  });
  const series = await controller.getSeries({ latitude: 34.1, longitude: -117.728, start: '2026-11-19T22:30:00Z', end: '2026-11-20T02:00:00Z' });
  assert.deepEqual(series.map(s => new Date(s.time).toISOString().slice(0, 13)), ['2026-11-19T22', '2026-11-19T23', '2026-11-20T00', '2026-11-20T01', '2026-11-20T02']);
  assert.deepEqual(series.map(s => s.temperature), [22, 23, 0, 1, 2]);
  assert.equal(series[0].apparentTemperature, 20);
  assert.equal(series[0].windGust, 9);
  assert.equal(requests.length, 2, 'one request per calendar day');
  assert.ok(requests.every(url => url.includes('apparent_temperature') && url.includes('wind_gusts_10m')));
  const far = await controller.getSeries({ latitude: 34.1, longitude: -117.728, start: '2027-06-01T00:00:00Z', end: '2027-06-01T05:00:00Z' });
  assert.deepEqual(far, [], 'hours beyond the forecast window are left out');
});

test('a request the service rejects is repeated without the optional values', async () => {
  const requests = [];
  const controller = new WeatherController({
    now: () => new Date('2026-11-19T10:00:00Z'),
    fetch: async url => {
      requests.push(url);
      if (url.includes('wind_gusts_10m')) return { ok: false, status: 400, json: async () => ({ error: true }) };
      const time = Array.from({ length: 24 }, (_, i) => Date.parse('2026-11-19T00:00:00Z') / 1000 + i * 3600);
      const hourly = { time };
      for (const key of new URL(url).searchParams.get('hourly').split(',')) hourly[key] = time.map(() => 12);
      return { ok: true, status: 200, json: async () => ({ hourly }) };
    }
  });
  const result = await controller.getConditions({ latitude: 34.1, longitude: -117.728, time: '2026-11-19T10:30:00Z' });
  assert.equal(result.kind, 'forecast');
  assert.equal(result.temperature, 12);
  assert.equal(result.windGust, null);
  assert.equal(requests.length, 2);
  assert.ok(!requests[1].includes('apparent_temperature') && requests[1].includes('temperature_2m'));
});

test('recent past hours come from the forecast service when the archive has not caught up', async () => {
  const requests = [];
  const controller = new WeatherController({
    now: () => new Date('2026-11-19T10:00:00Z'),
    fetch: async url => {
      requests.push(url);
      const query = new URL(url).searchParams;
      const time = Array.from({ length: 24 }, (_, i) => Date.parse(query.get('start_date') + 'T00:00:00Z') / 1000 + i * 3600);
      const archive = url.includes('archive-api');
      const hourly = { time };
      // The archive answers for recent days, but with no values yet.
      for (const key of query.get('hourly').split(',')) hourly[key] = time.map(() => archive && query.get('start_date') > '2026-11-10' ? null : archive ? 5 : 15);
      return { ok: true, status: 200, json: async () => ({ hourly }) };
    }
  });
  const place = { latitude: 34.1, longitude: -117.728 };
  const yesterday = await controller.getConditions({ ...place, time: '2026-11-18T20:00:00Z' });
  assert.equal(yesterday.kind, 'historical');
  assert.equal(yesterday.temperature, 15);
  assert.match(yesterday.detail, /recent past hour/);
  assert.ok(requests[0].includes('api.open-meteo.com/v1/forecast'), 'within a week, the forecast service is asked first');

  requests.length = 0;
  const lastMonth = await controller.getConditions({ ...place, time: '2026-10-20T20:00:00Z' });
  assert.equal(lastMonth.temperature, 5, 'older hours come from the archive');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].includes('archive-api'));

  requests.length = 0;
  const twoWeeks = await controller.getConditions({ ...place, time: '2026-11-11T20:00:00Z' });
  assert.equal(twoWeeks.temperature, 15, 'an empty archive day falls back to the forecast service');
  assert.deepEqual(requests.map(url => url.includes('archive-api')), [true, false]);
});

test('conditions change gradually between hourly values', async () => {
  const controller = new WeatherController({
    now: () => new Date('2026-11-19T10:00:00Z'),
    fetch: async url => {
      const query = new URL(url).searchParams;
      const time = Array.from({ length: 24 }, (_, i) => Date.parse(query.get('start_date') + 'T00:00:00Z') / 1000 + i * 3600);
      const hourly = { time };
      // Hour 18 is clear and dry; hour 19 is overcast, wet and murky, with the wind backing through north.
      const at = (key, i) => ({ cloud_cover: i === 19 ? 100 : 20, rain: i === 19 ? 2 : 0, precipitation: i === 19 ? 2 : 0,
        visibility: i === 19 ? 2000 : 20000, wind_direction_10m: i === 19 ? 10 : 350, temperature_2m: i, showers: 0 }[key] ?? 1);
      for (const key of query.get('hourly').split(',')) hourly[key] = time.map((_, i) => at(key, i));
      return { ok: true, status: 200, json: async () => ({ hourly }) };
    }
  });
  const place = { latitude: 34.1, longitude: -117.728 };
  const onTheHour = await controller.getConditions({ ...place, time: '2026-11-19T18:00:00Z' });
  assert.equal(onTheHour.cloudCover, 20);
  const late = await controller.getConditions({ ...place, time: '2026-11-19T18:57:00Z' });
  const early = await controller.getConditions({ ...place, time: '2026-11-19T19:03:00Z' });
  assert.ok(Math.abs(late.cloudCover - 96) < 0.01, String(late.cloudCover));
  assert.ok(Math.abs(late.visibility - 2900) < 1 && Math.abs(late.rain - 1.9) < 0.01);
  assert.ok(Math.abs(late.windDirection - 9) < 0.01, 'the wind turns the short way through north');
  assert.ok(Math.abs(late.cloudCover - early.cloudCover) < 6 && Math.abs(late.temperature - early.temperature) < 0.2,
    'a few minutes either side of the hour look alike');
});

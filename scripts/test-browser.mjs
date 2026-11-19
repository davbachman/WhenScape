import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let snow = false;
let cloudsOnly = false;
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === '127.0.0.1' || url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
  if (url.hostname === 'api.open-meteo.com' || url.hostname === 'archive-api.open-meteo.com') {
    const start = new Date(url.searchParams.get('start_date') + 'T00:00:00Z');
    const end = new Date(url.searchParams.get('end_date') + 'T23:00:00Z');
    const time = [];
    for (let t = +start; t <= +end; t += 3600000) time.push(t / 1000);
    const values = { temperature_2m: snow ? -2 : 14, cloud_cover: 85, precipitation: cloudsOnly ? 0 : 2, rain: snow || cloudsOnly ? 0 : 2,
      showers: 0, snowfall: snow && !cloudsOnly ? 1 : 0, wind_speed_10m: 5, wind_direction_10m: 260,
      visibility: cloudsOnly ? 10000 : 4000, snow_depth: snow && !cloudsOnly ? 0.05 : 0, precipitation_probability: 60 };
    const hourly = { time };
    for (const key of url.searchParams.get('hourly').split(',')) hourly[key] = time.map(() => values[key] ?? null);
    return route.fulfill({ json: { hourly }, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  return route.abort();
});

try {
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.whenScapeStatus?.ready);
  assert.equal(await page.locator('#fatal-message').isVisible(), false);
  assert.match(await page.locator('#geometry-status').textContent(), /not loaded/);
  await page.waitForFunction(() => window.whenScapeStatus?.weather?.kind === 'forecast');
  assert.match(await page.locator('#weather-summary').textContent(), /Rain/);
  assert.equal(await page.locator('#wind-line').isVisible(), true);
  await page.locator('#scene').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  assert.match(await page.locator('#heading').textContent(), /2°/);
  await page.locator('#compass').click();
  assert.match(await page.locator('#heading').textContent(), /0°/);

  const state = { latitude: 34.0967, longitude: -117.7198, location: 'Claremont, California',
    time: '2024-06-21T20:00:00Z', ionToken: '', weatherEnabled: false, reducedMotion: true };
  await page.evaluate(state => window.whenScape.update(state), state);
  assert.equal(await page.locator('#weather-kind').textContent(), 'CLEAR-SKY PREVIEW');
  assert.equal(await page.locator('#wind-line').isVisible(), false);
  assert.ok((await page.evaluate(() => window.whenScapeStatus.sunAltitude)) > 65);

  snow = true;
  state.weatherEnabled = true;
  state.time = '2024-01-21T20:00:00Z';
  await page.evaluate(state => window.whenScape.update(state), state);
  await page.waitForFunction(() => window.whenScapeStatus?.weather?.kind === 'historical');
  assert.match(await page.locator('#weather-summary').textContent(), /Snow/);
  assert.equal(await page.locator('#snow-label').isVisible(), true);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/scene-weather-test.png' });

  state.time = '2035-01-21T20:00:00Z';
  await page.evaluate(state => window.whenScape.update(state), state);
  await page.waitForFunction(() => window.whenScapeStatus?.weather?.kind === 'seasonal');
  assert.equal(await page.evaluate(() => window.whenScapeStatus.weather.renderPrecipitation), false);
  assert.equal(await page.locator('#snow-label').isVisible(), false);
  assert.match(await page.locator('#weather-detail').textContent(), /not a prediction/);

  // Cloud cover must not leave a foreground canvas sheet across the horizon.
  // This uses a new day to avoid the cached precipitation fixture above.
  cloudsOnly = true;
  state.time = '2024-06-22T20:00:00Z';
  await page.evaluate(state => window.whenScape.update(state), state);
  await page.waitForFunction(() => window.whenScapeStatus?.weather?.kind === 'historical');
  assert.match(await page.locator('#weather-summary').textContent(), /Overcast/);
  const foregroundAlpha = await page.evaluate(() => {
    const canvas = document.querySelector('#weather-effects');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let maximum = 0;
    for (let i = 3; i < pixels.length; i += 4) maximum = Math.max(maximum, pixels[i]);
    return maximum;
  });
  assert.equal(foregroundAlpha, 0, 'Clouds must render behind scene geometry, not on the foreground canvas');

  state.time = '2024-06-21T08:00:00Z';
  state.weatherEnabled = false;
  await page.evaluate(state => window.whenScape.update(state), state);
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => window.whenScapeStatus.sunAltitude)) < -18);
  assert.equal(await page.locator('#fatal-message').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: startup, real-data setup state, rotation, compass, daylight/night, clear sky, rain, snow, seasonal mode, no foreground cloud sheet, and no page errors. Weather responses were fixtures.');
} finally { await browser.close(); }

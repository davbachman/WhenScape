// Browser checks of the WhenScape browser app, served by `npm run preview:site`.
// Google Maps is replaced by a small stand-in, weather by fixtures, and every
// other outside request is refused, so no key or network is needed.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const SITE = process.env.SITE_URL || 'http://127.0.0.1:4174/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

// A stand-in for the parts of the Maps JavaScript API the app uses.
const mapsStub = `(() => {
  class LatLng { constructor(a, b) { if (typeof a === 'object') { this._lat = a.lat; this._lng = a.lng; } else { this._lat = a; this._lng = b; } } lat() { return this._lat; } lng() { return this._lng; } }
  class Map {
    constructor(element, options) { this.element = element; this.center = options.center; this.handlers = {}; element.dataset.stub = 'map'; window.__stubMap = this; }
    addListener(name, handler) { this.handlers[name] = handler; return { remove() {} }; }
    panTo(center) { this.center = center; }
    getBounds() { return null; }
  }
  class OverlayView {
    setMap(map) { this.map = map; this.onAdd?.(); this.draw?.(); }
    getPanes() { return { overlayLayer: this.map.element }; }
    getProjection() { return { fromLatLngToDivPixel: () => ({ x: 100, y: 100 }) }; }
  }
  const griffith = { lat: 34.1184, lng: -118.3004 };
  const prediction = { placeId: 'stub-griffith', mainText: { text: 'Griffith Observatory' }, secondaryText: { text: 'Los Angeles, CA' },
    toPlace() { return { async fetchFields() {}, location: new LatLng(griffith), formattedAddress: '2800 E Observatory Rd, Los Angeles, CA 90027' }; } };
  const places = {
    AutocompleteSessionToken: class {},
    AutocompleteSuggestion: { async fetchAutocompleteSuggestions({ input }) { window.__queries = (window.__queries || 0) + 1; return { suggestions: /gri/i.test(input) ? [{ placePrediction: prediction }] : [] }; } },
    Place: class { constructor({ id }) { this.id = id; } async fetchFields() { this.location = new LatLng(griffith); this.formattedAddress = '2800 E Observatory Rd, Los Angeles, CA'; } },
  };
  class Geocoder { async geocode() { return { results: [{ formatted_address: '1 Test Street, Testville, NY 10001, USA' }] }; } }
  const maps = { Map, OverlayView, LatLng, places, Geocoder };
  maps.importLibrary = async name => (name === 'places' ? places : maps);
  window.google = { maps };
  const callback = new URL(document.currentScript.src).searchParams.get('callback');
  setTimeout(() => window[callback]());
})();`;

async function openPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, ...options, permissions: ['clipboard-read', 'clipboard-write'] });
  // A key of the browser's own, so the app loads the (stand-in) map.
  await context.addInitScript(() => { try { localStorage.setItem('whenscape.googleKey', JSON.stringify('test-key')); } catch {} });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
    if (url.hostname === 'maps.googleapis.com' && url.pathname === '/maps/api/js') return route.fulfill({ contentType: 'application/javascript', body: mapsStub });
    if (url.hostname.endsWith('open-meteo.com')) {
      const start = new Date(url.searchParams.get('start_date') + 'T00:00:00Z'), end = new Date(url.searchParams.get('end_date') + 'T23:00:00Z');
      const time = [];
      for (let t = +start; t <= +end; t += 3_600_000) time.push(t / 1000);
      const values = { temperature_2m: 18, cloud_cover: 20, precipitation: 0, rain: 0, showers: 0, snowfall: 0, wind_speed_10m: 3, wind_direction_10m: 250, visibility: 20000, snow_depth: 0, precipitation_probability: 5 };
      const hourly = { time };
      for (const key of url.searchParams.get('hourly').split(',')) hourly[key] = time.map(() => values[key] ?? null);
      return route.fulfill({ json: { hourly }, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return route.abort();
  });
  return { context, page, errors };
}

const state = page => page.evaluate(() => window.whenScapeSite.state);
const near = (a, b, tolerance = 1e-3) => Math.abs(a - b) < tolerance;

try {
  const { context, page, errors } = await openPage();
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.whenScapeSite?.state.sceneReady, null, { timeout: 30_000 });
  await page.waitForSelector('#map[data-stub="map"]');
  assert.equal(await page.locator('#scene-loading').isVisible(), false);

  // Search as you type, then choose a suggestion.
  await page.locator('#search').fill('Griff');
  await page.waitForSelector('#results li[role="option"]');
  assert.match(await page.locator('#results').textContent(), /Griffith Observatory/);
  assert.match(await page.locator('#results').textContent(), /Google Maps/);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.whenScapeSite.state.name === 'Griffith Observatory');
  let now = await state(page);
  assert.ok(near(now.latitude, 34.1184) && near(now.longitude, -118.3004));
  assert.equal(now.timeZone, 'America/Los_Angeles');
  assert.match(await page.locator('#chips').textContent(), /Griffith Observatory/, 'a searched place joins the recent places');
  await page.screenshot({ path: 'artifacts/site-desktop.png' });

  // A map click moves the observer and names the spot.
  await page.evaluate(() => window.__stubMap.handlers.click({ latLng: new google.maps.LatLng(40.7128, -74.006) }));
  await page.waitForFunction(() => window.whenScapeSite.state.name === '1 Test Street, Testville');
  now = await state(page);
  assert.equal(now.timeZone, 'America/New_York');
  assert.match(await page.locator('#zone-label').textContent(), /America\/New_York · UTC−[45]:00/);

  // Save it, then come back to it from a chip.
  await page.locator('#save-place').click();
  await page.locator('#save-name').fill('Gym');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#save-place').evaluate(button => button.classList.contains('active')), true);
  await page.evaluate(() => window.__stubMap.handlers.click({ latLng: new google.maps.LatLng(34.05, -118.25) }));
  await page.waitForFunction(() => window.whenScapeSite.state.timeZone === 'America/Los_Angeles');
  await page.locator('.chip.saved', { hasText: 'Gym' }).click();
  await page.waitForFunction(() => window.whenScapeSite.state.timeZone === 'America/New_York');

  // Keys step the time by a quarter hour, landing on whole quarters.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const before = new Date((await state(page)).instant);
  await page.keyboard.press('ArrowRight');
  const after = new Date((await state(page)).instant);
  assert.ok(after > before && after - before <= 15 * 60_000 && after.getUTCMinutes() % 15 === 0, 'ArrowRight steps to the next quarter hour');
  // The same keys work while the scene has focus: its frame passes them on.
  const scene = page.frameLocator('#scene');
  await scene.locator('#scene').focus();
  await scene.locator('#scene').press('Shift+ArrowRight');
  // The frame's message arrives a moment later.
  await page.waitForFunction(time => window.whenScapeSite.state.instant !== time, after.toISOString(), { timeout: 5000 }).catch(() => {});
  const later = new Date((await state(page)).instant);
  assert.ok(later - after > 0 && later - after <= 60 * 60_000, 'Shift+ArrowRight in the scene steps an hour');

  // The date opens a calendar that stays on screen: the field is near the
  // bottom edge, so it opens above. Arrow keys move through its days without
  // stepping the time, and choosing a day keeps the time of day.
  const wallTime = () => page.evaluate(() => {
    const { instant, timeZone } = window.whenScapeSite.state;
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
  });
  const timeOfDay = await wallTime();
  const dateLabel = await page.locator('#instant-date').textContent();
  await page.locator('#instant-date').click();
  await page.waitForSelector('.calendar:not([hidden])');
  const calendarBox = await page.locator('.calendar').boundingBox();
  const fieldBox = await page.locator('#instant-date').boundingBox();
  assert.ok(calendarBox.y >= 0 && calendarBox.y + calendarBox.height <= 800, 'the calendar stays inside the window');
  assert.ok(calendarBox.y + calendarBox.height <= fieldBox.y, 'near the bottom edge the calendar opens above its field');
  assert.equal(await page.locator('.cal-day.selected').count(), 1);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.calendar').isHidden(), true, 'choosing a day closes the calendar');
  const nextDay = new Date((await state(page)).instant);
  assert.ok(nextDay - later >= 23 * 3_600_000 && nextDay - later <= 25 * 3_600_000, 'the next day was chosen');
  assert.equal(await wallTime(), timeOfDay, 'the time of day is kept');
  assert.notEqual(await page.locator('#instant-date').textContent(), dateLabel);
  // Escape closes it without choosing.
  await page.locator('#instant-date').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.calendar').isHidden(), true);
  assert.equal((await state(page)).instant, nextDay.toISOString());
  // The time field changes only the time.
  const chosenDate = await page.locator('#instant-date').textContent();
  await page.locator('#instant-time').fill('21:15');
  assert.equal(await wallTime(), '21:15');
  assert.equal(await page.locator('#instant-date').textContent(), chosenDate, 'the date stays the same');
  // With a range, the end's calendar shades the days between and will not go before the start.
  await page.locator('#range-toggle').check();
  await page.locator('#end-date').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  now = await state(page);
  assert.ok(new Date(now.end) - new Date(now.start) >= 47 * 3_600_000, 'the range now ends two days later');
  await page.locator('#end-date').click();
  assert.equal(await page.locator('.cal-day.in-range').count(), 3, 'the range is shaded across three days');
  const blockedDays = page.locator('.cal-day[aria-disabled="true"]');
  if (await blockedDays.count()) { // none show when the start is the grid's first day
    await blockedDays.last().click({ force: true }); // Playwright itself declines aria-disabled buttons
    assert.equal(await page.locator('.calendar').isHidden(), false, 'a day before the start cannot be chosen');
    assert.equal((await state(page)).end, now.end);
  }
  await page.keyboard.press('Escape');
  await page.locator('#range-toggle').uncheck();

  // Pasting a copied Calendar event, in the page or in the scene, brings in its time and asks for a place.
  const eventText = 'Office hours\nScheduled: Nov 9, 2026 at 12:00 PM to 1:00 PM, EST\n';
  await page.evaluate(text => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, eventText);
  now = await state(page);
  assert.deepEqual([now.locationRequired, now.rangeEnabled, now.start, now.end, now.event?.title],
    [true, true, '2026-11-09T17:00:00.000Z', '2026-11-09T18:00:00.000Z', 'Office hours']);
  assert.equal(await page.locator('#scene-overlay').isVisible(), true);
  assert.equal(await page.locator('#play').isDisabled(), true);
  await page.locator('#search').fill('Griff');
  await page.waitForSelector('#results li[role="option"]');
  await page.locator('#results li[role="option"]').first().click();
  await page.waitForFunction(() => !window.whenScapeSite.state.locationRequired);
  now = await state(page);
  assert.equal(now.start, '2026-11-09T17:00:00.000Z', 'choosing the place keeps the event’s moment');
  assert.equal(await page.locator('#scene-overlay').isVisible(), false);
  await page.frame({ url: /scene\/index\.html/ }).evaluate(text => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, 'Holiday\nScheduled: Nov 26, 2026');
  await page.waitForFunction(() => window.whenScapeSite.state.event?.allDay === true);
  now = await state(page);
  assert.equal(now.rangeEnabled, false);
  assert.equal(now.instant, '2026-11-26T20:00:00.000Z', 'an all-day event starts at local noon');
  await page.locator('#keep-place').click();
  assert.equal((await state(page)).locationRequired, false);

  // Copy link, then open it fresh: the same place and time come back.
  await page.locator('#copy-link').click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /#at=/);
  now = await state(page);
  const second = await openPage();
  await second.page.goto(link, { waitUntil: 'domcontentloaded' });
  await second.page.waitForFunction(() => window.whenScapeSite?.state.sceneReady, null, { timeout: 30_000 });
  const opened = await state(second.page);
  assert.ok(near(opened.latitude, now.latitude, 1e-4) && near(opened.longitude, now.longitude, 1e-4));
  assert.equal(opened.name, now.name);
  assert.equal(opened.instant, now.instant);
  assert.deepEqual(second.errors, []);
  await second.context.close();

  assert.deepEqual(errors, []);
  await context.close();

  // A phone: one scrolling column with nothing wider than the screen.
  const phone = await openPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await phone.page.waitForFunction(() => window.whenScapeSite?.state.sceneReady, null, { timeout: 30_000 });
  const layout = await phone.page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    scene: document.querySelector('.scene-frame').getBoundingClientRect().height,
    order: ['.scene-frame', '.time', '.location'].map(selector => document.querySelector(selector).getBoundingClientRect().top),
  }));
  assert.ok(layout.overflow <= 0, `no sideways scrolling on a phone (${layout.overflow}px too wide)`);
  assert.ok(layout.scene >= 300, 'the scene keeps a usable height');
  assert.ok(layout.order[0] < layout.order[1] && layout.order[1] < layout.order[2], 'scene, then time, then location');
  await phone.page.screenshot({ path: 'artifacts/site-phone.png', fullPage: true });
  assert.deepEqual(phone.errors, []);
  await phone.context.close();

  console.log('Browser app checks passed: scene in its frame, place search, map clicks with time zones, saved places, time keys in the page and the scene, the calendar and time fields, pasted timed and all-day calendar events, copied links reopening the same moment, and a phone layout. Google Maps was a stand-in and weather was fixtures.');
} finally { await browser.close(); }

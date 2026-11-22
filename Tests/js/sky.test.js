import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAstronomy, planetPositions } from '../../Web/astronomy.js';
import { SHOWERS, solarLongitude, showerZHR, radiantAt, visibleRate, activeShowers, isActive } from '../../Web/meteors.js';
import { meteorPath } from '../../Web/meteorview.js';
import { skyDirection } from '../../Web/skyframe.js';
import { planetSize, planetStrength } from '../../Web/planetview.js';
import { planetsPhrase, showerPhrase, airPhrase, skyPlace } from '../../Web/briefing.js';
import { aqiCategory, airQualityCoverage, parseAirQuality, sampleAt, worstBetween, AirQualityClient, AIR_QUALITY_FROM } from '../../Web/airquality.js';

const claremont = { latitude: 34.0967, longitude: -117.7198 };
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const showersAt = time => {
  const sky = calculateAstronomy({ ...claremont, time });
  return activeShowers({ ...claremont, time, sunAltitude: sky.sun.altitude, moonAltitude: sky.moon.altitude, moonFraction: sky.moonIlluminatedFraction });
};

test('the five naked-eye planets, placed among the stars and in the sky', () => {
  const planets = planetPositions({ ...claremont, time: '2026-11-22T03:00:00Z' });
  assert.deepEqual(planets.map(p => p.name), ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']);
  for (const p of planets) assert.ok(p.ra >= 0 && p.ra < 360 && Math.abs(p.dec) < 30 && Math.abs(p.altitude) <= 90, p.name);
  // Venus always outshines the rest; Saturn spends late 2026 in Pisces.
  const venus = planets.find(p => p.name === 'Venus');
  assert.ok(planets.every(p => p === venus || p.magnitude > venus.magnitude));
  const saturn = planets.find(p => p.name === 'Saturn');
  assert.ok(saturn.ra > 0 && saturn.ra < 30, `Saturn at RA ${saturn.ra}`);
  // Planets keep to the ecliptic: within 8° of the Sun's path.
  for (const p of planets) {
    const d = skyDirection(p.ra, p.dec), tilt = 23.44 * Math.PI / 180;
    const latitude = Math.asin(d.z * Math.cos(tilt) - d.y * Math.sin(tilt)) * 180 / Math.PI;
    assert.ok(Math.abs(latitude) < 8, `${p.name} is ${latitude.toFixed(1)}° off the ecliptic`);
  }
  assert.ok(planetSize(-4.5) > planetSize(0) && planetSize(0) > planetSize(1.5) && planetSize(-6) <= 9 && planetSize(5) >= 3);
  assert.ok(planetStrength(-20) === 1 && planetStrength(30) < 0.4);
});

test('meteor showers follow the Sun round the year', () => {
  // The March equinox of 2026 is at 14:46 UTC on the 20th; the IMO's longitudes are J2000, 0.4° behind.
  assert.ok(near(solarLongitude('2026-03-20T14:46:00Z'), 359.64, 0.05));
  const perseids = SHOWERS.find(s => s.name === 'Perseids');
  assert.equal(showerZHR(perseids, perseids.peak), 100);
  assert.ok(showerZHR(perseids, perseids.peak - 2) > showerZHR(perseids, perseids.peak + 2), 'Perseids rise slowly and fall fast');
  assert.equal(showerZHR(perseids, 200), 0);
  // The Quadrantids' active days run over the new year.
  const quadrantids = SHOWERS.find(s => s.name === 'Quadrantids');
  assert.ok(isActive(quadrantids, 280) && isActive(quadrantids, 290) && !isActive(quadrantids, 300));
  const early = radiantAt(perseids, perseids.peak - 5);
  assert.ok(near(early.ra, 48 - 6.75, 0.01) && early.dec < 58);
});

test('what a person would see of a shower', () => {
  const base = { zhr: 100, r: 2.2, radiantAltitude: 90, sunAltitude: -30, moonAltitude: -10, moonFraction: 0 };
  assert.equal(visibleRate(base), 100);
  assert.ok(near(visibleRate({ ...base, radiantAltitude: 30 }), 50, 1e-9));
  assert.equal(visibleRate({ ...base, radiantAltitude: -5 }), 0);
  assert.equal(visibleRate({ ...base, sunAltitude: -8 }), 0);
  assert.ok(visibleRate({ ...base, moonAltitude: 40, moonFraction: 1 }) < 30, 'a high full Moon hides most of them');
  assert.ok(visibleRate({ ...base, sunAltitude: -15 }) < visibleRate(base));
});

test('the showers active on a few nights in Claremont', () => {
  // Perseids at their best: before dawn on 13 August 2026, with a new Moon.
  const [perseids] = showersAt('2026-08-13T10:00:00Z');
  assert.equal(perseids.name, 'Perseids');
  assert.ok(perseids.rate > 40 && perseids.altitude > 30, `${perseids.rate} an hour`);
  assert.ok(near(perseids.peak, Date.parse('2026-08-13T01:00:00Z'), 12 * 3_600_000));
  // Geminids peak on the 14th of December, not a week before.
  assert.equal(showersAt('2026-12-14T09:00:00Z')[0].name, 'Geminids');
  assert.ok(!showersAt('2026-12-07T09:00:00Z').some(s => s.name === 'Geminids'));
  // Nothing much in mid-June.
  assert.deepEqual(showersAt('2026-06-15T08:00:00Z'), []);
  // By day the shower is listed, but none are seen.
  assert.equal(showersAt('2026-08-12T20:00:00Z')[0].rate, 0);
});

test('a meteor moves away from its radiant', () => {
  const radiant = skyDirection(48, 58), start = skyDirection(80, 30);
  const path = meteorPath(start, radiant, 59, 0.5);
  const toRadiant = { x: radiant.x - start.x, y: radiant.y - start.y, z: radiant.z - start.z };
  assert.ok(path.toward.x * toRadiant.x + path.toward.y * toRadiant.y + path.toward.z * toRadiant.z < 0);
  assert.ok(near(Math.hypot(path.toward.x, path.toward.y, path.toward.z), 1, 1e-9));
  assert.ok(path.length > 0 && path.duration >= 0.25 && path.duration <= 1.2);
  assert.ok(meteorPath(start, radiant, 71, 0.5).duration < meteorPath(start, radiant, 20, 0.5).duration, 'fast showers make quick streaks');
});

test('sky phrases for the conditions', () => {
  const planets = [{ name: 'Saturn', altitude: 52, azimuth: 146, magnitude: 0.5 }, { name: 'Venus', altitude: 12, azimuth: 250, magnitude: -4.2 },
    { name: 'Mars', altitude: -10, azimuth: 30, magnitude: 1 }];
  assert.equal(planetsPhrase(planets, -20), 'Venus W 12° · Saturn SE 52°');
  assert.equal(planetsPhrase(planets, 10), null);
  assert.equal(planetsPhrase([planets[2]], -20), 'none up');
  const shower = { name: 'Perseids', rate: 54.6, altitude: 47, peak: Date.parse('2026-08-13T01:00:00Z') };
  assert.equal(showerPhrase(shower, { dark: true, now: 0 }), 'Perseids: about 55 an hour');
  assert.equal(showerPhrase(shower, { dark: true, now: 0, cloudy: true }), 'Perseids: about 55 an hour if clear');
  assert.equal(showerPhrase({ ...shower, altitude: -3 }, { dark: true, now: 0 }), 'Perseids: radiant below the horizon');
  assert.equal(showerPhrase(shower, { dark: false, peakLabel: 'Aug 12', now: Date.parse('2026-08-10T20:00:00Z') }), 'Perseids peak Aug 12');
  assert.equal(showerPhrase(shower, { dark: false, peakLabel: 'Aug 12', now: Date.parse('2026-08-12T20:00:00Z') }), 'Perseids at their peak');
  assert.equal(skyPlace(22.4, 91), '22° up in the east');
  assert.equal(airPhrase({ aqi: 42 }, aqiCategory(42), false), 'Air quality Good · AQI 42');
  assert.equal(airPhrase({ aqi: 120 }, aqiCategory(120), true), 'Air quality up to Unhealthy for sensitive groups · AQI 120');
});

test('air quality: categories, coverage and samples', () => {
  assert.deepEqual([0, 50, 51, 100, 101, 151, 201, 301].map(v => aqiCategory(v).name),
    ['Good', 'Good', 'Moderate', 'Moderate', 'Unhealthy for sensitive groups', 'Unhealthy', 'Very unhealthy', 'Hazardous']);
  assert.equal(aqiCategory(null), null);
  const now = Date.parse('2026-11-21T12:00:00Z');
  assert.equal(airQualityCoverage(now + 3 * 86_400_000, now), 'available');
  assert.equal(airQualityCoverage(now + 9 * 86_400_000, now), 'too-far-ahead');
  assert.equal(airQualityCoverage(Date.parse('2021-06-01T00:00:00Z'), now), 'too-early');

  const hour = Date.parse('2026-11-21T00:00:00Z') / 1000;
  const samples = parseAirQuality({ hourly: {
    time: [hour, hour + 3600, hour + 7200, hour + 10800],
    us_aqi: [40, null, 72, 55], us_aqi_pm2_5: [40, null, 30, 55], us_aqi_ozone: [20, null, 72, 10],
    pm2_5: [9.1, null, 6, 13], ozone: [50, null, 140, 30],
  } });
  assert.equal(samples.length, 3, 'hours without an index are left out');
  assert.deepEqual(samples.map(s => s.pollutant), ['fine particles (PM2.5)', 'ozone', 'fine particles (PM2.5)']);
  assert.equal(sampleAt(samples, (hour + 3000) * 1000).aqi, 40);
  assert.equal(sampleAt(samples, (hour + 20 * 3600) * 1000), null, 'nothing within three hours');
  assert.equal(worstBetween(samples, hour * 1000, (hour + 10800) * 1000).aqi, 72);
  assert.deepEqual(parseAirQuality({}), []);
});

test('the air quality client asks once for each place and set of days', async () => {
  const asked = [];
  const client = new AirQualityClient(async url => {
    asked.push(new URL(url));
    return { ok: true, json: async () => ({ hourly: { time: [Date.parse('2026-11-21T06:00:00Z') / 1000], us_aqi: [61], us_aqi_ozone: [61] } }) };
  });
  const request = { latitude: 34.0967, longitude: -117.7198, start: Date.parse('2026-11-21T03:00:00Z'), end: Date.parse('2026-11-21T09:00:00Z'), now: Date.parse('2026-11-21T00:00:00Z') };
  const samples = await client.getSamples(request);
  await client.getSamples(request);
  assert.equal(asked.length, 1);
  assert.equal(samples[0].aqi, 61);
  const params = asked[0].searchParams;
  assert.equal(asked[0].hostname, 'air-quality-api.open-meteo.com');
  assert.deepEqual([params.get('start_date'), params.get('end_date'), params.get('timezone')], ['2026-11-21', '2026-11-21', 'GMT']);
  assert.match(params.get('hourly'), /^us_aqi,/);
  // Before the service's records begin there is nothing to ask.
  assert.deepEqual(await client.getSamples({ ...request, start: Date.parse('2021-01-01'), end: Date.parse('2021-01-02') }), []);
  assert.equal(asked.length, 1);
  assert.ok(AIR_QUALITY_FROM === Date.UTC(2022, 7, 1));
  // A failed request is not kept, so the next attempt asks again.
  const failing = new AirQualityClient(async () => ({ ok: false, status: 503 }));
  await assert.rejects(failing.getSamples(request), /503/);
  await assert.rejects(failing.getSamples(request), /503/);
});

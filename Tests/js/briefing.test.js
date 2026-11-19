import test from 'node:test';
import assert from 'node:assert/strict';
import { unitsFor, formatTemperature, formatSpeed, windReadout, notableGust, durationPhrase, sunPhrase, summaryLine } from '../../Web/briefing.js';

const us = unitsFor('en-US'), metric = unitsFor('de-DE');
const minute = 60000, hour = 60 * minute;

test('units follow the locale\'s region', () => {
  assert.deepEqual(us, { temperature: 'F', speed: 'mph' });
  assert.deepEqual(unitsFor('en-GB'), { temperature: 'C', speed: 'mph' });
  assert.deepEqual(metric, { temperature: 'C', speed: 'km/h' });
  assert.deepEqual(unitsFor('not a locale'), { temperature: 'C', speed: 'km/h' });
  assert.equal(formatTemperature(16.7, us), '62°');
  assert.equal(formatTemperature(16.7, metric), '17°');
  assert.equal(formatTemperature(null, us), null);
  assert.equal(formatSpeed(5.36, us), '12 mph');
  assert.equal(formatSpeed(5, metric), '18 km/h');
});

test('wind readout names direction, speed and only notable gusts', () => {
  assert.equal(windReadout({ windSpeed: 5.36, windDirection: 270, windGust: 6 }, us), 'Wind W 12 mph');
  assert.equal(windReadout({ windSpeed: 5.36, windDirection: 270, windGust: 11.2 }, us), 'Wind W 12 mph · gusts 25 mph');
  assert.equal(windReadout({ windSpeed: 0.1, windDirection: 90 }, us), 'Calm');
  assert.equal(windReadout({ windSpeed: 3, windDirection: null }, metric), 'Wind 11 km/h');
  assert.equal(windReadout({ windSpeed: null }, us), null);
  assert.equal(notableGust({ windSpeed: 2, windGust: 5 }), null, 'a weak gust is not worth mentioning');
});

test('durations read naturally', () => {
  assert.equal(durationPhrase(40 * minute), '40 minutes');
  assert.equal(durationPhrase(minute), '1 minute');
  assert.equal(durationPhrase(hour), '1 hour');
  assert.equal(durationPhrase(2 * hour + 10 * minute), '2 h 10 min');
});

test('the Sun phrase reports what happens during an event', () => {
  const start = 1000 * hour, end = start + 2 * hour;
  const event = { time: start, start, end, rangeEnabled: true };
  assert.equal(sunPhrase({ ...event, sunrise: start - 9 * hour, sunset: start + 40 * minute, sunUpAtStart: true }), 'sunset 40 minutes into the event');
  assert.equal(sunPhrase({ ...event, sunrise: start + hour, sunset: start + 11 * hour, sunUpAtStart: false }), 'sunrise 1 hour into the event');
  assert.equal(sunPhrase({ ...event, sunrise: start - 3 * hour, sunset: start + 5 * hour, sunUpAtStart: true }), 'daylight throughout');
  assert.equal(sunPhrase({ ...event, sunrise: start - 14 * hour, sunset: start - 3 * hour, sunUpAtStart: false }), 'dark throughout');
  assert.equal(sunPhrase({ time: start, rangeEnabled: false, sunset: start + 130 * minute, sunUp: true }), 'sunset in 2 h 10 min');
  assert.equal(sunPhrase({ time: start, rangeEnabled: false, sunrise: start + 30 * minute, sunset: start + 11 * hour, sunUp: false }), 'sunrise in 30 minutes');
  assert.equal(sunPhrase({ time: start, rangeEnabled: false, sunrise: start - 12 * hour, sunset: start - hour, sunUp: false }), 'after dark');
});

test('the summary is one sentence', () => {
  const weather = { kind: 'forecast', cloudCover: 45, temperature: 16.7, windSpeed: 3, windDirection: 270, renderPrecipitation: true, rain: 0, snowfall: 0 };
  const start = 1000 * hour;
  const sun = { time: start, start, end: start + 2 * hour, rangeEnabled: true, sunset: start + 40 * minute, sunUpAtStart: true };
  assert.equal(summaryLine({ weather, units: us, sun }), 'Partly cloudy, 62°, light west wind; sunset 40 minutes into the event.');
  assert.equal(summaryLine({ weather: { ...weather, kind: 'seasonal', renderPrecipitation: false }, units: metric, sun: null }), 'Typically partly cloudy, 17°, light west wind.');
  assert.equal(summaryLine({ weather: { kind: 'missing' }, units: us, sun: { time: start, rangeEnabled: false, sunset: start + hour, sunUp: true } }), 'Sunset in 1 hour.');
  assert.equal(summaryLine({ weather: { kind: 'missing' }, units: us, sun: null }), '');
  assert.match(summaryLine({ weather: { ...weather, windSpeed: 9, windGust: 15 }, units: us, sun: null }), /strong west wind gusting 34 mph\.$/);
});

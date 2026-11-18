import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateAstronomy, phaseName, compassName } from '../../Web/astronomy.js';

const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) < tolerance,
  `Expected ${actual} within ${tolerance} of ${expected}`);

test('March equinox solar noon is close to zenith on the equator', () => {
  // Equinox geometry: declination is near zero and apparent noon at Greenwich
  // is about 12:07 UTC because of the equation of time.
  const result = calculateAstronomy({ latitude: 0, longitude: 0, time: '2024-03-20T12:07:00Z' });
  close(result.sun.altitude, 90, 0.3);
  assert.equal(result.light, 'Daylight');
});

test('Greenwich equinox solar noon elevation and direction agree with geographic geometry', () => {
  const result = calculateAstronomy({ latitude: 51.4779, longitude: 0, time: '2024-03-20T12:07:00Z' });
  close(result.sun.altitude, 90 - 51.4779, 0.3);
  close(result.sun.azimuth, 180, 1);
});

test('June solstice midday at the equator reflects Earth axial tilt', () => {
  const result = calculateAstronomy({ latitude: 0, longitude: 0, time: '2024-06-20T12:02:00Z' });
  close(result.sun.altitude, 66.56, 0.25);
  close(Math.min(result.sun.azimuth, 360 - result.sun.azimuth), 0, 1);
});

test('Arctic midsummer midnight remains daylight', () => {
  const result = calculateAstronomy({ latitude: 78.2232, longitude: 15.6469, time: '2024-06-21T23:00:00Z' });
  assert.ok(result.sun.altitude > 10);
  assert.equal(result.light, 'Daylight');
});

test('2024 April total solar eclipse has a nearly new Moon', () => {
  const result = calculateAstronomy({ latitude: 32.7767, longitude: -96.7970, time: '2024-04-08T18:42:00Z' });
  assert.ok(result.moonIlluminatedFraction < 0.001);
  assert.equal(result.moonPhaseName, 'New Moon');
  close(result.sun.altitude, result.moon.altitude, 0.5);
  close(result.sun.azimuth, result.moon.azimuth, 0.5);
});

test('March 2024 lunar eclipse has a full Moon', () => {
  const result = calculateAstronomy({ latitude: 34.0967, longitude: -117.7198, time: '2024-03-25T07:00:00Z' });
  assert.ok(result.moonIlluminatedFraction > 0.999);
  assert.equal(result.moonPhaseName, 'Full Moon');
  assert.equal(result.light, 'Night');
});

test('timezone offsets resolve to the same astronomical instant across DST', () => {
  const one = calculateAstronomy({ latitude: 34.0967, longitude: -117.7198, time: '2024-11-03T01:30:00-07:00' });
  const two = calculateAstronomy({ latitude: 34.0967, longitude: -117.7198, time: '2024-11-03T08:30:00Z' });
  assert.deepEqual(one, two);
  const repeated = calculateAstronomy({ latitude: 34.0967, longitude: -117.7198, time: '2024-11-03T01:30:00-08:00' });
  assert.notEqual(one.sun.altitude, repeated.sun.altitude);
});

test('invalid coordinates and date are rejected', () => {
  for (const state of [{ latitude: 91, longitude: 0, time: new Date() },
    { latitude: 0, longitude: 181, time: new Date() },
    { latitude: 0, longitude: 0, time: 'invalid' }]) {
    assert.throws(() => calculateAstronomy(state), RangeError);
  }
});

test('phase and compass labels wrap correctly', () => {
  assert.equal(phaseName(360), 'New Moon');
  assert.equal(phaseName(-90), 'Last quarter');
  assert.equal(compassName(360), 'N');
  assert.equal(compassName(-90), 'W');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { meshLight, horizonColor, meshTone } from '../../Web/meshlook.js';

const close = (actual, expected, tolerance = 1e-9) =>
  expected.forEach((value, i) => assert.ok(Math.abs(actual[i] - value) <= tolerance, `${actual} ≈ ${expected}`));

test('the mesh is shown as photographed in clear daylight and dark blue at night', () => {
  close(meshLight(45, 0), [1, 1, 1]);
  close(meshLight(-30, 0), [0.03, 0.04, 0.075]);
});

test('low sun warms the light and cloud dims it', () => {
  const [red, , blue] = meshLight(2, 0);
  assert.ok(red > blue, 'sunset light is warmer than it is blue');
  assert.ok(meshLight(45, 1)[1] < meshLight(45, 0)[1], 'overcast daylight is dimmer');
});

test('the horizon colour runs from night to day sky, greyer under heavy cloud', () => {
  const night = horizonColor(-30, 0), day = horizonColor(45, 0), overcast = horizonColor(45, 1);
  assert.ok(day[2] > night[2]);
  assert.ok(Math.abs(overcast[0] - overcast[2]) < Math.abs(day[0] - day[2]), 'overcast is less blue than clear sky');
});

test('the mesh tone reflects visibility, rain, snow, cloud and night', () => {
  const clear = meshTone({ sunAltitude: 45 });
  assert.equal(clear.wet, 0);
  assert.equal(clear.snow, 0);
  assert.equal(clear.glow, 0);
  assert.equal(clear.hazeDensity, 1 / 18000);
  const stormy = meshTone({ sunAltitude: 45, clouds: 1, visibility: 160, precipitation: 6, snowDepth: 0.1 });
  assert.equal(stormy.wet, 1);
  assert.equal(stormy.snow, 0.7);
  assert.equal(stormy.hazeDensity, 1 / 120, 'fog is capped');
  assert.ok(stormy.cloudShadow < 1e-9, 'no direct sun under full cloud');
  assert.ok(meshTone({ sunAltitude: -30 }).glow > 0);
});

test('a bright Moon lifts the night light a little', () => {
  const dark = meshTone({ sunAltitude: -30 }).light;
  const moonlit = meshTone({ sunAltitude: -30, moonAltitude: 40, moonFraction: 1 }).light;
  assert.ok(moonlit[2] > dark[2]);
  assert.deepEqual(meshTone({ sunAltitude: -30, moonAltitude: -5, moonFraction: 1 }).light, dark);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { flagExtension, flagShape, shadowOffset, flagShadow } from '../../Web/flag.js';

const tip = shape => shape[shape.length - 1];

test('the flag streams downwind, opposite the direction the wind comes from', () => {
  const west = tip(flagShape({ height: 20, windSpeed: 9, windFrom: 270 }));
  assert.ok(west.e > 7 && Math.abs(west.n) < 1.5, 'wind from the west blows the flag east');
  const north = tip(flagShape({ height: 20, windSpeed: 9, windFrom: 0 }));
  assert.ok(north.n < -7 && Math.abs(north.e) < 1.5, 'wind from the north blows the flag south');
});

test('the flag hangs when calm or when the wind is unknown', () => {
  for (const wind of [{ windSpeed: 0, windFrom: 90 }, { windSpeed: null, windFrom: null }, { windSpeed: 6, windFrom: null }]) {
    assert.equal(flagExtension(wind.windSpeed, wind.windFrom), 0);
    const end = tip(flagShape({ height: 20, ...wind }));
    assert.ok(Math.hypot(end.e, end.n) < 1.5, 'cloth stays near the pole');
    assert.ok(end.top < 14 && end.bottom > 0, 'cloth droops but stays above the ground');
  }
  assert.ok(flagExtension(4, 90) > 0.3 && flagExtension(4, 90) < flagExtension(12, 90));
});

test('shadows fall away from the Sun and lengthen as it sinks', () => {
  const noon = shadowOffset(10, 45, 180);
  assert.ok(Math.abs(noon.n - 10) < 1e-9 && Math.abs(noon.e) < 1e-9, 'Sun in the south casts a shadow north');
  const evening = shadowOffset(10, 10, 270);
  assert.ok(evening.e > 50 && Math.abs(evening.n) < 1e-6, 'low Sun in the west casts a long shadow east');
  assert.ok(Math.hypot(...Object.values(shadowOffset(10, 0.1, 270))) <= 80 + 1e-9, 'capped near the horizon');
});

test('the cloth shadow is a closed outline displaced from the pole', () => {
  const outline = flagShadow({ height: 20, windSpeed: 8, windFrom: 270, sunAltitude: 45, sunAzimuth: 180 });
  assert.equal(outline.length, 14);
  assert.ok(outline.every(p => p.n > 4), 'every corner lies north of the pole');
});

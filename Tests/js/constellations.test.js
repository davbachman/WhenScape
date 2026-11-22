import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSTELLATIONS } from '../../Web/constellations.js';
import { skyDirection, constellationStrength } from '../../Web/constellationview.js';

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

test('all 88 constellations are there, with figures in range', () => {
  const names = CONSTELLATIONS.map(([name]) => name);
  // Serpens comes in two parts, on either side of Ophiuchus.
  assert.equal(names.length, 89);
  assert.ok(names.includes('Serpens Caput') && names.includes('Serpens Cauda'));
  assert.equal(new Set(names.map(name => name.replace(/ (Caput|Cauda)$/, ''))).size, 88);
  for (const [name, ra, dec, figure] of CONSTELLATIONS) {
    assert.ok(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90, `${name}'s label is in range`);
    assert.ok(figure.length > 0, `${name} has lines`);
    for (const line of figure) {
      assert.ok(line.length >= 4 && line.length % 2 === 0, `${name}'s lines join pairs of stars`);
      for (let i = 0; i < line.length; i += 2) assert.ok(line[i] >= 0 && line[i] < 360 && Math.abs(line[i + 1]) <= 90);
    }
  }
});

test('the figures pass through the stars they are named for', () => {
  const stars = name => CONSTELLATIONS.find(([n]) => n === name)[3].flatMap(line => line.flatMap((v, i) => (i % 2 ? [] : [[v, line[i + 1]]])));
  const has = (name, ra, dec) => stars(name).some(([r, d]) => near(r, ra, 0.05) && near(d, dec, 0.05));
  assert.ok(has('Orion', 88.79, 7.41), 'Betelgeuse');
  assert.ok(has('Orion', 78.63, -8.2), 'Rigel');
  assert.ok(has('Lyra', 279.23, 38.78), 'Vega');
  assert.ok(has('Ursa Minor', 37.95, 89.26), 'Polaris');
});

test('sky directions and line strength', () => {
  const pole = skyDirection(0, 90), equinox = skyDirection(0, 0), solstice = skyDirection(90, 0);
  assert.ok(near(pole.z, 1, 1e-12) && near(equinox.x, 1, 1e-12) && near(solstice.y, 1, 1e-12));
  // Softer at night, when the painted sky brightens them, than by day.
  assert.ok(constellationStrength(-30) < constellationStrength(-5) && constellationStrength(-5) < constellationStrength(40));
  assert.equal(constellationStrength(-30), constellationStrength(-60));
});

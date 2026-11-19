import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineMarkup } from '../../Web/timeline.js';

const hour = 3600000, start = 1000 * hour, end = start + 4 * hour;
const series = [0, 1, 2, 3].map(i => ({ time: start + i * hour, temperature: 10 + i * 2, cloudCover: 50, precipitationProbability: i === 2 ? 80 : 0 }));
const base = { start, end, now: start + hour, series, sunAltitude: t => t < start + 2 * hour ? 20 : -20,
  sunEvents: [{ time: start + 2 * hour, label: 'Sunset 4:44 pm' }], formatTemperature: c => `${Math.round(c)}°` };

test('the timeline draws temperature, rain chance, sunset and the cursor', () => {
  const svg = timelineMarkup(base);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<polyline points="/);
  assert.match(svg, />16°</, 'highest temperature is labelled');
  assert.match(svg, />10°</, 'lowest temperature is labelled');
  assert.equal((svg.match(/rgba\(110,180,255/g) ?? []).length, 1, 'one rain bar, for the wet hour');
  assert.match(svg, /Sunset 4:44 pm/);
  assert.match(svg, /class="now"/);
  assert.ok(svg.includes('rgba(120,170,230') && svg.includes('rgba(8,13,30'), 'day and night shading both appear');
});

test('the timeline tolerates missing data and bad intervals', () => {
  const empty = timelineMarkup({ ...base, series: [], now: end + hour, sunEvents: [{ time: end + hour, label: 'Sunrise' }] });
  assert.ok(!empty.includes('<polyline') && !empty.includes('class="now"') && !empty.includes('Sunrise'));
  assert.equal(timelineMarkup({ ...base, end: start }), '');
  assert.ok(!timelineMarkup({ ...base, sunEvents: [{ time: start + hour, label: '<b>"x"</b>' }] }).includes('<b>'), 'labels cannot inject markup');
});

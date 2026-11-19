import test from 'node:test';
import assert from 'node:assert/strict';
import { sunTrack } from '../../Web/astronomy.js';
import { domePoint, ringPoints, daylightRuns, hourMarks, clockLabel } from '../../Web/guides.js';

const claremont = { latitude: 34.1, longitude: -117.728 };

test('dome points follow compass directions and height', () => {
  const east = domePoint(0, 90, 10), overhead = domePoint(90, 0, 10), south = domePoint(30, 180, 10);
  assert.ok(Math.abs(east.e - 10) < 1e-9 && Math.abs(east.n) < 1e-9 && Math.abs(east.up) < 1e-9);
  assert.ok(Math.abs(overhead.up - 10) < 1e-9 && Math.hypot(overhead.e, overhead.n) < 1e-9);
  assert.ok(south.n < -8.6 && Math.abs(south.up - 5) < 1e-9);
  const ring = ringPoints(10, 8);
  assert.equal(ring.length, 9);
  assert.ok(ring.every(p => Math.abs(Math.hypot(p.e, p.n) - 10) < 1e-9 && Math.abs(p.up) < 1e-9));
});

test('the Sun track covers one solar day with a single stretch of daylight', () => {
  const track = sunTrack({ ...claremont, time: '2026-11-19T20:00:00Z' });
  assert.equal(track.end - track.start, 86400000);
  assert.ok(track.start <= Date.parse('2026-11-19T20:00:00Z') && track.end > Date.parse('2026-11-19T20:00:00Z'));
  const runs = daylightRuns(track.samples);
  assert.equal(runs.length, 1);
  // Mid-November in Claremont: sunrise near 6:25 am PST in the east-south-east, sunset near 4:45 pm in the west-south-west.
  assert.ok(Math.abs(track.sunrise.time - Date.parse('2026-11-19T14:25:00Z')) < 6 * 60000, new Date(track.sunrise.time).toISOString());
  assert.ok(Math.abs(track.sunset.time - Date.parse('2026-11-20T00:45:00Z')) < 6 * 60000, new Date(track.sunset.time).toISOString());
  assert.ok(track.sunrise.azimuth > 105 && track.sunrise.azimuth < 120);
  assert.ok(track.sunset.azimuth > 240 && track.sunset.azimuth < 255);
  const highest = Math.max(...track.samples.map(s => s.altitude));
  assert.ok(highest > 35 && highest < 38, String(highest));
});

test('daylight runs can be limited to an event', () => {
  const track = sunTrack({ ...claremont, time: '2026-11-19T20:00:00Z' });
  const [run] = daylightRuns(track.samples, Date.parse('2026-11-19T23:00:00Z'), Date.parse('2026-11-20T02:00:00Z'));
  assert.ok(run[0].time >= Date.parse('2026-11-19T23:00:00Z'));
  assert.ok(run[run.length - 1].time <= track.sunset.time, 'the highlight stops at sunset');
});

test('hour marks and clock labels use the place\'s civil time', () => {
  const marks = hourMarks(Date.parse('2026-11-19T14:10:00Z'), Date.parse('2026-11-19T21:10:00Z'), 'America/Los_Angeles');
  assert.deepEqual(marks.map(m => m.label), ['7 am', '8 am', '9 am', '10 am', '11 am', 'noon', '1 pm']);
  assert.equal(marks[0].time, Date.parse('2026-11-19T15:00:00Z'));
  const india = hourMarks(Date.parse('2026-11-19T00:00:00Z'), Date.parse('2026-11-19T01:00:00Z'), 'Asia/Kolkata');
  assert.deepEqual(india.map(m => [m.label, new Date(m.time).toISOString().slice(11, 16)]), [['6 am', '00:30']]);
  assert.equal(clockLabel(Date.parse('2026-11-19T14:24:00Z'), 'America/Los_Angeles'), '6:24 am');
});

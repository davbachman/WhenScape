import test from 'node:test';
import assert from 'node:assert/strict';
import { fromWall, toInputValue, fromInputValue, toTimeValue, withCivilDate, withWallTime, dayInterval, stepped, advancing, zoneLabel, noonOn, wallParts } from '../../Site/time.js';
import { monthGrid, shiftDays, shiftMonths, compareDates } from '../../Site/calendar.js';
import { clockStyle, withPart, timeValue, parseTimeValue } from '../../Site/timepicker.js';
import { parseCalendarText } from '../../Site/paste.js';
import { encodeLink, decodeLink } from '../../Site/link.js';
import { PlaceBook, expire, KEEP_FOR, needsLookup } from '../../Site/places.js';

const LA = 'America/Los_Angeles';

test('wall times convert both ways in a zone', () => {
  const instant = fromWall({ year: 2026, month: 11, day: 20, hour: 15, minute: 30 }, LA);
  assert.equal(instant.toISOString(), '2026-11-20T23:30:00.000Z');
  assert.equal(toInputValue(instant, LA), '2026-11-20T15:30');
  assert.equal(fromInputValue('2026-07-04T09:05', LA).toISOString(), '2026-07-04T16:05:00.000Z');
  assert.equal(fromInputValue('not a time', LA), null);
});

test('a date and a time can be changed separately', () => {
  const instant = fromWall({ year: 2026, month: 11, day: 20, hour: 15, minute: 30 }, LA);
  assert.equal(toTimeValue(instant, LA), '15:30');
  assert.equal(toInputValue(withCivilDate(instant, { year: 2027, month: 1, day: 2 }, LA), LA), '2027-01-02T15:30');
  assert.equal(toInputValue(withWallTime(instant, '07:05', LA), LA), '2026-11-20T07:05');
  assert.equal(withWallTime(instant, '', LA), null);
  assert.equal(withWallTime(instant, '25:00', LA), null);
  // Moving 2:30 AM onto the spring-forward day lands just after the gap.
  const early = fromWall({ year: 2026, month: 3, day: 7, hour: 2, minute: 30 }, LA);
  assert.equal(toInputValue(withCivilDate(early, { year: 2026, month: 3, day: 8 }, LA), LA), '2026-03-08T03:30');
});

test('the calendar shows whole weeks and steps by day and month', () => {
  // November 2026 starts on a Sunday; with Sunday first it needs five rows, padded to six.
  const sunday = monthGrid(2026, 11, 7);
  assert.equal(sunday.length, 42);
  assert.deepEqual(sunday[0], { year: 2026, month: 11, day: 1 });
  assert.deepEqual(sunday[41], { year: 2026, month: 12, day: 12 });
  // With Monday first, the grid starts on Monday 26 October.
  assert.deepEqual(monthGrid(2026, 11, 1)[0], { year: 2026, month: 10, day: 26 });
  assert.deepEqual(shiftDays({ year: 2026, month: 12, day: 31 }, 1), { year: 2027, month: 1, day: 1 });
  assert.deepEqual(shiftDays({ year: 2028, month: 3, day: 1 }, -1), { year: 2028, month: 2, day: 29 });
  assert.deepEqual(shiftMonths({ year: 2026, month: 1, day: 31 }, 1), { year: 2026, month: 2, day: 28 });
  assert.deepEqual(shiftMonths({ year: 2026, month: 1, day: 15 }, -13), { year: 2024, month: 12, day: 15 });
  assert.ok(compareDates({ year: 2026, month: 2, day: 1 }, { year: 2026, month: 1, day: 31 }) > 0);
  assert.equal(compareDates({ year: 2026, month: 2, day: 1 }, { year: 2026, month: 2, day: 1 }), 0);
});

test('the time picker follows the reader’s clock and changes one column at a time', () => {
  const us = clockStyle('en-US');
  assert.deepEqual(us, { twelve: true, zeroHour: 12, padHour: false, periods: ['AM', 'PM'], periodFirst: false });
  const uk = clockStyle('en-GB');
  assert.deepEqual([uk.twelve, uk.padHour, uk.periods], [false, true, null]);
  const korean = clockStyle('ko-KR');
  assert.deepEqual([korean.twelve, korean.periodFirst], [true, true], 'Korean puts 오전/오후 before the hour');

  const evening = { hour: 21, minute: 15 };
  assert.deepEqual(withPart(evening, 'hour', 7, true), { hour: 19, minute: 15 }, '7 on a 12-hour clock keeps PM');
  assert.deepEqual(withPart(evening, 'hour', 0, true), { hour: 12, minute: 15 }, '12 PM is noon');
  assert.deepEqual(withPart(evening, 'period', 0, true), { hour: 9, minute: 15 });
  assert.deepEqual(withPart({ hour: 0, minute: 5 }, 'period', 1, true), { hour: 12, minute: 5 }, 'midnight becomes noon');
  assert.deepEqual(withPart(evening, 'hour', 7, false), { hour: 7, minute: 15 });
  assert.deepEqual(withPart(evening, 'minute', 40, true), { hour: 21, minute: 40 });

  assert.equal(timeValue({ hour: 7, minute: 5 }), '07:05');
  assert.deepEqual(parseTimeValue('21:15'), { hour: 21, minute: 15 });
  assert.deepEqual(parseTimeValue('07:05:30'), { hour: 7, minute: 5 });
  assert.equal(parseTimeValue('24:00'), null);
  assert.equal(parseTimeValue(''), null);
});

test('daylight saving gaps and repeats resolve sensibly', () => {
  // 2:30 AM does not exist on 8 March 2026 in Los Angeles; it lands after the gap.
  assert.equal(toInputValue(fromWall({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, LA), LA), '2026-03-08T03:30');
  // 1:30 AM happens twice on 1 November 2026; the first pass (PDT) is chosen.
  assert.equal(fromWall({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, LA).toISOString(), '2026-11-01T08:30:00.000Z');
});

test('local days, noon and the zone label follow the place', () => {
  const instant = new Date('2026-11-21T06:30:00Z'); // 10:30 PM on the 20th in Los Angeles
  const day = dayInterval(instant, LA);
  assert.equal(day.start.toISOString(), '2026-11-20T08:00:00.000Z');
  assert.equal(day.end.toISOString(), '2026-11-21T08:00:00.000Z');
  assert.equal(dayInterval(new Date('2026-03-08T12:00:00Z'), LA).end - dayInterval(new Date('2026-03-08T12:00:00Z'), LA).start, 23 * 3_600_000);
  assert.equal(noonOn({ year: 2026, month: 6, day: 1 }, 'Asia/Kolkata').toISOString(), '2026-06-01T06:30:00.000Z');
  assert.equal(zoneLabel(instant, LA), 'America/Los_Angeles · UTC−8:00');
  assert.equal(zoneLabel(instant, 'Asia/Kolkata'), 'Asia/Kolkata · UTC+5:30');
});

test('time steps land on whole quarter hours and playback wraps', () => {
  const at = fromWall({ year: 2026, month: 11, day: 20, hour: 10, minute: 53 }, LA);
  assert.equal(toInputValue(stepped(at, 15, true, LA), LA), '2026-11-20T11:00');
  assert.equal(toInputValue(stepped(at, 15, false, LA), LA), '2026-11-20T10:45');
  assert.equal(toInputValue(stepped(at, 60, true, LA), LA), '2026-11-20T11:00');
  const day = dayInterval(at, LA);
  assert.equal(advancing(new Date(day.end - 60_000), 120, day).toISOString(), new Date(day.start.getTime() + 60_000).toISOString());
  assert.equal(advancing(day.start, -60, day).toISOString(), new Date(day.end - 60_000).toISOString());
});

test('a copied Calendar event gives its title and time', () => {
  const text = 'Office hours\nScheduled: Nov 9, 2026 at 12:00 PM to 1:00 PM, PST\n';
  const event = parseCalendarText(text, { localZone: LA });
  assert.equal(event.title, 'Office hours');
  assert.equal(event.allDay, false);
  assert.equal(event.start.toISOString(), '2026-11-09T20:00:00.000Z');
  assert.equal(event.end.toISOString(), '2026-11-09T21:00:00.000Z');
});

test('a named zone that is not the reader’s own is honoured', () => {
  const event = parseCalendarText('Call\nScheduled: Nov 9, 2026 at 9:00 AM to 10:00 AM, EST', { localZone: LA });
  assert.equal(event.start.toISOString(), '2026-11-09T14:00:00.000Z');
  // Without a zone, the reader's own zone is used, with its daylight saving.
  const summer = parseCalendarText('Picnic\nScheduled: Jul 4, 2026 at 1:00 PM to 3:00 PM', { localZone: LA });
  assert.equal(summer.start.toISOString(), '2026-07-04T20:00:00.000Z');
  assert.equal(summer.end.toISOString(), '2026-07-04T22:00:00.000Z');
});

test('events across midnight, on several days, or all day', () => {
  const late = parseCalendarText('Stargazing\nScheduled: Nov 9, 2026 at 11:00 PM to 1:00 AM', { localZone: LA });
  assert.equal(late.end - late.start, 2 * 3_600_000);
  const long = parseCalendarText('Trip\nScheduled: Monday, Nov 9, 2026 at 3:00 PM to Nov 11, 2026 at 10:00 AM', { localZone: LA });
  assert.equal(long.end.toISOString(), '2026-11-11T18:00:00.000Z');
  const allDay = parseCalendarText('Holiday\nScheduled: Nov 26, 2026', { localZone: LA });
  assert.deepEqual([allDay.allDay, allDay.startDate, allDay.endDate], [true, { year: 2026, month: 11, day: 26 }, { year: 2026, month: 11, day: 26 }]);
  const days = parseCalendarText('Conference\nScheduled: Nov 9, 2026 to Nov 11, 2026', { localZone: LA });
  assert.deepEqual(days.endDate, { year: 2026, month: 11, day: 11 });
});

test('other date and clock styles are read too', () => {
  const european = parseCalendarText('Seminar\nScheduled: 9 November 2026 at 14:00 to 15:30', { localZone: 'Europe/Paris' });
  assert.equal(european.start.toISOString(), '2026-11-09T13:00:00.000Z');
  assert.equal(european.end.toISOString(), '2026-11-09T14:30:00.000Z');
  const numeric = parseCalendarText('Meeting 11/9/2026 at 3:00 PM', { localZone: LA });
  assert.equal(numeric.start.toISOString(), '2026-11-09T23:00:00.000Z');
  assert.equal(parseCalendarText('Just some words\nand more words', { localZone: LA }), null);
  assert.equal(parseCalendarText('', { localZone: LA }), null);
});

test('links carry a place and a time or range', () => {
  const time = new Date('2026-11-20T23:00:00Z');
  const link = encodeLink('https://example.org/WhenScape/', { latitude: 34.0967, longitude: -117.7198, name: 'Pomona College', time });
  assert.equal(link, 'https://example.org/WhenScape/#at=34.09670%2C-117.71980&place=Pomona%20College&t=2026-11-20T23%3A00%3A00Z');
  const back = decodeLink(new URL(link).hash);
  assert.deepEqual({ ...back, time: back.time.toISOString() }, { latitude: 34.0967, longitude: -117.7198, name: 'Pomona College', rangeEnabled: false, time: '2026-11-20T23:00:00.000Z' });
  const start = new Date('2026-11-20T22:00:00Z'), end = new Date('2026-11-21T00:00:00Z');
  const range = decodeLink(new URL(encodeLink('https://example.org/', { latitude: 1, longitude: 2, time, start, end, rangeEnabled: true })).hash);
  assert.equal(range.rangeEnabled, true);
  assert.equal(range.start.toISOString(), start.toISOString());
  assert.equal(range.time.toISOString(), time.toISOString());
  assert.equal(decodeLink('#at=95,0'), null);
  assert.equal(decodeLink('#place=Nowhere'), null);
  assert.equal(decodeLink('#at=10,20&t=garbage').time, undefined);
});

test('saved places keep Home and Work first and replace by label or spot', () => {
  const book = new PlaceBook();
  const a = { name: 'A', latitude: 34, longitude: -117, origin: 'point' };
  book.save(a, 'Gym');
  book.save({ name: 'B', latitude: 35, longitude: -118 }, 'Work');
  book.save({ name: 'C', latitude: 36, longitude: -119 }, 'home');
  assert.deepEqual(book.saved.map(p => p.label), ['home', 'Work', 'Gym']);
  book.save({ name: 'D', latitude: 37, longitude: -120 }, 'Home');
  assert.deepEqual(book.saved.map(p => p.name), ['D', 'B', 'A']);
  book.save({ ...a, latitude: 34.0001 }, 'Pool');
  assert.deepEqual(book.saved.map(p => p.label), ['Home', 'Work', 'Pool']);
  assert.equal(book.savedPlaceNear(34, -117).label, 'Pool');
  assert.equal(book.save(a, '   '), null);
});

test('recent places are few, distinct, and leave out saved ones', () => {
  const book = new PlaceBook();
  for (let i = 0; i < 7; i++) book.noteVisit({ name: `P${i}`, latitude: i, longitude: i });
  assert.deepEqual(book.recent.map(p => p.name), ['P6', 'P5', 'P4', 'P3', 'P2']);
  book.noteVisit({ name: 'P4 again', latitude: 4, longitude: 4.0001 });
  assert.deepEqual(book.recent.map(p => p.name), ['P4 again', 'P6', 'P5', 'P3', 'P2']);
  book.save({ name: 'P6', latitude: 6, longitude: 6 }, 'Six');
  assert.deepEqual(book.unsavedRecents.map(p => p.name), ['P4 again', 'P5', 'P3', 'P2']);
  const restored = PlaceBook.from(JSON.stringify(book));
  assert.deepEqual(restored.toJSON(), book.toJSON());
  assert.equal(PlaceBook.from('not json').saved.length, 0);
});

test('Google-supplied details are dropped after 30 days', () => {
  const now = Date.now(), old = now - KEEP_FOR - 1000;
  const searched = expire({ name: 'Cafe', latitude: 1, longitude: 2, placeId: 'abc', origin: 'search', fetchedAt: old }, now);
  assert.deepEqual([searched.name, searched.latitude, searched.placeId], [null, null, 'abc']);
  assert.equal(needsLookup(searched), true);
  const clicked = expire({ name: '1 Main St', latitude: 1, longitude: 2, origin: 'point', fetchedAt: old }, now);
  assert.deepEqual([clicked.name, clicked.latitude], [null, 1]);
  const fresh = { name: 'New', latitude: 1, longitude: 2, origin: 'search', fetchedAt: now };
  assert.equal(expire(fresh, now), fresh);
  const book = new PlaceBook({ recent: [{ name: 'Old', latitude: 1, longitude: 1, fetchedAt: old }, { name: 'New', latitude: 2, longitude: 2, fetchedAt: now }] });
  assert.equal(book.prune(now), true);
  assert.deepEqual(book.recent.map(p => p.name), ['New']);
  assert.equal(book.prune(now), false);
});

// Reads an event copied in Apple's Calendar app. Its plain text is the title,
// then a line such as
//   Scheduled: Nov 9, 2026 at 12:00 PM to 1:00 PM, PST
// (with a narrow no-break space before PM). Calendar puts no location in the
// text, so only the title and the time can be taken from it. Other shapes are
// read too: other days, all-day events, 24-hour times, day-first dates.

import { fromWall } from './time.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const WEEKDAY = '(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\\.?,?\\s+)?';
const DATE_PATTERNS = [
  // Nov 9, 2026 · November 9 2026
  [new RegExp(`^${WEEKDAY}${MONTH}\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'), m => ({ month: monthNumber(m[1]), day: +m[2], year: +m[3] })],
  // 9 Nov 2026 · 9 November, 2026
  [new RegExp(`^${WEEKDAY}(\\d{1,2})\\.?\\s+${MONTH},?\\s+(\\d{4})`, 'i'), m => ({ day: +m[1], month: monthNumber(m[2]), year: +m[3] })],
  // 2026-11-09
  [/^(\d{4})-(\d{1,2})-(\d{1,2})/, m => ({ year: +m[1], month: +m[2], day: +m[3] })],
  // 11/9/2026 (US order)
  [/^(\d{1,2})\/(\d{1,2})\/(\d{4})/, m => ({ month: +m[1], day: +m[2], year: +m[3] })],
];
const TIME = /^(?:at\s+|,\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i;

// Abbreviations Calendar may add after the time, as hours from UTC. Only
// common ones; an unknown one falls back to the reader's own time zone.
const ZONES = {
  utc: 0, gmt: 0, wet: 0, bst: 1, cet: 1, cest: 2, eet: 2, eest: 3, ist: 5.5, jst: 9, kst: 9,
  aest: 10, aedt: 11, acst: 9.5, acdt: 10.5, awst: 8, nzst: 12, nzdt: 13,
  est: -5, edt: -4, cst: -6, cdt: -5, mst: -7, mdt: -6, pst: -8, pdt: -7,
  akst: -9, akdt: -8, hst: -10, ast: -4, adt: -3, nst: -3.5, ndt: -2.5,
};

function monthNumber(name) { return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1; }

function readDate(text) {
  for (const [pattern, read] of DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const date = read(match);
      if (date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= 31) return { date, rest: text.slice(match[0].length).trim() };
    }
  }
  return null;
}

function readTime(text) {
  const match = TIME.exec(text);
  if (!match) return null;
  let hour = +match[1];
  const minute = match[2] ? +match[2] : 0;
  const half = match[3]?.toLowerCase().replace(/\./g, '');
  if (!match[2] && !half) return null;
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return { time: { hour, minute }, rest: text.slice(match[0].length).trim() };
}

// One side of "… to …": a date with an optional time, or a time alone.
function readMoment(text) {
  const dated = readDate(text);
  if (dated) {
    const timed = readTime(dated.rest);
    return { date: dated.date, time: timed?.time ?? null, rest: timed ? timed.rest : dated.rest };
  }
  const timed = readTime(text);
  return timed ? { date: null, time: timed.time, rest: timed.rest } : null;
}

// The zone named at the end of the line: "PST", "GMT+1", "UTC−05:30".
function readZone(text) {
  const match = /(?:^|[,\s])\(?((?:utc|gmt)\s*([+\-−]\s*\d{1,2})(?::?(\d{2}))?|[a-z]{2,5})\)?\s*$/i.exec(text);
  if (!match) return null;
  if (match[2]) {
    const sign = /[-−]/.test(match[2]) ? -1 : 1;
    const hours = Number(match[2].replace(/[^\d]/g, ''));
    return { offsetMinutes: sign * (hours * 60 + Number(match[3] ?? 0)) };
  }
  const name = match[1].toUpperCase();
  const hours = ZONES[name.toLowerCase()];
  return hours === undefined ? { name } : { name, offsetMinutes: hours * 60 };
}

// The local zone's own abbreviation on a date, such as "PST" or "PDT".
function localAbbreviation(date, localZone) {
  try {
    const noon = new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
    return new Intl.DateTimeFormat('en-US', { timeZone: localZone, timeZoneName: 'short' })
      .formatToParts(noon).find(part => part.type === 'timeZoneName')?.value.toUpperCase();
  } catch { return undefined; }
}

function instantFrom(date, time, zone, localZone) {
  const wall = { ...date, hour: time.hour, minute: time.minute, second: 0 };
  if (zone) return new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - zone.offsetMinutes * 60_000);
  return fromWall(wall, localZone);
}

function nextDay({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const normalize = text => text.replace(/[    ]/g, ' ').replace(/[–—]/g, '-').replace(/\r/g, '');

/**
 * The event in pasted text, or null if none can be read. A timed event gives
 * { title, allDay: false, start, end } as instants; an all-day one gives
 * { title, allDay: true, startDate, endDate } as calendar dates, since the
 * day matters in the place's own time zone, which is not known yet. Times
 * without a named zone are read in `localZone`, the zone of the copying
 * computer's calendar.
 */
export function parseCalendarText(raw, { localZone } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const lines = normalize(raw).split('\n').map(line => line.trim()).filter(Boolean);
  const scheduledIndex = lines.findIndex(line => /^scheduled\s*:/i.test(line));
  const candidates = scheduledIndex >= 0 ? [lines[scheduledIndex].replace(/^scheduled\s*:\s*/i, '')] : lines;
  for (const line of candidates) {
    // Without the "Scheduled:" label the date may come after other words.
    const starts = scheduledIndex >= 0 ? [0] : [0, ...[...line.matchAll(/\s+/g)].map(match => match.index + match[0].length)];
    let event = null;
    for (const start of starts) if ((event = readLine(line.slice(start), localZone))) break;
    if (!event) continue;
    const title = lines.find((text, index) => index !== scheduledIndex && text !== line && !/^[a-z ]{2,20}:/i.test(text)) ?? '';
    return { title: title.slice(0, 200), ...event };
  }
  return null;
}

function readLine(line, localZone = 'UTC') {
  const [left, right] = line.split(/\s+(?:to|until|-)\s+/i, 2);
  const from = readMoment(left.replace(/^from\s+/i, ''));
  if (!from?.date) return null;
  const to = right ? readMoment(right) : null;
  let zone = readZone(to?.rest ?? from.rest ?? '');
  // The reader's own zone, named, is best read as that zone, which knows its
  // daylight saving dates; a zone the table does not know is read the same way.
  if (zone && (zone.offsetMinutes === undefined || (zone.name && zone.name === localAbbreviation(from.date, localZone)))) zone = null;
  if (!from.time) {
    // All day: Calendar's end date is the last day of the event.
    const endDate = to?.date ?? from.date;
    return { allDay: true, startDate: from.date, endDate };
  }
  const start = instantFrom(from.date, from.time, zone, localZone);
  let end;
  if (to?.time) {
    end = instantFrom(to.date ?? from.date, to.time, zone, localZone);
    // "11:00 PM to 1:00 AM" with no second date ends the next day.
    if (!to.date && end <= start) end = instantFrom(nextDay(from.date), to.time, zone, localZone);
  }
  if (!end || end <= start) end = new Date(start.getTime() + 3_600_000);
  return { allDay: false, start, end };
}

// Times in a place's own time zone, using only the browser's Intl support.
// An instant is a Date; a "wall" time is what a clock in that zone shows.

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const formatters = new Map();

function partsFormatter(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether the browser knows this IANA time zone. */
export function isTimeZone(timeZone) {
  try { partsFormatter(timeZone); return true; } catch { return false; }
}

/** The wall clock in a zone at an instant: { year, month (1–12), day, hour, minute, second }. */
export function wallParts(instant, timeZone) {
  const parts = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(instant)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
}

/** Milliseconds the zone's clock is ahead of UTC at an instant. */
export function zoneOffset(instant, timeZone) {
  const wall = wallParts(instant, timeZone);
  const asUTC = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUTC - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant a zone's clock shows a wall time. In a skipped hour (spring
 * forward) it lands just after the gap; in a repeated hour, on the first pass.
 */
export function fromWall({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wall - zoneOffset(new Date(wall), timeZone);
  for (let i = 0; i < 2; i++) {
    const next = wall - zoneOffset(new Date(guess), timeZone);
    if (next === guess) break;
    guess = next;
  }
  // In a repeated hour, prefer the earlier of the two instants.
  const earlier = guess - HOUR;
  const back = wallParts(new Date(earlier), timeZone);
  if (Date.UTC(back.year, back.month - 1, back.day, back.hour, back.minute, back.second) === wall) guess = earlier;
  return new Date(guess);
}

const pad = (value, size = 2) => String(value).padStart(size, '0');

/** The value for an <input type="datetime-local"> showing this instant in a zone. */
export function toInputValue(instant, timeZone) {
  const w = wallParts(instant, timeZone);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** The instant a datetime-local value means in a zone, or null if it is not one. */
export function fromInputValue(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  return fromWall({ year, month, day, hour, minute }, timeZone);
}

/** The value for an <input type="time"> showing this instant's wall clock in a zone. */
export function toTimeValue(instant, timeZone) {
  const w = wallParts(instant, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** The same wall-clock time on another calendar date ({ year, month, day }). */
export function withCivilDate(instant, date, timeZone) {
  const w = wallParts(instant, timeZone);
  return fromWall({ ...date, hour: w.hour, minute: w.minute }, timeZone);
}

/** The same calendar date at another wall-clock time ("HH:MM"), or null if it is not one. */
export function withWallTime(instant, value, timeZone) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return fromWall({ ...civilDate(instant, timeZone), hour: Number(match[1]), minute: Number(match[2]) }, timeZone);
}

/** The local day containing an instant, from midnight to the next midnight. */
export function dayInterval(instant, timeZone) {
  const w = wallParts(instant, timeZone);
  const start = fromWall({ year: w.year, month: w.month, day: w.day }, timeZone);
  const next = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  const end = fromWall({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, timeZone);
  return { start, end };
}

/** Noon on a calendar date ({ year, month, day }) in a zone. */
export function noonOn(date, timeZone) {
  return fromWall({ ...date, hour: 12, minute: 0, second: 0 }, timeZone);
}

export function clamped(instant, { start, end }) {
  return new Date(Math.min(Math.max(instant.getTime(), start.getTime()), end.getTime()));
}

/**
 * One step earlier or later on the local clock, landing on a whole step:
 * from 10:53, fifteen minutes later is 11:00 and earlier is 10:45.
 */
export function stepped(instant, minutes, forward, timeZone) {
  const step = Math.max(1, minutes) * MINUTE;
  const offset = zoneOffset(instant, timeZone);
  const local = instant.getTime() + offset;
  const target = forward ? (Math.floor(local / step) + 1) * step : (Math.ceil(local / step) - 1) * step;
  return new Date(target - offset);
}

/** Fixed elapsed time, wrapping around the interval, so repeated DST hours stay distinct. */
export function advancing(instant, seconds, { start, end }) {
  const duration = end.getTime() - start.getTime();
  if (duration <= 0) return new Date(start);
  const offset = instant.getTime() - start.getTime() + seconds * 1000;
  return new Date(start.getTime() + (((offset % duration) + duration) % duration));
}

/** "America/Los_Angeles · UTC−8:00" */
export function zoneLabel(instant, timeZone) {
  const minutes = Math.round(zoneOffset(instant, timeZone) / MINUTE);
  const sign = minutes < 0 ? '−' : '+';
  return `${timeZone} · UTC${sign}${Math.floor(Math.abs(minutes) / 60)}:${pad(Math.abs(minutes) % 60)}`;
}

/** "Fri, Nov 20, 2026, 11:58 AM PST" in the reader's own language. */
export function formatMoment(instant, timeZone, locale) {
  return new Intl.DateTimeFormat(locale, {
    timeZone, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(instant);
}

/** The calendar date an instant falls on in a zone: { year, month, day }. */
export function civilDate(instant, timeZone) {
  const { year, month, day } = wallParts(instant, timeZone);
  return { year, month, day };
}

export { MINUTE, HOUR, DAY };

// Guides drawn around the flag in the aerial view: a compass ring on the
// ground and the day's Sun path as an arc overhead. Offsets are metres east,
// north and up from the pin.

const radians = degrees => degrees * Math.PI / 180;

/** A point on a dome of the given radius, in the direction of altitude/azimuth. */
export function domePoint(altitude, azimuth, radius) {
  const flat = Math.cos(radians(altitude)) * radius;
  return { e: Math.sin(radians(azimuth)) * flat, n: Math.cos(radians(azimuth)) * flat, up: Math.sin(radians(altitude)) * radius };
}

/** Points around the compass ring, closed. */
export function ringPoints(radius, count = 72) {
  return Array.from({ length: count + 1 }, (_, i) => domePoint(0, 360 * i / count, radius));
}

/** The above-horizon part of a Sun track, as runs of consecutive samples. */
export function daylightRuns(samples, from = -Infinity, to = Infinity) {
  const runs = [];
  let run = [];
  for (const sample of samples) {
    if (sample.altitude > 0 && sample.time >= from && sample.time <= to) run.push(sample);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs.filter(r => r.length > 1);
}

/**
 * Whole civil hours between two instants in a time zone, with short labels.
 * Half-hour and quarter-hour zones are handled by testing each quarter hour.
 */
export function hourMarks(start, end, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true });
  const marks = [];
  const quarter = 15 * 60000;
  for (let ms = Math.ceil(start / quarter) * quarter; ms <= end; ms += quarter) {
    const fields = Object.fromEntries(parts.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
    if (fields.minute !== '00') continue;
    const hour = Number(fields.hour);
    const label = hour === 12 ? (fields.dayPeriod === 'PM' ? 'noon' : 'midnight') : `${hour} ${fields.dayPeriod.toLowerCase()}`;
    marks.push({ time: ms, hour, label });
  }
  return marks;
}

/** A clock time such as "6:24 am" in a time zone. */
export function clockLabel(time, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(time)).replace(/\s?(AM|PM)/, (_, half) => ' ' + half.toLowerCase());
}

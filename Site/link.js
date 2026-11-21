// A WhenScape link holds a place and a time after the "#", for example
//   https://…/WhenScape/#at=34.09670,-117.71980&place=Pomona%20College&t=2026-11-20T23:00:00Z
// with "from" and "to" in place of "t" for a time range. Everything after the
// "#" stays in the browser: it is not sent to the server hosting the page.

const iso = date => date.toISOString().replace(/\.000Z$/, 'Z');

/** The link for a place and time, on top of the page's own address. */
export function encodeLink(base, { latitude, longitude, name, time, start, end, rangeEnabled }) {
  const params = new URLSearchParams();
  params.set('at', `${latitude.toFixed(5)},${longitude.toFixed(5)}`);
  if (name) params.set('place', name);
  if (rangeEnabled && start && end) {
    params.set('from', iso(start));
    params.set('to', iso(end));
    if (time && time > start && time < end) params.set('t', iso(time));
  } else params.set('t', iso(time));
  return `${base.split('#')[0]}#${params.toString().replace(/\+/g, '%20')}`;
}

const readDate = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

/**
 * The place and time in a link's "#…" part, or null if it has no usable place.
 * A missing or unreadable time is left out, so the page keeps its own.
 */
export function decodeLink(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const at = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(params.get('at') ?? '');
  if (!at) return null;
  const latitude = Number(at[1]), longitude = Number(at[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const result = { latitude, longitude, name: (params.get('place') ?? '').trim().slice(0, 200) || null };
  const start = readDate(params.get('from')), end = readDate(params.get('to'));
  const time = readDate(params.get('t'));
  if (start && end && end > start) {
    Object.assign(result, { rangeEnabled: true, start, end, time: time && time >= start && time <= end ? time : start });
  } else if (time) Object.assign(result, { rangeEnabled: false, time });
  return result;
}

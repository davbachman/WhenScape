// A time popover for the time fields: columns of hours and minutes, plus AM
// and PM where the reader's clock has them. Clicking a value changes the time
// at once and leaves the popover open for the next column. The field keeps
// focus throughout, so a time can still be typed or stepped with its arrow keys.
//
// Times here are wall-clock times, { hour (0–23), minute }, with no date.

import { placeBeside } from './popover.js';

const pad = value => String(value).padStart(2, '0');

/** "HH:MM", the value of an <input type="time">. */
export const timeValue = ({ hour, minute }) => `${pad(hour)}:${pad(minute)}`;

/** The time in an "HH:MM" value, or null if it is not one. */
export function parseTimeValue(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * How the reader's clock shows a time: 12 hours or 24, whether hours have a
 * leading zero, and on a 12-hour clock the AM and PM labels and which side of
 * the hour they go (before it in Korean or Chinese, for example).
 */
export function clockStyle(locale) {
  // The locale's own short time ("9:05 AM", "09:05", "오전 9:05").
  const format = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', timeStyle: 'short' });
  const options = format.resolvedOptions();
  const cycle = options.hourCycle ?? (options.hour12 ? 'h12' : 'h23');
  const twelve = cycle === 'h12' || cycle === 'h11';
  const partsAt = hour => format.formatToParts(Date.UTC(2026, 0, 1, hour, 5));
  const morning = partsAt(9);
  const hourAt = morning.findIndex(part => part.type === 'hour');
  const periodAt = morning.findIndex(part => part.type === 'dayPeriod');
  const periodOf = hour => partsAt(hour).find(part => part.type === 'dayPeriod')?.value;
  return {
    twelve,
    zeroHour: cycle === 'h11' ? 0 : 12, // what a 12-hour clock calls the hour after midnight
    padHour: (morning[hourAt]?.value.length ?? 1) > 1,
    periods: twelve ? [periodOf(9) ?? 'AM', periodOf(21) ?? 'PM'] : null,
    periodFirst: twelve && periodAt >= 0 && periodAt < hourAt,
  };
}

/**
 * The time with one column's value changed: an hour (0–23, or 0–11 on a
 * 12-hour clock, keeping AM or PM), a minute, or a period (0 for AM, 1 for PM).
 */
export function withPart({ hour, minute }, part, value, twelve) {
  if (part === 'minute') return { hour, minute: value };
  if (part === 'period') return { hour: (hour % 12) + 12 * value, minute };
  return { hour: twelve ? value + (hour >= 12 ? 12 : 0) : value, minute };
}

/**
 * One time popover shared by every time field on the page.
 * open(anchor, input, { time, onPick }) shows it by a field; each click calls
 * onPick(time), and show(time) updates it after the field has changed.
 */
export function createTimePicker({ locale = navigator.language } = {}) {
  const style = clockStyle(locale);
  const digits = size => new Intl.NumberFormat(locale, { minimumIntegerDigits: size, useGrouping: false });
  const hourDigits = digits(style.padHour ? 2 : 1), minuteDigits = digits(2);
  const count = n => Array.from({ length: n }, (_, i) => i);

  const element = document.createElement('div');
  element.className = 'time-picker';
  element.hidden = true;
  // The field itself is the accessible control (it can be typed in and stepped
  // with arrow keys); this is a shortcut for the pointer beside it.
  element.setAttribute('aria-hidden', 'true');

  const columns = {};
  function column(part, values, label) {
    const list = document.createElement('div');
    list.className = `tp-column tp-${part}`;
    for (const value of values) {
      const item = document.createElement('button');
      item.type = 'button';
      item.tabIndex = -1;
      item.className = 'tp-item';
      item.dataset.part = part;
      item.dataset.value = String(value);
      item.textContent = label(value);
      list.append(item);
    }
    columns[part] = list;
    return list;
  }
  const lists = [
    column('hour', count(style.twelve ? 12 : 24), hour => hourDigits.format(style.twelve && hour === 0 ? style.zeroHour : hour)),
    column('minute', count(60), minute => minuteDigits.format(minute)),
  ];
  if (style.periods) {
    const periods = column('period', [0, 1], period => style.periods[period]);
    if (style.periodFirst) lists.unshift(periods); else lists.push(periods);
  }
  element.append(...lists);
  document.body.append(element);

  let current = null; // { anchor, input, time, onPick }

  const center = (list, item) => { list.scrollTop = item.offsetTop - (list.clientHeight - item.offsetHeight) / 2; };
  const reveal = (list, item) => {
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  };

  // Marks the time's hour, minute and period; scroll says how to bring them into view, if at all.
  function select(time, scroll) {
    current.time = time;
    const chosen = { hour: style.twelve ? time.hour % 12 : time.hour, minute: time.minute, period: time.hour >= 12 ? 1 : 0 };
    for (const [part, list] of Object.entries(columns)) {
      for (const item of list.children) {
        const on = Number(item.dataset.value) === chosen[part];
        item.classList.toggle('selected', on);
        if (on && scroll) scroll(list, item);
      }
    }
  }

  const place = event => {
    if (current && !(event?.type === 'scroll' && element.contains(event.target))) placeBeside(element, current.anchor);
  };

  function open(anchor, input, { time, onPick }) {
    if (current) close();
    current = { anchor, input, time, onPick };
    element.hidden = false;
    select(time, center);
    place();
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
  }

  function close() {
    if (!current) return;
    current = null;
    element.hidden = true;
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
  }

  /** Shows the time the field now has, typed or as it settled after a pick. */
  function show(time) { if (current && time) select(time, reveal); }

  // Keep focus in the field, so typing and its arrow keys carry on working.
  element.addEventListener('mousedown', event => event.preventDefault());
  element.addEventListener('click', event => {
    const item = event.target.closest('.tp-item');
    if (!item || !current) return;
    const time = withPart(current.time, item.dataset.part, Number(item.dataset.value), style.twelve);
    select(time);
    current.onPick(time);
  });

  // Close on a click elsewhere, and when the window loses focus (as it does
  // when the 3D view, in its own frame, is clicked).
  document.addEventListener('pointerdown', event => {
    if (current && !element.contains(event.target) && !current.anchor.contains(event.target)) close();
  }, true);
  addEventListener('blur', () => close());

  return {
    element, open, close, show, style,
    isOpenFor: input => current?.input === input,
  };
}

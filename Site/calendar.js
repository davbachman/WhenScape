// A month calendar in a popover, opened from a date button. It is placed
// wherever it fits on screen: below the button, or above it when the button
// is near the bottom edge (the browsers' own date pickers always open below).
//
// Dates here are calendar dates, { year, month (1–12), day }, with no time zone.

import { placeBeside } from './popover.js';

const DAY = 86_400_000;
const toUTC = date => Date.UTC(date.year, date.month - 1, date.day);
const fromUTC = ms => { const t = new Date(ms); return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }; };
const weekdayOf = date => new Date(toUTC(date)).getUTCDay() || 7; // 1 = Monday … 7 = Sunday

/** Negative, zero or positive as a is before, on or after b. */
export function compareDates(a, b) { return toUTC(a) - toUTC(b); }

export function shiftDays(date, days) { return fromUTC(toUTC(date) + days * DAY); }

/** The same day some months away, or that month's last day if it is shorter. */
export function shiftMonths(date, months) {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12), month = index - year * 12 + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(date.day, last) };
}

/** Six whole weeks covering a month, starting on firstDay (1 = Monday … 7 = Sunday). */
export function monthGrid(year, month, firstDay = 7) {
  const first = { year, month, day: 1 };
  const start = shiftDays(first, -((weekdayOf(first) - firstDay + 7) % 7));
  return Array.from({ length: 42 }, (_, i) => shiftDays(start, i));
}

function firstDayOfWeek(locale) {
  try {
    const info = new Intl.Locale(locale);
    const week = info.getWeekInfo?.() ?? info.weekInfo;
    if (week?.firstDay >= 1 && week.firstDay <= 7) return week.firstDay;
  } catch {}
  return 7;
}

const chevron = path => `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${path}"/></svg>`;

/**
 * One calendar popover shared by every date button on the page.
 * open(anchor, { label, selected, today, earliest, range, onPick }) shows it
 * for a button; choosing a day calls onPick(date) and closes it.
 */
export function createCalendar({ locale = navigator.language } = {}) {
  const firstDay = firstDayOfWeek(locale);
  const monthFormat = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const dayFormat = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const narrow = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'narrow' });
  const long = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' });

  const element = document.createElement('div');
  element.className = 'calendar';
  element.setAttribute('role', 'dialog');
  element.hidden = true;
  element.innerHTML = `
    <div class="calendar-head">
      <button type="button" class="cal-nav" data-months="-1" aria-label="Previous month" title="Previous month">${chevron('M12 4.5 6.5 10l5.5 5.5')}</button>
      <span class="cal-title" aria-live="polite"></span>
      <button type="button" class="cal-nav" data-months="1" aria-label="Next month" title="Next month">${chevron('M8 4.5 13.5 10 8 15.5')}</button>
    </div>
    <div class="cal-grid"></div>
    <div class="cal-foot"><button type="button" class="link-button cal-today">Today</button></div>`;
  document.body.append(element);
  const title = element.querySelector('.cal-title');
  const grid = element.querySelector('.cal-grid');
  const todayButton = element.querySelector('.cal-today');

  // Weekday initials, in the reader's order. 5–11 January 2026 run Monday to Sunday.
  const headers = Array.from({ length: 7 }, (_, i) => {
    const weekday = ((firstDay - 1 + i) % 7) + 1;
    const sample = Date.UTC(2026, 0, 4 + weekday);
    const cell = document.createElement('span');
    cell.className = 'cal-weekday';
    cell.textContent = narrow.format(sample);
    cell.title = long.format(sample);
    cell.setAttribute('aria-hidden', 'true');
    return cell;
  });

  let current = null; // { anchor, options }
  let cursor = null;  // the date with keyboard focus; its month is the one shown

  const blocked = date => !!current.options.earliest && compareDates(date, current.options.earliest) < 0;
  const same = (a, b) => !!b && compareDates(a, b) === 0;

  function render(focus) {
    const { selected, today, range } = current.options;
    title.textContent = monthFormat.format(toUTC({ ...cursor, day: 1 }));
    const days = monthGrid(cursor.year, cursor.month, firstDay).map(date => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cal-day';
      button.textContent = String(date.day);
      button.dataset.date = `${date.year}-${date.month}-${date.day}`;
      button.setAttribute('aria-label', dayFormat.format(toUTC(date)));
      button.tabIndex = same(date, cursor) ? 0 : -1;
      if (date.month !== cursor.month) button.classList.add('outside');
      if (same(date, today)) { button.classList.add('today'); button.setAttribute('aria-current', 'date'); }
      if (same(date, selected)) { button.classList.add('selected'); button.setAttribute('aria-pressed', 'true'); }
      if (range && compareDates(range.from, range.to) < 0 && compareDates(date, range.from) >= 0 && compareDates(date, range.to) <= 0) {
        button.classList.add('in-range');
        if (same(date, range.from)) button.classList.add('range-from');
        if (same(date, range.to)) button.classList.add('range-to');
      }
      if (blocked(date)) button.setAttribute('aria-disabled', 'true');
      return button;
    });
    grid.replaceChildren(...headers, ...days);
    todayButton.parentElement.hidden = blocked(today);
    if (focus) grid.querySelector('.cal-day[tabindex="0"]')?.focus({ preventScroll: true });
    place();
  }

  const place = () => current && placeBeside(element, current.anchor);

  function open(anchor, options) {
    if (current) close();
    current = { anchor, options };
    cursor = options.selected ?? options.today;
    element.setAttribute('aria-label', options.label ?? 'Choose a date');
    element.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    render(true);
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
  }

  function close({ restoreFocus = false } = {}) {
    if (!current) return;
    const { anchor } = current;
    current = null;
    element.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    if (restoreFocus) anchor.focus();
  }

  function pick(date) {
    if (!current || blocked(date)) return;
    const { onPick } = current.options;
    close({ restoreFocus: true });
    onPick(date);
  }

  grid.addEventListener('click', event => {
    const button = event.target.closest('.cal-day');
    if (!button) return;
    const [year, month, day] = button.dataset.date.split('-').map(Number);
    pick({ year, month, day });
  });
  for (const button of element.querySelectorAll('.cal-nav')) {
    button.addEventListener('click', () => { cursor = shiftMonths(cursor, Number(button.dataset.months)); render(false); });
  }
  todayButton.addEventListener('click', () => pick(current.options.today));

  // The calendar owns its keys: the page's own arrow-key time steps must not
  // see them (by then the day that was focused has been redrawn away).
  element.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close({ restoreFocus: true }); return; }
    if (!event.target.closest('.cal-day')) return;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const intoWeek = (weekdayOf(cursor) - firstDay + 7) % 7;
    let next = null;
    if (event.key in moves) next = shiftDays(cursor, moves[event.key]);
    else if (event.key === 'PageUp' || event.key === 'PageDown') next = shiftMonths(cursor, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
    else if (event.key === 'Home') next = shiftDays(cursor, -intoWeek);
    else if (event.key === 'End') next = shiftDays(cursor, 6 - intoWeek);
    if (!next) return;
    event.preventDefault();
    cursor = next;
    render(true);
  });

  // Close on a click elsewhere, on tabbing away, and when the window loses
  // focus (as it does when the 3D view, in its own frame, is clicked).
  document.addEventListener('pointerdown', event => {
    if (current && !element.contains(event.target) && !current.anchor.contains(event.target)) close();
  }, true);
  element.addEventListener('focusout', event => {
    const to = event.relatedTarget;
    if (current && to && !element.contains(to) && !current.anchor.contains(to)) close();
  });
  addEventListener('blur', () => close());

  return {
    element, open, close,
    isOpenFor: anchor => current?.anchor === anchor,
  };
}

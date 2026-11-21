// The WhenScape browser app: the page around the 3D scene. It plays the part
// of the Mac app: it keeps the place and time, the location panel and the
// time controls, and passes everything to the scene in its frame.

import tzlookup from '@photostructure/tz-lookup';
import { dayInterval, clamped, stepped, advancing, toInputValue, fromInputValue, zoneLabel, formatMoment, noonOn, civilDate, isTimeZone } from './time.js';
import { parseCalendarText } from './paste.js';
import { encodeLink, decodeLink } from './link.js';
import { PlaceBook, placeTitle, needsLookup } from './places.js';
import { loadGoogleMaps, whenKeyRefused, createMap, createSearch, nameSpot } from './google.js';

const $ = id => document.getElementById(id);
const store = {
  get(key, fallback) { try { const value = localStorage.getItem(`whenscape.${key}`); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`whenscape.${key}`, JSON.stringify(value)); } catch {} },
};
const coarse = matchMedia('(pointer: coarse)').matches;
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const config = globalThis.WHENSCAPE_CONFIG ?? {};

// ---------------------------------------------------------------- State

const prefs = {
  weatherEnabled: true, idleOrbit: true, snowCover: false, computedShadows: false,
  detail: coarse ? 'low' : 'balanced', playbackSpeed: 300,
  ...store.get('prefs', {}),
};
const app = {
  latitude: 34.0967, longitude: -117.7198, name: 'Claremont, California', timeZone: 'America/Los_Angeles',
  origin: 'point', placeId: null, fetchedAt: Date.now(),
  instant: new Date(), start: new Date(), end: new Date(Date.now() + 3_600_000), rangeEnabled: false,
  event: null, locationRequired: false, locationMessage: null,
  isPlaying: false, direction: 1,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, diagnostics: false,
  googleKey: store.get('googleKey', '') || config.googleMapsKey || '',
  sceneReady: false, sceneMessage: 'Preparing the scene…', heading: 0, weatherLabel: '',
};
const places = new PlaceBook(store.get('places', {}) ?? {});
if (places.prune()) savePlaces();

function savePrefs() { store.set('prefs', prefs); }
function savePlaces() { store.set('places', places.toJSON()); }
function saveLastPlace() {
  store.set('lastPlace', { latitude: app.latitude, longitude: app.longitude, name: app.name, origin: app.origin, placeId: app.placeId, fetchedAt: app.fetchedAt });
}

const zoneAt = (latitude, longitude) => {
  try { const zone = tzlookup(latitude, longitude); return isTimeZone(zone) ? zone : 'UTC'; } catch { return 'UTC'; }
};

function interval() {
  if (app.rangeEnabled) return { start: app.start, end: new Date(Math.max(app.end.getTime(), app.start.getTime() + 60_000)) };
  return dayInterval(app.instant, app.timeZone);
}

// ---------------------------------------------------------------- Scene

const frame = $('scene');
let sceneWindow = null, pushQueued = false;

function sceneState() {
  const { start, end } = interval();
  return {
    latitude: app.latitude, longitude: app.longitude, location: app.name || 'Selected place',
    time: app.instant.toISOString(), start: start.toISOString(), end: end.toISOString(), rangeEnabled: app.rangeEnabled,
    timeZone: app.timeZone, weatherEnabled: prefs.weatherEnabled, snowCover: prefs.snowCover,
    reducedMotion: app.reducedMotion, computedShadows: prefs.computedShadows, diagnostics: app.diagnostics,
    idleOrbit: prefs.idleOrbit, detail: prefs.detail, ionToken: '', googleKey: app.googleKey,
  };
}

function pushScene() {
  if (pushQueued) return;
  pushQueued = true;
  queueMicrotask(() => {
    pushQueued = false;
    try { sceneWindow?.whenScape?.update(sceneState()); } catch {}
  });
}

function pushActivity() {
  try { sceneWindow?.whenScape?.setActivity({ visible: !document.hidden, active: document.hasFocus() }); } catch {}
}

addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'ready' || (message.type === 'status' && message.ready && !app.sceneReady)) {
    sceneWindow = frame.contentWindow;
    sceneWindow.addEventListener('focus', () => setTimeout(pushActivity));
    sceneWindow.addEventListener('blur', () => setTimeout(pushActivity));
    pushScene();
    pushActivity();
  }
  if (message.type === 'status') {
    app.sceneReady = !!message.ready;
    if (typeof message.message === 'string') app.sceneMessage = message.message;
    if (Number.isFinite(message.heading)) { app.heading = message.heading; mapView?.face(message.heading); }
    if (message.weather?.label) app.weatherLabel = message.weather.label;
    renderStatus();
  } else if (message.type === 'key') handleTimeKey(message.key, message.shift);
  else if (message.type === 'paste') usePastedText(message.text, { quietIfNotEvent: false });
});
for (const name of ['focus', 'blur']) addEventListener(name, () => setTimeout(pushActivity));
document.addEventListener('visibilitychange', pushActivity);

// ---------------------------------------------------------------- Time

function setInstant(date) { app.instant = date; renderTime(); pushScene(); }
function clearEvent() {
  if (!app.event) return;
  app.event = null;
  renderTime();
}
function chooseInstant(date) { clearEvent(); app.isPlaying = false; setInstant(date); }
function chooseStart(date) {
  clearEvent();
  app.start = date;
  if (app.end <= app.start) app.end = new Date(app.start.getTime() + 3_600_000);
  app.instant = clamped(app.instant, interval());
  renderTime(); pushScene();
}
function chooseEnd(date) {
  clearEvent();
  app.end = new Date(Math.max(date.getTime(), app.start.getTime() + 60_000));
  app.instant = clamped(app.instant, interval());
  renderTime(); pushScene();
}
function setRangeEnabled(on) {
  app.rangeEnabled = on;
  if (on) { app.start = app.instant; app.end = new Date(app.instant.getTime() + 3_600_000); }
  renderTime(); pushScene();
}
function step(minutes, forward) {
  if (app.locationRequired) return;
  app.isPlaying = false;
  const next = stepped(app.instant, minutes, forward, app.timeZone);
  setInstant(app.rangeEnabled ? clamped(next, interval()) : next);
}
function play(direction) {
  if (app.locationRequired) return;
  if (app.isPlaying && app.direction === direction) app.isPlaying = false;
  else { app.direction = direction; app.isPlaying = true; }
  renderTime();
}
setInterval(() => {
  if (!app.isPlaying || app.locationRequired) return;
  app.instant = advancing(app.instant, app.direction * prefs.playbackSpeed * 0.1, interval());
  renderTime(); pushScene();
}, 100);

const editing = target => target instanceof Element && !!target.closest('input:not([type="range"]):not([type="checkbox"]), textarea, select, [contenteditable], dialog[open]');

function handleTimeKey(key, shift) {
  if (key === 'ArrowLeft' || key === 'ArrowRight') step(shift ? 60 : 15, key === 'ArrowRight');
  else if (key === ' ') play(1);
}

document.addEventListener('keydown', event => {
  if (event.altKey || event.metaKey || event.ctrlKey || editing(event.target)) return;
  if (document.querySelector('dialog[open]')) return;
  const timeKey = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  const space = event.key === ' ' && !(event.target instanceof Element && event.target.closest('button, a, summary, label'));
  // The time slider moves by itself with the arrows; let it, but keep the steps tidy.
  if (timeKey && event.target === $('scrub')) { event.preventDefault(); handleTimeKey(event.key, event.shiftKey); return; }
  if (!timeKey && !space) return;
  event.preventDefault();
  handleTimeKey(event.key, event.shiftKey);
});

// ---------------------------------------------------------------- Calendar events

/**
 * Brings in the date and time of a copied calendar event, then asks where it
 * takes place: Calendar's copied text has no location.
 */
function useEvent(event) {
  app.isPlaying = false;
  if (event.allDay) {
    app.rangeEnabled = false;
    app.instant = noonOn(event.startDate, app.timeZone);
  } else {
    app.start = event.start;
    app.end = event.end;
    app.rangeEnabled = true;
    app.instant = event.start;
  }
  app.event = { ...event, initialInstant: app.instant };
  app.locationRequired = true;
  const title = event.title ? `“${event.title}”` : 'this event';
  app.locationMessage = `Where is ${title}? Search for its place, or ${coarse ? 'tap' : 'click'} the map.`;
  renderTime(); renderLocation(); pushScene();
  showToast(event.allDay ? 'Event date added. Now choose its place.' : 'Event time added. Now choose its place.');
  if (!coarse) $('search').focus();
  else $('search').scrollIntoView({ behavior: app.reducedMotion ? 'auto' : 'smooth', block: 'center' });
}

function resetToEvent() {
  const event = app.event;
  if (!event) return;
  if (event.allDay) { app.rangeEnabled = false; app.instant = noonOn(event.startDate, app.timeZone); }
  else { app.start = event.start; app.end = event.end; app.rangeEnabled = true; app.instant = event.start; }
  app.isPlaying = false;
  renderTime(); pushScene();
}

/** An all-day event's noon is in the place's own zone, so it is set again once the place is known. */
function settleAllDay() {
  const event = app.event;
  if (event?.allDay && app.instant.getTime() === event.initialInstant.getTime()) {
    app.instant = noonOn(event.startDate, app.timeZone);
    event.initialInstant = app.instant;
  }
}

function usePastedText(text, { quietIfNotEvent }) {
  const event = parseCalendarText(text, { localZone });
  if (event) { useEvent(event); return true; }
  if (!quietIfNotEvent) showToast('That doesn’t look like a copied calendar event. Copy an event in your calendar app, then paste here.');
  return false;
}

document.addEventListener('paste', event => {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  const inField = editing(event.target);
  // In a text field an ordinary paste is left alone; a whole copied event is taken.
  if (inField && !/^\s*scheduled\s*:/im.test(text)) return;
  if (usePastedText(text, { quietIfNotEvent: inField })) event.preventDefault();
});

$('paste-event').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    usePastedText(text, { quietIfNotEvent: false });
  } catch {
    showToast(coarse ? 'Your browser didn’t allow reading the clipboard.' : 'Press ⌘V (or Ctrl+V) to paste a copied event.');
  }
});

$('copy-link').addEventListener('click', async () => {
  const link = encodeLink(location.href, { latitude: app.latitude, longitude: app.longitude, name: app.name, time: app.instant, start: app.start, end: app.end, rangeEnabled: app.rangeEnabled });
  history.replaceState(null, '', link);
  try {
    await navigator.clipboard.writeText(link);
    showToast('Link copied. Paste it into a calendar event’s URL or notes.');
  } catch {
    window.prompt('Copy this link:', link);
  }
});

// ---------------------------------------------------------------- Places

let maps = null, mapView = null, search = null, locationRevision = 0;

/**
 * Moves the observer. `remember` adds the place to the recent ones; it is set
 * for places chosen by name (a search), not for map clicks.
 */
function setLocation({ latitude, longitude, name = null, origin = 'point', placeId = null }, { remember = false, recenter = true } = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
  const revision = ++locationRevision;
  Object.assign(app, { latitude, longitude, name, origin, placeId, fetchedAt: Date.now(), locationRequired: false, locationMessage: null });
  app.timeZone = zoneAt(latitude, longitude);
  settleAllDay();
  if (recenter) mapView?.reveal(latitude, longitude);
  mapView?.moveMarker(latitude, longitude);
  saveLastPlace();
  renderLocation(); renderTime(); pushScene();
  const finish = () => {
    if (revision !== locationRevision) return;
    if (!app.name) app.name = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    saveLastPlace();
    if (remember) { places.noteVisit(currentRecord()); savePlaces(); }
    renderLocation(); pushScene();
  };
  if (name || !maps) { finish(); return; }
  nameSpot(maps, latitude, longitude)
    .then(found => { if (revision === locationRevision) app.name = found || 'Selected map point'; })
    .catch(() => {})
    .finally(finish);
}

function currentRecord() {
  return { name: app.name, latitude: app.latitude, longitude: app.longitude, timeZone: app.timeZone, origin: app.origin, placeId: app.placeId, fetchedAt: app.fetchedAt };
}

async function goTo(place, chip) {
  if (!needsLookup(place)) {
    setLocation({ latitude: place.latitude, longitude: place.longitude, name: place.name, origin: place.origin, placeId: place.placeId });
    return;
  }
  // Past Google's 30 days: look the place up again by its ID.
  if (!place.placeId || !search) { showToast('This place needs to be found again. Search for it and save it once more.'); return; }
  chip?.classList.add('busy');
  try {
    const found = await search.locateId(place.placeId);
    const name = found.address.split(', ').slice(0, 2).join(', ') || null;
    places.update(place.id, { latitude: found.latitude, longitude: found.longitude, name, fetchedAt: Date.now() });
    savePlaces();
    setLocation({ latitude: found.latitude, longitude: found.longitude, name, origin: 'search', placeId: place.placeId });
  } catch {
    showToast('Couldn’t find this place again. Check the connection and try once more.');
  } finally { chip?.classList.remove('busy'); }
}

// Here: the browser's own location, read only when asked.
let locating = false;
function goHere(chip) {
  if (locating) return;
  if (!navigator.geolocation) { showToast('This browser can’t share its location.'); return; }
  locating = true;
  chip?.classList.add('busy');
  navigator.geolocation.getCurrentPosition(position => {
    locating = false;
    chip?.classList.remove('busy');
    closeResults();
    $('search').value = '';
    setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, origin: 'point' });
    if (position.coords.accuracy > 150) showToast(`Placed within about ${Math.round(position.coords.accuracy)} m of where you are.`);
  }, error => {
    locating = false;
    chip?.classList.remove('busy');
    showToast(error.code === error.PERMISSION_DENIED ? 'Location access is off for this site. Allow it in your browser’s settings to use Here.' : 'Your location isn’t available right now.');
  }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
}

$('recenter').addEventListener('click', () => mapView?.center(app.latitude, app.longitude));

// ---- Search

let suggestions = [], activeIndex = -1, searchTimer, searchGeneration = 0;
const searchInput = $('search');

function closeResults() {
  suggestions = []; activeIndex = -1;
  $('results').hidden = true;
  $('results').replaceChildren();
  searchInput.setAttribute('aria-expanded', 'false');
  searchInput.removeAttribute('aria-activedescendant');
  $('search-busy').hidden = true;
}

function renderResults() {
  const list = $('results');
  list.replaceChildren(...suggestions.map((item, index) => {
    const li = document.createElement('li');
    li.id = `result-${index}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(index === activeIndex));
    const main = document.createElement('span'); main.className = 'main'; main.textContent = item.main;
    const secondary = document.createElement('span'); secondary.className = 'secondary'; secondary.textContent = item.secondary;
    li.append(main, secondary);
    li.addEventListener('mousedown', event => event.preventDefault());
    li.addEventListener('click', () => chooseSuggestion(item));
    return li;
  }));
  if (suggestions.length) {
    const credit = document.createElement('li');
    credit.className = 'attribution';
    credit.setAttribute('role', 'presentation');
    credit.innerHTML = '<span class="secondary">Google Maps</span>';
    list.append(credit);
  }
  list.hidden = !suggestions.length;
  searchInput.setAttribute('aria-expanded', String(!!suggestions.length));
  if (activeIndex >= 0) searchInput.setAttribute('aria-activedescendant', `result-${activeIndex}`);
  else searchInput.removeAttribute('aria-activedescendant');
}

function showSearchMessage(text) {
  $('search-message').textContent = text ?? '';
  $('search-message').hidden = !text;
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  showSearchMessage(null);
  const query = searchInput.value.trim();
  const generation = ++searchGeneration;
  if (query.length < 2 || !search) { closeResults(); return; }
  searchTimer = setTimeout(async () => {
    $('search-busy').hidden = false;
    try {
      const found = await search.suggest(query, { latitude: app.latitude, longitude: app.longitude });
      if (generation !== searchGeneration) return;
      suggestions = found; activeIndex = found.length ? 0 : -1;
      renderResults();
      if (!found.length) showSearchMessage('No places found.');
    } catch {
      if (generation === searchGeneration) { closeResults(); showSearchMessage('Search isn’t available right now.'); }
    } finally {
      if (generation === searchGeneration) $('search-busy').hidden = true;
    }
  }, 220);
});

searchInput.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!suggestions.length) return;
    event.preventDefault();
    activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
    renderResults();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const item = suggestions[Math.max(0, activeIndex)];
    if (item) chooseSuggestion(item);
  } else if (event.key === 'Escape') {
    if (suggestions.length) { event.preventDefault(); closeResults(); }
  }
});
searchInput.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== searchInput) closeResults(); }, 150));
// The search field's own clear button empties it without an input event in some browsers.
searchInput.addEventListener('search', () => { if (!searchInput.value) closeResults(); });

async function chooseSuggestion(item) {
  const generation = ++searchGeneration;
  $('search-busy').hidden = false;
  try {
    const found = await search.locate(item);
    if (generation !== searchGeneration) return;
    closeResults();
    searchInput.value = item.main;
    setLocation({ latitude: found.latitude, longitude: found.longitude, name: item.main, origin: 'search', placeId: item.id }, { remember: true });
    searchInput.blur();
  } catch {
    if (generation === searchGeneration) showSearchMessage('Couldn’t open that place. Try again.');
  } finally {
    if (generation === searchGeneration) $('search-busy').hidden = true;
  }
}

// ---- Saved places

const icons = {
  here: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M17.5 2.5 2.5 9l6.5 2.5 2.5 6.5z" fill="currentColor"/></svg>',
  home: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 9.5 10 3.5l7 6V17h-4.5v-4.5h-5V17H3z" fill="currentColor" stroke="none"/></svg>',
  work: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="6" width="15" height="10.5" rx="2" fill="currentColor" stroke="none"/><path d="M7 6V4.5h6V6"/></svg>',
  star: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z" fill="currentColor" stroke="none"/></svg>',
  clock: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2"/></svg>',
};

function chip({ className, icon, text, title, onClick, onForget, forgetLabel }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `chip ${className}`;
  button.title = title;
  button.innerHTML = icon;
  const label = document.createElement('span'); label.className = 'chip-text'; label.textContent = text;
  button.append(label);
  button.addEventListener('click', () => onClick(button));
  if (!onForget) return button;
  const wrap = document.createElement('span');
  wrap.className = 'chip-wrap';
  const forget = document.createElement('button');
  forget.type = 'button';
  forget.className = 'forget';
  forget.textContent = '×';
  forget.title = forgetLabel;
  forget.setAttribute('aria-label', `${forgetLabel}: ${text}`);
  forget.addEventListener('click', onForget);
  wrap.append(button, forget);
  return wrap;
}

function renderChips() {
  const items = [chip({ className: 'here', icon: icons.here, text: 'Here', title: 'Go to where you are now', onClick: goHere })];
  for (const place of places.saved) {
    const kind = place.label?.toLowerCase();
    items.push(chip({
      className: 'saved', icon: kind === 'home' ? icons.home : kind === 'work' ? icons.work : icons.star,
      text: placeTitle(place), title: place.name ? `${place.label}: ${place.name}` : place.label,
      onClick: button => goTo(place, button),
      onForget: () => { places.remove(place.id); savePlaces(); renderLocation(); }, forgetLabel: 'Remove saved place',
    }));
  }
  for (const place of places.unsavedRecents) {
    items.push(chip({
      className: 'recent', icon: icons.clock, text: placeTitle(place), title: place.name ?? '',
      onClick: button => goTo(place, button),
      onForget: () => { places.remove(place.id); savePlaces(); renderLocation(); }, forgetLabel: 'Remove from recents',
    }));
  }
  $('chips').replaceChildren(...items);
}

const popover = $('save-popover');
function openSavePopover() {
  const saved = places.savedPlaceNear(app.latitude, app.longitude);
  $('save-name').value = saved?.label ?? '';
  $('save-remove').hidden = !saved;
  popover.hidden = false;
  updateTaken();
  $('save-name').focus();
}
function closeSavePopover() { popover.hidden = true; }
function updateTaken() {
  const label = $('save-name').value.trim();
  const holder = label && places.savedWithLabel(label);
  const here = places.savedPlaceNear(app.latitude, app.longitude);
  const taken = holder && holder.id !== here?.id;
  $('save-taken').hidden = !taken;
  if (taken) $('save-taken').textContent = `This replaces your saved ${holder.label}.`;
  $('save-confirm').disabled = !label;
}
function confirmSave(label = $('save-name').value) {
  if (!places.save(currentRecord(), label)) return;
  savePlaces();
  closeSavePopover();
  renderLocation();
}
$('save-place').addEventListener('click', () => (popover.hidden ? openSavePopover() : closeSavePopover()));
$('save-name').addEventListener('input', updateTaken);
$('save-name').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); confirmSave(); }
  if (event.key === 'Escape') { event.preventDefault(); closeSavePopover(); $('save-place').focus(); }
});
for (const button of popover.querySelectorAll('[data-label]')) button.addEventListener('click', () => confirmSave(button.dataset.label));
$('save-confirm').addEventListener('click', () => confirmSave());
$('save-cancel').addEventListener('click', closeSavePopover);
$('save-remove').addEventListener('click', () => {
  const saved = places.savedPlaceNear(app.latitude, app.longitude);
  if (saved) { places.remove(saved.id); savePlaces(); }
  closeSavePopover();
  renderLocation();
});
document.addEventListener('mousedown', event => {
  if (!popover.hidden && !event.target.closest('.save-wrap')) closeSavePopover();
});

$('keep-place').addEventListener('click', () => {
  app.locationRequired = false;
  app.locationMessage = null;
  renderLocation(); renderTime(); pushScene();
});

// ---------------------------------------------------------------- Rendering

let lastMomentText = '';
function renderTime() {
  const { start, end } = interval();
  const zone = app.timeZone;
  $('zone-label').textContent = zoneLabel(app.instant, zone);
  $('event-label').hidden = !app.event;
  $('explore-label').hidden = !!app.event;
  if (app.event) $('event-title').textContent = app.event.title || 'Pasted event';
  $('range-toggle').checked = app.rangeEnabled;
  $('instant-fields').hidden = app.rangeEnabled;
  $('range-fields').hidden = !app.rangeEnabled;
  const setField = (input, date) => { if (document.activeElement !== input) input.value = toInputValue(date, zone); };
  setField($('instant-input'), app.instant);
  setField($('start-input'), app.start);
  setField($('end-input'), app.end);
  $('end-input').min = toInputValue(new Date(app.start.getTime() + 60_000), zone);
  $('all-day-note').hidden = !(app.event?.allDay && !app.rangeEnabled);
  const scrub = $('scrub');
  const upper = app.rangeEnabled ? end : new Date(end.getTime() - 1000);
  scrub.min = String(Math.floor(start.getTime() / 1000));
  scrub.max = String(Math.max(Math.floor(start.getTime() / 1000), Math.floor(upper.getTime() / 1000)));
  scrub.value = String(Math.floor(clamped(app.instant, { start, end: upper }).getTime() / 1000));
  const moment = formatMoment(app.instant, zone, navigator.language);
  scrub.setAttribute('aria-valuetext', moment);
  if (moment !== lastMomentText) { $('moment-text').textContent = moment; lastMomentText = moment; }
  const backward = app.isPlaying && app.direction < 0, forward = app.isPlaying && app.direction > 0;
  $('play').classList.toggle('playing', forward);
  $('play').title = forward ? 'Pause' : 'Play forward';
  $('play').setAttribute('aria-label', $('play').title);
  $('play-back').classList.toggle('reverse-on', backward);
  $('play-back').title = backward ? 'Pause backward playback' : 'Play backward';
  $('play-back').setAttribute('aria-label', $('play-back').title);
  for (const id of ['play', 'play-back']) $(id).disabled = app.locationRequired;
  $('speed').value = String(prefs.playbackSpeed);
  $('weather-toggle').checked = prefs.weatherEnabled;
  $('turntable-toggle').checked = prefs.idleOrbit;
  $('turntable-toggle').disabled = app.reducedMotion;
  $('turntable-label').title = app.reducedMotion ? 'Reduce motion is on, so the aerial view stays still' : 'Slowly circle the aerial view around the flag when it is left alone for 30 seconds';
  renderStatus();
}

function renderStatus() {
  const label = $('weather-label');
  label.classList.toggle('clear', !prefs.weatherEnabled);
  label.textContent = prefs.weatherEnabled ? app.weatherLabel : 'Clear-sky preview';
  const loading = $('scene-loading');
  loading.hidden = app.sceneReady || app.locationRequired;
  $('scene-loading-text').textContent = app.sceneMessage;
}

function renderLocation() {
  const saved = places.savedPlaceNear(app.latitude, app.longitude);
  $('save-place').classList.toggle('active', !!saved);
  $('save-place').title = saved ? `Saved as ${saved.label}` : 'Save this place';
  $('save-place').setAttribute('aria-label', $('save-place').title);
  $('location-message').hidden = !app.locationMessage;
  $('location-message').textContent = app.locationMessage ?? '';
  const overlay = $('scene-overlay');
  overlay.hidden = !app.locationRequired;
  if (app.locationRequired) {
    $('overlay-title').textContent = 'Choose a location';
    $('overlay-body').textContent = app.locationMessage ?? `Search or ${coarse ? 'tap' : 'click'} the map to choose where to stand.`;
    $('keep-place').hidden = !app.name;
    $('keep-place').textContent = `Use ${app.name}`;
  }
  renderChips();
  renderStatus();
}

// ---------------------------------------------------------------- Controls

$('instant-input').addEventListener('change', event => { const date = fromInputValue(event.target.value, app.timeZone); if (date) chooseInstant(date); });
$('start-input').addEventListener('change', event => { const date = fromInputValue(event.target.value, app.timeZone); if (date) chooseStart(date); });
$('end-input').addEventListener('change', event => { const date = fromInputValue(event.target.value, app.timeZone); if (date) chooseEnd(date); });
for (const button of document.querySelectorAll('.now')) {
  button.addEventListener('click', () => (button.dataset.field === 'start' ? chooseStart(new Date()) : chooseInstant(new Date())));
}
$('range-toggle').addEventListener('change', event => { clearEvent(); setRangeEnabled(event.target.checked); });
$('scrub').addEventListener('input', event => { app.isPlaying = false; setInstant(new Date(Number(event.target.value) * 1000)); });
$('play').addEventListener('click', () => play(1));
$('play-back').addEventListener('click', () => play(-1));
$('speed').addEventListener('change', event => { prefs.playbackSpeed = Number(event.target.value) || 300; savePrefs(); });
$('weather-toggle').addEventListener('change', event => { prefs.weatherEnabled = event.target.checked; savePrefs(); renderTime(); pushScene(); });
$('turntable-toggle').addEventListener('change', event => { prefs.idleOrbit = event.target.checked; savePrefs(); renderTime(); pushScene(); });
$('reset-event').addEventListener('click', resetToEvent);

// Settings and About
const settings = $('settings');
$('open-settings').addEventListener('click', () => {
  $('detail-select').value = prefs.detail;
  $('motion-toggle').checked = app.reducedMotion;
  $('turntable-setting').checked = prefs.idleOrbit;
  $('turntable-setting').disabled = app.reducedMotion;
  $('snow-toggle').checked = prefs.snowCover;
  $('shadows-toggle').checked = prefs.computedShadows;
  $('diagnostics-toggle').checked = app.diagnostics;
  $('key-input').value = store.get('googleKey', '');
  settings.showModal();
});
$('detail-select').addEventListener('change', event => { prefs.detail = event.target.value; savePrefs(); pushScene(); });
$('motion-toggle').addEventListener('change', event => { app.reducedMotion = event.target.checked; $('turntable-setting').disabled = app.reducedMotion; renderTime(); pushScene(); });
$('turntable-setting').addEventListener('change', event => { prefs.idleOrbit = event.target.checked; savePrefs(); renderTime(); pushScene(); });
$('snow-toggle').addEventListener('change', event => { prefs.snowCover = event.target.checked; savePrefs(); pushScene(); });
$('shadows-toggle').addEventListener('change', event => { prefs.computedShadows = event.target.checked; savePrefs(); pushScene(); });
$('diagnostics-toggle').addEventListener('change', event => { app.diagnostics = event.target.checked; pushScene(); });
settings.addEventListener('close', () => {
  const key = $('key-input').value.trim();
  if (key === store.get('googleKey', '')) return;
  store.set('googleKey', key);
  // A new key needs a fresh start of the map and the scene.
  location.reload();
});
$('open-about').addEventListener('click', () => $('about').showModal());
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { app.reducedMotion = event.matches; renderTime(); pushScene(); });

// ---------------------------------------------------------------- Toast

let toastTimer;
function showToast(text) {
  const toast = $('toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
}

// ---------------------------------------------------------------- Start

function applyLink() {
  const link = decodeLink(location.hash);
  if (!link) return false;
  if (link.time) {
    app.rangeEnabled = !!link.rangeEnabled;
    if (link.rangeEnabled) { app.start = link.start; app.end = link.end; }
    app.instant = link.time;
  }
  app.event = null;
  setLocation({ latitude: link.latitude, longitude: link.longitude, name: link.name, origin: 'point' });
  return true;
}

function start() {
  if (coarse) {
    document.querySelector('.map-hint').textContent = 'Tap the map to choose where to stand';
    $('overlay-body').textContent = 'Search or tap the map to choose where to stand.';
  }
  const last = store.get('lastPlace', null);
  if (last && Number.isFinite(last.latitude) && Number.isFinite(last.longitude)) {
    const fresh = Date.now() - (last.fetchedAt ?? 0) <= 30 * 86_400_000;
    Object.assign(app, { latitude: last.latitude, longitude: last.longitude, origin: last.origin === 'search' ? 'search' : 'point', placeId: last.placeId ?? null });
    app.name = fresh ? last.name ?? null : null;
    app.fetchedAt = fresh ? last.fetchedAt : Date.now();
  }
  app.timeZone = zoneAt(app.latitude, app.longitude);
  if (!applyLink()) {
    if (!app.name) setLocation({ latitude: app.latitude, longitude: app.longitude, origin: app.origin, placeId: app.placeId }, { recenter: false });
  }
  renderTime(); renderLocation();
  addEventListener('hashchange', () => { if (applyLink()) renderTime(); });

  loadGoogleMaps(app.googleKey).then(googleMaps => {
    maps = googleMaps;
    mapView = createMap(maps, $('map'), { latitude: app.latitude, longitude: app.longitude, onPick: point => {
      closeResults();
      searchInput.value = '';
      setLocation({ ...point, origin: 'point' }, { recenter: false });
    } });
    mapView.face(app.heading);
    search = createSearch(maps);
    if (!app.name || app.name === `${app.latitude.toFixed(4)}, ${app.longitude.toFixed(4)}`) {
      setLocation({ latitude: app.latitude, longitude: app.longitude, origin: app.origin, placeId: app.placeId }, { recenter: false });
    }
    if (searchInput.value.trim().length >= 2) searchInput.dispatchEvent(new Event('input'));
  }).catch(error => mapUnavailable(error));
  whenKeyRefused(() => mapUnavailable(new Error('Google refused this site’s key')));
}

function mapUnavailable(error) {
  $('map-unavailable').hidden = false;
  $('map-unavailable-text').textContent = app.googleKey
    ? `The map and place search aren’t available right now (${error.message}). You can still use Here, saved places and links.`
    : 'The map and place search need a Google Maps key, which this copy of WhenScape doesn’t have. You can still use Here, saved places and links.';
  searchInput.disabled = true;
  searchInput.placeholder = 'Place search unavailable';
}

start();

// For integration tests: the app's state, with no saved places or keys.
Object.defineProperty(globalThis, 'whenScapeSite', { value: {
  get state() { return { latitude: app.latitude, longitude: app.longitude, name: app.name, timeZone: app.timeZone, instant: app.instant.toISOString(), start: app.start.toISOString(), end: app.end.toISOString(), rangeEnabled: app.rangeEnabled, locationRequired: app.locationRequired, event: app.event ? { title: app.event.title, allDay: app.event.allDay } : null, sceneReady: app.sceneReady }; },
} });

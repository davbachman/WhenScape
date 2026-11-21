// The browser's saved places (Home, Work and any others named) and the few
// places chosen most recently, kept in this browser only. Two places closer
// than SAME_PLACE metres count as the same spot.
//
// Google's terms let an app keep coordinates from Google's place search, and
// names from its address lookup, for at most 30 days (place IDs may be kept).
// So each place notes where it came from and when:
//   origin "search": found by search; its place ID is kept, and after 30 days
//     its name and coordinates are dropped and looked up again when used.
//   origin "point": a spot the user chose (a map click, Here, a link); its
//     coordinates are theirs to keep, and after 30 days only the looked-up
//     name is dropped.
// Recent places are simply forgotten after 30 days.

export const RECENT_LIMIT = 5;
export const SAME_PLACE = 75;
export const KEEP_FOR = 30 * 86_400_000;

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** Great-circle distance in metres. */
export function distance(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

const located = place => Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude);
const sameSpot = (a, b) => located(a) && located(b) && distance(a.latitude, a.longitude, b.latitude, b.longitude) < SAME_PLACE;
const rank = place => ({ home: 0, work: 1 })[place.label?.toLowerCase()] ?? 2;

/** The label for a saved place, or the name for a recent one. */
export function placeTitle(place) {
  return place.label || place.name || (located(place) ? `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}` : 'Saved place');
}

function clean(place) {
  return {
    id: typeof place.id === 'string' ? place.id : newId(),
    label: typeof place.label === 'string' && place.label.trim() ? place.label.trim() : null,
    name: typeof place.name === 'string' && place.name.trim() ? place.name.trim() : null,
    latitude: Number.isFinite(place.latitude) ? place.latitude : null,
    longitude: Number.isFinite(place.longitude) ? place.longitude : null,
    timeZone: typeof place.timeZone === 'string' ? place.timeZone : null,
    placeId: typeof place.placeId === 'string' ? place.placeId : null,
    origin: place.origin === 'search' ? 'search' : 'point',
    fetchedAt: Number.isFinite(place.fetchedAt) ? place.fetchedAt : Date.now(),
  };
}

/**
 * A place past Google's 30 days, with what Google supplied removed. Returns
 * the same object when nothing needs to change.
 */
export function expire(place, now = Date.now()) {
  if (now - place.fetchedAt <= KEEP_FOR) return place;
  if (place.origin === 'search') return { ...place, name: null, latitude: null, longitude: null };
  return place.name ? { ...place, name: null } : place;
}

/** Whether a place has to be looked up again before it can be used. */
export const needsLookup = place => !located(place);

export class PlaceBook {
  constructor({ saved = [], recent = [] } = {}) {
    this.saved = Array.isArray(saved) ? saved.map(clean) : [];
    this.recent = Array.isArray(recent) ? recent.map(clean) : [];
  }

  static from(json) {
    try { return new PlaceBook(JSON.parse(json ?? '{}') ?? {}); } catch { return new PlaceBook(); }
  }

  toJSON() { return { saved: this.saved, recent: this.recent }; }

  /** Applies Google's 30-day limit. Returns whether anything changed. */
  prune(now = Date.now()) {
    const before = JSON.stringify(this);
    this.saved = this.saved.map(place => expire(place, now));
    this.recent = this.recent.filter(place => now - place.fetchedAt <= KEEP_FOR);
    return JSON.stringify(this) !== before;
  }

  /**
   * Saves a place under a label. It replaces a saved place with the same
   * label (so saving a new Home moves Home) and any saved place at the same
   * spot (so saving again renames it). Home and Work stay first.
   */
  save(place, label) {
    const name = String(label ?? '').trim();
    if (!name) return null;
    const entry = clean({ ...place, id: newId(), label: name });
    const kept = this.saved.filter(saved => saved.label?.toLowerCase() !== name.toLowerCase() && !sameSpot(saved, entry));
    this.saved = [...kept, entry]
      .map((value, index) => ({ value, index }))
      .sort((a, b) => rank(a.value) - rank(b.value) || a.index - b.index)
      .map(({ value }) => value);
    return entry;
  }

  /** Replaces a stored place after it has been looked up again. */
  update(id, changes) {
    const apply = list => list.map(place => (place.id === id ? clean({ ...place, ...changes, id }) : place));
    this.saved = apply(this.saved);
    this.recent = apply(this.recent);
  }

  remove(id) {
    this.saved = this.saved.filter(place => place.id !== id);
    this.recent = this.recent.filter(place => place.id !== id);
  }

  /** Puts a place first among the recent ones, replacing an older visit to the same spot. */
  noteVisit(place) {
    if (!located(place)) return;
    const entry = clean({ ...place, id: newId(), label: null });
    this.recent = [entry, ...this.recent.filter(recent => !sameSpot(recent, entry))].slice(0, RECENT_LIMIT);
  }

  /** The saved place at this spot, if any. */
  savedPlaceNear(latitude, longitude) {
    return this.saved.find(place => sameSpot(place, { latitude, longitude })) ?? null;
  }

  /** The saved place with this label, ignoring case, if any. */
  savedWithLabel(label) {
    const name = String(label ?? '').trim().toLowerCase();
    return this.saved.find(place => place.label?.toLowerCase() === name) ?? null;
  }

  /** Recent places that are not also saved. */
  get unsavedRecents() {
    return this.recent.filter(place => !this.saved.some(saved => sameSpot(saved, place)));
  }
}

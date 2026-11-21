// Google Maps in the browser app: the 2D map, place search and naming a
// clicked spot. Google's terms ask that its 3D tiles be used with Google's
// own map and search, so all three come from Google, with the site's key.

let loading, onAuthFailure;

/**
 * Loads the Maps JavaScript API once. Resolves to google.maps, or rejects if
 * there is no key, the script cannot load, or Google refuses the key.
 */
export function loadGoogleMaps(key, { timeout = 20_000 } = {}) {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!key) { reject(new Error('No Google Maps key')); return; }
    if (globalThis.google?.maps?.Map) { resolve(globalThis.google.maps); return; }
    const timer = setTimeout(() => reject(new Error('Google Maps did not respond')), timeout);
    globalThis.__whenScapeMapsReady = () => { clearTimeout(timer); resolve(globalThis.google.maps); };
    // Google calls this when it refuses the key, for example on a site the key is not for.
    globalThis.gm_authFailure = () => { clearTimeout(timer); reject(new Error('Google refused this site’s key')); onAuthFailure?.(); };
    const params = new URLSearchParams({ key, v: 'weekly', loading: 'async', libraries: 'places,geocoding', callback: '__whenScapeMapsReady' });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => { clearTimeout(timer); reject(new Error('Google Maps could not load')); };
    document.head.append(script);
  });
  return loading;
}

/** Called if Google refuses the key after the map has loaded. */
export function whenKeyRefused(callback) { onAuthFailure = callback; }

// A Maps library by name; older loads keep places under maps.places and the geocoder on maps.
async function library(maps, name) {
  if (maps.importLibrary) return maps.importLibrary(name);
  return name === 'places' ? maps.places : maps;
}

/**
 * The map with the observer's marker. `onPick(latLng)` is called when the
 * map is clicked. The marker is an HTML overlay, so the map needs no Map ID.
 */
export function createMap(maps, element, { latitude, longitude, onPick }) {
  const map = new maps.Map(element, {
    center: { lat: latitude, lng: longitude }, zoom: 15,
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    clickableIcons: false, keyboardShortcuts: true, gestureHandling: 'auto',
  });
  class Marker extends maps.OverlayView {
    constructor() {
      super();
      this.position = { lat: latitude, lng: longitude };
      this.element = document.createElement('div');
      this.element.className = 'observer-marker';
      this.element.setAttribute('aria-hidden', 'true');
      this.element.innerHTML = '<span class="halo"></span><svg viewBox="0 0 24 24"><path d="M12 2.5 19 20.5 12 16.6 5 20.5Z"/></svg>';
    }
    onAdd() { this.getPanes().overlayLayer.append(this.element); }
    onRemove() { this.element.remove(); }
    draw() {
      const point = this.getProjection()?.fromLatLngToDivPixel(new maps.LatLng(this.position));
      if (!point) return;
      this.element.style.left = `${point.x}px`;
      this.element.style.top = `${point.y}px`;
    }
    moveTo(lat, lng) { this.position = { lat, lng }; this.draw(); }
    face(degrees) { this.element.style.setProperty('--heading', `${degrees}deg`); }
  }
  const marker = new Marker();
  marker.setMap(map);
  map.addListener('click', event => {
    if (!event.latLng) return;
    event.stop?.();
    onPick({ latitude: event.latLng.lat(), longitude: event.latLng.lng() });
  });
  return {
    map,
    moveMarker(lat, lng) { marker.moveTo(lat, lng); },
    face(degrees) { marker.face(degrees); },
    center(lat, lng) { map.panTo({ lat, lng }); },
    /** Pans to the observer only if it has left the visible map. */
    reveal(lat, lng) {
      const bounds = map.getBounds?.();
      if (!bounds || !bounds.contains({ lat, lng })) map.panTo({ lat, lng });
    },
  };
}

/**
 * Place search as you type. Each search shares a session token with the
 * place lookup that ends it, as Google's pricing expects.
 */
export function createSearch(maps) {
  let places, token;
  const ready = library(maps, 'places').then(lib => { places = lib; });
  const newToken = () => { token = new places.AutocompleteSessionToken(); };
  return {
    /** Up to five suggestions: { id, main, secondary, prediction }. */
    async suggest(input, { latitude, longitude } = {}) {
      await ready;
      if (!token) newToken();
      const request = { input, sessionToken: token };
      if (Number.isFinite(latitude)) request.locationBias = { center: { lat: latitude, lng: longitude }, radius: 50_000 };
      const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
      return suggestions.filter(item => item.placePrediction).slice(0, 5).map(({ placePrediction: p }) => ({
        id: p.placeId, main: p.mainText?.text ?? p.text?.text ?? '', secondary: p.secondaryText?.text ?? '', prediction: p,
      }));
    },
    /** The coordinates of a chosen suggestion. Only basic fields are asked for, to keep its cost low. */
    async locate(suggestion) {
      await ready;
      const place = suggestion.prediction.toPlace();
      await place.fetchFields({ fields: ['location', 'formattedAddress'] });
      newToken();
      return { latitude: place.location.lat(), longitude: place.location.lng(), address: place.formattedAddress ?? '' };
    },
    /** The coordinates of a saved place, by its place ID, after Google's 30 days. */
    async locateId(placeId) {
      await ready;
      const place = new places.Place({ id: placeId });
      await place.fetchFields({ fields: ['location', 'formattedAddress'] });
      return { latitude: place.location.lat(), longitude: place.location.lng(), address: place.formattedAddress ?? '' };
    },
  };
}

/** A short name for a spot, such as "1050 N Mills Ave, Claremont", or null. */
export async function nameSpot(maps, latitude, longitude) {
  const lib = await library(maps, 'geocoding');
  const Geocoder = lib.Geocoder ?? maps.Geocoder;
  const { results } = await new Geocoder().geocode({ location: { lat: latitude, lng: longitude } });
  const address = results?.[0]?.formatted_address;
  if (!address) return null;
  return address.split(', ').slice(0, 2).join(', ');
}

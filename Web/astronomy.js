import * as Astronomy from 'astronomy-engine';

/** Pure, renderer-independent topocentric astronomy. Angles in degrees. */
export function calculateAstronomy({ latitude, longitude, time, elevation = 1.7 }) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new RangeError('A valid instant and geographic coordinates are required.');
  }
  const observer = new Astronomy.Observer(latitude, longitude, elevation);
  const position = body => {
    const equator = Astronomy.Equator(body, date, observer, true, true);
    const horizon = Astronomy.Horizon(date, observer, equator.ra, equator.dec, 'normal');
    return { altitude: horizon.altitude, azimuth: horizon.azimuth,
      rightAscension: equator.ra, declination: equator.dec };
  };
  const sun = position(Astronomy.Body.Sun);
  const moon = position(Astronomy.Body.Moon);
  const illumination = Astronomy.Illumination(Astronomy.Body.Moon, date);
  const phaseAngle = Astronomy.MoonPhase(date);
  return {
    sun, moon, moonIlluminatedFraction: illumination.phase_fraction,
    moonPhaseAngle: phaseAngle,
    moonPhaseName: phaseName(phaseAngle),
    light: sun.altitude >= 0 ? 'Daylight' : sun.altitude >= -6 ? 'Civil twilight'
      : sun.altitude >= -12 ? 'Nautical twilight' : sun.altitude >= -18 ? 'Astronomical twilight' : 'Night',
  };
}

export function phaseName(angle) {
  return ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
    'Full Moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'][Math.floor((((angle % 360) + 360) % 360 + 22.5) / 45) % 8];
}

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
export function compassName(degrees) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((degrees % 360 + 360) % 360) / 45) % 8];
}

/**
 * The Sun's path over the solar day containing `time`: samples from one local
 * solar midnight to the next, plus that day's sunrise and sunset if they occur.
 * Using the solar day keeps the daylight stretch in one piece without needing
 * the civil time zone.
 */
export function sunTrack({ latitude, longitude, time, stepMinutes = 10, elevation = 1.7 }) {
  const instant = new Date(time).getTime();
  if (!Number.isFinite(instant) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new RangeError('A valid instant and geographic coordinates are required.');
  }
  const day = 86400000, solarOffset = longitude / 15 * 3600000;
  const start = Math.floor((instant + solarOffset) / day) * day - solarOffset;
  const observer = new Astronomy.Observer(latitude, longitude, elevation);
  const at = ms => {
    const date = new Date(ms);
    const equator = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
    const horizon = Astronomy.Horizon(date, observer, equator.ra, equator.dec, 'normal');
    return { time: ms, altitude: horizon.altitude, azimuth: horizon.azimuth };
  };
  const samples = [];
  for (let ms = start; ms <= start + day; ms += stepMinutes * 60000) samples.push(at(ms));
  const event = direction => {
    const found = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, direction, new Date(start), 1);
    return found && found.date.getTime() <= start + day ? at(found.date.getTime()) : null;
  };
  return { start, end: start + day, samples, sunrise: event(+1), sunset: event(-1), at };
}

/** The Moon's next rise and set after `time`, as epoch milliseconds, or null if none within two days. */
export function moonEvents({ latitude, longitude, time, elevation = 1.7 }) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new RangeError('A valid instant and geographic coordinates are required.');
  }
  const observer = new Astronomy.Observer(latitude, longitude, elevation);
  const next = direction => Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, direction, date, 2)?.date.getTime() ?? null;
  return { rise: next(+1), set: next(-1) };
}

const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];

/**
 * The five planets you can see without a telescope, as seen from the place:
 * where they are among the stars (J2000 right ascension and declination in
 * degrees, the frame of the constellation figures), where they are in the sky
 * (altitude and azimuth) and how bright (magnitude: lower is brighter).
 */
export function planetPositions({ latitude, longitude, time, elevation = 1.7 }) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new RangeError('A valid instant and geographic coordinates are required.');
  }
  const observer = new Astronomy.Observer(latitude, longitude, elevation);
  return PLANETS.map(name => {
    const body = Astronomy.Body[name];
    const amongStars = Astronomy.Equator(body, date, observer, false, true);
    const ofDate = Astronomy.Equator(body, date, observer, true, true);
    const sky = Astronomy.Horizon(date, observer, ofDate.ra, ofDate.dec, 'normal');
    return { name, ra: amongStars.ra * 15, dec: amongStars.dec, altitude: sky.altitude, azimuth: sky.azimuth,
      magnitude: Astronomy.Illumination(body, date).mag };
  });
}

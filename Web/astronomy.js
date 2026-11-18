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

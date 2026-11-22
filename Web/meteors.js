// Meteor showers: when each is active, how many meteors to expect from a
// place, and where in the sky they seem to come from (the radiant).
//
// Dates, radiants, speeds and peak rates follow the International Meteor
// Organization's working list of major showers, approximately. Activity is
// modelled the IMO's way: the zenithal hourly rate (ZHR, what one observer
// would count under a perfectly dark sky with the radiant overhead) falls
// exponentially either side of the peak in solar longitude. What a person
// would actually see is lower: by the radiant's height, by twilight, and by
// moonlight, which drowns the fainter meteors.
import * as Astronomy from 'astronomy-engine';

const DAY = 86_400_000;

// peak: the Sun's longitude at the peak (J2000, degrees, about one a day);
// active: the first and last day, as solar longitudes; zhr: the peak rate;
// slope: how fast activity falls before and after the peak (the IMO's B, in
// powers of ten per degree); r: the population index, how fast the count
// grows with fainter meteors; ra, dec: the radiant at the peak (J2000,
// degrees); drift: its motion each day in ra and dec; speed: km/s.
export const SHOWERS = [
  { name: 'Quadrantids', peak: 283.15, active: [276.1, 291.4], zhr: 80, slope: [2.5, 2.5], r: 2.1, ra: 230, dec: 49, drift: [0.8, -0.2], speed: 41 },
  { name: 'Lyrids', peak: 32.32, active: [23.7, 39.3], zhr: 18, slope: [0.9, 0.9], r: 2.1, ra: 271, dec: 34, drift: [1.1, 0], speed: 49 },
  { name: 'Eta Aquariids', peak: 45.5, active: [28.6, 66.3], zhr: 50, slope: [0.08, 0.08], r: 2.4, ra: 338, dec: -1, drift: [0.9, 0.4], speed: 66 },
  { name: 'Southern Delta Aquariids', peak: 127, active: [109.3, 149.5], zhr: 25, slope: [0.091, 0.091], r: 2.5, ra: 340, dec: -16, drift: [0.8, 0.2], speed: 41 },
  { name: 'Alpha Capricornids', peak: 127, active: [100.7, 141.8], zhr: 5, slope: [0.1, 0.1], r: 2.5, ra: 307, dec: -10, drift: [0.6, 0.2], speed: 23 },
  { name: 'Perseids', peak: 140.0, active: [114.1, 150.5], zhr: 100, slope: [0.2, 0.4], r: 2.2, ra: 48, dec: 58, drift: [1.35, 0.25], speed: 59 },
  { name: 'Draconids', peak: 195.4, active: [192.4, 196.3], zhr: 10, slope: [1, 1], r: 2.6, ra: 262, dec: 54, drift: [0, 0], speed: 20 },
  { name: 'Southern Taurids', peak: 197, active: [166.9, 237.3], zhr: 5, slope: [0.03, 0.03], r: 2.3, ra: 32, dec: 9, drift: [0.8, 0.25], speed: 27 },
  { name: 'Orionids', peak: 208, active: [188.4, 224.2], zhr: 20, slope: [0.12, 0.12], r: 2.5, ra: 95, dec: 16, drift: [0.7, 0.1], speed: 66 },
  { name: 'Northern Taurids', peak: 230, active: [206.2, 257.5], zhr: 5, slope: [0.03, 0.03], r: 2.3, ra: 58, dec: 22, drift: [0.75, 0.15], speed: 29 },
  { name: 'Leonids', peak: 235.27, active: [223.2, 247.4], zhr: 15, slope: [0.4, 0.4], r: 2.5, ra: 152, dec: 22, drift: [0.7, -0.4], speed: 71 },
  { name: 'Geminids', peak: 262.2, active: [251.5, 267.7], zhr: 150, slope: [0.39, 0.81], r: 2.6, ra: 112, dec: 33, drift: [1.0, -0.1], speed: 35 },
  { name: 'Ursids', peak: 270.7, active: [264.7, 273.8], zhr: 10, slope: [0.6, 0.6], r: 3.0, ra: 217, dec: 76, drift: [0, 0], speed: 33 },
];

// Precession moves the equinox about 50 arcseconds a year; the IMO's solar
// longitudes are referred to the equinox of J2000.
const PRECESSION = 0.013969;
const J2000 = Date.UTC(2000, 0, 1, 12);
const wrap180 = degrees => ((((degrees + 180) % 360) + 360) % 360) - 180;

/** The Sun's ecliptic longitude at a moment, in degrees, referred to J2000 as the IMO's list is. */
export function solarLongitude(time) {
  const date = new Date(time);
  const years = (date.getTime() - J2000) / (365.25 * DAY);
  return (((Astronomy.SunPosition(date).elon - PRECESSION * years) % 360) + 360) % 360;
}

/** Degrees of solar longitude (about days) from a shower's peak: negative before it. */
export function fromPeak(shower, longitude) { return wrap180(longitude - shower.peak); }

/** Whether a shower is active at a solar longitude. */
export function isActive(shower, longitude) {
  const [first, last] = shower.active;
  return (((longitude - first) % 360) + 360) % 360 <= (((last - first) % 360) + 360) % 360;
}

/** A shower's zenithal hourly rate at a solar longitude: none outside its active days. */
export function showerZHR(shower, longitude) {
  if (!isActive(shower, longitude)) return 0;
  const offset = fromPeak(shower, longitude);
  return shower.zhr * 10 ** -((offset < 0 ? shower.slope[0] : shower.slope[1]) * Math.abs(offset));
}

/** Where the radiant is among the stars at a solar longitude, having drifted from its place at the peak. */
export function radiantAt(shower, longitude) {
  const days = fromPeak(shower, longitude);
  return { ra: (((shower.ra + shower.drift[0] * days) % 360) + 360) % 360, dec: shower.dec + shower.drift[1] * days };
}

/**
 * Meteors an hour that one person would see from a dark site (no light
 * pollution, no cloud): the ZHR lowered by the radiant's height (none while it
 * is below the horizon), and by twilight and moonlight, which raise the sky's
 * brightness and so hide the fainter meteors. Altitudes in degrees.
 */
export function visibleRate({ zhr, r, radiantAltitude, sunAltitude, moonAltitude, moonFraction }) {
  if (!(zhr > 0) || radiantAltitude <= 0 || sunAltitude > -12) return 0;
  // Magnitudes lost from a dark sky's faintest visible star, about 6.5.
  const twilight = sunAltitude > -18 ? ((sunAltitude + 18) / 6) * 1.5 : 0;
  const moon = moonAltitude > 0 ? moonFraction * (0.4 + 0.6 * Math.min(moonAltitude / 30, 1)) * 1.6 : 0;
  return zhr * Math.sin((radiantAltitude * Math.PI) / 180) * r ** -(twilight + moon);
}

/**
 * The showers worth showing at a moment and place, busiest first: each one
 * active with a ZHR of at least `least`, with its radiant among the stars and
 * in the sky, the rate a person would see now, and when it peaks.
 */
export function activeShowers({ latitude, longitude, time, sunAltitude, moonAltitude, moonFraction, least = 3 }) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  const solar = solarLongitude(date);
  const observer = new Astronomy.Observer(latitude, longitude, 0);
  const found = [];
  for (const shower of SHOWERS) {
    const zhr = showerZHR(shower, solar);
    if (zhr < least) continue;
    const radiant = radiantAt(shower, solar);
    // The radiant is in J2000; the 0.4° of precession since is too little to matter here.
    const sky = Astronomy.Horizon(date, observer, radiant.ra / 15, radiant.dec, 'normal');
    const offset = fromPeak(shower, solar);
    found.push({
      name: shower.name, zhr, peakZHR: shower.zhr, speed: shower.speed, ...radiant,
      altitude: sky.altitude, azimuth: sky.azimuth,
      rate: visibleRate({ zhr, r: shower.r, radiantAltitude: sky.altitude, sunAltitude, moonAltitude, moonFraction }),
      // The Sun moves about 0.9856° of longitude a day.
      peak: date.getTime() - (offset / 0.9856) * DAY,
    });
  }
  return found.sort((a, b) => b.zhr - a.zhr);
}

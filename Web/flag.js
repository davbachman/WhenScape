// A flag planted at the selected point. It streams downwind, hangs when calm,
// and its shadow on the ground points away from the Sun. Offsets are metres
// east and north of the pole; heights are metres above its base.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const radians = degrees => degrees * Math.PI / 180;

/** How far the cloth is blown out: 0 hanging, 1 fully streaming. */
export function flagExtension(windSpeed, windFrom) {
  if (windSpeed == null || windFrom == null || !(windSpeed > 0.25)) return 0;
  return clamp((windSpeed - 0.25) / 8, 0, 1);
}

/**
 * The cloth as columns from the pole outward, each with a top and bottom
 * height. `windFrom` is the direction the wind comes from, in degrees
 * clockwise from north, so the cloth points the opposite way.
 */
export function flagShape({ height, windSpeed, windFrom, phase = 0, columns = 12 }) {
  const extension = flagExtension(windSpeed, windFrom);
  const azimuth = extension > 0 ? radians(windFrom + 180) : Math.PI / 2;
  const along = { e: Math.sin(azimuth), n: Math.cos(azimuth) };
  const across = { e: along.n, n: -along.e };
  const length = height * 0.42, hoist = height * 0.26, peak = height * 0.98;
  const points = [];
  for (let i = 0; i <= columns; i++) {
    const u = i / columns;
    const reach = length * u * (0.12 + 0.88 * extension);
    const wave = extension * length * 0.07 * u * Math.sin(u * 7 - phase);
    const lift = extension * hoist * 0.06 * u * Math.sin(u * 9 - phase * 1.3);
    const top = peak - (1 - extension) * length * u * 0.85 + lift;
    points.push({ e: along.e * reach + across.e * wave, n: along.n * reach + across.n * wave, top, bottom: top - hoist });
  }
  return points;
}

/**
 * Where the shadow of a point `up` metres above the ground falls, as an
 * offset from the spot directly beneath it. Very long shadows near sunrise
 * and sunset are capped so they stay inside the view.
 */
export function shadowOffset(up, sunAltitude, sunAzimuth, longest = 8) {
  const stretch = Math.min(1 / Math.tan(radians(Math.max(sunAltitude, 0.5))), longest);
  const away = radians(sunAzimuth + 180);
  return { e: Math.sin(away) * up * stretch, n: Math.cos(away) * up * stretch };
}

/** Ground outline of the cloth's shadow, using the cloth at rest in the wind. */
export function flagShadow({ height, windSpeed, windFrom, sunAltitude, sunAzimuth }) {
  const cloth = flagShape({ height, windSpeed, windFrom, phase: 0, columns: 6 });
  const cast = (point, up) => {
    const offset = shadowOffset(up, sunAltitude, sunAzimuth);
    return { e: point.e + offset.e, n: point.n + offset.n };
  };
  return [...cloth.map(p => cast(p, p.top)), ...cloth.reverse().map(p => cast(p, p.bottom))];
}

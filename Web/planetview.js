// Draws the five naked-eye planets among the stars: each a point sized by its
// brightness, in its own colour, with its name beside it. They sit in the sky
// frame (skyframe.js) with the constellations. Like the stars they are drawn
// translucent, so the painted sky lets them show through a dark or clear sky,
// dims them by day and behind cloud, and hides them behind buildings and the
// ground.
import { skyPoint } from './skyframe.js';

const COLORS = { Mercury: '#efe4d6', Venus: '#fffaf0', Mars: '#ffb08a', Jupiter: '#fff1dc', Saturn: '#ffe3a6' };

/** A point size in pixels for a magnitude: brilliant Venus largest, a faint Mars smallest. */
export function planetSize(magnitude) {
  return Math.min(9, Math.max(3, 5.2 - 0.9 * magnitude));
}

/**
 * How strongly to draw them, 0–1, from the Sun's altitude in degrees: full
 * after dark, faint by day, when only Venus can sometimes be picked out.
 */
export function planetStrength(sunAltitude) {
  const daylight = Math.min(Math.max((sunAltitude + 10) / 14, 0), 1);
  return 1 - 0.7 * daylight;
}

export function createPlanets(C, viewer) {
  const points = viewer.scene.primitives.add(new C.PointPrimitiveCollection({ blendOption: C.BlendOption.TRANSLUCENT }));
  const names = viewer.scene.primitives.add(new C.LabelCollection({ blendOption: C.BlendOption.TRANSLUCENT }));
  const drawn = new Map();

  return {
    /** Bring them to the moment: `frame` is the sky frame, `planets` from planetPositions(). */
    update({ frame, planets, sunAltitude }) {
      points.modelMatrix = frame;
      names.modelMatrix = frame;
      const strength = planetStrength(sunAltitude);
      for (const planet of planets) {
        let entry = drawn.get(planet.name);
        if (!entry) {
          entry = { color: C.Color.fromCssColorString(COLORS[planet.name] ?? '#ffffff') };
          entry.point = points.add({ color: entry.color });
          entry.label = names.add({ text: planet.name, font: '600 11px -apple-system, "Helvetica Neue", sans-serif',
            horizontalOrigin: C.HorizontalOrigin.LEFT, verticalOrigin: C.VerticalOrigin.CENTER });
          drawn.set(planet.name, entry);
        }
        const position = skyPoint(C, planet.ra, planet.dec);
        const size = planetSize(planet.magnitude);
        entry.point.position = position;
        entry.point.pixelSize = size;
        entry.point.color = entry.color.withAlpha(strength);
        entry.label.position = position;
        entry.label.pixelOffset = new C.Cartesian2(size / 2 + 5, 0);
        entry.label.fillColor = entry.color.withAlpha(0.8 * strength);
      }
    },
  };
}

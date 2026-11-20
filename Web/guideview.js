// Draws the aerial view's guides with Cesium: a compass ring on the ground and
// the day's Sun path overhead, both centred on the flag. The geometry comes
// from guides.js; this module only turns it into entities and lines.
import { domePoint, ringPoints, daylightRuns, hourMarks, clockLabel } from './guides.js';

export function createGuides(C, viewer) {
  const labels = new C.CustomDataSource('guides');
  viewer.dataSources.add(labels);
  const lines = viewer.scene.primitives.add(new C.PrimitiveCollection());
  let layoutKey, sunMarker;

  // A guide line built at once rather than in the background, as entity lines
  // are, so resizing the guides swaps the old lines for the new in one frame
  // instead of leaving a gap. Where it passes behind the mesh it is drawn faintly.
  const line = (positions, width, color, faint) => new C.Primitive({
    geometryInstances: new C.GeometryInstance({
      geometry: new C.PolylineGeometry({ positions, width, arcType: C.ArcType.NONE,
        vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT }),
      attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(color),
        depthFailColor: C.ColorGeometryInstanceAttribute.fromColor(faint) } }),
    appearance: new C.PolylineColorAppearance({ translucent: true }),
    depthFailAppearance: new C.PolylineColorAppearance({ translucent: true }),
    asynchronous: false });

  const ink = C.Color.fromCssColorString('#ffd24a');
  const always = Number.POSITIVE_INFINITY;
  const label = (text, color = C.Color.WHITE, size = 12) => ({ text, font: `600 ${size}px -apple-system, "Helvetica Neue", sans-serif`,
    fillColor: color, outlineColor: C.Color.BLACK.withAlpha(0.75), outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new C.Cartesian2(0, -13), disableDepthTestDistance: always });

  function rebuild({ at, radius, track, zone, event }) {
    const dome = sample => { const p = domePoint(Math.max(sample.altitude, 0), sample.azimuth, radius); return at(p.e, p.n, p.up); };
    labels.entities.removeAll();
    lines.removeAll();
    // A level circle just above the pin's ground height. Draping it over the
    // mesh breaks it up across roofs and trees; where it passes behind them
    // it is drawn faintly instead.
    lines.add(line(ringPoints(radius).map(p => at(p.e, p.n, 1.5)), 2, C.Color.WHITE.withAlpha(0.8), C.Color.WHITE.withAlpha(0.28)));
    // The letters stand well outside the ring, clear of the sunrise and
    // sunset labels, which sit on the ring itself.
    for (const [name, bearing] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
      const p = domePoint(0, bearing, radius * 1.3);
      labels.entities.add({ position: at(p.e, p.n, 1.5), label: { ...label(name, name === 'N' ? C.Color.fromCssColorString('#ffb27a') : C.Color.WHITE, 15),
        pixelOffset: C.Cartesian2.ZERO } });
    }
    for (const run of daylightRuns(track.samples)) {
      const ends = [track.sunrise, ...run, track.sunset].filter(Boolean).sort((a, b) => a.time - b.time);
      lines.add(line(ends.map(dome), 2, ink.withAlpha(0.9), ink.withAlpha(0.3)));
    }
    // The part of the day the selected range covers, drawn heavier.
    if (event) for (const run of daylightRuns(track.samples, event[0], event[1])) {
      const orange = C.Color.fromCssColorString('#ff8a3c');
      lines.add(line(run.map(dome), 6, orange, orange.withAlpha(0.35)));
    }
    if (zone) for (const mark of hourMarks(track.start, track.end, zone)) {
      const sample = track.at(mark.time);
      if (sample.altitude <= 1) continue;
      labels.entities.add({ position: dome(sample), point: { pixelSize: 5, color: C.Color.WHITE, outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1,
        disableDepthTestDistance: always }, label: mark.hour % 3 === 0 ? label(mark.label, C.Color.WHITE, 11) : undefined });
    }
    for (const [name, sample] of [['Sunrise', track.sunrise], ['Sunset', track.sunset]]) {
      if (!sample) continue;
      // Below the dot, so the text does not run along the ring into the letters or the arc.
      labels.entities.add({ position: dome(sample), point: { pixelSize: 7, color: ink, outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1,
        disableDepthTestDistance: always }, label: { ...label(zone ? `${name} ${clockLabel(sample.time, zone)}` : name, ink, 11),
        verticalOrigin: C.VerticalOrigin.TOP, pixelOffset: new C.Cartesian2(0, 9) } });
    }
    sunMarker = labels.entities.add({ point: { pixelSize: 15, color: C.Color.fromCssColorString('#fff3b0'), outlineColor: ink, outlineWidth: 3,
      disableDepthTestDistance: always } });
    return dome;
  }

  let dome;
  return {
    /**
     * Show or hide the guides and bring them up to date. `at(e, n, up)` maps
     * metres from the pin to the globe; `key` changes whenever anything that
     * shapes the guides changes, so they are rebuilt only then. The Sun marker
     * moves on every call.
     */
    update({ shown, key, at, radius, track, zone, event, sun }) {
      labels.show = lines.show = shown;
      if (!shown) return;
      if (key !== layoutKey) { layoutKey = key; dome = rebuild({ at, radius, track, zone, event }); }
      sunMarker.show = !!sun && sun.altitude > 0;
      if (sunMarker.show) sunMarker.position = dome(sun);
    },
  };
}

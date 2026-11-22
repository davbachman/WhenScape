// Draws the constellations among Cesium's own stars: the figures of the 88
// IAU constellations and their names. They sit on a sphere far around the
// place, turned with the sky by the same transform Cesium gives its stars, so
// they stay on them as time passes.
//
// The lines are translucent, so they leave the scene's depth untouched. The
// painted sky (clouds.js) therefore treats them as it treats starlight: they
// show through a clear sky, fade behind cloud and haze, and stay hidden behind
// buildings and the ground.
import { CONSTELLATIONS } from './constellations.js';

// Far enough that moving about the place never shifts them against the stars
// (2 km is a thousandth of a degree), and inside the camera's far plane.
const SKY_RADIUS = 2e8;

/** The direction of a right ascension and declination (degrees), in the sky's own axes. */
export function skyDirection(ra, dec) {
  const a = ra * Math.PI / 180, d = dec * Math.PI / 180;
  return { x: Math.cos(d) * Math.cos(a), y: Math.cos(d) * Math.sin(a), z: Math.sin(d) };
}

/**
 * How strongly to draw them, 0–1, from the Sun's altitude in degrees. The
 * painted sky brightens what shows through it after dark, so the lines stay
 * soft at night; by day they are drawn stronger to show against the blue.
 */
export function constellationStrength(sunAltitude) {
  const daylight = Math.min(Math.max((sunAltitude + 8) / 20, 0), 1);
  return 0.3 + 0.45 * daylight;
}

export function createConstellations(C, viewer) {
  let lines, names, lineMaterial, shownStrength;
  const frame = new C.Matrix4(), rotation = new C.Matrix3();
  const point = (ra, dec) => {
    const d = skyDirection(ra, dec);
    return new C.Cartesian3(d.x * SKY_RADIUS, d.y * SKY_RADIUS, d.z * SKY_RADIUS);
  };

  // Built the first time they are shown, all at once.
  function build() {
    const instances = [];
    for (const [, , , figure] of CONSTELLATIONS) {
      for (const line of figure) {
        const positions = [];
        for (let i = 0; i < line.length; i += 2) positions.push(point(line[i], line[i + 1]));
        // Each segment is a straight chord of the sphere; seen from its centre
        // that is the arc of sky between the two stars.
        instances.push(new C.GeometryInstance({
          geometry: new C.PolylineGeometry({ positions, width: 1.5, arcType: C.ArcType.NONE,
            vertexFormat: C.PolylineMaterialAppearance.VERTEX_FORMAT }),
        }));
      }
    }
    lineMaterial = C.Material.fromType('Color', { color: C.Color.WHITE });
    lines = viewer.scene.primitives.add(new C.Primitive({
      geometryInstances: instances,
      appearance: new C.PolylineMaterialAppearance({ material: lineMaterial, translucent: true }),
      modelMatrix: frame, asynchronous: false, allowPicking: false,
    }));
    names = viewer.scene.primitives.add(new C.LabelCollection({ modelMatrix: frame, blendOption: C.BlendOption.TRANSLUCENT }));
    for (const [name, ra, dec] of CONSTELLATIONS) {
      names.add({ position: point(ra, dec), text: name, font: '600 12px -apple-system, "Helvetica Neue", sans-serif',
        horizontalOrigin: C.HorizontalOrigin.CENTER, verticalOrigin: C.VerticalOrigin.CENTER });
    }
  }

  function setStrength(strength) {
    if (strength === shownStrength) return;
    shownStrength = strength;
    lineMaterial.uniforms.color = C.Color.fromCssColorString('#8fb4f0').withAlpha(strength * 0.75);
    const text = C.Color.fromCssColorString('#b8cff5').withAlpha(Math.min(1, strength * 0.95));
    for (let i = 0; i < names.length; i++) names.get(i).fillColor = text;
  }

  return {
    /**
     * Show or hide them, and bring them to the moment: `time` is the scene's
     * JulianDate, `center` the place (a Cartesian3), `sunAltitude` in degrees.
     */
    update({ shown, time, center, sunAltitude }) {
      if (!shown) {
        if (lines) lines.show = names.show = false;
        return;
      }
      if (!lines) build();
      lines.show = names.show = true;
      C.Transforms.computeTemeToPseudoFixedMatrix(time, rotation);
      C.Matrix4.fromRotationTranslation(rotation, center, frame);
      lines.modelMatrix = frame;
      names.modelMatrix = frame;
      // Steps of a tenth keep the 89 names from being recoloured on every frame of playback.
      setStrength(Math.round(constellationStrength(sunAltitude) * 10) / 10);
    },
  };
}

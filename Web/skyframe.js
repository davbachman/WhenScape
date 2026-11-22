// The sky's own frame, shared by everything drawn among the stars:
// constellations, planets and meteor shower radiants. Positions are right
// ascension and declination (J2000, degrees) on a sphere far around the place,
// and the frame turns them with the sky by the same transform Cesium gives its
// stars, so all of them stay on the stars and on one another.

// Far enough that moving about the place never shifts them against the stars
// (2 km is a thousandth of a degree), and inside the camera's far plane.
export const SKY_RADIUS = 2e8;

/** The direction of a right ascension and declination (degrees), in the sky's own axes. */
export function skyDirection(ra, dec) {
  const a = ra * Math.PI / 180, d = dec * Math.PI / 180;
  return { x: Math.cos(d) * Math.cos(a), y: Math.cos(d) * Math.sin(a), z: Math.sin(d) };
}

/** A point on the far sphere, in the sky frame, as a Cesium Cartesian3. */
export function skyPoint(C, ra, dec, result = new C.Cartesian3()) {
  const d = skyDirection(ra, dec);
  return C.Cartesian3.fromElements(d.x * SKY_RADIUS, d.y * SKY_RADIUS, d.z * SKY_RADIUS, result);
}

/**
 * The sky frame at a moment, centred on the place: Cesium's own TEME to
 * Earth-fixed rotation for the scene's time (as its sky box uses), then a
 * move to `center`. Returns the frame and the rotation alone, which turns sky
 * directions into world directions.
 */
export function skyFrame(C, time, center) {
  const rotation = C.Transforms.computeTemeToPseudoFixedMatrix(time, new C.Matrix3());
  return { frame: C.Matrix4.fromRotationTranslation(rotation, center, new C.Matrix4()), rotation };
}

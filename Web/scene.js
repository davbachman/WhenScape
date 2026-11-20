import { calculateAstronomy, clamp, compassName, sunTrack, moonEvents } from './astronomy.js';
import { unitsFor, formatTemperature, conditionName, windReadout, notableGust, summaryLine } from './briefing.js';
import { timelineMarkup } from './timeline.js';
import { clockLabel } from './guides.js';
import { createGuides } from './guideview.js';
import { WeatherController } from './weather.js';
import { createCloudStage } from './clouds.js';
import { flagExtension, flagShape, flagShadow, shadowOffset } from './flag.js';
import { createTintShader, createSnowShader, meshTone } from './meshlook.js';
import { createDiagnostics } from './diagnostics.js';

const C = window.Cesium;
const $ = id => document.getElementById(id);
const native = window.webkit?.messageHandlers?.scene;
let viewer, buildings, terrain, state, astronomy, snowShader, tintShader, cloudStage;
// True while `buildings` is the photorealistic mesh, which includes its own ground.
let photoreal = false;
let heading = 0, pitch = 0.025, eyeHeight = 1.7;
// Aerial view used with the photorealistic mesh, which is captured from the
// air and only holds up from above: the camera orbits the pin, looking down.
// minHeight keeps the camera above the treetops: closer to the ground the
// mesh's trees and walls break into floating shards.
const droneLimits = { minPitch: -80 * Math.PI / 180, maxPitch: -6 * Math.PI / 180, minRange: 60, maxRange: 2500, minHeight: 40 };
let dronePitch = -20 * Math.PI / 180, droneRange = 175;
let flag, flagTimer, lastFlagRender = 0, lastSkyRender = 0;
let guides, track, trackKey;
// Figures for the diagnostics readout only.
let diagnostics, groundReadings = [], tileFailures = 0, framesRendered = 0, frameRate = 0;
let series = [], seriesKey, seriesAbort, moonTimes, moonKey, timelineEvents = {};
const units = unitsFor(globalThis.navigator?.language ?? 'en-US');
const cloudDrift = { x: 0, y: 0 };
let geometryGeneration = 0, positionGeneration = 0, weatherGeneration = 0;
let activeToken, terrainAvailable = false, geometryMessage = 'Geographic data unavailable';
let weather = { kind: 'missing', label: 'Weather unavailable', detail: 'Choose a place and time.', renderPrecipitation: false };
let lastWeatherKey, lastWeatherPlace, weatherTimer, weatherAbort, lastAstronomyKey;
let lastWeatherAttempt = 0;
let weatherController = new WeatherController();
let animationFrame, lastFrame = 0, weatherClock = 0, lastStatus = 0;
// Whether the app's window can be seen and whether the app is frontmost, as
// reported by the native side. A covered window draws nothing; a visible window
// of a background app animates more slowly.
let activity = { visible: true, active: true };
const sceneShown = () => activity.visible && !document.hidden;
let statusTimer;
const overlay = $('weather-effects');
const ctx = overlay.getContext('2d');
let pixelRatio = 1, width = 1, height = 1;

function postStatus(force = false) {
  const now = performance.now();
  if (!force && now - lastStatus < 250) {
    if (!statusTimer) statusTimer = setTimeout(() => { statusTimer = undefined; postStatus(true); }, 250 - (now - lastStatus));
    return;
  }
  clearTimeout(statusTimer); statusTimer = undefined;
  lastStatus = now;
  const payload = { type: 'status', ready: !!viewer, heading: normalizeHeading(),
    sunAltitude: astronomy?.sun.altitude ?? 0,
    moonPhase: astronomy?.moonIlluminatedFraction ?? 0,
    weather, message: geometryMessage };
  if (native) native.postMessage(payload);
  // Kept available for integration tests; no calendar data or credentials are included.
  window.whenScapeStatus = payload;
}

function showNotice(title, body) {
  $('setup-message').hidden = false;
  $('notice-title').textContent = title;
  $('notice-body').textContent = body;
}

function failScene(error) {
  const panel = $('fatal-message');
  panel.hidden = false;
  panel.textContent = 'The 3D scene could not start. WebGL may be unavailable. You can still use the calendar and map. Try a lower scene detail setting or restart WhenScape.';
  geometryMessage = '3D rendering unavailable';
  postStatus(true);
}

function createViewer() {
  viewer = new C.Viewer('scene', {
    animation: false, timeline: false, baseLayerPicker: false, baseLayer: false,
    geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
    fullscreenButton: false, infoBox: false, selectionIndicator: false,
    shadows: true, shouldAnimate: false, requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    contextOptions: { webgl: { alpha: false, antialias: true, powerPreference: 'low-power' } },
  });
  viewer.scene.screenSpaceCameraController.enableInputs = false;
  viewer.scene.globe.baseColor = C.Color.fromCssColorString('#65735d');
  viewer.scene.globe.enableLighting = true;
  // Cesium defaults fade globe lighting out close to the ground, which is useful
  // for map imagery but would make a ground-level night scene look like daytime.
  viewer.scene.globe.lightingFadeOutDistance = 0;
  viewer.scene.globe.lightingFadeInDistance = 1;
  viewer.scene.globe.vertexShadowDarkness = 0.08;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.shadows = C.ShadowMode.RECEIVE_ONLY;
  viewer.scene.light = new C.SunLight();
  // Cesium's Moon is a sun-lit ellipsoid, so its visible phase changes with time.
  // Its celestial axes and the skybox's TEME transform use this same scene clock.
  if (viewer.scene.moon) viewer.scene.moon.onlySunLighting = true;
  lightMoonBySun(viewer.scene.moon);
  viewer.scene.shadowMap.maximumDistance = 1800;
  viewer.scene.shadowMap.softShadows = true;
  viewer.scene.skyAtmosphere.setDynamicLighting(C.DynamicAtmosphereLightingType?.SUNLIGHT ?? 2);
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.00008;
  viewer.scene.highDynamicRange = true;
  cloudStage = viewer.scene.postProcessStages.add(createCloudStage(C, viewer.scene));
  prepareStarTextures();
  flag = createFlag();
  guides = createGuides(C, viewer);
  diagnostics = createDiagnostics(document.body, diagnosticRows);
  viewer.scene.postRender.addEventListener(() => { framesRendered++; });
  setInterval(() => { frameRate = framesRendered; framesRendered = 0; }, 1000);
  viewer.scene.renderError.addEventListener((_scene, error) => failScene(error));
  const handler = viewer.screenSpaceEventHandler;
  handler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  installRotation();
  resize();
  new ResizeObserver(resize).observe($('scene'));
  // Do not let focus leave the viewport when keyboard arrows rotate it.
  $('compass').addEventListener('click', () => { noteInteraction(); heading = 0; setCamera(); });
  $('find-sun').addEventListener('click', () => lookAtSky('sun'));
  $('find-moon').addEventListener('click', () => lookAtSky('moon'));
  $('refresh-weather').addEventListener('click', () => { lastWeatherKey = undefined; queueWeather(); });
  installConditionsPin();
  document.addEventListener('visibilitychange', applyActivity);
  setInterval(() => { if (sceneShown()) refreshWeatherIfNeeded(); }, 60_000);
  setInterval(checkIdleOrbit, 1000);
}

// A click on the conditions bar keeps its details open (or lets it fold back
// to one line); the choice is remembered. Links and buttons inside work as usual.
function installConditionsPin() {
  const bar = document.querySelector('.conditions');
  const key = 'whenscape.conditionsPinned';
  try { bar.classList.toggle('pinned', localStorage.getItem(key) === '1'); } catch {}
  bar.addEventListener('click', event => {
    if (event.target.closest('a, button, summary, details')) return;
    const pinned = bar.classList.toggle('pinned');
    bar.title = pinned ? 'Click to fold the details away' : 'Click to keep the details open';
    try { localStorage.setItem(key, pinned ? '1' : '0'); } catch {}
  });
}

// Cesium lights its Moon with the scene light, which is dimmed after dark to
// darken the globe and plain buildings, so the Moon faded at night just when
// it should be brightest. This material lights it by the Sun's direction alone,
// at a fixed strength, keeping its phase. Lunar dust scatters light so that the
// lit face stays nearly as bright out to the limb (the Lommel-Seeliger law),
// with a crisp terminator. It replaces the material of the Moon's internal
// ellipsoid; if a Cesium update renames that, the Moon keeps Cesium's own lighting.
function lightMoonBySun(moon) {
  const body = moon?._ellipsoidPrimitive;
  if (!body?.material) return;
  body.material = new C.Material({
    translucent: false,
    fabric: {
      uniforms: { image: moon.textureUrl },
      source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
        czm_material material = czm_getDefaultMaterial(materialInput);
        vec3 normal = normalize(materialInput.normalEC);
        float toSun = max(dot(normal, czm_sunDirectionEC), 0.0);
        float toEye = max(dot(normal, normalize(materialInput.positionToEyeEC)), 0.0);
        float lit = 2.0 * toSun / max(toSun + toEye, 1e-3);
        material.diffuse = vec3(0.0);
        // The sky stage brightens what shows through it after dark; at this
        // strength the full Moon stays just short of white, so its seas show.
        material.emission = texture(image, materialInput.st).rgb * min(lit, 1.0) * 0.5;
        return material;
      }`,
    },
  });
}

function prepareStarTextures() {
  // Decode local star textures even when starting in daylight. Supplying ready
  // images avoids a blank first night frame in Cesium's on-demand render loop.
  const faces = { positiveX: 'px', negativeX: 'mx', positiveY: 'py', negativeY: 'my', positiveZ: 'pz', negativeZ: 'mz' };
  Promise.all(Object.entries(faces).map(([axis, suffix]) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve([axis, img]);
    img.onerror = reject;
    img.src = `./cesium/Assets/Textures/SkyBox/tycho2t3_80_${suffix}.jpg`;
  }))).then(entries => {
    const previous = viewer.scene.skyBox;
    viewer.scene.skyBox = new C.SkyBox({ sources: Object.fromEntries(entries), show: (astronomy?.sun.altitude ?? 90) < -4 });
    previous?.destroy();
    viewer.scene.requestRender();
  }).catch(() => {
    // Leave the default Cesium skybox in place so its own resource retry remains possible.
  });
}

function resize() {
  width = Math.max(1, overlay.clientWidth);
  height = Math.max(1, overlay.clientHeight);
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  overlay.width = Math.round(width * pixelRatio);
  overlay.height = Math.round(height * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  if (state) { drawEffects(0); viewer?.scene.requestRender(); }
}

function installRotation() {
  const canvas = viewer.canvas;
  let pointer;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    noteInteraction();
    // In the aerial view a sideways drag turns the scene like a turntable:
    // grabbing below the pin moves the near side, so the turn is reversed.
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, turn: photoreal && belowPin(e) ? -1 : 1 };
    canvas.setPointerCapture(e.pointerId);
    $('scene').focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    heading -= (e.clientX - pointer.x) * 0.003 * pointer.turn;
    const tilt = (e.clientY - pointer.y) * 0.003;
    // In the aerial view, dragging down lifts the camera toward a top-down view;
    // dragging up flattens it and then raises the gaze into the sky.
    if (photoreal) raiseGaze(-tilt);
    else pitch = clamp(pitch + tilt, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    pointer.x = e.clientX; pointer.y = e.clientY;
    setCamera();
  });
  const end = () => { pointer = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    noteInteraction();
    e.preventDefault();
    const factor = Math.exp(clamp(e.deltaY, -200, 200) * 0.002);
    // From the ground, or looking up from the air, scrolling zooms the lens
    // like a telephoto; otherwise it moves the orbit in or out.
    if (!photoreal || lookingUp()) setFov(viewer.camera.frustum.fov * factor);
    else droneRange = clamp(droneRange * factor, droneLimits.minRange, droneLimits.maxRange);
    setCamera();
  }, { passive: false });
  $('scene').addEventListener('keydown', e => {
    noteInteraction();
    const amount = e.shiftKey ? 0.12 : 0.035;
    // Plain ← and → step through time (handled by the app); with Option they turn the view.
    if (e.key === 'ArrowLeft' && e.altKey) heading -= amount;
    else if (e.key === 'ArrowRight' && e.altKey) heading += amount;
    else if (photoreal && e.key === 'ArrowUp') raiseGaze(amount);
    else if (photoreal && e.key === 'ArrowDown') raiseGaze(-amount);
    else if ((!photoreal || lookingUp()) && (e.key === '+' || e.key === '=')) setFov(viewer.camera.frustum.fov / 1.15);
    else if ((!photoreal || lookingUp()) && (e.key === '-' || e.key === '_')) setFov(viewer.camera.frustum.fov * 1.15);
    else if (photoreal && (e.key === '+' || e.key === '=')) droneRange = Math.max(droneRange / 1.15, droneLimits.minRange);
    else if (photoreal && (e.key === '-' || e.key === '_')) droneRange = Math.min(droneRange * 1.15, droneLimits.maxRange);
    else if (e.key === 'ArrowUp') pitch = Math.min(pitch + amount, Math.PI / 2 - 0.02);
    else if (e.key === 'ArrowDown') pitch = Math.max(pitch - amount, -Math.PI / 2 + 0.02);
    else return;
    e.preventDefault(); setCamera();
  });
}

// Whether a pointer event lies below the pin's ground point on screen. The
// orbit keeps the pin at the centre, which is the fallback if it cannot be projected.
function belowPin(e) {
  const rect = viewer.canvas.getBoundingClientRect();
  const pin = state && C.SceneTransforms.worldToWindowCoordinates(viewer.scene,
    C.Cartesian3.fromDegrees(state.longitude, state.latitude, eyeHeight - 1.7));
  // Looking up, the pin can be out of view entirely; everything seen is then above it.
  if (!pin) return skyTilt > 0 ? false : e.clientY - rect.top > rect.height / 2;
  return e.clientY - rect.top > pin.y;
}

// Looking up from the orbit. Tilting past the orbit's flattest angle keeps the
// camera where it is and raises its gaze, bringing the sky, stars and Moon into
// view; tilting back lowers the gaze to the pin before the orbit rises again.
// skyTilt is how far the gaze is raised above the orbit's own angle, in radians.
let skyTilt = 0;
const DEFAULT_FOV = Math.PI / 3, TELEPHOTO_FOV = 6 * Math.PI / 180, MOON_FOV = 12 * Math.PI / 180;
const lookingUp = () => skyTilt > 0.02;
// A new place or view starts with the gaze on the pin and the normal lens.
function resetGaze() {
  aim = undefined;
  skyTilt = 0;
  if (viewer) viewer.camera.frustum.fov = DEFAULT_FOV;
}
function flattestOrbitPitch() {
  return Math.min(droneLimits.maxPitch, -Math.asin(Math.min(1, droneLimits.minHeight / droneRange)));
}
function raiseGaze(amount) {
  if (amount > 0) {
    const orbit = Math.min(amount, Math.max(0, flattestOrbitPitch() - dronePitch));
    dronePitch += orbit;
    // The gaze stops short of the zenith, where heading would lose its meaning.
    skyTilt = Math.min(skyTilt + amount - orbit, 85 * Math.PI / 180 - dronePitch);
  } else {
    const back = Math.min(-amount, skyTilt);
    skyTilt -= back;
    dronePitch = Math.max(dronePitch + amount + back, droneLimits.minPitch);
  }
  // Back on the pin, the lens returns to normal.
  if (!lookingUp()) setFov(DEFAULT_FOV);
}
// Turn smoothly to the Sun or the Moon at its calculated position, raising the
// gaze to its altitude. For the Moon the lens also narrows, since at its true
// size, about half a degree, it would be a speck in the normal view.
let aim;
function lookAtSky(body) {
  const target = astronomy?.[body];
  if (!viewer || !target || target.altitude <= 0) return;
  noteInteraction();
  const radians = degrees => degrees * Math.PI / 180;
  const from = { heading, dronePitch, skyTilt, pitch, fov: viewer.camera.frustum.fov };
  const turn = ((radians(target.azimuth) - heading) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  const flattest = flattestOrbitPitch();
  const altitude = Math.min(radians(target.altitude), radians(85));
  const to = { dronePitch: flattest, skyTilt: Math.max(0, altitude - flattest), pitch: altitude,
    fov: body === 'moon' ? MOON_FOV : DEFAULT_FOV };
  const id = {}, start = performance.now(), duration = state?.reducedMotion ? 0 : 1600;
  aim = id;
  const step = now => {
    if (aim !== id || !viewer) return;
    const t = duration ? Math.min(1, (now - start) / duration) : 1;
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const between = name => from[name] + (to[name] - from[name]) * ease;
    heading = from.heading + turn * ease;
    if (photoreal) { dronePitch = between('dronePitch'); skyTilt = between('skyTilt'); }
    else pitch = between('pitch');
    viewer.camera.frustum.fov = between('fov');
    setCamera();
    if (t < 1) requestAnimationFrame(step); else aim = undefined;
  };
  // With reduced motion the view turns at once, without waiting for a frame.
  if (duration) requestAnimationFrame(step); else step(start);
}

// The finders work only for a body above the horizon.
function updateFinders() {
  for (const body of ['sun', 'moon']) {
    const button = $(`find-${body}`), name = body === 'sun' ? 'Sun' : 'Moon';
    const up = (astronomy?.[body]?.altitude ?? -1) > 0;
    button.disabled = !up;
    button.title = up ? `Look at the ${name}` : `The ${name} is below the horizon`;
  }
}

function setFov(value) {
  viewer.camera.frustum.fov = clamp(value, TELEPHOTO_FOV, DEFAULT_FOV);
  viewer.scene.requestRender();
}

// Flying to a new place: the camera travels from the old orbit to the same
// orbit around the new pin, so a change of place reads as a journey rather
// than a cut. Any drag, scroll or key press cancels it and takes over.
let flight;
function flyToPin(from) {
  const start = C.Cartesian3.fromDegrees(from.longitude, from.latitude);
  const end = C.Cartesian3.fromDegrees(state.longitude, state.latitude);
  const distance = C.Cartesian3.distance(start, end);
  if (!(distance > 5)) return;
  noteInteraction();
  const id = {};
  flight = id;
  const done = () => { if (flight === id) { flight = undefined; setCamera(); } };
  viewer.camera.flyToBoundingSphere(new C.BoundingSphere(C.Cartesian3.fromDegrees(state.longitude, state.latitude, eyeHeight - 1.7), 0), {
    offset: new C.HeadingPitchRange(heading, dronePitch, droneRange),
    duration: clamp(1.2 + Math.log10(1 + distance / 400) * 1.1, 1.2, 4.5),
    complete: done, cancel: done,
  });
}

// When the aerial view is left alone for a while, it slowly circles the pin;
// switching the turntable on starts it at once. It runs only while the app is
// in front and its window can be seen, at a capped frame rate, and stops at
// the first touch.
const IDLE_ORBIT_AFTER = 30_000, IDLE_ORBIT_RATE = 2 * Math.PI / 180;
let lastInteraction = performance.now(), orbitFrame, orbitLast = 0;
function noteInteraction() {
  lastInteraction = performance.now();
  aim = undefined;
  if (flight) { flight = undefined; viewer.camera.cancelFlight(); setCamera(); }
  stopIdleOrbit();
}
function idleOrbitAllowed() {
  return photoreal && !flight && state?.idleOrbit !== false && !state?.reducedMotion && activity.active && sceneShown();
}
function checkIdleOrbit() {
  if (orbitFrame || !idleOrbitAllowed() || performance.now() - lastInteraction < IDLE_ORBIT_AFTER) return;
  orbitLast = 0;
  viewer.targetFrameRate = 30;
  orbitFrame = requestAnimationFrame(orbitStep);
}
function orbitStep(time) {
  orbitFrame = undefined;
  if (!idleOrbitAllowed()) { stopIdleOrbit(); return; }
  const delta = orbitLast ? Math.min((time - orbitLast) / 1000, 0.1) : 0;
  orbitLast = time;
  heading += IDLE_ORBIT_RATE * delta;
  setCamera();
  orbitFrame = requestAnimationFrame(orbitStep);
}
function stopIdleOrbit() {
  if (orbitFrame) cancelAnimationFrame(orbitFrame);
  orbitFrame = undefined;
  if (viewer) viewer.targetFrameRate = activity.active ? undefined : 10;
}

function normalizeHeading() { return (((heading * 180 / Math.PI) % 360) + 360) % 360; }

function updateViewLabels() {
  $('view-kind').textContent = photoreal ? 'AERIAL VIEW' : 'GROUND VIEW';
  $('rotate-hint').textContent = photoreal ? 'Drag to orbit, or up into the sky · scroll to zoom · ← → step time' : 'Drag to look · scroll to zoom · ← → step time';
  $('scene').setAttribute('aria-label', photoreal
    ? 'Aerial view of the selected place. Drag, or use Option with the left and right arrow keys and the up and down arrow keys, to orbit and tilt; keep tilting up to look into the sky. Scroll or use plus and minus to zoom. Left and right arrow keys step through time.'
    : 'Ground-level scene. Drag to look around, or use Option with the left and right arrow keys and the up and down arrow keys. Scroll or use plus and minus to zoom. Left and right arrow keys step through time.');
  updateFlag();
}

function setCamera() {
  if (!state || !viewer) return;
  if (photoreal) {
    // Orbit the pin at ground level; `heading` stays the direction the camera faces.
    const pin = C.Cartesian3.fromDegrees(state.longitude, state.latitude, eyeHeight - 1.7);
    // A shallow tilt at a short range would put the camera among the trees, so
    // zooming in steepens the view enough to stay minHeight above the pin.
    dronePitch = Math.min(dronePitch, -Math.asin(Math.min(1, droneLimits.minHeight / droneRange)));
    // During a flight to a new place the flight moves the camera; it lands here.
    if (!flight) {
      viewer.camera.lookAt(pin, new C.HeadingPitchRange(heading, dronePitch, droneRange));
      viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
      if (skyTilt > 0) viewer.camera.lookUp(skyTilt);
    }
  } else {
    viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(state.longitude, state.latitude, eyeHeight),
      orientation: { heading, pitch, roll: 0 },
    });
  }
  const degrees = normalizeHeading();
  $('heading').textContent = `${compassName(degrees)} · ${Math.round(degrees)}°`;
  $('compass-needle').style.transform = `rotate(${-degrees}deg)`;
  // The flag is sized to the view, so zooming changes it; wait for the gesture to settle.
  clearTimeout(flagTimer);
  flagTimer = setTimeout(updateFlag, 120);
  viewer.scene.requestRender();
  drawEffects(0);
  postStatus();
}

// The pin as a local frame: metres east, north and up from the ground point.
function pinFrame() {
  const ground = eyeHeight - 1.7;
  const frame = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(state.longitude, state.latitude, ground));
  return { ground, at: (e, n, up = 0) => C.Matrix4.multiplyByPoint(frame, new C.Cartesian3(e, n, up), new C.Cartesian3()) };
}

// The flag is sized to the zoom so it stays readable. The size is fixed when
// updateFlag runs, after a zoom settles, so the cloth (redrawn every frame)
// never grows apart from the pole, shadow and guides, which update with it.
let flagSize = 8;
function flagHeight() { return flagSize; }
function flagWind() {
  const known = state?.weatherEnabled && weather.kind !== 'missing';
  return { windSpeed: known ? weather.windSpeed : null, windFrom: known ? weather.windDirection : null };
}

// A flag at the pin for the aerial view: it marks the exact point, streams
// downwind, and its drawn shadow shows where the Sun is. The mesh cannot
// receive computed shadows, so the shadow is laid on it as a ground overlay.
function createFlag() {
  const cloth = () => {
    const { ground, at } = pinFrame();
    const { windSpeed, windFrom } = flagWind();
    // Notable gusts arrive as occasional surges toward the gust speed.
    const gust = flagWind().windSpeed != null ? notableGust(weather) : null;
    const surge = gust ? clamp((Math.sin(weatherClock * 0.9) + Math.sin(weatherClock * 0.37 + 1.7) - 0.9) / 0.9, 0, 1) : 0;
    const blowing = windSpeed == null ? null : windSpeed + ((gust ?? windSpeed) - windSpeed) * surge;
    const phase = weatherClock * (2 + (blowing ?? 0) * 0.3);
    const shape = flagShape({ height: flagHeight(), windSpeed: blowing, windFrom, phase });
    return { positions: shape.map(p => at(p.e, p.n)), tops: shape.map(p => ground + p.top), bottoms: shape.map(p => ground + p.bottom) };
  };
  const shade = C.Color.BLACK.withAlpha(0.4);
  const onMesh = C.ClassificationType.CESIUM_3D_TILE;
  // The pole and cloth are primitives rebuilt by drawFlag, at once rather than
  // in the background, so the flag never blinks out when it moves or resizes.
  // (Entities driven by a per-frame callback would be rebuilt by Cesium on every
  // frame, and each rebuild asks for another frame, so the scene would never rest.)
  const body = viewer.scene.primitives.add(new C.PrimitiveCollection());
  const poleColor = C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString('#f3f0e8'));
  const clothColor = C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString('#e8552d'));
  const draw = shown => {
    body.removeAll();
    if (!shown || !state) return;
    const { at } = pinFrame();
    const shape = cloth();
    body.add(new C.Primitive({ asynchronous: false, shadows: C.ShadowMode.DISABLED,
      geometryInstances: new C.GeometryInstance({ attributes: { color: poleColor },
        geometry: new C.PolylineGeometry({ positions: [at(0, 0, 0), at(0, 0, flagHeight())], width: 3, arcType: C.ArcType.NONE,
          vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT }) }),
      appearance: new C.PolylineColorAppearance() }));
    body.add(new C.Primitive({ asynchronous: false, shadows: C.ShadowMode.DISABLED,
      geometryInstances: new C.GeometryInstance({ attributes: { color: clothColor },
        geometry: new C.WallGeometry({ positions: shape.positions, maximumHeights: shape.tops, minimumHeights: shape.bottoms,
          vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }) }),
      appearance: new C.PerInstanceColorAppearance({ translucent: false, faceForward: true }) }));
  };
  return {
    draw,
    poleShadow: viewer.entities.add({ show: false, polyline: { width: 3, clampToGround: true, classificationType: onMesh, material: shade } }),
    clothShadow: viewer.entities.add({ show: false, polygon: { classificationType: onMesh, material: shade } }),
  };
}

function updateFlag() {
  if (!flag || !state || !viewer) return;
  flagSize = clamp(droneRange * 0.12, 8, 140);
  const shown = photoreal;
  flag.draw(shown);
  // Direct sunlight strong enough to cast a visible shadow.
  const enabled = state.weatherEnabled && weather.kind !== 'missing';
  const clouds = enabled ? clamp((weather.cloudCover ?? 0) / 100, 0, 1) : 0;
  // By day the Sun casts the shadow; on a clear night a bright Moon casts a fainter one.
  const moonlit = astronomy && astronomy.sun.altitude < -4 && astronomy.moon.altitude > 5 && astronomy.moonIlluminatedFraction > 0.25;
  const sun = moonlit ? astronomy.moon : astronomy?.sun;
  const shadowed = shown && sun && (moonlit ? clouds < 0.6 : sun.altitude > 1.5 && clouds < 0.85);
  flag.poleShadow.show = flag.clothShadow.show = !!shadowed;
  if (shown) {
    const { at } = pinFrame();
    const height = flagHeight();
    if (shadowed) {
      const tip = shadowOffset(height, sun.altitude, sun.azimuth);
      const shade = C.Color.BLACK.withAlpha((moonlit ? 0.3 * astronomy.moonIlluminatedFraction : 0.45) * Math.pow(1 - clouds, 1.5));
      flag.poleShadow.polyline.positions = [at(0, 0), at(tip.e, tip.n)];
      flag.poleShadow.polyline.material = shade;
      flag.clothShadow.polygon.hierarchy = new C.PolygonHierarchy(
        flagShadow({ height, ...flagWind(), sunAltitude: sun.altitude, sunAzimuth: sun.azimuth }).map(p => at(p.e, p.n)));
      flag.clothShadow.polygon.material = shade;
    }
  }
  updateGuides();
  updateMeshShader();
  viewer.scene.requestRender();
}

// The place's civil time zone, when the app supplies a valid one.
function sceneTimeZone() {
  if (!state?.timeZone) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: state.timeZone }); return state.timeZone; } catch { return null; }
}

// The Sun's path for the solar day containing the selected instant, shared by
// the guides, the summary and the timeline.
function ensureTrack() {
  const key = `${state.latitude},${state.longitude}`, now = Date.parse(state.time);
  if (key !== trackKey || !track || now < track.start || now >= track.end) {
    track = sunTrack(state);
    trackKey = key;
  }
  return track;
}

// Compass ring and the day's Sun path around the flag; see guideview.js.
function updateGuides() {
  if (!guides) return;
  if (!photoreal || !state) { guides.update({ shown: false }); return; }
  const radius = flagHeight() * 2.2;
  ensureTrack();
  const zone = sceneTimeZone();
  const event = state.rangeEnabled ? [Date.parse(state.start), Date.parse(state.end)] : null;
  guides.update({ shown: true, at: pinFrame().at, radius, track, zone, event, sun: astronomy?.sun,
    key: [state.latitude, state.longitude, Math.round(eyeHeight * 10), Math.round(radius), track.start, zone, event?.join('-')].join('|') });
}

// What the diagnostics readout shows. Heights are metres above the ellipsoid.
function diagnosticRows() {
  const camera = viewer.camera.positionCartographic;
  const ground = eyeHeight - 1.7;
  const fixed = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '–';
  return {
    view: photoreal ? 'aerial · photorealistic mesh' : buildings ? 'ground · terrain + OSM buildings' : 'sky preview',
    camera: `${fixed(camera.height)} m (${fixed(camera.height - ground)} m above ground)`,
    ground: `${fixed(ground)} m`,
    readings: groundReadings.length ? groundReadings.map(h => fixed(h)).join(' ') : undefined,
    orbit: photoreal ? `range ${fixed(droneRange, 0)} m · pitch ${fixed(dronePitch * 180 / Math.PI)}° · heading ${fixed(normalizeHeading(), 0)}°` : undefined,
    gaze: photoreal && skyTilt > 0 ? `raised ${fixed(skyTilt * 180 / Math.PI)}° · lens ${fixed(viewer.camera.frustum.fov * 180 / Math.PI, 0)}°` : undefined,
    look: photoreal ? undefined : `heading ${fixed(normalizeHeading(), 0)}° · pitch ${fixed(pitch * 180 / Math.PI)}°`,
    flag: photoreal ? `${fixed(flagHeight())} m` : undefined,
    globe: viewer.scene.globe ? `${viewer.scene.globe.show ? 'shown' : 'hidden'} · tiles ${viewer.scene.globe.tilesLoaded ? 'loaded' : 'loading'}` : 'removed',
    tiles: buildings ? `${buildings.tilesLoaded ? 'loaded' : 'loading'} · ${(buildings.totalMemoryUsageInBytes / 1048576).toFixed(0)} MB · ${tileFailures} failed` : 'none',
    frames: `${frameRate}/s${sceneShown() ? '' : ' · paused (window hidden)'}${activity.active ? '' : ' · app in background'}`,
    weather: `${weather.kind}${weather.validAt ? ` · ${weather.validAt.slice(0, 16)}Z` : ''}`,
  };
}

async function placeObserver() {
  const generation = ++positionGeneration;
  const { latitude, longitude } = state;
  // Keep the last ground height in the aerial view so moving the pin does not
  // drop the camera below the mesh while the new height is sampled.
  if (!photoreal) eyeHeight = 1.7;
  setCamera();
  if (photoreal) {
    try {
      // The mesh is the ground here, so sample it instead of a terrain provider.
      // Sample the pin and a ring of points a few metres around it and use a
      // low one: the mesh is a surface, so a pin under a tree or at a roof
      // edge would otherwise put the ground at canopy or roof height, and the
      // flag itself stands on the pin and can be hit instead of the ground.
      // Nothing is excluded from the sampling, and a reading far below the
      // rest is ignored, so one stray value cannot sink the view underground.
      const metres = 1 / 111_320, across = Math.cos(latitude * Math.PI / 180);
      const around = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.sin(i * Math.PI / 4) * 5, Math.cos(i * Math.PI / 4) * 5])];
      const points = around.map(([east, north]) => C.Cartographic.fromDegrees(longitude + east * metres / across, latitude + north * metres));
      const sampled = await viewer.scene.sampleHeightMostDetailed(points);
      if (generation !== positionGeneration) return;
      groundReadings = sampled.map(p => p?.height);
      const heights = sampled.map(p => p?.height).filter(Number.isFinite).sort((x, y) => x - y);
      if (!heights.length) throw new Error('No mesh height');
      const typical = heights[Math.floor(heights.length / 2)];
      eyeHeight = heights.find(h => h > typical - 12) + 1.7;
      setCamera();
    } catch {
      if (generation !== positionGeneration) return;
      showNotice('Ground elevation unavailable', 'The 3D mesh height could not be resolved at this pin. Choose a nearby outdoor point on the map or try again when the data connection is available.');
      geometryMessage = 'Ground elevation unresolved · viewpoint approximate';
      $('geometry-status').textContent = geometryMessage;
      postStatus(true);
    }
    return;
  }
  if (!terrain || !terrainAvailable) return;
  try {
    const [position] = await C.sampleTerrainMostDetailed(terrain, [C.Cartographic.fromDegrees(longitude, latitude)]);
    if (generation !== positionGeneration) return;
    if (!Number.isFinite(position.height)) throw new Error('No terrain height');
    eyeHeight = position.height + 1.7;
    setCamera();
  } catch {
    if (generation !== positionGeneration) return;
    // Never pretend ellipsoid height is ground level when terrain sampling fails.
    showNotice('Ground elevation unavailable', 'Terrain height could not be resolved at this pin. Choose a nearby point on the map or try again when the data connection is available.');
    geometryMessage = 'Ground elevation unresolved · viewpoint approximate';
    $('geometry-status').textContent = geometryMessage;
    postStatus(true);
  }
}

async function loadGeography(token) {
  const generation = ++geometryGeneration;
  tileFailures = 0;
  groundReadings = [];
  ++positionGeneration;
  terrainAvailable = false;
  terrain = undefined;
  if (buildings) { viewer.scene.primitives.remove(buildings); buildings = undefined; }
  if (snowShader) { snowShader.destroy(); snowShader = undefined; }
  if (tintShader) { tintShader.destroy(); tintShader = undefined; }
  photoreal = false;
  resetGaze();
  updateViewLabels();
  viewer.scene.globe.show = true;
  viewer.terrainProvider = new C.EllipsoidTerrainProvider();
  if (!token) {
    geometryMessage = 'Sky preview · terrain and buildings not loaded';
    $('geometry-status').textContent = geometryMessage;
    showNotice('Connect geographic data', 'Add a Cesium ion token in Settings to load real terrain and buildings. The sky is calculated for your selected place and time.');
    placeObserver();
    postStatus(true);
    return;
  }
  C.Ion.defaultAccessToken = token;
  geometryMessage = 'Loading terrain and buildings…';
  $('geometry-status').textContent = geometryMessage;
  showNotice('Loading this place', 'Preparing the 3D model of this place. Heights and small features may be approximate.');
  // First choice: Google Photorealistic 3D Tiles through Cesium ion (asset
  // 2275207), a textured mesh of real buildings, trees and ground. The ion
  // account must have that asset added; otherwise fall back to World Terrain
  // with OSM building boxes below.
  let mesh, meshProblem;
  try {
    // Requested directly rather than through Cesium's helper, which remembers a
    // failed request and would keep failing after the token is corrected.
    mesh = await C.Cesium3DTileset.fromUrl(await C.IonResource.fromAssetId(2275207), {
      maximumScreenSpaceError: detailError(), showCreditsOnScreen: true,
      // No camera collision: Cesium lifted the camera to a surface height it
      // found under it, which moved it off the orbit by tens of metres and
      // sometimes left the view under the mesh.
      // The orbit's minimum height keeps the camera clear instead.
      enableCollision: false,
      // The aerial view sees to the horizon; load distant tiles more coarsely.
      dynamicScreenSpaceError: true,
      // Capture-time shadows are baked into the textures, so computed ones
      // would double them; they are added only when the setting asks.
      shadows: meshShadowMode() });
  } catch (error) {
    mesh = undefined;
    meshProblem = describeIonError(error);
  }
  if (generation !== geometryGeneration) { mesh?.destroy(); return; }
  if (mesh) {
    photoreal = true;
    resetGaze();
    updateViewLabels();
    // The mesh replaces the globe surface; drawing both makes them fight.
    viewer.scene.globe.show = false;
    buildings = viewer.scene.primitives.add(mesh);
    buildings.tileFailed.addEventListener(() => {
      tileFailures++;
      geometryMessage = 'Some 3D tiles unavailable · coverage incomplete';
      $('geometry-status').textContent = geometryMessage;
      postStatus(true);
    });
    updateBuildingStyle();
    geometryMessage = 'Photorealistic 3D mesh · captured in daylight, relit approximately';
    $('geometry-status').textContent = geometryMessage;
    await placeObserver();
    if (generation !== geometryGeneration) return;
    if (!geometryMessage.startsWith('Ground elevation')) $('setup-message').hidden = true;
    viewer.scene.requestRender();
    postStatus(true);
    return;
  }
  const results = await Promise.allSettled([
    C.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: false }),
    C.createOsmBuildingsAsync({ defaultColor: C.Color.fromCssColorString('#dbd5c8'),
      maximumScreenSpaceError: detailError(), shadows: C.ShadowMode.ENABLED }),
  ]);
  if (generation !== geometryGeneration) {
    if (results[1].status === 'fulfilled') results[1].value.destroy();
    return;
  }
  const [terrainResult, buildingsResult] = results;
  if (terrainResult.status === 'fulfilled') {
    terrain = terrainResult.value;
    terrainAvailable = true;
    viewer.terrainProvider = terrain;
    terrain.errorEvent.addEventListener(() => {
      geometryMessage = 'Some terrain tiles unavailable · retrying';
      $('geometry-status').textContent = geometryMessage;
      postStatus(true);
    });
  }
  if (buildingsResult.status === 'fulfilled' && terrainAvailable) {
    buildings = viewer.scene.primitives.add(buildingsResult.value);
    buildings.tileFailed.addEventListener(() => {
      tileFailures++;
      geometryMessage = 'Some building tiles unavailable · coverage incomplete';
      $('geometry-status').textContent = geometryMessage;
      postStatus(true);
    });
    updateBuildingStyle();
  } else if (buildingsResult.status === 'fulfilled') {
    // OSM geometry is aligned to World Terrain; without it buildings can float.
    buildingsResult.value.destroy();
  }
  if (terrainAvailable && buildings) {
    geometryMessage = `OSM buildings · photorealistic mesh unavailable: ${meshProblem}`;
    $('setup-message').hidden = true;
  } else if (terrainAvailable) {
    geometryMessage = 'Terrain only · buildings unavailable';
    showNotice('Building data unavailable', 'Terrain is available, but buildings could not load. Check your Cesium token’s asset access and network connection.');
  } else {
    geometryMessage = 'Sky preview · geographic data unavailable';
    const terrainProblem = describeIonError(terrainResult.reason);
    showNotice('Geographic data unavailable', `Photorealistic mesh: ${meshProblem}. Terrain: ${terrainProblem}. The calculated sky remains available; terrain and buildings have not loaded.`);
  }
  $('geometry-status').textContent = geometryMessage;
  await placeObserver();
  viewer.scene.requestRender();
  postStatus(true);
}

// A short reason for a failed Cesium ion request. Only the status code is
// used, so no token or request address can reach the screen.
function describeIonError(error) {
  const status = error?.statusCode;
  if (status === 401) return 'Cesium ion rejected the token (401)';
  if (status === 403 || status === 404) return `this token cannot read the asset (${status})`;
  if (status) return `request failed (${status})`;
  return 'no response; check the network connection';
}

// The mesh both casts and receives computed shadows when they are on: with
// the globe hidden, the mesh is the only surface they can fall on.
function meshShadowMode() { return state?.computedShadows ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED; }

function detailError() { return state?.detail === 'high' ? 8 : state?.detail === 'low' ? 32 : 16; }

function updateBuildingStyle() {
  if (!buildings) return;
  if (photoreal) {
    if (!tintShader) tintShader = createTintShader(C);
    updateMeshShader();
    buildings.customShader = tintShader;
    return;
  }
  // A uniform matte style deliberately avoids photographic lighting baked into textures.
  if (!buildings.style) buildings.style = new C.Cesium3DTileStyle({ color: "color('#dbd5c8')" });
  const white = state.snowCover || (state.weatherEnabled && (weather.snowDepth ?? 0) > 0);
  if (white) {
    if (!snowShader) snowShader = createSnowShader(C);
    buildings.customShader = snowShader;
  } else { buildings.customShader = undefined; }
}

// Feed the mesh shader the current sky, weather and pin; see meshlook.js.
function updateMeshShader() {
  if (!tintShader || !state) return;
  const enabled = state.weatherEnabled && weather.kind !== 'missing';
  const tone = meshTone({
    sunAltitude: astronomy?.sun.altitude ?? 45,
    moonAltitude: astronomy?.moon.altitude ?? null,
    moonFraction: astronomy?.moonIlluminatedFraction ?? 0,
    clouds: enabled ? clamp((weather.cloudCover ?? 0) / 100, 0, 1) : 0,
    visibility: enabled && weather.visibility > 0 ? weather.visibility : null,
    precipitation: enabled && weather.renderPrecipitation ? (weather.rain ?? 0) + (weather.precipitation ?? 0) : 0,
    snowDepth: state.snowCover ? 0.05 : enabled ? (weather.snowDepth ?? 0) : 0,
  });
  const vector = ([x, y, z]) => new C.Cartesian3(x, y, z);
  tintShader.setUniform('u_light', vector(tone.light));
  tintShader.setUniform('u_hazeColor', vector(tone.hazeColor));
  for (const [name, value] of [['u_hazeDensity', tone.hazeDensity], ['u_cloudCover', tone.cloudCover],
    ['u_cloudShadow', tone.cloudShadow], ['u_wet', tone.wet], ['u_snow', tone.snow], ['u_glow', tone.glow]]) {
    tintShader.setUniform(name, value);
  }
  const { at } = pinFrame();
  const pin = at(0, 0), east = at(1, 0), north = at(0, 1);
  tintShader.setUniform('u_pin', pin);
  tintShader.setUniform('u_east', C.Cartesian3.subtract(east, pin, new C.Cartesian3()));
  tintShader.setUniform('u_north', C.Cartesian3.subtract(north, pin, new C.Cartesian3()));
}

function updateLightAndWeather() {
  if (!viewer || !astronomy) return;
  const enabled = state.weatherEnabled && weather.kind !== 'missing';
  const clouds = enabled ? clamp((weather.cloudCover ?? 0) / 100, 0, 1) : 0;
  const daylight = clamp((astronomy.sun.altitude + 8) / 20, 0, 1);
  // The stage paints the whole sky, clear or cloudy, wherever depth is available.
  const paintedSky = viewer.scene.pickPositionSupported;
  cloudStage.enabled = paintedSky;
  // The painted sky replaces Cesium's atmosphere; hiding it leaves only the
  // Moon and stars behind the painted sky, so the Moon can show by day too.
  viewer.scene.skyAtmosphere.show = !paintedSky;
  updateFinders();
  if (paintedSky) {
    cloudStage.uniforms.cloudCover = clouds;
    const visibilityNow = enabled ? weather.visibility : null;
    cloudStage.uniforms.haze = visibilityNow > 0 ? clamp(1 - Math.log10(visibilityNow / 200) / 2, 0, 1) : 0;
    // The stage draws its own Sun; Cesium's would show through at dusk.
    if (viewer.scene.sun) viewer.scene.sun.show = false;
  }
  viewer.scene.light.intensity = (0.04 + 1.96 * daylight) * (1 - clouds * 0.68);
  viewer.scene.shadowMap.enabled = clouds < 0.88;
  viewer.scene.skyAtmosphere.saturationShift = -clouds * 0.8;
  viewer.scene.skyAtmosphere.brightnessShift = -clouds * 0.22;
  const visibility = enabled ? weather.visibility : null;
  viewer.scene.fog.density = visibility > 0 ? clamp(1 / visibility, 0.00005, 0.004) : 0.00008;
  const white = state.snowCover || (enabled && (weather.snowDepth ?? 0) > 0);
  viewer.scene.globe.baseColor = C.Color.fromCssColorString(white ? '#cdd4d4' : '#65735d');
  $('snow-label').hidden = !white;
  $('snow-label').textContent = state.snowCover ? 'Illustrative white surfaces · no depth simulation'
    : 'Snow cover from an available depth estimate';
  updateBuildingStyle();
  updateWeatherHUD();
  updateFlag();
  viewer.scene.requestRender();
  drawEffects(0);
  scheduleEffects();
}

function updateWeatherHUD() {
  const sky = !state.weatherEnabled;
  const known = !sky && weather.kind !== 'missing';
  const zone = sceneTimeZone();
  const sunLabel = `${astronomy.light} · Sun ${Math.round(astronomy.sun.altitude)}°`;
  $('weather-kind').textContent = sky ? 'CLEAR-SKY PREVIEW' : weather.label.toUpperCase();
  $('weather-attribution').hidden = weather.kind === 'missing';
  const detailLines = [weather.detail, sunLabel];
  if (weather.source) detailLines.push(`Source: ${weather.source}`);
  if (weather.validAt) detailLines.push(`For: ${formatUTC(weather.validAt)}`);
  if (weather.fetchedAt) detailLines.push(`Retrieved: ${formatUTC(weather.fetchedAt)}`);
  if (weather.precipitationProbability != null) detailLines.push(`Chance of precipitation: ${Math.round(weather.precipitationProbability)}% (not intensity)`);
  if (weather.precipitation != null && weather.kind !== 'seasonal') detailLines.push(`Precipitation: ${weather.precipitation.toFixed(1)} mm over the preceding hour`);
  if (weather.snowfall != null && weather.kind !== 'seasonal') detailLines.push(`Snowfall: ${weather.snowfall.toFixed(1)} cm over the preceding hour`);
  if (weather.windSpeed != null && weather.windDirection != null) detailLines.push(`Wind from ${Math.round(weather.windDirection)}° at ${weather.windSpeed.toFixed(1)} m/s, estimated at 10 m`);
  if (weather.temperatureRange) detailLines.push(`Historical 10th–90th percentile: ${weather.temperatureRange.map(x => formatTemperature(x, units)).join(' to ')}`);
  if (weather.wetHourFrequency != null) detailLines.push(`Historical wet-hour frequency: ${Math.round(weather.wetHourFrequency)}% (not a forecast probability)`);
  if (weather.cloudCover == null) detailLines.push('Cloud cover unavailable; sky appearance is illustrative.');
  if (weather.kind === 'forecast' && Date.now() - Date.parse(weather.fetchedAt) > 2 * 60 * 60_000) detailLines.push('Forecast data is stale. Refresh when a connection is available.');
  detailLines.push('The sky, clouds, haze, shadows and precipitation are illustrative.');
  $('weather-source-detail').textContent = detailLines.filter(Boolean).join('\n');

  // Headline: temperature and condition, or the light when there is no weather.
  $('temperature').textContent = known ? formatTemperature(weather.temperature, units) ?? '' : '';
  $('weather-summary').textContent = known ? conditionName(weather) : sunLabel;
  const feels = known && weather.apparentTemperature != null && weather.temperature != null &&
    Math.abs(weather.apparentTemperature - weather.temperature) >= 2 ? `Feels like ${formatTemperature(weather.apparentTemperature, units)}` : '';
  $('feels-like').textContent = feels;
  $('feels-like').hidden = !feels;
  $('weather-detail').textContent = sky ? 'Weather effects are off.'
    : weather.kind === 'missing' ? `${weather.detail || 'Weather is unavailable.'}${weather.error ? ` (${weather.error})` : ''} Clear sky is illustrative.`
    : weather.kind === 'seasonal' ? 'Seasonal averages, not a prediction. Falling precipitation is not inferred from averages.' : '';
  $('weather-detail').hidden = !$('weather-detail').textContent;

  // One sentence for the whole picture.
  const day = ensureTrack(), now = Date.parse(state.time);
  const start = Date.parse(state.start), end = Date.parse(state.end);
  const ranged = !!state.rangeEnabled && end > start;
  const summary = { weather: known ? weather : null, units, sun: {
    time: now, start, end, rangeEnabled: ranged, sunrise: day.sunrise?.time, sunset: day.sunset?.time,
    sunUpAtStart: ranged ? day.at(start).altitude > 0 : undefined, sunUp: astronomy.sun.altitude > 0 } };
  $('briefing').textContent = summaryLine(summary);
  $('briefing').hidden = !$('briefing').textContent;
  $('briefing-short').textContent = summaryLine({ ...summary, headline: false });
  $('briefing-short').hidden = !$('briefing-short').textContent;

  const wind = sky ? null : windReadout(weather, units);
  $('wind-line').hidden = !wind;
  $('wind-line').textContent = wind ?? '';
  const chance = known && weather.precipitationProbability != null ? `Rain chance ${Math.round(weather.precipitationProbability)}%` : '';
  $('rain-line').hidden = !chance;
  $('rain-line').textContent = chance;
  const moonKeyNow = `${state.latitude},${state.longitude},${state.time.slice(0, 13)}`;
  if (moonKeyNow !== moonKey) { moonKey = moonKeyNow; try { moonTimes = moonEvents(state); } catch { moonTimes = null; } }
  const moonUp = astronomy.moon.altitude > 0, nextMoon = moonUp ? moonTimes?.set : moonTimes?.rise;
  $('moon-line').textContent = `${astronomy.moonPhaseName} · ${Math.round(astronomy.moonIlluminatedFraction * 100)}% lit` +
    (zone && nextMoon ? ` · ${moonUp ? 'sets' : 'rises'} ${clockLabel(nextMoon, zone)}` : moonUp ? ' · up' : ' · down');
  updateTimeline();
}

// Hourly conditions across the selected interval, for the timeline strip.
function queueSeries() {
  if (!state) return;
  const key = `${state.latitude.toFixed(3)},${state.longitude.toFixed(3)},${state.start?.slice(0, 13)},${state.end?.slice(0, 13)},${state.weatherEnabled}`;
  if (key === seriesKey) return;
  seriesKey = key;
  seriesAbort?.abort();
  series = [];
  updateTimeline();
  const start = Date.parse(state.start), end = Date.parse(state.end);
  if (!state.weatherEnabled || !(end > start)) return;
  const controller = seriesAbort = new AbortController();
  weatherController.getSeries({ latitude: state.latitude, longitude: state.longitude, start: state.start, end: state.end, signal: controller.signal })
    .then(samples => { if (key === seriesKey && !controller.signal.aborted) { series = samples; updateTimeline(); } })
    .catch(() => {});
}

function updateTimeline() {
  if (!state || !astronomy) return;
  const start = Date.parse(state.start), end = Date.parse(state.end);
  const panel = $('timeline');
  if (!(end > start) || end - start > 4 * 86400000) { panel.hidden = true; return; }
  const zone = sceneTimeZone(), day = ensureTrack();
  // Sunrise and sunset for each solar day the interval touches.
  const eventsKey = `${state.latitude},${state.longitude},${start},${end},${zone}`;
  const events = eventsKey === timelineEvents.key ? timelineEvents.list : [];
  if (eventsKey !== timelineEvents.key) for (let t = start; t < end + 86400000; t += 86400000) {
    const each = t === Date.parse(state.time) ? day : sunTrack({ ...state, time: new Date(Math.min(t, end)).toISOString() });
    for (const [name, sample] of [['Sunrise', each.sunrise], ['Sunset', each.sunset]]) {
      if (sample && !events.some(e => Math.abs(e.time - sample.time) < 60000)) events.push({ time: sample.time, label: zone ? `${name} ${clockLabel(sample.time, zone)}` : name });
    }
  }
  timelineEvents = { key: eventsKey, list: events };
  panel.hidden = false;
  panel.innerHTML = timelineMarkup({ start, end, now: Date.parse(state.time), series, sunAltitude: t => day.at(t).altitude, sunEvents: events,
    formatTemperature: c => formatTemperature(c, units), startLabel: zone ? clockLabel(start, zone) : '', endLabel: zone ? clockLabel(end, zone) : '' });
}

function queueWeather() {
  if (!state) return;
  // Conditions are blended between hourly values, so refresh every few minutes of selected time.
  const place = `${state.latitude.toFixed(5)},${state.longitude.toFixed(5)}`;
  const key = `${place},${Math.floor(Date.parse(state.time) / 300_000)}`;
  if (key === lastWeatherKey) return;
  const moved = place !== lastWeatherPlace;
  lastWeatherPlace = place;
  lastWeatherKey = key;
  lastWeatherAttempt = Date.now();
  const generation = ++weatherGeneration;
  clearTimeout(weatherTimer);
  weatherAbort?.abort();
  // Keep showing the current conditions while nearby times load, so moving
  // through time does not flash to a clear sky. Blank only for a new place.
  if (moved || weather.kind === 'missing') {
    weather = { kind: 'missing', label: 'Loading weather', detail: 'Fetching conditions for the selected place and hour.', renderPrecipitation: false };
    updateLightAndWeather();
    postStatus(true);
  }
  weatherTimer = setTimeout(async () => {
    const controller = new AbortController();
    weatherAbort = controller;
    const { latitude, longitude, time } = state;
    try {
      const next = await weatherController.getConditions({ latitude, longitude, time, signal: controller.signal });
      if (generation !== weatherGeneration || controller.signal.aborted) return;
      weather = next;
    } catch (error) {
      if (generation !== weatherGeneration || controller.signal.aborted) return;
      weather = { kind: 'missing', label: 'Weather unavailable', detail: 'Weather could not be retrieved. The clear sky shown is illustrative.', renderPrecipitation: false };
    }
    updateLightAndWeather();
    postStatus(true);
  }, moved ? 350 : 60);
}

function formatUTC(instant) {
  const date = new Date(instant);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'Unavailable';
}

function refreshWeatherIfNeeded() {
  if (Date.now() - lastWeatherAttempt >= (weather.kind === 'missing' ? 120_000 : 30 * 60_000)) {
    lastWeatherKey = undefined;
    queueWeather();
  }
}

// Stop Cesium's render loop and the effects while the scene cannot be seen,
// and pick both up again, with fresh weather, when it can.
function applyActivity() {
  if (!viewer) return;
  const shown = sceneShown();
  viewer.useDefaultRenderLoop = shown;
  // Cesium's loop wakes on every display frame to check for changes even when
  // it draws nothing; behind other apps, ten checks a second are plenty.
  viewer.targetFrameRate = orbitFrame ? 30 : activity.active ? undefined : 10;
  if (!shown) {
    animationFrame?.cancel();
    animationFrame = undefined;
    return;
  }
  lastFrame = 0;
  scheduleEffects();
  refreshWeatherIfNeeded();
  viewer.scene.requestRender();
}

function setActivity(next) {
  activity = { visible: next?.visible !== false, active: next?.active !== false };
  applyActivity();
}

function scheduleEffects() {
  if (animationFrame || !sceneShown()) return;
  const moving = state?.weatherEnabled && !state.reducedMotion && weather.kind !== 'missing';
  if (!moving) { drawEffects(0); return; }
  const step = time => {
    animationFrame = undefined;
    const delta = lastFrame ? clamp((time - lastFrame) / 1000, 0, 0.25) : 0;
    lastFrame = time;
    drawEffects(delta);
    scheduleEffects();
  };
  // Every display frame while the app is in front; about eight a second behind
  // other apps, where smooth motion matters less than the power it costs.
  if (activity.active) {
    const id = requestAnimationFrame(step);
    animationFrame = { cancel: () => cancelAnimationFrame(id) };
  } else {
    const id = setTimeout(() => step(performance.now()), 125);
    animationFrame = { cancel: () => clearTimeout(id) };
  }
}

// Foreground precipitation and haze are illustrative viewport effects. Clouds
// are rendered separately against Cesium's scene depth so they stay behind
// terrain and buildings instead of cutting across them at a screen-space line.
function drawEffects(delta) {
  if (!state || !astronomy) return;
  ctx.clearRect(0, 0, width, height);
  if (!state.weatherEnabled || weather.kind === 'missing') return;
  if (!state.reducedMotion) weatherClock += delta;
  const daylight = clamp((astronomy.sun.altitude + 9) / 20, 0, 1);
  const wind = weather.windSpeed ?? 0;
  const windAngle = ((weather.windDirection ?? 0) * Math.PI / 180) - heading;
  const drift = Math.sin(windAngle) * wind;
  // The flat fog sheet suits the ground view. From the air the mesh already
  // fades with distance, and a sheet would bury the whole scene and its labels.
  if (!photoreal && weather.visibility != null && weather.visibility < 6000) {
    const opacity = clamp(1 - weather.visibility / 6000, 0, 0.7);
    const shade = Math.round(28 + daylight * 152);
    const fog = ctx.createLinearGradient(0, 0, 0, height);
    fog.addColorStop(0, `rgba(${shade},${shade + 3},${shade + 7},${opacity * 0.3})`);
    fog.addColorStop(0.65, `rgba(${shade},${shade + 3},${shade + 7},${opacity})`);
    fog.addColorStop(1, `rgba(${shade},${shade + 3},${shade + 7},${opacity * 0.5})`);
    ctx.fillStyle = fog; ctx.fillRect(0, 0, width, height);
  }
  if (weather.renderPrecipitation) {
    const snow = weather.snowfall ?? 0;
    const rain = weather.rain ?? 0;
    // Enough streaks to read clearly as rain, still fine enough to see the
    // place through. Their number grows with the square root of the rate, so a
    // downpour looks heavier than a drizzle without becoming a curtain.
    const count = Math.min(state.detail === 'low' ? 110 : 260, Math.ceil(snow * 65 + 45 * Math.sqrt(rain)));
    const snowFraction = snow + rain > 0 ? snow / (snow + rain) : 0;
    // In the aerial view, drops move the way falling rain would look from this
    // camera: project one second of fall and wind drift at the pin onto the screen.
    const fallOnScreen = isSnow => {
      if (!photoreal) return null;
      const { at } = pinFrame();
      const blown = ((weather.windDirection ?? 0) + 180) * Math.PI / 180, carry = wind * (isSnow ? 0.7 : 0.35);
      const down = isSnow ? 1.4 : 9, above = flagHeight();
      const from = viewer.scene.cartesianToCanvasCoordinates(at(0, 0, above));
      const to = viewer.scene.cartesianToCanvasCoordinates(at(Math.sin(blown) * carry, Math.cos(blown) * carry, above - down));
      if (!from || !to) return null;
      return { x: to.x - from.x, y: to.y - from.y };
    };
    const projected = { rain: fallOnScreen(false), snow: fallOnScreen(true) };
    for (let i = 0; i < count; i++) {
      const seed = hash(i + 11), isSnow = hash(i + 700) < snowFraction;
      const depth = 0.3 + hash(i + 200) * 0.7;
      const fall = isSnow ? projected.snow : projected.rain;
      if (fall) {
        // Nearer drops cross the screen faster and look larger.
        const near = 1 + depth * 5;
        const x = mod(seed * width + weatherClock * fall.x * near, width + 40) - 20;
        const y = mod(hash(i + 400) * height + weatherClock * fall.y * near, height + 45) - 20;
        ctx.globalAlpha = (isSnow ? 0.25 + depth * 0.6 : 0.2 + depth * 0.42) * (0.35 + daylight * 0.65);
        if (isSnow) {
          ctx.fillStyle = '#edf4fa'; ctx.beginPath();
          ctx.arc(x + Math.sin(weatherClock * 1.5 + i) * 5, y, 0.8 + depth * 2.2, 0, Math.PI * 2); ctx.fill();
        } else {
          const length = Math.max(Math.hypot(fall.x, fall.y), 1), streak = 6 + depth * 15;
          ctx.strokeStyle = '#cddbe8'; ctx.lineWidth = 0.5 + depth * 0.6;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + fall.x / length * streak, y + fall.y / length * streak); ctx.stroke();
        }
        continue;
      }
      const speed = isSnow ? 25 + depth * 55 : 350 + depth * 550;
      const x = mod(seed * width + weatherClock * drift * 9 * depth - heading * width * depth, width + 40) - 20;
      const y = mod(hash(i + 400) * height + weatherClock * speed + (photoreal ? dronePitch : pitch) * height * depth, height + 45) - 20;
      ctx.globalAlpha = (isSnow ? 0.25 + depth * 0.6 : 0.2 + depth * 0.42) * (0.35 + daylight * 0.65);
      if (isSnow) {
        ctx.fillStyle = '#edf4fa'; ctx.beginPath();
        ctx.arc(x + Math.sin(weatherClock * 1.5 + i) * 7, y, 0.8 + depth * 2.2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = '#cddbe8'; ctx.lineWidth = 0.5 + depth * 0.6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + drift * 0.45, y + 8 + depth * 18); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  // Drift the clouds downwind. Real cloud speed would be imperceptible, so it
  // is exaggerated; without wind data they creep east. A few frames a second
  // are enough for motion this slow.
  if (delta > 0 && !state.reducedMotion && cloudStage.enabled) {
    const speed = weather.windDirection == null ? 1.5 : Math.max(wind, 1);
    const toward = ((weather.windDirection ?? 270) + 180) * Math.PI / 180;
    cloudDrift.x -= Math.sin(toward) * speed * delta * 0.0016;
    cloudDrift.y -= Math.cos(toward) * speed * delta * 0.0016;
    cloudStage.uniforms.cloudOffset = new C.Cartesian2(cloudDrift.x, cloudDrift.y);
    if (photoreal && tintShader) tintShader.setUniform('u_cloudOffset', new C.Cartesian2(cloudDrift.x, cloudDrift.y));
    const now = performance.now();
    if ((weather.cloudCover ?? 0) > 5 && now - lastSkyRender > (activity.active ? 125 : 500)) { lastSkyRender = now; viewer.scene.requestRender(); }
  }
  // Keep the flag waving. The 3D scene otherwise renders only on demand, and
  // each frame redraws the whole mesh, so ask for about ten frames a second
  // while the app is in front and four while it is in the background.
  if (photoreal && delta > 0 && !state.reducedMotion && flagExtension(wind, weather.windDirection) > 0) {
    const now = performance.now();
    if (now - lastFlagRender > (activity.active ? 100 : 250)) { lastFlagRender = now; flag.draw(true); viewer.scene.requestRender(); }
  }
}

function hash(seed) { const value = Math.sin(seed * 127.1) * 43758.5453; return value - Math.floor(value); }
function mod(value, modulus) { return ((value % modulus) + modulus) % modulus; }

function update(next) {
  if (!next || !Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)
      || Math.abs(next.latitude) > 90 || Math.abs(next.longitude) > 180
      || !Number.isFinite(new Date(next.time).getTime())) return;
  const previous = state;
  state = { weatherEnabled: true, snowCover: false, reducedMotion: false, computedShadows: false, diagnostics: false, idleOrbit: true, detail: 'balanced', ionToken: '', ...next };
  state.time = new Date(state.time).toISOString();
  // Without a valid interval, use the 24 hours around the selected instant.
  const instant = Date.parse(state.time), from = Date.parse(state.start), until = Date.parse(state.end);
  const valid = Number.isFinite(from) && Number.isFinite(until) && until > from;
  state.start = new Date(valid ? from : instant - 12 * 3_600_000).toISOString();
  state.end = new Date(valid ? until : instant + 12 * 3_600_000).toISOString();
  if (!valid) state.rangeEnabled = false;
  if (!viewer) return;
  $('place-name').textContent = state.location || 'Selected location';
  $('scene-coordinate').textContent = `${Math.abs(state.latitude).toFixed(4)}° ${state.latitude < 0 ? 'S' : 'N'}  ·  ${Math.abs(state.longitude).toFixed(4)}° ${state.longitude < 0 ? 'W' : 'E'}`;
  viewer.clock.currentTime = C.JulianDate.fromIso8601(state.time);
  viewer.clock.shouldAnimate = false;
  const astronomyKey = `${state.latitude},${state.longitude},${state.time}`;
  if (astronomyKey !== lastAstronomyKey) {
    astronomy = calculateAstronomy(state);
    lastAstronomyKey = astronomyKey;
  }
  // Atmospheric scattering controls twilight fading; hide the texture in daylight.
  // The underlying Cesium skybox rotates with sidereal time, not with the camera.
  // Stars wait for nautical twilight, so they do not appear in a still-bright sky.
  if (viewer.scene.skyBox) viewer.scene.skyBox.show = astronomy.sun.altitude < -9;
  diagnostics?.setEnabled(!!state.diagnostics);
  if (previous?.detail !== state.detail) {
    viewer.resolutionScale = state.detail === 'low' ? 0.75 : 1;
    viewer.scene.globe.maximumScreenSpaceError = state.detail === 'low' ? 4 : state.detail === 'high' ? 1 : 2;
    if (buildings) buildings.maximumScreenSpaceError = detailError();
    viewer.scene.shadowMap.size = state.detail === 'low' ? 1024 : 2048;
  }
  if (photoreal && buildings && previous?.computedShadows !== state.computedShadows) buildings.shadows = meshShadowMode();
  if (activeToken !== state.ionToken) {
    activeToken = state.ionToken;
    loadGeography(activeToken).catch(error => {
      geometryMessage = 'Geographic data unavailable';
      $('geometry-status').textContent = geometryMessage;
      showNotice('Geographic data unavailable', `The scene could not be prepared: ${String(error?.message ?? error).slice(0, 160)}`);
      postStatus(true);
    });
  } else if (previous?.latitude !== state.latitude || previous?.longitude !== state.longitude) {
    resetGaze();
    if (photoreal && previous && !state.reducedMotion) flyToPin(previous);
    placeObserver();
  }
  updateLightAndWeather();
  queueWeather();
  queueSeries();
  // Switching the turntable on starts it now; the idle wait applies only after a touch.
  if (previous?.idleOrbit === false && state.idleOrbit !== false) {
    lastInteraction = performance.now() - IDLE_ORBIT_AFTER;
    checkIdleOrbit();
  }
  viewer.scene.requestRender();
  postStatus();
}

window.whenScape = { update, setActivity,
  faceNorth() { heading = 0; setCamera(); },
  retryWeather() { lastWeatherKey = undefined; queueWeather(); },
};
try {
  if (!C) throw new Error('Cesium is unavailable');
  createViewer();
  // A real place and current instant, never invented calendar entries.
  update({ latitude: 34.0967, longitude: -117.7198, location: 'Claremont, California',
    time: new Date().toISOString(), weatherEnabled: true, ionToken: '' });
  if (native) native.postMessage({ type: 'ready' });
} catch (error) { failScene(error); }

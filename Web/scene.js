import { calculateAstronomy, clamp, compassName, sunTrack, moonEvents } from './astronomy.js';
import { unitsFor, formatTemperature, conditionName, windReadout, notableGust, summaryLine } from './briefing.js';
import { timelineMarkup } from './timeline.js';
import { domePoint, ringPoints, daylightRuns, hourMarks, clockLabel } from './guides.js';
import { WeatherController } from './weather.js';
import { createCloudStage } from './clouds.js';
import { flagExtension, flagShape, flagShadow, shadowOffset } from './flag.js';

const C = window.Cesium;
const $ = id => document.getElementById(id);
const native = window.webkit?.messageHandlers?.scene;
let viewer, buildings, terrain, state, astronomy, snowShader, tintShader, cloudStage;
// True while `buildings` is the photorealistic mesh, which includes its own ground.
let photoreal = false;
let heading = 0, pitch = 0.025, eyeHeight = 1.7;
// Aerial view used with the photorealistic mesh, which is captured from the
// air and only holds up from above: the camera orbits the pin, looking down.
const droneLimits = { minPitch: -80 * Math.PI / 180, maxPitch: -6 * Math.PI / 180, minRange: 60, maxRange: 2500 };
let dronePitch = -20 * Math.PI / 180, droneRange = 175;
let flag, flagTimer, lastFlagRender = 0, lastSkyRender = 0;
let guides, guidesKey, sunMarker, track, trackKey;
let series = [], seriesKey, seriesAbort, moonTimes, moonKey, timelineEvents = {};
const units = unitsFor(globalThis.navigator?.language ?? 'en-US');
const cloudDrift = { x: 0, y: 0 };
let geometryGeneration = 0, positionGeneration = 0, weatherGeneration = 0;
let activeToken, terrainAvailable = false, geometryMessage = 'Geographic data unavailable';
let weather = { kind: 'missing', label: 'Weather unavailable', detail: 'Choose a place and time.', renderPrecipitation: false };
let lastWeatherKey, weatherTimer, weatherAbort, lastAstronomyKey;
let lastWeatherAttempt = 0;
let weatherController = new WeatherController();
let animationFrame, lastFrame = 0, weatherClock = 0, lastStatus = 0;
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
  viewer.scene.shadowMap.maximumDistance = 1800;
  viewer.scene.shadowMap.softShadows = true;
  viewer.scene.skyAtmosphere.setDynamicLighting(C.DynamicAtmosphereLightingType?.SUNLIGHT ?? 2);
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.00008;
  viewer.scene.highDynamicRange = true;
  cloudStage = viewer.scene.postProcessStages.add(createCloudStage(C, viewer.scene));
  prepareStarTextures();
  flag = createFlag();
  guides = new C.CustomDataSource('guides');
  viewer.dataSources.add(guides);
  viewer.scene.renderError.addEventListener((_scene, error) => failScene(error));
  const handler = viewer.screenSpaceEventHandler;
  handler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  installRotation();
  resize();
  new ResizeObserver(resize).observe($('scene'));
  // Do not let focus leave the viewport when keyboard arrows rotate it.
  $('compass').addEventListener('click', () => { heading = 0; setCamera(); });
  $('refresh-weather').addEventListener('click', () => { lastWeatherKey = undefined; queueWeather(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { lastFrame = 0; scheduleEffects(); refreshWeatherIfNeeded(); viewer.scene.requestRender(); }
  });
  setInterval(() => { if (!document.hidden) refreshWeatherIfNeeded(); }, 60_000);
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
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    $('scene').focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    heading -= (e.clientX - pointer.x) * 0.003;
    const tilt = (e.clientY - pointer.y) * 0.003;
    // In the aerial view, dragging down lifts the camera toward a top-down view.
    if (photoreal) dronePitch = clamp(dronePitch - tilt, droneLimits.minPitch, droneLimits.maxPitch);
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
    e.preventDefault();
    if (!photoreal) return;
    droneRange = clamp(droneRange * Math.exp(clamp(e.deltaY, -200, 200) * 0.002), droneLimits.minRange, droneLimits.maxRange);
    setCamera();
  }, { passive: false });
  $('scene').addEventListener('keydown', e => {
    const amount = e.shiftKey ? 0.12 : 0.035;
    if (e.key === 'ArrowLeft') heading -= amount;
    else if (e.key === 'ArrowRight') heading += amount;
    else if (photoreal && e.key === 'ArrowUp') dronePitch = Math.max(dronePitch - amount, droneLimits.minPitch);
    else if (photoreal && e.key === 'ArrowDown') dronePitch = Math.min(dronePitch + amount, droneLimits.maxPitch);
    else if (photoreal && (e.key === '+' || e.key === '=')) droneRange = Math.max(droneRange / 1.15, droneLimits.minRange);
    else if (photoreal && (e.key === '-' || e.key === '_')) droneRange = Math.min(droneRange * 1.15, droneLimits.maxRange);
    else if (e.key === 'ArrowUp') pitch = Math.min(pitch + amount, Math.PI / 2 - 0.02);
    else if (e.key === 'ArrowDown') pitch = Math.max(pitch - amount, -Math.PI / 2 + 0.02);
    else return;
    e.preventDefault(); setCamera();
  });
}

function normalizeHeading() { return (((heading * 180 / Math.PI) % 360) + 360) % 360; }

function updateViewLabels() {
  $('view-kind').textContent = photoreal ? 'AERIAL VIEW' : 'GROUND VIEW';
  $('rotate-hint').textContent = photoreal ? 'Drag to orbit · scroll to zoom' : 'Drag to look · ↑ ↓ ← →';
  $('scene').setAttribute('aria-label', photoreal
    ? 'Aerial view of the selected place. Drag or use arrow keys to orbit and tilt. Scroll or use plus and minus to zoom.'
    : 'Ground-level scene. Drag to look around. Arrow keys rotate the view.');
  updateFlag();
}

function setCamera() {
  if (!state || !viewer) return;
  if (photoreal) {
    // Orbit the pin at ground level; `heading` stays the direction the camera faces.
    const pin = C.Cartesian3.fromDegrees(state.longitude, state.latitude, eyeHeight - 1.7);
    viewer.camera.lookAt(pin, new C.HeadingPitchRange(heading, dronePitch, droneRange));
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
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

function flagHeight() { return clamp(droneRange * 0.12, 8, 140); }
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
  return {
    pole: viewer.entities.add({ show: false, polyline: { width: 3, material: C.Color.fromCssColorString('#f3f0e8') } }),
    cloth: viewer.entities.add({ show: false, wall: {
      positions: new C.CallbackProperty(() => state ? cloth().positions : [], false),
      maximumHeights: new C.CallbackProperty(() => state ? cloth().tops : [], false),
      minimumHeights: new C.CallbackProperty(() => state ? cloth().bottoms : [], false),
      material: C.Color.fromCssColorString('#e8552d'), shadows: C.ShadowMode.DISABLED } }),
    poleShadow: viewer.entities.add({ show: false, polyline: { width: 3, clampToGround: true, classificationType: onMesh, material: shade } }),
    clothShadow: viewer.entities.add({ show: false, polygon: { classificationType: onMesh, material: shade } }),
  };
}

function updateFlag() {
  if (!flag || !state || !viewer) return;
  const shown = photoreal;
  flag.pole.show = flag.cloth.show = shown;
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
    flag.pole.polyline.positions = [at(0, 0, 0), at(0, 0, height)];
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

// Compass ring on the ground and the day's Sun path overhead, both centred on
// the flag. The arc is a dome: each point lies in the Sun's real direction at
// that time, so sunrise and sunset meet the ring at their compass bearings.
function updateGuides() {
  if (!guides) return;
  guides.show = photoreal;
  if (!photoreal || !state) return;
  const { at } = pinFrame();
  const radius = flagHeight() * 2.2;
  ensureTrack();
  const zone = sceneTimeZone();
  const event = state.rangeEnabled ? [Date.parse(state.start), Date.parse(state.end)] : null;
  const layout = [state.latitude, state.longitude, Math.round(eyeHeight * 10), Math.round(radius), track.start, zone, event?.join('-')].join('|');
  const ink = C.Color.fromCssColorString('#ffd24a');
  const always = Number.POSITIVE_INFINITY;
  const label = (text, color = C.Color.WHITE, size = 12) => ({ text, font: `600 ${size}px -apple-system, "Helvetica Neue", sans-serif`,
    fillColor: color, outlineColor: C.Color.BLACK.withAlpha(0.75), outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new C.Cartesian2(0, -13), disableDepthTestDistance: always });
  const dome = sample => { const p = domePoint(Math.max(sample.altitude, 0), sample.azimuth, radius); return at(p.e, p.n, p.up); };
  if (layout !== guidesKey) {
    guidesKey = layout;
    guides.entities.removeAll();
    guides.entities.add({ polyline: { positions: ringPoints(radius).map(p => at(p.e, p.n)), width: 2, clampToGround: true,
      classificationType: C.ClassificationType.CESIUM_3D_TILE, material: C.Color.WHITE.withAlpha(0.75) } });
    for (const [name, bearing] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
      const p = domePoint(0, bearing, radius * 1.1);
      guides.entities.add({ position: at(p.e, p.n, 1), label: { ...label(name, name === 'N' ? C.Color.fromCssColorString('#ffb27a') : C.Color.WHITE, 15),
        pixelOffset: C.Cartesian2.ZERO } });
    }
    for (const run of daylightRuns(track.samples)) {
      const ends = [track.sunrise, ...run, track.sunset].filter(Boolean).sort((a, b) => a.time - b.time);
      guides.entities.add({ polyline: { positions: ends.map(dome), width: 2, material: ink.withAlpha(0.9),
        depthFailMaterial: ink.withAlpha(0.3) } });
    }
    // The part of the day the selected event covers, drawn heavier.
    if (event) for (const run of daylightRuns(track.samples, event[0], event[1])) {
      guides.entities.add({ polyline: { positions: run.map(dome), width: 6, material: C.Color.fromCssColorString('#ff8a3c'),
        depthFailMaterial: C.Color.fromCssColorString('#ff8a3c').withAlpha(0.35) } });
    }
    if (zone) for (const mark of hourMarks(track.start, track.end, zone)) {
      const sample = track.at(mark.time);
      if (sample.altitude <= 1) continue;
      guides.entities.add({ position: dome(sample), point: { pixelSize: 5, color: C.Color.WHITE, outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1,
        disableDepthTestDistance: always }, label: mark.hour % 3 === 0 ? label(mark.label, C.Color.WHITE, 11) : undefined });
    }
    for (const [name, sample] of [['Sunrise', track.sunrise], ['Sunset', track.sunset]]) {
      if (!sample) continue;
      guides.entities.add({ position: dome(sample), point: { pixelSize: 7, color: ink, outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1,
        disableDepthTestDistance: always }, label: label(zone ? `${name} ${clockLabel(sample.time, zone)}` : name, ink) });
    }
    sunMarker = guides.entities.add({ point: { pixelSize: 15, color: C.Color.fromCssColorString('#fff3b0'), outlineColor: ink, outlineWidth: 3,
      disableDepthTestDistance: always } });
  }
  const sun = astronomy?.sun;
  sunMarker.show = !!sun && sun.altitude > 0;
  if (sunMarker.show) sunMarker.position = dome(sun);
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
      const [position] = await viewer.scene.sampleHeightMostDetailed([C.Cartographic.fromDegrees(longitude, latitude)]);
      if (generation !== positionGeneration) return;
      if (!Number.isFinite(position?.height)) throw new Error('No mesh height');
      eyeHeight = position.height + 1.7;
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
  ++positionGeneration;
  terrainAvailable = false;
  terrain = undefined;
  if (buildings) { viewer.scene.primitives.remove(buildings); buildings = undefined; }
  if (snowShader) { snowShader.destroy(); snowShader = undefined; }
  if (tintShader) { tintShader.destroy(); tintShader = undefined; }
  photoreal = false;
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
      maximumScreenSpaceError: detailError(), showCreditsOnScreen: true, enableCollision: true,
      // The aerial view sees to the horizon; load distant tiles more coarsely.
      dynamicScreenSpaceError: true,
      // Capture-time shadows are baked into the textures; casting more would double them.
      shadows: C.ShadowMode.DISABLED });
  } catch (error) {
    mesh = undefined;
    meshProblem = describeIonError(error);
  }
  if (generation !== geometryGeneration) { mesh?.destroy(); return; }
  if (mesh) {
    photoreal = true;
    updateViewLabels();
    // The mesh replaces the globe surface; drawing both makes them fight.
    viewer.scene.globe.show = false;
    buildings = viewer.scene.primitives.add(mesh);
    buildings.tileFailed.addEventListener(() => {
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

function detailError() { return state?.detail === 'high' ? 8 : state?.detail === 'low' ? 32 : 16; }

function updateBuildingStyle() {
  if (!buildings) return;
  if (photoreal) {
    // The mesh carries photographs taken in daylight and has no usable
    // normals, so it cannot be lit. Multiply it by the current light instead.
    if (!tintShader) tintShader = new C.CustomShader({
      lightingModel: C.LightingModel.UNLIT,
      uniforms: {
        u_light: { type: C.UniformType.VEC3, value: new C.Cartesian3(1, 1, 1) },
        u_hazeColor: { type: C.UniformType.VEC3, value: new C.Cartesian3(0.7, 0.8, 0.9) },
        u_hazeDensity: { type: C.UniformType.FLOAT, value: 0 },
        u_pin: { type: C.UniformType.VEC3, value: new C.Cartesian3() },
        u_east: { type: C.UniformType.VEC3, value: new C.Cartesian3(1, 0, 0) },
        u_north: { type: C.UniformType.VEC3, value: new C.Cartesian3(0, 1, 0) },
        u_cloudOffset: { type: C.UniformType.VEC2, value: new C.Cartesian2() },
        u_cloudCover: { type: C.UniformType.FLOAT, value: 0 },
        u_cloudShadow: { type: C.UniformType.FLOAT, value: 0 },
        u_wet: { type: C.UniformType.FLOAT, value: 0 },
        u_snow: { type: C.UniformType.FLOAT, value: 0 },
        u_glow: { type: C.UniformType.FLOAT, value: 0 },
      },
      // The cloud pattern repeats the sky stage's, laid over the ground at the
      // cloud layer's scale, so shadows drift with the clouds overhead.
      fragmentShaderText: `
      float groundHash(vec2 cell) { return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453); }
      float groundNoise(vec2 position) {
        vec2 cell = floor(position);
        vec2 part = fract(position);
        part = part * part * (3.0 - 2.0 * part);
        return mix(mix(groundHash(cell), groundHash(cell + vec2(1.0, 0.0)), part.x),
          mix(groundHash(cell + vec2(0.0, 1.0)), groundHash(cell + vec2(1.0, 1.0)), part.x), part.y);
      }
      float groundLayers(vec2 position) {
        float total = 0.0;
        float weight = 0.5;
        for (int i = 0; i < 5; ++i) {
          total += weight * groundNoise(position);
          position = position * 2.03 + vec2(17.0, 9.0);
          weight *= 0.5;
        }
        return total;
      }
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 photo = material.diffuse;
        float brightness = dot(photo, vec3(0.299, 0.587, 0.114));
        vec3 color = mix(photo, vec3(0.92, 0.94, 0.97), u_snow);
        color *= 1.0 - 0.28 * u_wet;
        vec3 offset = fsInput.attributes.positionWC - u_pin;
        vec2 ground = vec2(dot(offset, u_east), dot(offset, u_north)) / 1500.0 + u_cloudOffset;
        float threshold = mix(0.72, 0.18, u_cloudCover);
        float shadow = smoothstep(threshold, threshold + 0.15, groundLayers(ground)) * smoothstep(0.02, 0.12, u_cloudCover);
        color *= 1.0 - u_cloudShadow * shadow;
        color *= u_light;
        // After dark, pale surfaces pick up a warm tone, as if lit by lamps.
        color += u_glow * vec3(1.0, 0.78, 0.5) * smoothstep(0.35, 0.8, brightness) * photo;
        float distance = length(fsInput.attributes.positionEC);
        material.diffuse = mix(color, u_hazeColor, 1.0 - exp(-distance * u_hazeDensity));
      }`,
    });
    updateMeshShader();
    buildings.customShader = tintShader;
    return;
  }
  // A uniform matte style deliberately avoids photographic lighting baked into textures.
  if (!buildings.style) buildings.style = new C.Cesium3DTileStyle({ color: "color('#dbd5c8')" });
  const white = state.snowCover || (state.weatherEnabled && (weather.snowDepth ?? 0) > 0);
  if (white) {
    if (!snowShader) snowShader = new C.CustomShader({
      uniforms: { u_snowAmount: { type: C.UniformType.FLOAT, value: 0.72 } },
      fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 normalWC = normalize(czm_inverseViewRotation * fsInput.attributes.normalEC);
        vec3 upWC = normalize(fsInput.attributes.positionWC);
        float facingUp = smoothstep(0.4, 0.85, dot(normalWC, upWC));
        material.diffuse = mix(material.diffuse, vec3(0.88, 0.91, 0.94), facingUp * u_snowAmount);
        material.roughness = 1.0;
      }`,
    });
    buildings.customShader = snowShader;
  } else { buildings.customShader = undefined; }
}

// Approximate colour of the light falling on the scene: dark blue at night,
// warm near sunrise and sunset, dimmer and greyer under cloud.
function meshLight() {
  const altitude = astronomy?.sun.altitude ?? 45;
  const enabled = state?.weatherEnabled && weather.kind !== 'missing';
  const clouds = enabled ? clamp((weather.cloudCover ?? 0) / 100, 0, 1) : 0;
  const daylight = clamp((altitude + 8) / 20, 0, 1);
  const warmth = clamp(1 - Math.abs(altitude - 2) / 12, 0, 1) * (1 - clouds * 0.8);
  const mix = (night, day, warm) => {
    const base = night + (day - night) * daylight;
    return (base + (warm - base) * warmth * 0.6) * (1 - clouds * 0.3 * daylight);
  };
  return new C.Cartesian3(mix(0.03, 1, 1.0), mix(0.04, 1, 0.76), mix(0.075, 1, 0.56));
}

// Approximate colour of the sky at the horizon, matching the painted sky,
// used to fade distant ground into it.
function horizonColor() {
  const sunHeight = Math.sin((astronomy?.sun.altitude ?? 45) * Math.PI / 180);
  const step = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const day = step(-0.10, 0.12, sunHeight);
  const twilight = step(-0.28, -0.03, sunHeight) * (1 - step(0.02, 0.32, sunHeight));
  const enabled = state?.weatherEnabled && weather.kind !== 'missing';
  const overcast = step(0.55, 1, enabled ? (weather.cloudCover ?? 0) / 100 : 0);
  const blend = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  let color = blend([0.03, 0.045, 0.08], [0.66, 0.80, 0.93], day);
  color = blend(color, [0.80, 0.52, 0.42], twilight);
  color = blend(color, blend([0.045, 0.055, 0.075], [0.60, 0.64, 0.69], day), overcast * 0.85);
  return new C.Cartesian3(...color);
}

// Everything the mesh's look depends on: light, haze, cloud shadows, wet or
// snowy ground and the night tone. All of it is illustrative.
function updateMeshShader() {
  if (!tintShader || !state) return;
  const enabled = state.weatherEnabled && weather.kind !== 'missing';
  const clouds = enabled ? clamp((weather.cloudCover ?? 0) / 100, 0, 1) : 0;
  const sun = astronomy?.sun, moon = astronomy?.moon;
  const daylight = clamp(((sun?.altitude ?? 45) + 8) / 20, 0, 1);
  const light = meshLight();
  // Moonlight lifts the night a little, more for a fuller, higher Moon.
  const moonlight = moon && moon.altitude > 0 ? clamp(Math.sin(moon.altitude * Math.PI / 180) * 2.5, 0, 1) *
    (astronomy.moonIlluminatedFraction ?? 0) * (1 - daylight) * (1 - clouds * 0.8) : 0;
  light.x += 0.05 * moonlight; light.y += 0.065 * moonlight; light.z += 0.10 * moonlight;
  tintShader.setUniform('u_light', light);
  tintShader.setUniform('u_hazeColor', horizonColor());
  const visibility = enabled && weather.visibility > 0 ? weather.visibility : null;
  tintShader.setUniform('u_hazeDensity', clamp(visibility ? 2.5 / visibility : 1 / 18000, 1 / 18000, 1 / 60));
  const { at } = pinFrame();
  const pin = at(0, 0), east = at(1, 0), north = at(0, 1);
  tintShader.setUniform('u_pin', pin);
  tintShader.setUniform('u_east', C.Cartesian3.subtract(east, pin, new C.Cartesian3()));
  tintShader.setUniform('u_north', C.Cartesian3.subtract(north, pin, new C.Cartesian3()));
  tintShader.setUniform('u_cloudCover', clouds);
  const direct = sun && sun.altitude > 2 ? Math.pow(1 - clamp((clouds - 0.55) / 0.45, 0, 1), 1.5) : 0;
  tintShader.setUniform('u_cloudShadow', 0.38 * direct);
  const raining = enabled && weather.renderPrecipitation ? clamp(((weather.rain ?? 0) + (weather.precipitation ?? 0)) / 3, 0, 1) : 0;
  tintShader.setUniform('u_wet', raining);
  const depth = state.snowCover ? 0.05 : enabled ? (weather.snowDepth ?? 0) : 0;
  tintShader.setUniform('u_snow', clamp(depth / 0.05, 0, 1) * 0.7);
  tintShader.setUniform('u_glow', (1 - daylight) * 0.16);
}

function updateLightAndWeather() {
  if (!viewer || !astronomy) return;
  const enabled = state.weatherEnabled && weather.kind !== 'missing';
  const clouds = enabled ? clamp((weather.cloudCover ?? 0) / 100, 0, 1) : 0;
  const daylight = clamp((astronomy.sun.altitude + 8) / 20, 0, 1);
  // The stage paints the whole sky, clear or cloudy, wherever depth is available.
  const paintedSky = viewer.scene.pickPositionSupported;
  cloudStage.enabled = paintedSky;
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
    : weather.kind === 'missing' ? `${weather.detail || 'Weather is unavailable.'} Clear sky is illustrative.`
    : weather.kind === 'seasonal' ? 'Seasonal averages, not a prediction. Falling precipitation is not inferred from averages.' : '';
  $('weather-detail').hidden = !$('weather-detail').textContent;

  // One sentence for the whole picture.
  const day = ensureTrack(), now = Date.parse(state.time);
  const start = Date.parse(state.start), end = Date.parse(state.end);
  const ranged = !!state.rangeEnabled && end > start;
  $('briefing').textContent = summaryLine({ weather: known ? weather : null, units, sun: {
    time: now, start, end, rangeEnabled: ranged, sunrise: day.sunrise?.time, sunset: day.sunset?.time,
    sunUpAtStart: ranged ? day.at(start).altitude > 0 : undefined, sunUp: astronomy.sun.altitude > 0 } });
  $('briefing').hidden = !$('briefing').textContent;

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
  const key = `${state.latitude.toFixed(5)},${state.longitude.toFixed(5)},${state.time.slice(0, 13)}`;
  if (key === lastWeatherKey) return;
  lastWeatherKey = key;
  lastWeatherAttempt = Date.now();
  const generation = ++weatherGeneration;
  clearTimeout(weatherTimer);
  weatherAbort?.abort();
  weather = { kind: 'missing', label: 'Loading weather', detail: 'Fetching conditions for the selected place and hour.', renderPrecipitation: false };
  updateLightAndWeather();
  postStatus(true);
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
  }, 350);
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

function scheduleEffects() {
  if (animationFrame || document.hidden) return;
  const moving = state?.weatherEnabled && !state.reducedMotion && weather.kind !== 'missing';
  if (!moving) { drawEffects(0); return; }
  animationFrame = requestAnimationFrame(time => {
    animationFrame = undefined;
    const delta = lastFrame ? clamp((time - lastFrame) / 1000, 0, 0.1) : 0;
    lastFrame = time;
    drawEffects(delta);
    scheduleEffects();
  });
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
  if (weather.visibility != null && weather.visibility < 6000) {
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
    const count = Math.min(state.detail === 'low' ? 90 : 240, Math.ceil(snow * 65 + rain * 24));
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
        ctx.globalAlpha = (0.25 + depth * 0.6) * (0.35 + daylight * 0.65);
        if (isSnow) {
          ctx.fillStyle = '#edf4fa'; ctx.beginPath();
          ctx.arc(x + Math.sin(weatherClock * 1.5 + i) * 5, y, 0.8 + depth * 2.2, 0, Math.PI * 2); ctx.fill();
        } else {
          const length = Math.max(Math.hypot(fall.x, fall.y), 1), streak = 6 + depth * 16;
          ctx.strokeStyle = '#b9d0e5'; ctx.lineWidth = 0.5 + depth * 0.7;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + fall.x / length * streak, y + fall.y / length * streak); ctx.stroke();
        }
        continue;
      }
      const speed = isSnow ? 25 + depth * 55 : 350 + depth * 550;
      const x = mod(seed * width + weatherClock * drift * 9 * depth - heading * width * depth, width + 40) - 20;
      const y = mod(hash(i + 400) * height + weatherClock * speed + (photoreal ? dronePitch : pitch) * height * depth, height + 45) - 20;
      ctx.globalAlpha = (0.25 + depth * 0.6) * (0.35 + daylight * 0.65);
      if (isSnow) {
        ctx.fillStyle = '#edf4fa'; ctx.beginPath();
        ctx.arc(x + Math.sin(weatherClock * 1.5 + i) * 7, y, 0.8 + depth * 2.2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = '#b9d0e5'; ctx.lineWidth = 0.5 + depth * 0.7;
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
    if ((weather.cloudCover ?? 0) > 5 && now - lastSkyRender > 120) { lastSkyRender = now; viewer.scene.requestRender(); }
  }
  // Keep the flag waving. The 3D scene otherwise renders only on demand, so
  // ask for a frame about twenty times a second while there is wind to show.
  if (photoreal && delta > 0 && !state.reducedMotion && flagExtension(wind, weather.windDirection) > 0) {
    const now = performance.now();
    if (now - lastFlagRender > 50) { lastFlagRender = now; viewer.scene.requestRender(); }
  }
}

function hash(seed) { const value = Math.sin(seed * 127.1) * 43758.5453; return value - Math.floor(value); }
function mod(value, modulus) { return ((value % modulus) + modulus) % modulus; }

function update(next) {
  if (!next || !Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)
      || Math.abs(next.latitude) > 90 || Math.abs(next.longitude) > 180
      || !Number.isFinite(new Date(next.time).getTime())) return;
  const previous = state;
  state = { weatherEnabled: true, snowCover: false, reducedMotion: false, detail: 'balanced', ionToken: '', ...next };
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
  if (viewer.scene.skyBox) viewer.scene.skyBox.show = astronomy.sun.altitude < -4;
  if (previous?.detail !== state.detail) {
    viewer.resolutionScale = state.detail === 'low' ? 0.75 : 1;
    viewer.scene.globe.maximumScreenSpaceError = state.detail === 'low' ? 4 : state.detail === 'high' ? 1 : 2;
    if (buildings) buildings.maximumScreenSpaceError = detailError();
    viewer.scene.shadowMap.size = state.detail === 'low' ? 1024 : 2048;
  }
  if (activeToken !== state.ionToken) {
    activeToken = state.ionToken;
    loadGeography(activeToken).catch(error => {
      geometryMessage = 'Geographic data unavailable';
      $('geometry-status').textContent = geometryMessage;
      showNotice('Geographic data unavailable', `The scene could not be prepared: ${String(error?.message ?? error).slice(0, 160)}`);
      postStatus(true);
    });
  } else if (previous?.latitude !== state.latitude || previous?.longitude !== state.longitude) {
    placeObserver();
  }
  updateLightAndWeather();
  queueWeather();
  queueSeries();
  viewer.scene.requestRender();
  postStatus();
}

window.whenScape = { update,
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

import { calculateAstronomy, clamp, compassName } from './astronomy.js';
import { WeatherController } from './weather.js';
import { createCloudStage } from './clouds.js';

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
  viewer.scene.requestRender();
  drawEffects(0);
  postStatus();
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
      uniforms: { u_light: { type: C.UniformType.VEC3, value: new C.Cartesian3(1, 1, 1) } },
      fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        material.diffuse *= u_light;
      }`,
    });
    tintShader.setUniform('u_light', meshLight());
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

function updateLightAndWeather() {
  if (!viewer || !astronomy) return;
  const enabled = state.weatherEnabled && weather.kind !== 'missing';
  const clouds = enabled ? clamp((weather.cloudCover ?? 0) / 100, 0, 1) : 0;
  const daylight = clamp((astronomy.sun.altitude + 8) / 20, 0, 1);
  cloudStage.uniforms.cloudCover = clouds;
  cloudStage.uniforms.daylight = daylight;
  cloudStage.enabled = viewer.scene.pickPositionSupported && clouds > 0.05;
  viewer.scene.light.intensity = (0.04 + 1.96 * daylight) * (1 - clouds * 0.68);
  viewer.scene.shadowMap.enabled = clouds < 0.88;
  viewer.scene.skyAtmosphere.saturationShift = -clouds * 0.8;
  viewer.scene.skyAtmosphere.brightnessShift = -clouds * 0.22;
  const visibility = enabled ? weather.visibility : null;
  viewer.scene.fog.density = visibility > 0 ? clamp(1 / visibility, 0.00005, 0.004) : 0.00008;
  // The photographic mesh cannot be whitened by surface direction.
  const white = !photoreal && (state.snowCover || (enabled && (weather.snowDepth ?? 0) > 0));
  viewer.scene.globe.baseColor = C.Color.fromCssColorString(white ? '#cdd4d4' : '#65735d');
  $('snow-label').hidden = !white;
  $('snow-label').textContent = state.snowCover ? 'Illustrative white surfaces · no depth simulation'
    : 'Snow cover from an available depth estimate';
  updateBuildingStyle();
  updateWeatherHUD();
  viewer.scene.requestRender();
  drawEffects(0);
  scheduleEffects();
}

function updateWeatherHUD() {
  const sky = !state.weatherEnabled;
  const sunLabel = `${astronomy.light} · Sun ${Math.round(astronomy.sun.altitude)}°`;
  $('weather-kind').textContent = sky ? 'CLEAR-SKY PREVIEW' : weather.label.toUpperCase();
  $('weather-attribution').hidden = weather.kind === 'missing';
  const detailLines = [weather.detail];
  if (weather.source) detailLines.push(`Source: ${weather.source}`);
  if (weather.validAt) detailLines.push(`For: ${formatUTC(weather.validAt)}`);
  if (weather.fetchedAt) detailLines.push(`Retrieved: ${formatUTC(weather.fetchedAt)}`);
  if (weather.precipitationProbability != null) detailLines.push(`Chance of precipitation: ${Math.round(weather.precipitationProbability)}% (not intensity)`);
  if (weather.precipitation != null && weather.kind !== 'seasonal') detailLines.push(`Precipitation: ${weather.precipitation.toFixed(1)} mm over the preceding hour`);
  if (weather.snowfall != null && weather.kind !== 'seasonal') detailLines.push(`Snowfall: ${weather.snowfall.toFixed(1)} cm over the preceding hour`);
  if (weather.temperatureRange) detailLines.push(`Historical 10th–90th percentile: ${weather.temperatureRange.map(x => Math.round(x) + '°C').join(' to ')}`);
  if (weather.wetHourFrequency != null) detailLines.push(`Historical wet-hour frequency: ${Math.round(weather.wetHourFrequency)}% (not a forecast probability)`);
  if (weather.cloudCover == null) detailLines.push('Cloud cover unavailable; sky appearance is illustrative.');
  if (weather.kind === 'forecast' && Date.now() - Date.parse(weather.fetchedAt) > 2 * 60 * 60_000) detailLines.push('Forecast data is stale. Refresh when a connection is available.');
  $('weather-source-detail').textContent = detailLines.filter(Boolean).join('\n');
  if (sky) {
    $('weather-summary').textContent = sunLabel;
    $('weather-detail').textContent = `${astronomy.moonPhaseName} · ${Math.round(astronomy.moonIlluminatedFraction * 100)}% illuminated. Weather effects are off.`;
  } else if (weather.kind === 'missing') {
    $('weather-summary').textContent = sunLabel;
    $('weather-detail').textContent = `${weather.detail || 'Weather is unavailable.'} Clear sky is illustrative.`;
  } else {
    const temperature = weather.temperature == null ? '' : `${Math.round(weather.temperature)}°C · `;
    const condition = weather.renderPrecipitation && weather.snowfall > 0 ? 'Snow'
      : weather.renderPrecipitation && weather.rain > 0 ? 'Rain'
      : weather.visibility != null && weather.visibility < 1000 ? 'Fog'
      : weather.cloudCover == null ? 'Cloud cover unavailable'
      : weather.cloudCover > 80 ? 'Overcast' : weather.cloudCover > 20 ? 'Partly cloudy' : 'Mostly clear';
    $('weather-summary').textContent = `${temperature}${condition}`;
    $('weather-detail').textContent = weather.kind === 'seasonal'
      ? 'Seasonal averages · representative light, not a prediction. Falling precipitation is not inferred from averages.'
      : `${sunLabel}. ${weather.kind === 'historical' ? 'Historical grid estimate.' : 'Forecast conditions.'} Effects are illustrative.`;
  }
  $('wind-indicator').hidden = !state.weatherEnabled || weather.windSpeed == null;
  if (weather.windSpeed != null) {
    $('wind-speed').textContent = `${weather.windSpeed.toFixed(1)} m/s`;
    $('wind-direction').textContent = weather.windDirection == null ? 'Wind direction unknown'
      : `From ${compassName(weather.windDirection)} ${Math.round(weather.windDirection)}°`;
  }
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
    for (let i = 0; i < count; i++) {
      const seed = hash(i + 11), isSnow = hash(i + 700) < snowFraction;
      const depth = 0.3 + hash(i + 200) * 0.7;
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
  const sockAngle = state.reducedMotion ? 0 : Math.sin(weatherClock * 4) * Math.min(4, wind);
  $('windsock').style.transformOrigin = '13px 16px';
  $('windsock').style.transform = `rotate(${sockAngle}deg)`;
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

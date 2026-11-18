import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// This fixture has real depth-writing geometry but no ion token, terrain
// service, imagery or weather requests. It isolates cloud compositing from
// the lighting changes that accompany the app's Weather switch.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = `<!doctype html><html><head><style>
html,body,canvas { width:100%; height:100%; margin:0; overflow:hidden; display:block; }
</style></head><body><canvas id="scene"></canvas>
<script>window.CESIUM_BASE_URL='/cesium/';</script><script src="/cesium/Cesium.js"></script>
<script type="module">
import { createCloudStage } from '/Web/clouds.js';
const C = window.Cesium;
const canvas = document.getElementById('scene');
canvas.width = innerWidth; canvas.height = innerHeight;
const scene = new C.Scene({ canvas, contextOptions: { webgl: { preserveDrawingBuffer: true, antialias: false } } });
scene.backgroundColor = C.Color.fromCssColorString('#367dc9');
scene.highDynamicRange = false;
scene.msaaSamples = 1;
scene.camera.frustum.near = 0.1;
scene.camera.frustum.far = 1000;
const errors = [];
scene.renderError.addEventListener((_, error) => errors.push(String(error)));
const frame = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(0, 0, 0));
const boxPosition = C.Matrix4.multiplyByPoint(frame, new C.Cartesian3(0, 20, 5), new C.Cartesian3());
scene.primitives.add(new C.Primitive({
  geometryInstances: new C.GeometryInstance({
    geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(8, 8, 40), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }),
    modelMatrix: C.Transforms.eastNorthUpToFixedFrame(boxPosition),
    attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString('#e04a35')) }
  }),
  appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: false, closed: true }),
  asynchronous: false
}));
const stage = scene.postProcessStages.add(createCloudStage(C, scene));
stage.uniforms.cloudCover = 0.95;
stage.uniforms.daylight = 1;
const copy = document.createElement('canvas');
copy.width = canvas.width; copy.height = canvas.height;
const ctx = copy.getContext('2d', { willReadFrequently: true });
const now = C.JulianDate.fromIso8601('2026-06-21T12:00:00Z');
async function renderFrames(count = 5) {
  for (let i = 0; i < count; ++i) {
    await new Promise(requestAnimationFrame);
    scene.initializeFrame(); scene.render(now);
  }
}
function pixels() {
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}
window.fixture = {
  scene, stage, errors,
  depthSupported: scene.pickPositionSupported,
  async compare(pitch, logarithmicDepth) {
    scene.logarithmicDepthBuffer = logarithmicDepth;
    scene.camera.setView({ destination: C.Cartesian3.fromDegrees(0, 0, 1.7), orientation: { heading: 0, pitch, roll: 0 } });
    stage.enabled = false;
    await renderFrames();
    const clear = pixels();
    stage.enabled = true;
    await renderFrames(12);
    const cloudy = pixels();
    let surfaceCount = 0, surfaceDelta = 0, changedSurface = 0;
    let skyCount = 0, skyDelta = 0, changedSky = 0;
    let surfaceAboveMidline = 0, surfaceBelowMidline = 0;
    const width = canvas.width, height = canvas.height;
    // Sample the interior of flat-color surfaces, excluding antialiased edges.
    for (let y = 3; y < height - 3; ++y) {
      for (let x = 3; x < width - 3; ++x) {
        const i = (y * width + x) * 4;
        const red = clear[i] > clear[i + 1] * 1.5 && clear[i] > clear[i + 2] * 1.5;
        const blue = clear[i + 2] > clear[i] * 1.5 && clear[i + 1] > clear[i] * 1.2;
        let interior = true;
        for (const offset of [-12, 12, -12 * width, 12 * width]) {
          for (let channel = 0; channel < 3; ++channel) {
            if (Math.abs(clear[i + channel] - clear[i + offset + channel]) > 1) interior = false;
          }
        }
        if (!interior) continue;
        const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(clear[i + channel] - cloudy[i + channel])));
        if (red) {
          ++surfaceCount; surfaceDelta += delta;
          if (delta > 2) ++changedSurface;
          if (y < height / 2) ++surfaceAboveMidline; else ++surfaceBelowMidline;
        } else if (blue) {
          ++skyCount; skyDelta += delta;
          if (delta > 8) ++changedSky;
        }
      }
    }
    return { pitch, logarithmicDepth, ready: stage.ready, surfaceCount, surfaceMeanDelta: surfaceDelta / surfaceCount,
      changedSurface, skyCount, skyMeanDelta: skyDelta / skyCount, changedSky, surfaceAboveMidline, surfaceBelowMidline };
  }
};
window.fixtureReady = true;
</script></body></html>`;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    let file;
    if (url.pathname === '/Web/clouds.js') file = path.join(root, 'Web/clouds.js');
    else if (url.pathname.startsWith('/cesium/')) {
      const assets = path.join(root, 'node_modules/cesium/Build/Cesium');
      file = path.resolve(assets, '.' + url.pathname.slice('/cesium'.length));
      if (!file.startsWith(assets + path.sep)) throw new Error('Invalid asset path');
    } else throw new Error('Unknown fixture path');
    const body = await readFile(file);
    const mime = { '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 720, height: 540 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.fixtureReady);
  assert.equal(await page.evaluate(() => fixture.depthSupported), true, 'This regression requires WebGL depth textures');
  for (const logarithmicDepth of [true, false]) {
    for (const pitch of [-0.25, 0, 0.45]) {
      const result = await page.evaluate(([pitch, logarithmicDepth]) => fixture.compare(pitch, logarithmicDepth), [pitch, logarithmicDepth]);
      assert.equal(result.ready, true, 'The cloud shader must compile and become ready');
      assert.ok(result.surfaceCount > 1000, 'Fixture must render a substantial opaque building');
      assert.ok(result.surfaceAboveMidline > 300 && result.surfaceBelowMidline > 300, 'Building must cross the viewport horizon: ' + JSON.stringify(result));
      assert.ok(result.surfaceMeanDelta <= 1 && result.changedSurface < result.surfaceCount * 0.001,
        'Clouds must not paint across building pixels: ' + JSON.stringify(result));
      assert.ok(result.skyCount > 1000 && result.changedSky > 1000 && result.skyMeanDelta > 5,
        'Clouds must visibly change the unobstructed sky: ' + JSON.stringify(result));
    }
  }
  assert.deepEqual(await page.evaluate(() => fixture.errors), [], 'No Cesium render errors');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/scene-cloud-occlusion-test.png') });
  console.log('Cloud rendering checks passed: visible clouds, unchanged opaque buildings across the horizon, three camera pitches, logarithmic/linear depth, and no shader errors. Geometry and sky were local fixtures.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

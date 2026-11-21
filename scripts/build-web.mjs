import { build } from 'esbuild';
import { cp, mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Builds the 3D scene page, with Cesium and licence notices, into `out`. */
export async function buildScene(out) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(path.join(root, 'node_modules/cesium/Build/Cesium'), path.join(out, 'cesium'), { recursive: true });
  await mkdir(path.join(out, 'licenses'), { recursive: true });
  await copyFile(path.join(root, 'node_modules/cesium/LICENSE.md'), path.join(out, 'licenses/Cesium.txt'));
  const astronomySource = await readFile(path.join(root, 'node_modules/astronomy-engine/astronomy.js'), 'utf8');
  const astronomyNotice = astronomySource.match(/^\/\*\*([\s\S]*?)\*\//)?.[1];
  if (!astronomyNotice?.includes('MIT License')) throw new Error('Astronomy Engine license notice missing');
  await writeFile(path.join(out, 'licenses/AstronomyEngine.txt'), astronomyNotice);
  for (const file of ['index.html', 'scene.css']) await copyFile(path.join(root, 'Web', file), path.join(out, file));
  await build({ entryPoints: [path.join(root, 'Web/scene.js')], bundle: true, outfile: path.join(out, 'app.js'), format: 'iife', target: 'safari17', minify: true });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildScene(path.join(root, 'Sources/WhenScape/Resources/Web'));
  console.log('Bundled the scene and Cesium assets for offline app loading. Map and weather data still require a connection.');
}

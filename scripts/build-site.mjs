// Builds the browser app into dist/site: the page around the scene, and the
// scene itself under scene/. The Google Maps key comes from the
// GOOGLE_MAPS_API_KEY environment variable; it is public in the page, so it
// must be restricted in Google Cloud to this site's address and to the Maps
// JavaScript, Places (New), Geocoding and Map Tiles APIs.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildScene, root } from './build-web.mjs';

const out = path.join(root, 'dist/site');
await buildScene(path.join(out, 'scene'));
for (const file of ['index.html', 'site.css']) await copyFile(path.join(root, 'Site', file), path.join(out, file));
await build({ entryPoints: [path.join(root, 'Site/site.js')], bundle: true, outfile: path.join(out, 'site.js'), format: 'iife', target: ['safari16', 'chrome110', 'firefox110'], minify: true });
const key = (process.env.GOOGLE_MAPS_API_KEY ?? '').trim();
await writeFile(path.join(out, 'config.js'), `window.WHENSCAPE_CONFIG = ${JSON.stringify({ googleMapsKey: key })};\n`);
// GitHub Pages would otherwise skip files and folders whose names start with "_".
await writeFile(path.join(out, '.nojekyll'), '');
await mkdir(path.join(out, 'licenses'), { recursive: true });
const tzLicense = await readFile(path.join(root, 'node_modules/@photostructure/tz-lookup/LICENSE'), 'utf8').catch(() => 'CC0-1.0');
await writeFile(path.join(out, 'licenses/tz-lookup.txt'), tzLicense);
console.log(`Built the browser app in dist/site${key ? '' : ' (no Google Maps key: map, search and 3D model will be unavailable)'}.`);

// Serves the built scene (port 4173) or, with --site, the built browser app (port 4174).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const site = process.argv.includes('--site');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), site ? '../dist/site' : '../Sources/WhenScape/Resources/Web');
const port = site ? 4174 : 4173;
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(site
  ? `Browser app preview: http://127.0.0.1:${port}/`
  : `Scene preview: http://127.0.0.1:${port} (native calendar and MapKit require macOS)`));

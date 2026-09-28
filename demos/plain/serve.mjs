// Static server for the plain demo. No framework, no bundler: it serves the
// repo root so the page can import the rixse package (/packages/rixse), the
// shared demo modules (/demos/shared) and the canvas demo's zega engine and
// samples (/zega/* → demos/canvas/public/zega). Usage: node serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.csv': 'text/csv; charset=utf-8',
  '.zql': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

/** @param {number} port @returns {Promise<import('node:http').Server>} */
export function serve(port = 3200) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (p === '/') { res.writeHead(302, { location: '/demos/plain/index.html' }); res.end(); return; }
      if (p.startsWith('/zega/')) p = `/demos/canvas/public${p}`;
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.argv[2] ?? 3200);
  serve(port).then(() => console.log(`rixse plain demo: http://localhost:${port}/ (agent endpoint: ?agent=, default http://localhost:3100/api/agent)`));
}

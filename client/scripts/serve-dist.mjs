/**
 * Serve client/dist the way a CDN would (brotli, long cache on hashed assets)
 * and proxy /api and /share to the game server. Used for performance runs:
 *   node client/scripts/serve-dist.mjs [port=5180] [api=http://127.0.0.1:8787]
 */
import { createServer, request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { brotliCompressSync, constants } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.argv[2] ?? 5180);
const api = new URL(process.argv[3] ?? 'http://127.0.0.1:8787');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.xml': 'application/xml' };
const cache = new Map();

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/share')) {
    const p = request({ host: api.hostname, port: api.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    req.pipe(p);
    return;
  }
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(root, 'index.html');
  }
  try {
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const compressible = /text|json|svg|xml|wasm|gltf/.test(type);
    const br = compressible && /\bbr\b/.test(req.headers['accept-encoding'] ?? '');
    const key = `${file}:${br}`;
    let body = cache.get(key);
    if (!body) {
      body = await readFile(file);
      if (br) body = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
      cache.set(key, body);
    }
    res.writeHead(200, {
      'content-type': type,
      ...(br ? { 'content-encoding': 'br' } : {}),
      'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`dist on http://localhost:${port}`));

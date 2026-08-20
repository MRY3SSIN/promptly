/**
 * Minimal static file server for the e2e fixtures. Root is `tests/`, so a
 * fixture loads the built harness from `/.build/harness.js`.
 *
 * Deliberately not `vite dev` — the fixtures must be served as the byte-exact
 * saved HTML, with no transform pass in between, or the test stops testing the
 * markup we actually snapshotted.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 5599);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (path.includes('..')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`fixtures on http://127.0.0.1:${PORT}`);
});

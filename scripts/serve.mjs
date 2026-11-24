#!/usr/bin/env node
// Static server that mimics GitHub Pages: serves dist/ under /weight-app/ (and redirects / → /weight-app/).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const PORT = Number(process.env.PORT ?? 4180), BASE = '/weight-app/', ROOT = 'dist';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith(BASE)) { res.writeHead(302, { Location: BASE }); return res.end(); }
  let rest = decodeURIComponent(url.pathname.slice(BASE.length));
  if (!rest || rest.endsWith('/')) rest += 'index.html';
  const p = normalize(rest).replace(/^(\.\.[/\\])+/, '');
  try {
    const f = join(ROOT, p);
    if (!(await stat(f)).isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream', 'Cache-Control': p === 'sw.js' || p.endsWith('.html') ? 'no-cache' : 'max-age=600' });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(PORT, () => console.log(`serving dist at http://localhost:${PORT}${BASE}`));

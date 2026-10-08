// Server lokal sederhana untuk folder dist/ (tanpa dependensi).
// Meniru perilaku Cloudflare Pages: /gallery -> gallery.html, /wallpaper/slug -> wallpaper/slug.html
// Jalankan dengan: npm run serve   (atau npm run dev untuk build + serve)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveFile(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const candidates = [p, `${p}.html`, path.join(p, 'index.html')];
  for (const c of candidates) {
    const full = path.join(ROOT, c);
    if (!full.startsWith(ROOT)) continue; // cegah path traversal
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      /* coba kandidat berikutnya */
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/_headers') {
    res.writeHead(404).end('Not found');
    return;
  }
  let file = resolveFile(pathname);
  let status = 200;
  if (!file) {
    file = path.join(ROOT, '404.html');
    status = 404;
  }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    'Cache-Control': 'no-cache',
  };
  if (pathname.startsWith('/original/')) headers['Content-Disposition'] = 'attachment';
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nTSC AI WALLPAPER berjalan di:\n  Komputer ini : http://localhost:${PORT}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  HP (Wi-Fi sama): http://${a.address}:${PORT}`);
    }
  }
  console.log('\nTekan Ctrl+C untuk berhenti.\n');
});

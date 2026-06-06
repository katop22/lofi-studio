#!/usr/bin/env node
// Minimal static file server for domain verification files (TikTok, etc.).
// Serves every file under project-root/public/ at the URL root.
//
//   npm run serve:static
//   → http://localhost:8766/<filename>
//   → expose publicly with: ngrok http 8766
import http from 'node:http';
import fs   from 'node:fs';
import path from 'node:path';
import { log } from './logger.js';

const PORT       = parseInt(process.env.STATIC_PORT || '8766', 10);
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
};

const server = http.createServer((req, res) => {
  // Strip query string and prevent path traversal.
  const urlPath  = decodeURIComponent(req.url.split('?')[0]).replace(/\.\./g, '');
  const filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      log.warn(`404 ${req.url}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
    log.info(`200 ${req.url} (${(data.length / 1024).toFixed(1)} KB)`);
  });
});

server.listen(PORT, () => {
  log.info(`Static file server running on http://localhost:${PORT}`);
  log.info(`Serving files from: ${PUBLIC_DIR}`);
  log.info('Place verification files in public/ then expose with: ngrok http ' + PORT);
});

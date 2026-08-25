// Minimal static server for dom-test.sh — module scripts won't load over
// file://, so the harness needs an origin. No dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

http
  .createServer((req, res) => {
    const p = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = path.join(root, p.endsWith('/') ? p + 'index.html' : p);
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(parseInt(process.argv[2] ?? '8437', 10), '127.0.0.1');

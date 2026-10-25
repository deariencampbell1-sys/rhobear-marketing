// W0-01: tiny static server for checking `dist` locally (npm run dev).
// No dependencies: node:http only. Serves dist/<path>/index.html for clean
// URLs and dist/404.html with status 404 for anything unknown — mirroring
// what the production host must do.
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const distDir = path.join(process.cwd(), 'dist');
const port = Number(process.env.PORT ?? 4173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = path.join(distDir, urlPath);
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) file = path.join(distDir, '404.html');
    const status = file.endsWith('404.html') && urlPath !== '/404.html' ? 404 : 200;
    res.writeHead(status, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(res);
  })
  .listen(port, () => {
    console.log(`dev server: http://localhost:${port} serving dist/`);
  });
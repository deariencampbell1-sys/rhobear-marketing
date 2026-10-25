// W0-01: tiny static server for checking `dist` locally (npm run dev).
// No dependencies: node:http only. Serves dist/<path>/index.html for clean
// URLs and dist/404.html with status 404 for anything unknown — mirroring
// what the production host must do.
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist');
const notFoundFile = path.join(distDir, '404.html');
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendText(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDirectory(file) {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function sendFile(res, file, status) {
  res.writeHead(status, {
    'content-type': types[path.extname(file)] ?? 'application/octet-stream',
  });
  const stream = createReadStream(file);
  stream.on('error', (error) => {
    console.error(`dev server: could not read ${file}: ${error.message}`);
    res.destroy();
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function sendNotFound(res) {
  if (isFile(notFoundFile)) sendFile(res, notFoundFile, 404);
  else sendText(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }
  if (urlPath.includes('\0')) {
    sendText(res, 400, 'Bad request');
    return;
  }

  let file = path.resolve(distDir, '.' + urlPath);
  if (file !== distDir && !file.startsWith(distDir + path.sep)) {
    sendNotFound(res);
    return;
  }
  if (isDirectory(file)) file = path.join(file, 'index.html');
  if (!isFile(file)) {
    sendNotFound(res);
    return;
  }
  sendFile(res, file, 200);
});

server.on('error', (error) => {
  console.error(`dev server: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`dev server: http://${host}:${port} serving dist/`);
});
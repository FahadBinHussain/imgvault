import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  
  if (url.pathname === '/scene-viewer.html') {
    // Serve the viewer HTML with no CSP
    const html = fs.readFileSync(path.join(distDir, 'scene-viewer.html'), 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*',
      // No CSP header — allows WASM and CDN imports
    });
    res.end(html);
    return;
  }

  // Serve other dist files
  const filePath = path.join(distDir, url.pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(`[SceneViewer] http://127.0.0.1:${port}/scene-viewer.html`);
});

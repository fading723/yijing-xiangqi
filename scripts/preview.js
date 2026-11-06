'use strict';
// Optional development preview; the finished game does not need this server.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/engine.js', ['engine.js', 'text/javascript; charset=utf-8']],
  ['/campaign-design.js', ['campaign-design.js', 'text/javascript; charset=utf-8']],
  ['/campaign-data.js', ['campaign-data.js', 'text/javascript; charset=utf-8']],
  ['/levels.js', ['levels.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/offline.html', ['弈境-离线版.html', 'text/html; charset=utf-8']]
]);
const server = http.createServer((req, res) => {
  const item = files.get(new URL(req.url, 'http://127.0.0.1').pathname);
  if (!item || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(root, item[0]), (error, content) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
});
server.listen(8765, '127.0.0.1', () => console.log('Game preview: http://127.0.0.1:8765'));

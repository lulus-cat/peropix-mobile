// mobile/www 를 그대로 띄우는 미리보기용 정적 서버 (개발 전용).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'www');
const PORT = 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

http.createServer(function (req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  // 상위 경로 탈출은 아래 ROOT 접두 검사 하나로 막는다.
  const file = path.resolve(ROOT, '.' + path.normalize(p));
  if (!file.startsWith(path.resolve(ROOT))) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, function () { console.log('미리보기: http://localhost:' + PORT); });

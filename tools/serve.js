// docs/ をローカルで確認するサーバー。baseUrl のパス（/semicon-quiz/ など）を再現する。
// 実行: node tools/serve.js [ポート]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const docs = path.join(root, 'docs');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const base = new URL(config.baseUrl.replace(/\/?$/, '/')).pathname;
const port = Number(process.argv[2]) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(base)) {
    res.writeHead(302, { Location: base });
    return res.end();
  }
  let file = path.join(docs, url.slice(base.length));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.endsWith('/')) {
      res.writeHead(301, { Location: url + '/' });
      return res.end();
    }
    file = path.join(file, 'index.html');
  }
  if (!file.startsWith(docs) || !fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': types['.html'] });
    return res.end(fs.readFileSync(path.join(docs, '404.html')));
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(port, () => console.log(`http://localhost:${port}${base}`));

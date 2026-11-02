// Tiny loopback-only receiver: the browser tab that crawls the guide/wiki POSTs its rows here,
// and they are saved into data/raw/<name>. Usage: node tools/recv.js  (port 48791)
const http = require('http'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'data', 'raw');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const name = u.searchParams.get('name') || '';
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET' && /^[a-z0-9-]+\.tsv$/.test(name)) { try { return res.end(fs.readFileSync(path.join(DIR, name))); } catch (e) { res.statusCode = 404; return res.end(''); } }
  if (req.method !== 'POST' || !/^[a-z0-9-]+\.tsv$/.test(name)) { res.statusCode = 400; return res.end('bad'); }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8').replace(/\r?\n?$/, '\n');
    fs.writeFileSync(path.join(DIR, name), body);
    res.end('ok ' + body.split('\n').length);
  });
}).listen(48791, '127.0.0.1');

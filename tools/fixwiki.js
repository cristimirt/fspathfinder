// Normalises a raw wiki crawl: plain links to a master realm become "World Area" exits,
// and the world column is filled from that exit when the wiki page had no "Located in" line.
// Usage: node tools/fixwiki.js <raw file in data/raw> <output name in data/raw>
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'data', 'raw');
const [inName, outName] = process.argv.slice(2);
const masters = new Set();
fs.readdirSync(DIR).filter(f => f.startsWith('world-areas-')).forEach(f =>
  fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean).forEach(l => masters.add(l.split('¦')[0])));
const lines = fs.readFileSync(path.join(DIR, inName), 'utf8').split('\n').filter(Boolean);
let conv = 0, noWorld = 0;
const res = lines.map(l => {
  const c = l.split('¦');
  const items = (c[3] || '').split(';').filter(Boolean).map(it => {
    const p = it.split('|');
    if (p[0] === '') {
      const t = p[1].replace(/ World Area$/, '');
      if (masters.has(t)) { p[0] = 'World Area'; p[1] = t; conv++; }
    }
    return p.join('|');
  });
  c[3] = items.join(';');
  if (!masters.has(c[2])) {
    const w = items.map(i => i.split('|')).find(p => p[0] === 'World Area');
    if (w) c[2] = w[1];
  }
  if (!c[2]) noWorld++;
  return c.join('¦');
});
fs.writeFileSync(path.join(DIR, outName), res.join('\n') + '\n');
console.log(lines.length, 'rows,', conv, 'exits tagged,', noWorld, 'without world');

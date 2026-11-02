// Waits for crawled batches (raw-wiki-<A>-<B>.tsv, posted by the browser through recv.js), normalises each one
// into wiki-<A>-<B>.tsv, then rebuilds site/data.js. Exits after <count> batches so the caller gets a report.
//   node tools/ingest.js <count>
const fs = require('fs'), path = require('path'), cp = require('child_process');
const DIR = path.join(__dirname, '..', 'data', 'raw');
const want = +process.argv[2] || 1;
let done = 0;
const tick = () => {
  for (const f of fs.readdirSync(DIR).filter((x) => /^raw-wiki-\d+-\d+\.tsv$/.test(x)).sort()) {
    const out = f.replace('raw-', '');
    if (fs.existsSync(path.join(DIR, out))) continue;
    // let the browser finish the POST before reading
    if (Date.now() - fs.statSync(path.join(DIR, f)).mtimeMs < 3000) continue;
    process.stdout.write(f + ': ' + cp.execFileSync('node', [path.join(__dirname, 'fixwiki.js'), f, out]).toString());
    done++;
  }
  if (done >= want) {
    process.stdout.write(cp.execFileSync('node', [path.join(__dirname, 'build-data.js')]).toString().split('\n')
      .map((l) => (l.length > 600 ? l.slice(0, 600) + ' ...' : l)).join('\n'));
    process.exit(0);
  }
  setTimeout(tick, 10000);
};
tick();

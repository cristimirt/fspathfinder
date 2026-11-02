// Copies site/route.js into the helper userscript, between its ">>> route.js" and "<<< route.js" marker lines, so the
// helper and the website share one routing implementation. Run after changing route.js:
//   node tools/sync-helper.js <path to fs_backpack_helper.js>
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = process.argv[2];
if (!target) { console.error('usage: node tools/sync-helper.js <path to fs_backpack_helper.js>'); process.exit(1); }
const src = fs.readFileSync(path.join(root, 'site', 'route.js'), 'utf8').replace(/\r\n/g, '\n').trim();

const START = '  // >>> route.js';
const END = '  // <<< route.js';
let text = fs.readFileSync(target, 'utf8');
const crlf = text.includes('\r\n');
text = text.replace(/\r\n/g, '\n');
const i = text.indexOf(START);
const j = text.indexOf(END);
if (i < 0 || j < i) throw new Error('marker lines not found in ' + target);

// `module` is given an empty exports object, so route.js takes its CommonJS branch and hands the API back
const body = src.split('\n').map((l) => (l ? '    ' + l : l)).join('\n');
const block = START + ' (generated from the Fallen Sword Path Finder repo, site/route.js by tools/sync-helper.js: edit that file, not this copy)\n' +
  '  const FSRoute = (() => {\n    const module = { exports: {} };\n' + body + '\n    return module.exports;\n  })();\n';
text = text.slice(0, i) + block + text.slice(j);
if (crlf) text = text.replace(/\n/g, '\r\n');
fs.writeFileSync(target, text);
console.log('route.js copied into', target);

// Builds site/data.js from the raw files collected from the guide and the wiki.
//   node tools/build-data.js
// Inputs  (data/raw): guide-1-50.tsv, wiki-1-50.tsv, world-areas-1-50.tsv
// Output  (site):     data.js  ->  window.FSAR = { pages, worlds, areas }
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rawDir = path.join(root, 'data', 'raw');
// every line of every file that starts with the prefix, in file-name order (one file per level batch)
const raw = (prefix) => fs.readdirSync(rawDir).filter((f) => f.startsWith(prefix) && f.endsWith('.tsv')).sort()
  .reduce((all, f) => all.concat(fs.readFileSync(path.join(rawDir, f), 'utf8').split(/\r?\n/).filter(Boolean)), []);
const list = (s) => (s ? s.split(';').map((x) => x.trim()).filter(Boolean) : []);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Pages are cut from the data once the realms are known (see buildPages below).
const PAGE_SIZE = 50;   // target number of realms per page
const PAGE_MIN = 15;    // a shorter leftover at the end of a thousand is merged into the page before it

// The wiki leaves some "Located in" lines empty or disagrees with its own world map; fixed by hand.
const WORLD_OVERRIDE = {
  'Labyrinth of the Lost': 'Krul Island', // sits next to Krul Island in the original guide
  'Angels Keep': 'Elya Desert',
  'Moot Forest South': 'Jaunt Bay', // Jaunt Bay's nearest portal is Moot Forest (South)
  'Ethereal Frontier': 'Bay of Zenel', 'Ethereal Badlands': 'Bay of Zenel', 'Ethereal Plains': 'Bay of Zenel', // wiki says Krul Island
  'Jahd Swamps (North)': 'Bay of Zenel', 'Jahd Swamps (Trogladores Cave)': 'Bay of Zenel', 'Jahd Swamps (West)': 'Bay of Zenel',
  'Jahd Swamps (South)': 'Bay of Zenel', 'Jahd Swamps (East)': 'Bay of Zenel',
  // the way on into The Killgorey Labyrinth starts here, which makes these look closer to it than to their own world map
  'Jorkath Desert (Drifts)': 'The Ugarak Canyons', 'Jorkath Desert (Court)': 'The Ugarak Canyons', 'Jorkath Desert (Range)': 'The Ugarak Canyons',
};
// areas that only exist during a seasonal event (the wiki files them under Krul Island)
const EVENT_NAME = /^(Forest of Yule|Springtime Forest|Grannies Cottage|Woodsman Forest|Toad Swamp|The Virtue Desert|Quango|Battleground of Gurgriss|Cursed Ones Frozen Forest|The Decrepit Castle|The Wretched Graveyard|Dark Dwarf|Horrifying Haunt|Happy Bear Woods|The Bears Cottage|Haunt of Tommy Aches|Hallowed Isle|Cursed Ones Autumn Forest|The Overgrown Castle|Carle Farm|Arable Farmers Mart)/; // the last two only open from The Grimmnor Forest (Halloween)
// Realms entered straight from the world map when the wiki has no "World Area" exit for the world.
// Entries added by hand. An empty list means the world map has no way in from a realm (nothing is guessed for it).
const ENTRY_OVERRIDE = { 'Krul Island': [] };

// ---- guide: name, level, shops, relics, quests, creatures
const guide = {};
raw('guide-').forEach((line) => {
  const [id, name0, level, shops, relics, quests, creatures] = line.split('¦');
  const name = name0.replace(/\\/g, ''); // the guide escapes apostrophes
  const ranks = ['Champion', 'Elite', 'Super Elite', 'Legendary', 'Titan'];
  guide[name] = {
    guideId: +id,
    level: +level,
    shops: list(shops),
    relics: list(relics),
    quests: list(quests),
    // the guide sometimes lists a creature twice
    creatures: list(creatures).filter((c, i, all) => all.indexOf(c) === i).map((c) => {
      // "Skull Carver (Super Elite) (Demon)" -> name, rank, race
      const clean = (c.match(/\(([^()]*)\)/g) || []).map((p) => p.slice(1, -1).trim());
      const rank = clean.find((p) => ranks.indexOf(p) !== -1) || '';
      const race = clean.filter((p) => p !== rank).pop() || '';
      return { name: c.replace(/\s*\([^()]*\)/g, '').trim() || c, rank, race };
    }),
  };
});

// ---- wiki: name, level, world area, then "tag|title|x|y|note" items
const wiki = {};
raw('wiki-').forEach((line) => {
  // column 2 is the level (first batch) or the wiki page title that was used (later batches)
  const [name0, second, world, items] = line.split('¦');
  const name = name0.replace(/\\/g, '');
  wiki[name] = {
    level: +second || null,
    title: second && !/^\d+$/.test(second) && second !== name ? second : '',
    world: world || '',
    items: list(items).map((it) => {
      const [tag, title, x, y, note] = it.split('|');
      return { tag: (tag || '').toLowerCase(), title, x: +x, y: +y, note: (note || '').replace(/^\(|\)$/g, '') };
    }),
  };
});

// ---- links crawled from the guide's own pages (the guide is the source of truth; the wiki is no longer updated)
//   links-masters.tsv: master realm id, name, min level, "realmId:name;..." (its main realms = entered from the world map)
//   links-stairs.tsv:  realm id, flag, "toId:x:y:name;..." (every stairway link inside the .realmContainer map)
const guideMasters = raw('links-masters').map((line) => {
  const [id, name, level, main] = line.split('¦');
  return { id: +id, name: name.trim(), level: +level, main: list(main).map((m) => +m.split(':')[0]) };
});
const guideLinks = {};
raw('links-stairs').forEach((line) => {
  const [id, , ls] = line.split('¦');
  guideLinks[id] = list(ls).map((x) => { const [to, lx, ly] = x.split(':'); return { to: +to, x: +lx, y: +ly }; });
});
// links-features.tsv: realm id, then what the guide's own realm map shows: "x:y:id" portal tiles, "x:y:name" shops, relics and
// stairways to a master realm (the way out to the world map). The guide is the truth for what stands on which tile.
const unesc = (s) => s.split(String.fromCharCode(92)).join('');
const guideFeat = {};
raw('links-features').forEach((line) => {
  const [id, portals, shops, relics, exits] = line.split('¦');
  const items = (s) => list(s).map((x) => { const [px, py, ...rest] = x.split(':'); return { x: +px, y: +py, name: unesc(rest.join(':')) }; });
  guideFeat[id] = { portals: items(portals), shops: items(shops), relics: items(relics), exits: items(exits) };
});
// four master realms share their name with a realm in them ("City of Xinderoth" is both), and node names must be unique:
// they keep the shorter names the wiki gave them
const MASTER_NAME = { 'The lost Realm of Ruzdum': 'Ruzdum', 'The buried city of Dar GromSol': 'Dar GromSol', 'City of Xinderoth': 'Xinderoth', 'The Gorgon Isle': 'Gorgon Isle' };
const guideName = (n) => n;
guideMasters.forEach((m) => { m.name = MASTER_NAME[m.name] || m.name; });

// ---- world areas (master realms): the guide's list, plus the wiki's nearest-portal text where it has it
const wikiWorld = {};
raw('world-areas-').forEach((line) => {
  const [name, level, , portal] = line.split('¦');
  wikiWorld[norm(guideName(name))] = {
    level: +level,
    nearestPortal: portal.replace(/\s*\/\s*\d+ moves away\.?$/, '').replace(/ \/ /g, ', '),
    moves: +((portal.match(/(\d+) moves away/) || [])[1] || 0),
  };
});
const worldRows = [{ name: 'Krul Island', level: 1, id: 0, main: [] }]
  .concat(guideMasters.slice().sort((p, q) => p.level - q.level || p.id - q.id))
  .map((m, i, all) => {
    const w = wikiWorld[norm(m.name)] || {};
    return {
      name: m.name, id: m.id, level: m.level,
      prev: i ? all[i - 1].name : null,
      next: all[i + 1] ? all[i + 1].name : null,
      nearestPortal: w.nearestPortal || '',
      moves: w.moves || 0,
      mainIds: m.main,
    };
  });

// ---- realms
const byName = {};
const byNorm = {};
const areas = [];
Object.keys(guide).forEach((name) => {
  const g = guide[name];
  const a = {
    name,
    kind: 'realm',
    level: g.level,
    world: null, // decided below, once the guide's links are known
    guideId: g.guideId,
    wikiTitle: (wiki[name] && wiki[name].title) || '',
    dark: false,
    event: EVENT_NAME.test(name),
    shops: g.shops,
    relics: g.relics,
    quests: g.quests,
    creatures: g.creatures,
    stairs: [],
    beyond: [],
    portals: [],
    shopSpots: [],
    relicSpots: [],
    worldExits: [],
  };
  byName[name] = a;
  byNorm[norm(name)] = a;
  areas.push(a);
});
worldRows.forEach((w) => {
  const a = {
    name: w.name, kind: 'master', level: w.level, world: w.name,
    nearestPortal: w.nearestPortal, moves: w.moves, main: [], guideId: w.id,
    stairs: [], beyond: [], portals: [], shops: [], relics: [], quests: [], creatures: [],
    shopSpots: [], relicSpots: [], worldExits: [],
  };
  byName[w.name] = a;
  byNorm[norm(w.name)] = a;
  areas.push(a);
});
const worldNames = worldRows.map((w) => w.name);
const byId = {};
areas.forEach((a) => { if (a.kind === 'realm') byId[a.guideId] = a; });
worldRows.forEach((w) => { byName[w.name].main = w.mainIds.filter((id) => byId[id]).map((id) => byId[id].name); });

// ---- which world map each realm belongs to
// 1. the guide lists the main realms of every master realm: those are certain.
// 2. further in, a realm belongs to the master realm that is the fewest stairways away (ties: the highest master level
//    that is not above the realm's level).
// 3. the wiki's "Located in" is only used below level 1001, where its list of master realms was complete.
const WIKI_LAST_GOOD = 1000;
const adj = {};
Object.keys(guideLinks).forEach((a) => guideLinks[a].forEach((l) => {
  (adj[a] = adj[a] || new Set()).add(String(l.to));
  (adj[l.to] = adj[l.to] || new Set()).add(a);
}));
const dist = {}, owners = {};
let frontier = [];
worldRows.forEach((w) => w.mainIds.forEach((id) => {
  if (!byId[id]) return;
  if (!(id in dist)) { dist[id] = 0; owners[id] = []; frontier.push(String(id)); }
  if (owners[id].indexOf(w) === -1) owners[id].push(w);
}));
while (frontier.length) {
  const next = [];
  frontier.forEach((r) => (adj[r] || new Set()).forEach((b) => {
    if (!byId[b]) return;
    if (!(b in dist)) { dist[b] = dist[r] + 1; owners[b] = owners[r].slice(); next.push(b); }
    else if (dist[b] === dist[r] + 1) owners[r].forEach((o) => { if (owners[b].indexOf(o) === -1) owners[b].push(o); });
  }));
  frontier = next;
}
const masterByLevel = worldRows.slice().sort((p, q) => q.level - p.level);
areas.filter((a) => a.kind === 'realm').forEach((a) => {
  const o = owners[a.guideId];
  const wikiWorldName = wiki[a.name] && guideName(wiki[a.name].world);
  const valid = (n) => n && worldNames.indexOf(n) !== -1;
  const pick = (list) => list.filter((m) => m.level <= a.level).sort((p, q) => q.level - p.level)[0] || list.slice().sort((p, q) => p.level - q.level)[0];
  if (o && dist[a.guideId] === 0) a.world = o.length === 1 ? o[0].name : pick(o).name;
  else if (WORLD_OVERRIDE[a.name]) a.world = WORLD_OVERRIDE[a.name];
  else if (a.level <= WIKI_LAST_GOOD && valid(wikiWorldName)) a.world = wikiWorldName;
  else if (o) a.world = pick(o).name;
});

// ---- sort the wiki items into portals / shops / relics / world-map exits (stairs come from the guide, below)
const wikiNote = {};
areas.filter((a) => a.kind === 'realm').forEach((a) => {
  const w = wiki[a.name];
  if (!w) return;
  w.items.forEach((it) => {
    if (it.tag === 'portal') {
      const nm = it.title.indexOf('⟷') !== -1 ? it.title.split(' (')[0] : it.title;
      a.portals.push({ name: nm, x: it.x, y: it.y });
    } else if (it.tag === 'shop') {
      a.shopSpots.push({ name: it.title, x: it.x, y: it.y });
    } else if (it.tag === 'relic') {
      a.relicSpots.push({ name: it.title, x: it.x, y: it.y });
    } else if (it.tag === 'world area') {
      const wn = guideName(it.title);
      if (byName[wn] && byName[wn].kind === 'master') a.worldExits.push({ world: wn, x: it.x, y: it.y });
    } else if (it.tag === '') {
      if (it.title.indexOf('⟷') !== -1) return; // jump inside the same realm
      const target = byNorm[norm(it.title)];
      if (target && target !== a) {
        wikiNote[a.name + '\u0000' + target.name + '\u0000' + it.x + ',' + it.y] = it.note || '';
        if (/event/i.test(it.note)) target.event = true;
      }
    }
  });
});

// ---- the guide's map replaces what the wiki said about portal, shop, relic and world-map exit tiles
areas.filter((a) => a.kind === 'realm').forEach((a) => {
  const f = guideFeat[a.guideId];
  if (!f) return;
  // the guide does not name portals; keep the wiki's name when it has one on the same tile
  a.portals = f.portals.map((p) => { const old = a.portals.find((o) => o.x === p.x && o.y === p.y); return { name: old ? old.name : 'Portal', x: p.x, y: p.y }; });
  a.shopSpots = f.shops.map((s) => ({ name: s.name, x: s.x, y: s.y }));
  a.relicSpots = f.relics.map((s) => ({ name: s.name, x: s.x, y: s.y }));
  a.worldExits = [];
  f.exits.forEach((e) => {
    const nm = e.name.trim(); // the guide's tooltips sometimes end in a space
    const wn = MASTER_NAME[nm] || nm;
    if (byName[wn] && byName[wn].kind === 'master') a.worldExits.push({ world: wn, x: e.x, y: e.y });
    else console.log('unknown master realm in an exit:', a.name, e.name);
  });
});

// ---- stairs: every stairway link on the guide's realm map
areas.filter((a) => a.kind === 'realm').forEach((a) => {
  const seen = {};
  (guideLinks[a.guideId] || []).forEach((l) => {
    const target = byId[l.to];
    if (!target || target === a) return; // a link back into the same realm is a jump, not a stairway
    const key = target.name + '\u0000' + l.x + ',' + l.y;
    if (seen[key]) return;
    seen[key] = true;
    a.stairs.push({ to: target.name, x: l.x, y: l.y, note: wikiNote[a.name + '\u0000' + key] || '' });
  });
});

// ---- realms without a world: take the world most of their neighbours are in
for (let pass = 0; pass < 5; pass++) {
  areas.filter((a) => a.kind === 'realm' && !a.world).forEach((a) => {
    const votes = {};
    a.stairs.forEach((s) => {
      const o = byName[s.to];
      if (o && o.world) votes[o.world] = (votes[o.world] || 0) + 1;
    });
    areas.forEach((o) => {
      if (o.stairs.some((s) => s.to === a.name) && o.world) votes[o.world] = (votes[o.world] || 0) + 1;
    });
    const best = Object.keys(votes).sort((p, q) => votes[q] - votes[p])[0];
    if (best) a.world = best;
  });
}

// ---- still nothing (hidden rooms with no stairway): file them under the master realm whose level range they fall in
areas.filter((a) => a.kind === 'realm' && !a.world).forEach((a) => {
  const m = masterByLevel.find((w) => w.level <= a.level) || masterByLevel[masterByLevel.length - 1];
  a.world = m.name;
});

// ---- stairs are two-way: tell the other side where you arrive, and add links only one side lists
const declared = {};
areas.forEach((a) => a.stairs.forEach((s) => { declared[a.name + '\u0000' + s.to] = s; }));
areas.forEach((a) => {
  a.stairs.slice().forEach((s) => {
    const back = declared[s.to + '\u0000' + a.name];
    s.arrive = back ? { x: back.x, y: back.y } : null;
    if (!back && byName[s.to]) {
      const o = byName[s.to];
      const implied = { to: a.name, x: null, y: null, note: s.note || '', arrive: { x: s.x, y: s.y }, implied: true };
      o.stairs.push(implied);
      declared[s.to + '\u0000' + a.name] = implied;
    }
  });
});

// ---- hook realms up to the world map
worldRows.forEach((w) => {
  const master = byName[w.name];
  const entries = [];
  areas.forEach((a) => {
    a.worldExits.forEach((e) => { if (e.world === w.name && entries.indexOf(a.name) === -1) entries.push(a.name); });
  });
  master.main.forEach((n) => { if (entries.indexOf(n) === -1) entries.push(n); });
  (ENTRY_OVERRIDE[w.name] || []).forEach((n) => { if (entries.indexOf(n) === -1) entries.push(n); });
  if (!entries.length && !ENTRY_OVERRIDE[w.name]) {
    // no world-map exit listed: assume the lowest-level realm of the world is the way in
    const members = areas.filter((a) => a.kind === 'realm' && a.world === w.name).sort((p, q) => p.level - q.level || p.name.localeCompare(q.name));
    if (members.length) entries.push(members[0].name);
  }
  master.entries = entries;
});
// every realm links to its master realm's chain: neighbours in the world map
worldRows.forEach((w) => {
  byName[w.name].prevWorld = w.prev && byName[w.prev] ? w.prev : null;
  byName[w.name].nextWorld = w.next && byName[w.next] ? w.next : null;
});

// ---- sanity: realms that cannot be reached from any master realm
const reach = {};
const queue = [];
worldRows.forEach((w) => { reach[w.name] = true; queue.push(w.name); });
byName[worldRows[0].name].entries.forEach(() => {});
const nb = (a) => {
  const out = a.stairs.map((s) => s.to);
  if (a.kind === 'master') a.entries.forEach((n) => out.push(n));
  areas.forEach((o) => { if (o.worldExits.some((e) => e.world === a.name)) out.push(o.name); });
  return out;
};
while (queue.length) {
  const cur = byName[queue.shift()];
  nb(cur).forEach((n) => { if (byName[n] && !reach[n]) { reach[n] = true; queue.push(n); } });
}
const unreachable = areas.filter((a) => !reach[a.name]).map((a) => a.name);

// ---- pages: one group per 1000 levels, each cut into pages of about PAGE_SIZE realms.
// A page always starts on a level divisible by 5.
const buildPages = () => {
  const count = {};
  let top = 0;
  areas.forEach((a) => { if (a.kind === 'realm' && !a.event) { count[a.level] = (count[a.level] || 0) + 1; top = Math.max(top, a.level); } });
  const pages = [];
  for (let g = 0; g * 1000 <= top; g++) {
    const first = Math.max(1, g * 1000), last = Math.min(g * 1000 + 999, top);
    const group = 'Levels ' + first + ' – ' + last;
    const mine = [];
    let start = first, acc = 0;
    for (let l = first; l <= last; l++) {
      acc += count[l] || 0;
      if (l < last && acc >= PAGE_SIZE && (l + 1) % 5 === 0) { mine.push({ min: start, max: l, n: acc }); start = l + 1; acc = 0; }
    }
    mine.push({ min: start, max: g * 1000 + 999 > top ? top : last, n: acc });
    if (mine.length > 1 && mine[mine.length - 1].n < PAGE_MIN) { const x = mine.pop(); mine[mine.length - 1].max = x.max; mine[mine.length - 1].n += x.n; }
    mine.forEach((m) => pages.push({ id: pages.length + 1, group, label: 'Levels ' + m.min + ' - ' + m.max, min: m.min, max: m.max }));
  }
  return pages;
};
const PAGES = buildPages();

const out = {
  built: new Date().toISOString().slice(0, 10),
  pages: PAGES,
  worlds: worldNames,
  areas,
};
fs.mkdirSync(path.join(root, 'site'), { recursive: true });
fs.writeFileSync(path.join(root, 'site', 'data.js'), 'window.FSAR = ' + JSON.stringify(out) + ';\n');

// Compact copy for the helper userscript (routing only): no creatures, shops, quests or relic lists.
const routeOut = {
  built: out.built,
  worlds: worldNames,
  areas: areas.map((a) => {
    const r = { name: a.name, kind: a.kind, level: a.level, guideId: a.guideId };
    if (a.world) r.world = a.world;
    if (a.event) r.event = 1;
    r.stairs = a.stairs.map((s) => { const o = { to: s.to, x: s.x, y: s.y }; if (s.arrive) o.arrive = s.arrive; if (s.note) o.note = s.note; return o; });
    r.portals = a.portals || [];
    r.worldExits = a.worldExits || [];
    if (a.entries && a.entries.length) r.entries = a.entries;
    if (a.nextWorld) r.nextWorld = a.nextWorld;
    return r;
  }),
};
fs.writeFileSync(path.join(root, 'site', 'route.json'), JSON.stringify(routeOut));

const counts = {};
areas.forEach((a) => { counts[a.kind] = (counts[a.kind] || 0) + 1; });
console.log('areas', counts);
console.log('no world:', areas.filter((a) => a.kind === 'realm' && !a.world).map((a) => a.name).join(', ') || '-');
console.log('no stairs:', areas.filter((a) => a.kind === 'realm' && !a.stairs.length).map((a) => a.name).join(', ') || '-');
console.log('unreachable from a world map:', unreachable.join(', ') || '-');
console.log('with portals:', areas.filter((a) => a.portals.length).length, ' events:', areas.filter((a) => a.event).map((a) => a.name).join(', '));
console.log('beyond-50 links:', areas.reduce((n, a) => n + a.beyond.length, 0));

(function () {
  'use strict';

  const D = window.FSAR;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

  // ---------------------------------------------------------------- level colours
  // One rainbow over the whole range: violet at level 1 through indigo, blue, green, yellow and orange to red at level 10000.
  // A square-root scale: half way between a straight line and a log scale, so the early levels change colour a little sooner
  // than a straight line would (level 1000 is a third of the way along, level 3000 is at green) without racing ahead.
  const RAINBOW = [[123, 31, 162], [75, 54, 190], [44, 102, 230], [39, 174, 96], [226, 196, 0], [239, 125, 26], [205, 40, 40]];
  const TOP_LEVEL = 10000;
  const levelT = (l) => Math.sqrt(Math.max(0, Math.min(1, (l - 1) / (TOP_LEVEL - 1)))); // 0 .. 1 along the rainbow
  function levelRGB(l) {
    const x = levelT(l) * (RAINBOW.length - 1);
    const i = Math.min(Math.floor(x), RAINBOW.length - 2);
    const f = x - i;
    return RAINBOW[i].map((v, k) => Math.round(v + (RAINBOW[i + 1][k] - v) * f));
  }
  const rgbStr = (c) => c.join(',');
  const isLight = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.62;

  // ---------------------------------------------------------------- icons
  const ICON = {
    portal: '<span class="ico" title="Portal"><img src="https://cdn2.fallensword.com/ui/world/action-list-portal.png" alt="*" onerror="this.replaceWith(\'*\')"></span>',
    shop: '<span class="ico" title="Shop"><svg viewBox="0 0 16 16"><path d="M3 6.5h10l-1 8H4z" fill="#f0c24b" stroke="#6b4b00"/><path d="M5.5 6.5V4.8a2.5 2.5 0 0 1 5 0v1.7" fill="none" stroke="#6b4b00" stroke-width="1.2"/></svg></span>',
    quest: '<span class="ico" title="Quest"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#ffd54a" stroke="#6b4b00"/><rect x="7.1" y="3.6" width="1.8" height="5.4" rx=".9" fill="#6b4b00"/><circle cx="8" cy="11.6" r="1.05" fill="#6b4b00"/></svg></span>',
    relic: '<span class="ico" title="Relic"><svg viewBox="0 0 16 16"><path d="M8 1.5l5 5-5 8-5-8z" fill="#7be0ff" stroke="#0b4a63"/><path d="M3 6.5h10M8 1.5l-2 5 2 8 2-8z" fill="none" stroke="#0b4a63" stroke-width=".7"/></svg></span>',
    next: '<span class="ico" title="Continues on another page">&#8599;</span>',
  };

  // ---------------------------------------------------------------- data
  const R = FSRoute.create(D);
  const { byName, masters, realms, adj, drawn } = R;
  const LAST_LEVEL = D.pages[D.pages.length - 1].max;
  const pageAtLevel = [];
  D.pages.forEach((p) => { for (let l = p.min; l <= p.max; l++) pageAtLevel[l] = p; });
  const pageOf = (a) => pageAtLevel[a.level] || D.pages[D.pages.length - 1];

  // how far a realm is from the world map of its own master realm (row on the page)
  const depth = {};
  masters.forEach((m) => {
    const q = [];
    (m.entries || []).forEach((n) => {
      const r = byName[n];
      if (r && r.world === m.name && depth[n] == null) { depth[n] = 1; q.push(n); }
    });
    while (q.length) {
      const cur = q.shift();
      adj[cur].forEach((e) => {
        const o = byName[e.to];
        if (e.kind === 'stairs' && o && o.kind === 'realm' && o.world === byName[cur].world && depth[o.name] == null) {
          depth[o.name] = depth[cur] + 1;
          q.push(o.name);
        }
      });
    }
  });
  let changed = true;
  while (changed) {
    changed = false;
    realms.forEach((r) => {
      if (depth[r.name] != null) return;
      let best = null;
      adj[r.name].forEach((e) => {
        const o = byName[e.to];
        if (e.kind === 'stairs' && o && o.world === r.world && depth[o.name] != null && depth[o.name] < 90) best = best == null ? depth[o.name] : Math.min(best, depth[o.name]);
      });
      if (best != null) { depth[r.name] = best + 1; changed = true; }
    });
  }
  realms.forEach((r) => { if (depth[r.name] == null) depth[r.name] = 99; });

  const offPage = (a) => a.stairs.map((s) => byName[s.to]).filter((o) => o && pageOf(o).id !== pageOf(a).id);
  const nextPage = (a) => a.beyond.length > 0 || a.stairs.some((s) => byName[s.to] && pageOf(byName[s.to]).id !== pageOf(a).id);

  // ---------------------------------------------------------------- state
  const state = { page: D.pages[0].id, pinned: null, hover: null, route: null, openGroup: null, lastGroup: null };
  const nodeEls = {};
  const lineEls = {};

  // ---------------------------------------------------------------- node html
  function nodeHTML(a, extra) {
    const cls = ['node', a.kind === 'master' ? 'master' : 'realm'];
    if (a.kind === 'realm' && nextPage(a)) cls.push('next');
    if (a.event) cls.push('event');
    if (extra) cls.push(extra);
    const rgb = levelRGB(a.level);
    if (isLight(rgb)) cls.push('light');
    const b = [];
    if (a.portals && a.portals.length) b.push(ICON.portal);
    if ((a.shopSpots && a.shopSpots.length) || (a.shops && a.shops.length)) b.push(ICON.shop);
    if (a.quests && a.quests.length) b.push(ICON.quest);
    if ((a.relicSpots && a.relicSpots.length) || (a.relics && a.relics.length)) b.push(ICON.relic);
    if (a.kind === 'realm' && nextPage(a)) b.push(ICON.next);
    return '<div class="' + cls.join(' ') + '" data-name="' + esc(a.name) + '" style="--c:rgb(' + rgbStr(rgb) + ')">' +
      '<span class="lv">' + a.level + '</span>' + (a.dark ? '<span class="dr">DR</span>' : '') +
      '<span class="nm">' + esc(a.name) + '</span>' +
      (a.kind === 'master' ? '<span class="sub">Master realm</span>' : '') +
      '<span class="badges">' + b.join('') + '</span>' + linksHTML(a, 'links', a.kind === 'realm' && offPage(a).length ? '<a data-jump title="Continues on another page: go there">&#8599;</a>' : '') + '</div>';
  }

  // ---------------------------------------------------------------- page
  function orderRow(list, prev) {
    const index = {};
    (prev || []).forEach((r, i) => { index[r.name] = i; });
    const score = (r) => {
      const idx = [];
      adj[r.name].forEach((e) => { if (e.kind === 'stairs' && index[e.to] != null) idx.push(index[e.to]); });
      return idx.length ? idx.reduce((p, q) => p + q, 0) / idx.length : Infinity;
    };
    return list.slice().sort((x, y) => (score(x) - score(y)) || (x.level - y.level) || x.name.localeCompare(y.name));
  }

  // Layout: the ELK "layered" algorithm (vendor/elk.bundled.js). The world map is the top row, every realm sits one row below the
  // realm it is reached from, realms in a row are ordered to cut down crossings, and each connection is a polyline (straight
  // segments, diagonals allowed, no curves) that leaves the boxes alone.
  const NW = 108, NH = 52;
  const elk = new ELK();
  const ELK_OPTIONS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.edgeRouting': 'POLYLINE',
    'elk.padding': '[top=12,left=12,bottom=12,right=12]',
    'elk.spacing.nodeNode': '34',
    'elk.spacing.edgeNode': '18',
    'elk.spacing.edgeEdge': '14',
    'elk.spacing.componentComponent': '44',
    'elk.layered.spacing.nodeNodeBetweenLayers': '52',
    'elk.layered.spacing.edgeNodeBetweenLayers': '20',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
    'elk.separateConnectedComponents': 'true',
    'elk.aspectRatio': '2',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.crossingMinimization.thoroughness': '30',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  };

  async function layoutCanvas(canvas, members, primary, master) {
    const els = {};
    canvas.querySelectorAll('.node').forEach((el) => { els[el.dataset.name] = el; });
    const set = new Set(members.map((r) => r.name));
    const idx = {};
    members.forEach((r, i) => { idx[r.name] = i; });
    const E = [];
    drawn.forEach((e, key) => {
      if (set.has(e.a) && set.has(e.b) && e.a !== e.b && (primary.has(e.a) || primary.has(e.b))) E.push({ a: idx[e.a], b: idx[e.b], key, e });
    });

    // row of each area: its distance from the world map. Copies of areas of other maps take the average of what they touch.
    const nbr = members.map(() => []);
    E.forEach((r) => { nbr[r.a].push(r.b); nbr[r.b].push(r.a); });
    const layer = members.map((r) => (primary.has(r.name) ? (r.kind === 'master' ? 0 : Math.min(depth[r.name], 6)) : -1));
    layer.forEach((l, i) => {
      if (l >= 0) return;
      const ls = nbr[i].map((j) => layer[j]).filter((x) => x >= 0);
      layer[i] = ls.length ? Math.round(ls.reduce((p, q) => p + q, 0) / ls.length) : 1;
    });

    // connections point from the row nearer the world map to the row further away, which is what makes the rows
    const build = (opts) => ({
      id: 'root',
      layoutOptions: opts,
      children: members.map((r, i) => {
        const c = { id: 'n' + i, width: NW, height: NH };
        if (r === master && primary.has(r.name)) c.layoutOptions = { 'elk.layered.layering.layerConstraint': 'FIRST' };
        return c;
      }),
      edges: E.map((r, k) => {
        const flip = layer[r.a] > layer[r.b] || (layer[r.a] === layer[r.b] && r.a > r.b);
        return { id: 'e' + k, sources: ['n' + (flip ? r.b : r.a)], targets: ['n' + (flip ? r.a : r.b)] };
      }),
    });
    // a row that is wider than the page is laid out again with a cap on how many areas one row may hold, until it fits
    const avail = Math.max(480, canvas.clientWidth);
    let res = await elk.layout(build(ELK_OPTIONS));
    let cap = Math.floor((avail - 24 + 34) / (NW + 34));
    while (res.width > avail && cap >= 3) {
      res = await elk.layout(build(Object.assign({}, ELK_OPTIONS, { 'elk.layered.layering.strategy': 'COFFMAN_GRAHAM', 'elk.layered.layering.coffmanGraham.layerBound': String(cap) })));
      cap--;
    }

    res.children.forEach((c) => {
      const el = els[members[+c.id.slice(1)].name];
      el.style.left = Math.round(c.x) + 'px';
      el.style.top = Math.round(c.y) + 'px';
    });
    canvas.style.width = Math.ceil(res.width) + 'px';
    canvas.style.height = Math.ceil(res.height) + 'px';
    return res.edges.map((ed, k) => {
      const s = ed.sections && ed.sections[0];
      const pts = s ? [s.startPoint].concat(s.bendPoints || [], [s.endPoint]).map((p) => [p.x, p.y]) : [];
      return { key: E[k].key, a: E[k].e.a, b: E[k].e.b, kind: E[k].e.kind, pts };
    }).filter((r) => r.pts.length > 1);
  }

  const graphs = [];
  // Put the given areas (plus ghost copies of the areas they connect to in other world maps) on a canvas and route the lines.
  async function mountGraph(canvas, primaryAreas, master, masterHere, pid) {
    const primary = new Set(primaryAreas.map((a) => a.name));
    const ghosts = [];
    drawn.forEach((e) => {
      [[e.a, e.b], [e.b, e.a]].forEach(([me, other]) => {
        const o = byName[other];
        if (!primary.has(me) || primary.has(other) || ghosts.some((g) => g.name === other)) return;
        if (o.kind === 'master' || pageOf(o).id === pid) ghosts.push(o);
      });
    });
    canvas.innerHTML = primaryAreas.map((r) => nodeHTML(r, r === master && !masterHere ? 'ghost' : '')).join('') +
      ghosts.map((g) => nodeHTML(g, 'dup ghost')).join('');
    return { canvas, routes: await layoutCanvas(canvas, primaryAreas.concat(ghosts), primary, master) };
  }

  let renderToken = 0;
  function renderPage(pid) {
    const token = ++renderToken;
    const jobs = [];
    state.page = pid;
    const page = D.pages.find((p) => p.id === pid);
    const wrap = $('#sections');
    wrap.innerHTML = '';
    Object.keys(nodeEls).forEach((k) => delete nodeEls[k]);
    graphs.length = 0;

    masters.forEach((m) => {
      const items = realms.filter((r) => r.world === m.name && !r.event && pageOf(r).id === pid);
      const masterHere = pageOf(m).id === pid;
      if (!items.length && !masterHere) return;

      const sec = document.createElement('section');
      sec.className = 'world';
      sec.id = 'w-' + norm(m.name);

      const head = document.createElement('div');
      head.className = 'world-head';
      head.innerHTML = '<div class="meta"><b>' + esc(m.name) + '</b> world map &middot; ' + items.length + ' realm' + (items.length === 1 ? '' : 's') + ' on this page' +
        (masterHere ? '' : ' (world map is on <b>' + esc(pageOf(m).label) + '</b>)') +
        '<br>Nearest portal: ' + esc(m.nearestPortal || '-') + (m.moves ? ' &middot; ' + m.moves + ' moves' : '') +
        '<br>' + linksHTML(m, 'hlinks') + '</div>';
      sec.appendChild(head);

      // free-form graph: the master realm and its realms, positioned so no line runs under a node
      const canvas = document.createElement('div');
      canvas.className = 'canvas';
      sec.appendChild(canvas);
      wrap.appendChild(sec);
      jobs.push(mountGraph(canvas, [m].concat(items), m, masterHere, pid));
    });

    // event-only areas (Christmas, Halloween, ...) are not part of any world map: one section of their own
    const ev = realms.filter((r) => r.event && pageOf(r).id === pid);
    if (ev.length) {
      const sec = document.createElement('section');
      sec.className = 'world';
      sec.id = 'w-events';
      sec.innerHTML = '<div class="world-head"><div class="meta"><b>Special event areas</b> &middot; ' + ev.length + ' on this page<br>Only open during the event; they are not reached from a world map.</div></div>';
      const canvas = document.createElement('div');
      canvas.className = 'canvas';
      sec.appendChild(canvas);
      wrap.appendChild(sec);
      jobs.push(mountGraph(canvas, ev, null, true, pid));
    }

    // an area can also appear as a copy in a neighbouring map (a ghost); the real box is the one that gets highlighted
    wrap.querySelectorAll('.node:not(.dup)').forEach((el) => { nodeEls[el.dataset.name] = el; });
    wrap.querySelectorAll('.node.dup').forEach((el) => { if (!nodeEls[el.dataset.name]) nodeEls[el.dataset.name] = el; });
    renderTabs();
    renderStrip();
    renderLevelBar();
    return Promise.all(jobs).then((done) => {
      if (token !== renderToken) return;
      graphs.push.apply(graphs, done);
      drawEdges();
      applyRoute();
    });
  }

  // ---------------------------------------------------------------- lines between areas
  function drawEdges() {
    const svg = $('#edges');
    const map = $('#map');
    svg.setAttribute('width', map.offsetWidth);
    svg.setAttribute('height', map.offsetHeight);
    svg.innerHTML = '';
    Object.keys(lineEls).forEach((k) => delete lineEls[k]);
    const base = map.getBoundingClientRect();
    const frag = document.createDocumentFragment();
    graphs.forEach((g) => {
      const cr = g.canvas.getBoundingClientRect();
      const ox = cr.left - base.left, oy = cr.top - base.top;
      g.routes.forEach((r) => {
        const ln = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        ln.setAttribute('points', r.pts.map((p) => (p[0] + ox).toFixed(1) + ',' + (p[1] + oy).toFixed(1)).join(' '));
        ln.setAttribute('class', 'ln' + (r.kind === 'exit' ? ' exit' : ''));
        ln.dataset.a = r.a; ln.dataset.b = r.b;
        lineEls[lineEls[r.key] ? r.key + '#' + frag.childNodes.length : r.key] = ln;
        frag.appendChild(ln);
      });
    });
    svg.appendChild(frag);
  }

  // ---------------------------------------------------------------- tabs, world strip, legend
  function renderTabs() {
    const t = $('#tabs');
    if (!renderTabs.counts) {
      renderTabs.counts = {};
      realms.forEach((r) => { if (!r.event) { const id = pageOf(r).id; renderTabs.counts[id] = (renderTabs.counts[id] || 0) + 1; } });
    }
    const cnt = renderTabs.counts;
    const cur = D.pages.find((p) => p.id === state.page);
    const groups = [];
    D.pages.forEach((p) => {
      let g = groups[groups.length - 1];
      if (!g || g.name !== p.group) groups.push(g = { name: p.group, pages: [] });
      g.pages.push(p);
    });
    // one group open at a time: the one holding the current page, unless the user opened another one since
    if (state.lastGroup !== cur.group) { state.lastGroup = cur.group; state.openGroup = cur.group; }
    t.innerHTML = groups.map((g) => {
      const total = g.pages.reduce((s, p) => s + (cnt[p.id] || 0), 0);
      return '<details data-g="' + esc(g.name) + '"' + (g.name === state.openGroup ? ' open' : '') + '><summary><span>' + esc(g.name) + '</span><small>' + total + '</small></summary>' +
        g.pages.map((p) => '<button type="button" data-p="' + p.id + '" class="' + (p.id === state.page ? 'on' : '') + '">' + esc(p.label) + '<small>' + (cnt[p.id] || 0) + '</small></button>').join('') + '</details>';
    }).join('');
    const on = t.querySelector('.on');
    const side = $('#side');
    if (on) {
      const r = on.getBoundingClientRect(), s = side.getBoundingClientRect();
      if (r.top < s.top + 30 || r.bottom > s.bottom) side.scrollTop += r.top - s.top - s.height / 3;
    }
    $('#pageTitle').textContent = cur.group + ' › ' + cur.label;
  }
  function renderStrip() {
    // only the world maps that have a section on this page
    const here = masters.filter((m) => !!$('#w-' + norm(m.name)));
    $('#worldStrip').innerHTML = here.map((m, i) => {
      return (i ? '<span class="sep">&middot;</span>' : '') +
        '<span class="w" data-w="' + esc(m.name) + '" style="--c:rgb(' + rgbStr(levelRGB(m.level)) + ')" title="Level ' + m.level + '">' + esc(m.name) + '</span>';
    }).join('');
  }
  // The bar always runs from level 1 to 10000, but the levels of the page you are looking at take the wide middle part of it
  // (a "fisheye": the levels below and above are squeezed into the sides). The colours are the same as on the realms.
  function renderLevelBar() {
    const el = $('#lvBar');
    if (!el) return;
    const pg = D.pages.find((x) => x.id === state.page) || D.pages[0];
    const lo = pg.min, hi = Math.max(pg.max, pg.min + 1);
    const tlo = levelT(lo), thi = levelT(hi);
    const L = Math.min(0.3, tlo * 3); // share of the bar for the levels below the page (less when the page is at the very start)
    const R = Math.min(0.3, (1 - thi) * 3); // and above it
    const F = 1 - L - R;
    const levelAt = (x) => {
      if (x < L) return 1 + (lo - 1) * (x / L);
      if (x <= L + F) return lo + (hi - lo) * ((x - L) / F);
      return hi + (TOP_LEVEL - hi) * ((x - L - F) / R);
    };
    const posOf = (l) => {
      if (l < lo) return lo > 1 ? L * (l - 1) / (lo - 1) : 0;
      if (l <= hi) return L + F * (l - lo) / (hi - lo);
      return L + F + R * (l - hi) / (TOP_LEVEL - hi);
    };
    const N = 240;
    const grad = 'linear-gradient(90deg,' + Array.from({ length: N }, (_, k) => {
      const x = k / (N - 1);
      return 'rgb(' + rgbStr(levelRGB(levelAt(x))) + ') ' + (x * 100).toFixed(2) + '%';
    }).join(',') + ')';
    // labels: the edges of this page first, then the round numbers that still fit
    const placed = [];
    [lo, hi, 1, 10000, 5000, 2500, 7500, 1000, 2000, 3000, 4000, 6000, 8000, 9000].forEach((l, k) => {
      if (k >= 2 && l >= lo && l <= hi) return;
      const p = posOf(l) * 100;
      if (placed.every((q) => Math.abs(q.p - p) >= 10)) placed.push({ l, p });
    });
    const ticks = placed.map((q) => '<span style="left:' + q.p.toFixed(2) + '%;transform:translateX(' + (q.p < 2 ? 0 : q.p > 98 ? -100 : -50) + '%)">' + q.l + '</span>').join('');
    el.innerHTML = '<div class="bar" style="background:' + grad + '"></div><div class="lvfocus" style="left:' + (L * 100).toFixed(2) + '%;width:' + (F * 100).toFixed(2) + '%"></div><div class="bar-l">' + ticks + '</div>';
  }
  function renderLegend() {
    const mini = (cls, label, extra, name) =>
      '<div class="it"><div class="node ' + cls + ' legend-node" style="--c:' + extra + '"><span class="nm">' + name + '</span></div><span>' + label + '</span></div>';
    $('#legend').innerHTML =
      mini('master', '<b>Master Realm</b> (world map)', 'rgb(' + rgbStr(levelRGB(20)) + ')', 'Name') +
      mini('realm', '<b>Realm</b>', 'rgb(' + rgbStr(levelRGB(20)) + ')', 'Name') +
      '<div class="it"><div class="node realm legend-node" style="--c:rgb(' + rgbStr(levelRGB(20)) + ')"><span class="dr">DR</span><span class="nm">Name</span></div><span><b>Dark Realm</b> (needs the Vision skill)</span></div>' +
      mini('realm next', '<b>Continues</b> on another page / at higher levels (the &#8599; tab under it goes there)', 'rgb(' + rgbStr(levelRGB(20)) + ')', 'Name') +
      mini('realm event', '<b>Special event</b> area', '#6f747d', 'Name') +
      '<div class="it">' + ICON.portal + '<span><b>Portal</b> &mdash; coordinates in the info card</span></div>' +
      '<div class="it">' + ICON.shop + '<span><b>Shop</b></span></div>' +
      '<div class="it">' + ICON.quest + '<span><b>Quest</b></span></div>' +
      '<div class="it">' + ICON.relic + '<span><b>Relic</b></span></div>' +
      '<div class="it"><svg class="lsample" width="34" height="10" aria-hidden="true"><line class="sample" x1="1" y1="5" x2="33" y2="5"/></svg><span><b>Solid line</b> &mdash; stairs between two realms</span></div>' +
      '<div class="it"><svg class="lsample" width="34" height="10" aria-hidden="true"><line class="sample exit" x1="1" y1="5" x2="33" y2="5"/></svg><span><b>Dotted line</b> &mdash; to or from the world map (leave the realm / enter it from the world map)</span></div>' +
      mini('realm ghost', '<b>Faded</b> &mdash; belongs to another world map or page; shown only to say where a connection leads', 'rgb(' + rgbStr(levelRGB(20)) + ')', 'Name') +
      '<div class="it"><div id="lvBar"></div><span>Minimum <b>level</b> (1 &ndash; 10000). The levels on this page get the wide middle part.</span></div>';
    renderLevelBar();
  }

  // ---------------------------------------------------------------- info card
  // The guide has a page per realm; master realms are not in it, so they link to the guide's search for the name.
  // master realms have a page of their own in the Guide (Krul Island has none, so it gets the list of master realms)
  const guideUrl = (a) => a.kind === 'master'
    ? 'https://guide.fallensword.com/index.php?cmd=masterrealms' + (a.guideId ? '&subcmd=view&masterrealm_id=' + a.guideId : '')
    : a.guideId
      ? 'https://guide.fallensword.com/index.php?cmd=realms&subcmd=view&realm_id=' + a.guideId
      : 'https://guide.fallensword.com/index.php?cmd=realms&search_name=' + encodeURIComponent(a.name);
  const wikiUrl = (a) => 'https://wiki.fallensword.com/index.php/' +
    encodeURIComponent((a.wikiTitle || a.name).replace(/ /g, '_')).replace(/%28/g, '(').replace(/%29/g, ')').replace(/%2C/g, ',').replace(/%27/g, "'");
  // the small tabs under a realm say just G and W; next to a world map's name they are spelled out
  const linksHTML = (a, cls, extra) => {
    const short = cls === 'links';
    return '<span class="' + cls + '"><a href="' + guideUrl(a) + '" target="_blank" rel="noopener" title="Open ' + esc(a.name) + ' in the Guide">' + (short ? 'G' : 'Guide') + '</a>' +
      '<a href="' + wikiUrl(a) + '" target="_blank" rel="noopener" title="Open ' + esc(a.name) + ' on the Wiki">' + (short ? 'W' : 'Wiki') + '</a>' + (extra || '') + '</span>';
  };
  const coord = (x, y) => (x != null && y != null ? '<span class="coord">(' + x + ',' + y + ')</span>' : '');

  function questHTML(q) {
    const cls = /\(Epic\)/.test(q) ? 'epic' : /\((Halloween|Xmas|STF|BFN|[A-Z]{3,4})\)/.test(q) ? 'evt' : '';
    return '<li class="' + cls + '">' + esc(q) + '</li>';
  }
  function section(title, icon, body, empty) {
    return '<h4>' + (icon || '') + title + '</h4>' + (body || '<div class="none">' + (empty || 'None') + '</div>');
  }

  function cardHTML(a, pinned) {
    const tags = ['<span class="tag lv">Level ' + a.level + '</span>'];
    tags.push('<span class="tag">' + (a.kind === 'master' ? 'Master realm (world map)' : 'Realm') + '</span>');
    if (a.kind === 'realm' && a.world) tags.push('<span class="tag">' + esc(a.world) + '</span>');
    if (a.dark) tags.push('<span class="tag">Dark Realm</span>');
    if (a.event) tags.push('<span class="tag">Special event</span>');
    tags.push('<span class="tag">' + esc(pageOf(a).label) + '</span>');

    let h = '<button type="button" class="close" title="Close (Esc)">&times;</button><h3>' + esc(a.name) + '</h3><div class="tags">' + tags.join('') + '</div>';

    if (a.kind === 'master') {
      h += section('Nearest portal', ICON.portal, '<div>' + esc(a.nearestPortal || '-') + (a.moves ? ' <span class="coord">&middot; ' + a.moves + ' moves away</span>' : '') + '</div>');
      h += section('Entered from the world map', '', '<ul>' + (a.entries || []).map((n) => '<li><div class="stair"><a data-go="' + esc(n) + '">' + esc(n) + '</a>' + (byName[n] ? '<span class="coord">Lv ' + byName[n].level + '</span>' : '') + '</div></li>').join('') + '</ul>', 'Not known');
      const nb = [a.prevWorld, a.nextWorld].filter(Boolean);
      h += section('Next to it on the world map', '', '<ul>' + nb.map((n) => '<li><a data-go="' + esc(n) + '" style="cursor:pointer">' + esc(n) + '</a> <span class="coord">Lv ' + byName[n].level + '</span></li>').join('') + '</ul>');
    } else {
      // creatures
      const cr = a.creatures || [];
      h += section('Creatures (' + cr.length + ')', '', cr.length
        ? '<ul class="cols">' + cr.map((c) => '<li>' + esc(c.name) + (c.rank ? '<span class="rk ' + esc(c.rank) + '">' + esc(c.rank) + '</span>' : '') + (c.race ? ' <span class="race">' + esc(c.race) + '</span>' : '') + '</li>').join('') + '</ul>' : '', 'No creatures listed');
      // shops
      const sp = a.shopSpots || [];
      const shopBody = sp.length
        ? '<ul>' + sp.map((s) => '<li>' + esc(s.name) + ' ' + coord(s.x, s.y) + '</li>').join('') + '</ul>'
        : (a.shops && a.shops.length ? '<ul>' + a.shops.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '');
      h += section('Shops', ICON.shop, shopBody, 'No shops');
      // quests
      h += section('Quests (' + (a.quests || []).length + ')', ICON.quest, (a.quests || []).length ? '<ul>' + a.quests.map(questHTML).join('') + '</ul>' : '', 'No quests');
      // relics
      const rl = a.relicSpots || [];
      if (rl.length || (a.relics && a.relics.length)) {
        h += section('Relics', ICON.relic, '<ul>' + (rl.length ? rl.map((s) => '<li>' + esc(s.name) + ' ' + coord(s.x, s.y) + '</li>') : a.relics.map((s) => '<li>' + esc(s) + '</li>')).join('') + '</ul>');
      }
      // portals
      if (a.portals.length) {
        h += section('Portal', ICON.portal, '<ul>' + a.portals.map((s) => '<li>' + esc(s.name) + ' ' + coord(s.x, s.y) + '</li>').join('') + '</ul>');
      }
      // exits
      const ex = a.worldExits.map((e) => '<li><div class="stair"><span>World map: <a data-go="' + esc(e.world) + '">' + esc(e.world) + '</a></span>' + coord(e.x, e.y) + '</div></li>');
      const st = a.stairs.map((s) => {
        const o = byName[s.to];
        return '<li><div class="stair"><span>&rarr; <a data-go="' + esc(s.to) + '">' + esc(s.to) + '</a>' + (o ? ' <span class="coord">Lv ' + o.level + '</span>' : '') + (o && pageOf(o).id !== pageOf(a).id ? ' <span class="coord">' + esc(pageOf(o).label) + '</span>' : '') +
          (s.note ? ' <span class="coord">' + esc(s.note) + '</span>' : '') + '</span>' + coord(s.x, s.y) + '</div></li>';
      });
      h += section('Exits &amp; stairs', '', '<ul>' + ex.concat(st).join('') + '</ul>', 'None known');
      if (a.beyond.length) {
        const shown = a.beyond.slice(0, 6).map((b) => '<li><div class="stair"><span>' + esc(b.name) + (b.level ? ' <span class="coord">Lv ' + b.level + '+</span>' : '') + '</span>' + coord(b.x, b.y) + '</div></li>').join('');
        h += section('Leads on to (areas not on the map, level ' + (LAST_LEVEL + 1) + '+)', ICON.next, '<ul>' + shown + '</ul>' + (a.beyond.length > 6 ? '<div class="none">&hellip; and ' + (a.beyond.length - 6) + ' more</div>' : ''));
      }
    }

    if (pinned) {
      h += '<div class="acts"><button type="button" data-act="from">Route from here</button><button type="button" data-act="to">Route to here</button>' +
        '<a href="' + guideUrl(a) + '" target="_blank" rel="noopener">Guide' + (a.guideId ? ' page' : ' search') + '</a>' +
        '<a href="' + wikiUrl(a) + '" target="_blank" rel="noopener">Wiki page</a></div>';
    } else {
      h += '<div class="hint">Click the area to pin this card.</div>';
    }
    return h;
  }

  const card = $('#card');
  function placeCard(x, y) {
    const w = card.offsetWidth;
    const hgt = card.offsetHeight;
    let left = x + 18;
    let top = y + 14;
    if (left + w > window.innerWidth - 10) left = Math.max(10, x - w - 18);
    if (top + hgt > window.innerHeight - 10) top = Math.max(10, window.innerHeight - hgt - 10);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }
  function showCard(name, x, y, pinned) {
    const a = byName[name];
    if (!a) return;
    card.innerHTML = cardHTML(a, pinned);
    card.classList.toggle('pinned', !!pinned);
    card.hidden = false;
    card.dataset.name = name;
    placeCard(x, y);
  }
  function hideCard() { card.hidden = true; card.classList.remove('pinned'); state.pinned = null; }

  // ---------------------------------------------------------------- highlight on hover
  function neighbours(name) { return adj[name].filter((e) => e.kind !== 'world').map((e) => e.to); }
  function focusNode(name) {
    const map = $('#map');
    map.classList.add('focus');
    const near = neighbours(name);
    Object.keys(nodeEls).forEach((k) => {
      const el = nodeEls[k];
      el.classList.toggle('me', k === name);
      el.classList.toggle('hl', near.indexOf(k) !== -1);
    });
    Object.keys(lineEls).forEach((k) => {
      const ln = lineEls[k];
      ln.classList.toggle('hl', ln.dataset.a === name || ln.dataset.b === name);
    });
  }
  function unfocus() {
    $('#map').classList.remove('focus');
    Object.keys(nodeEls).forEach((k) => nodeEls[k].classList.remove('me', 'hl'));
    Object.keys(lineEls).forEach((k) => lineEls[k].classList.remove('hl'));
  }

  // ---------------------------------------------------------------- routing
  // Cost is in moves: walking inside a realm is the straight-line distance between the tile you arrive on and the tile of
  // the next stairs / portal (diagonals allowed, obstacles ignored). A portal reaches any master realm's world map, and you can
  // always teleport to Mountain Path for free, so the cheapest way may start by walking to a nearby portal instead.
  const findRoute = R.findRoute;
  // a master realm is shown with its level in brackets, the way the game sorts its portal menu
  const wm = (n) => esc(n) + (byName[n] && byName[n].kind === 'master' ? ' [' + byName[n].level + ']' : '');
  const link = (n) => '<a data-go="' + esc(n) + '">' + wm(n) + '</a>';
  function stepText(s) {
    const e = s.edge;
    const walk = s.walk ? ' <span class="mv">' + s.walk + ' move' + (s.walk === 1 ? '' : 's') + ' to get there</span>' : '';
    if (e.kind === 'free') {
      return 'Teleport to ' + link(e.to) + ' <span class="sub">&mdash; free from anywhere</span>';
    }
    if (e.kind === 'portal') {
      return 'In ' + link(s.from) + ', walk to the <b>' + esc(e.name) + '</b> ' + coord(e.x, e.y) + walk + ' and teleport to the ' + link(e.to) +
        ' <span class="sub">&mdash; world map</span>';
    }
    if (e.kind === 'stairs') {
      return 'In ' + link(s.from) + ', take the stairs' + (e.x != null ? ' at ' + coord(e.x, e.y) : '') + walk + ' to ' + link(e.to) +
        (e.ax != null ? ' <span class="sub">&mdash; you arrive at ' + coord(e.ax, e.ay) + '</span>' : '');
    }
    if (e.kind === 'exit') {
      return 'Leave ' + link(s.from) + ' to the <b>' + wm(e.to) + '</b> world map' + (e.x != null ? ' <span class="sub">&mdash; exit tile ' + coord(e.x, e.y) + '</span>' : '');
    }
    if (e.kind === 'enter') {
      return 'From the <b>' + wm(s.from) + '</b> world map, enter ' + link(e.to) + (e.x != null ? ' <span class="sub">&mdash; you appear at ' + coord(e.x, e.y) + '</span>' : '');
    }
    return 'Cross the world map from <b>' + wm(s.from) + '</b> to <b>' + wm(e.to) + '</b> <span class="sub">&mdash; neighbouring world maps</span>';
  }
  function runRoute(from, to) {
    const panel = $('#routePanel');
    const fa = byName[from];
    const ta = byName[to];
    if (!fa || !ta) {
      panel.hidden = false;
      panel.innerHTML = '<h2>Route</h2><div class="err">Pick both areas from the suggestion list.</div>';
      return;
    }
    const steps = from === to ? [] : findRoute(from, to);
    state.route = steps ? { from, to, steps } : null;
    panel.hidden = false;
    $('#rClear').hidden = false;
    if (!steps) {
      panel.innerHTML = '<h2>Route</h2><div class="err">No known way from <b>' + esc(from) + '</b> to <b>' + esc(to) + '</b> in this data.</div>';
      applyRoute();
      return;
    }
    const path = [from].concat(steps.map((s) => s.edge.to));
    const maxLv = Math.max.apply(null, path.map((n) => byName[n].level));
    panel.innerHTML =
      '<h2>' + link(from) + ' &rarr; ' + link(to) + '<small>' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + ' &middot; about ' + Math.round(steps.total) + ' moves &middot; highest minimum level on the way: ' + maxLv + '</small></h2>' +
      '<ol><li><span>Start in ' + link(from) + ' <span class="sub">(level ' + fa.level + ')</span></span></li>' +
      steps.map((s) => '<li><span>' + stepText(s) + '</span></li>').join('') +
      '<li><span>You are in ' + link(to) + '</span></li></ol>';
    applyRoute();
    panel.scrollIntoView({ block: 'nearest' });
  }
  function applyRoute() {
    const map = $('#map');
    Object.keys(nodeEls).forEach((k) => nodeEls[k].classList.remove('route'));
    Object.keys(lineEls).forEach((k) => lineEls[k].classList.remove('route'));
    if (!state.route) { map.classList.remove('routing'); return; }
    map.classList.add('routing');
    const path = [state.route.from].concat(state.route.steps.map((s) => s.edge.to));
    path.forEach((n) => { if (nodeEls[n]) nodeEls[n].classList.add('route'); });
    state.route.steps.forEach((s) => {
      const k0 = [s.from, s.edge.to].sort().join('\u0000');
      Object.keys(lineEls).forEach((k) => { if (k.split('#')[0] === k0) lineEls[k].classList.add('route'); });
    });
  }
  function clearRoute() {
    state.route = null;
    $('#routePanel').hidden = true;
    $('#rClear').hidden = true;
    applyRoute();
  }

  // ---------------------------------------------------------------- jump to an area
  function goTo(name, pin) {
    const a = byName[name];
    if (!a) return;
    if (pageOf(a).id !== state.page) { renderPage(pageOf(a).id).then(() => goTo(name, pin)); return; }
    const el = nodeEls[name];
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('found');
    void el.offsetWidth;
    el.classList.add('found');
    setTimeout(() => el.classList.remove('found'), 2800);
    if (pin !== false) {
      setTimeout(() => {
        const r = el.getBoundingClientRect();
        state.pinned = name;
        showCard(name, r.right, r.top, true);
      }, 520);
    }
  }

  // The arrow tab of a dashed area. If everything it leads to is on one other page, go there; if it leads to several pages,
  // pin its info card, which lists every exit with the page it is on (each one is a link).
  function jumpOn(name) {
    const out = offPage(byName[name]);
    if (!out.length) return;
    if (new Set(out.map((o) => pageOf(o).id)).size === 1) { hideCard(); unfocus(); goTo(out[0].name); return; }
    const r = nodeEls[name].getBoundingClientRect();
    state.pinned = name;
    showCard(name, r.right, r.top, true);
  }

  // ---------------------------------------------------------------- autocomplete
  function attachAC(input, ul, onPick) {
    let items = [];
    let on = -1;
    const find = (q) => {
      q = norm(q);
      if (!q) return D.areas.slice().sort((x, y) => x.level - y.level || x.name.localeCompare(y.name)).slice(0, 12);
      return D.areas.map((a) => {
        const n = norm(a.name);
        const i = n.indexOf(q);
        return { a, s: i === 0 ? 0 : i > 0 ? 1 : 9 };
      }).filter((x) => x.s < 9).sort((x, y) => x.s - y.s || x.a.level - y.a.level || x.a.name.localeCompare(y.a.name)).slice(0, 12).map((x) => x.a);
    };
    const draw = () => {
      items = find(input.value);
      on = items.length ? 0 : -1;
      ul.innerHTML = items.map((a, i) => '<li data-i="' + i + '"' + (i === on ? ' class="on"' : '') + '><b>' + esc(a.name) + '</b><small>' + (a.kind === 'master' ? 'world map &middot; ' : '') + 'Lv ' + a.level + '</small></li>').join('');
      ul.hidden = !items.length;
    };
    const mark = () => ul.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i === on));
    const pick = (a) => { ul.hidden = true; input.value = a.name; onPick(a); };
    input.addEventListener('input', draw);
    input.addEventListener('focus', draw);
    input.addEventListener('blur', () => setTimeout(() => { ul.hidden = true; }, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { on = Math.min(items.length - 1, on + 1); mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { on = Math.max(0, on - 1); mark(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        const exact = byName[input.value];
        const a = ul.hidden ? exact : items[on] || exact;
        if (a) { pick(a); e.preventDefault(); }
        else if (onPick.enter) onPick.enter();
      } else if (e.key === 'Escape') { ul.hidden = true; }
    });
    ul.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li');
      if (li) { e.preventDefault(); pick(items[+li.dataset.i]); }
    });
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    const q = $('#q');
    const from = $('#rFrom');
    const to = $('#rTo');
    attachAC(q, $('#qSugg'), (a) => goTo(a.name));
    const go = () => { if (from.value && to.value) runRoute(from.value, to.value); };
    const onRoutePick = () => go();
    attachAC(from, $('#rFromSugg'), onRoutePick);
    attachAC(to, $('#rToSugg'), onRoutePick);
    $('#rGo').addEventListener('click', go);
    $('#rClear').addEventListener('click', clearRoute);
    $('#rSwap').addEventListener('click', () => { const t = from.value; from.value = to.value; to.value = t; if (from.value && to.value) go(); });

    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]');
      if (b) { hideCard(); unfocus(); renderPage(+b.dataset.p); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    $('#tabs').addEventListener('toggle', (e) => {
      const d = e.target;
      if (d.open) {
        state.openGroup = d.dataset.g;
        $('#tabs').querySelectorAll('details[open]').forEach((o) => { if (o !== d) o.open = false; });
      } else if (state.openGroup === d.dataset.g) state.openGroup = null;
    }, true);
    // dark or game (parchment) theme; the choice is remembered. The page already has it applied from index.html.
    const themeBtn = $('#themeBtn');
    const setTheme = (name) => {
      document.documentElement.dataset.theme = name;
      themeBtn.textContent = 'Theme: ' + (name === 'game' ? 'Game' : 'Dark');
      try { localStorage.setItem('fspf_theme', name); } catch (err) { /* ignore */ }
    };
    setTheme(document.documentElement.dataset.theme === 'game' ? 'game' : 'dark');
    themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'game' ? 'dark' : 'game'));
    const hh = () => document.documentElement.style.setProperty('--hh', $('#top').offsetHeight + 'px');
    hh(); window.addEventListener('resize', hh);
    $('#goLevel').addEventListener('change', (e) => {
      const l = +e.target.value;
      const p = D.pages.find((x) => l >= x.min && l <= x.max);
      if (p) { hideCard(); unfocus(); renderPage(p.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    $('#worldStrip').addEventListener('click', (e) => {
      const w = e.target.closest('.w');
      if (!w) return;
      const m = byName[w.dataset.w];
      const show = () => { const sec = $('#w-' + norm(m.name)); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      if (!$('#w-' + norm(m.name))) renderPage(pageOf(m).id).then(show); else show();
    });
    // the legend hangs from the sticky page bar, so it can be opened anywhere on the page; the choice is remembered
    const showLegend = (on) => {
      $('#legend').hidden = !on;
      $('#legendBtn').setAttribute('aria-expanded', String(on));
      try { localStorage.setItem('fspf_legend', on ? '1' : '0'); } catch (err) { /* ignore */ }
    };
    try { if (localStorage.getItem('fspf_legend') === '1') showLegend(true); } catch (err) { /* ignore */ }
    $('#legendBtn').addEventListener('click', () => showLegend($('#legend').hidden));

    const map = $('#map');
    map.addEventListener('mouseover', (e) => {
      const n = e.target.closest('.node');
      if (!n) return;
      focusNode(n.dataset.name);
      if (!state.pinned) { state.hover = n.dataset.name; showCard(n.dataset.name, e.clientX, e.clientY, false); }
    });
    map.addEventListener('mousemove', (e) => { if (!state.pinned && !card.hidden) placeCard(e.clientX, e.clientY); });
    map.addEventListener('mouseout', (e) => {
      const n = e.target.closest('.node');
      if (!n || n.contains(e.relatedTarget)) return;
      unfocus();
      if (!state.pinned) { state.hover = null; card.hidden = true; }
    });
    map.addEventListener('click', (e) => {
      const jump = e.target.closest('[data-jump]');
      if (jump) { e.preventDefault(); e.stopPropagation(); jumpOn(jump.closest('.node').dataset.name); return; }
      if (e.target.closest('a')) return; // Guide / Wiki links open normally
      const n = e.target.closest('.node');
      if (n) {
        e.stopPropagation();
        state.pinned = n.dataset.name;
        showCard(n.dataset.name, e.clientX, e.clientY, true);
      }
    });
    document.addEventListener('click', (e) => {
      if (card.classList.contains('pinned') && !e.target.closest('#card') && !e.target.closest('.node')) hideCard();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { hideCard(); if (!$('#legend').hidden) showLegend(false); }
      if (e.key === '/' && !/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); q.focus(); q.select(); }
    });
    card.addEventListener('click', (e) => {
      const go2 = e.target.closest('[data-go]');
      if (go2) { e.preventDefault(); hideCard(); goTo(go2.dataset.go); return; }
      if (e.target.closest('.close')) { hideCard(); return; }
      const act = e.target.closest('[data-act]');
      if (act) {
        const name = card.dataset.name;
        (act.dataset.act === 'from' ? from : to).value = name;
        hideCard();
        if (from.value && to.value) runRoute(from.value, to.value);
        else (act.dataset.act === 'from' ? to : from).focus();
      }
    });
    $('#routePanel').addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]');
      if (g) { e.preventDefault(); goTo(g.dataset.go, false); }
    });

    let t = null;
    let lastW = $('#map').offsetWidth;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => { const w = $('#map').offsetWidth; if (w !== lastW) { lastW = w; renderPage(state.page); } else drawEdges(); }, 150);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawEdges);
  }

  // ---------------------------------------------------------------- start
  renderLegend();
  wire();
  renderPage(state.page);
  $('#foot').innerHTML = 'Data from the Ultimate Fallen Sword Guide and the Fallen Sword Wiki, collected ' + esc(D.built) +
    '. Community-maintained, so some stairs may be missing or out of date. ' + realms.length + ' realms and ' + masters.length + ' master realms, levels 1&ndash;' + LAST_LEVEL + '. Not affiliated with Hunted Cow Studios.';
})();

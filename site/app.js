(function () {
  'use strict';

  const D = window.FSAR;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

  // ---------------------------------------------------------------- level colours
  // Same idea as the original guide's colour bar: purple at level 1, through blue, teal, green, yellow, orange to dark red.
  const STOPS = [
    [1, [123, 31, 162]], [10, [91, 54, 184]], [20, [58, 73, 214]], [30, [44, 102, 230]], [40, [28, 140, 214]],
    [50, [19, 168, 184]], [70, [39, 174, 96]], [100, [226, 196, 0]], [115, [243, 156, 18]], [130, [239, 108, 26]],
    [150, [224, 58, 47]], [190, [139, 26, 26]], [300, [122, 28, 92]], [400, [76, 40, 126]], [500, [34, 62, 120]], [600, [20, 96, 110]], [700, [24, 110, 70]],
  ];
  // above 700 the hue keeps walking round the wheel, one stop per 100 levels, so neighbouring bands stay distinct
  for (let l = 800; l <= 6400; l += 100) {
    const h = (l / 100 * 47) % 360, s = 0.55, v = 0.36;
    const f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
    STOPS.push([l, [f(5), f(3), f(1)]]);
  }
  function levelRGB(l) {
    if (l <= STOPS[0][0]) return STOPS[0][1];
    for (let i = 1; i < STOPS.length; i++) {
      if (l <= STOPS[i][0]) {
        const [l0, c0] = STOPS[i - 1];
        const [l1, c1] = STOPS[i];
        const t = (l - l0) / (l1 - l0);
        return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      }
    }
    return STOPS[STOPS.length - 1][1];
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
      '<span class="badges">' + b.join('') + '</span>' + linksHTML(a, 'links') + '</div>';
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

  // Grid layout like the original guide: every area sits in a cell of a grid and every connection runs along the
  // channels between the cells (horizontal / vertical lines), so a line can never pass behind an area.
  // 1) a force simulation gives each area a rough place so that neighbours end up close,
  // 2) the places are snapped to free grid cells, 3) each connection is routed through the channels.
  const NW = 108, NH = 52, PX = 136, PY = 76;

  const MinHeap = FSRoute.MinHeap;

  function layoutCanvas(canvas, members, primary) {
    const ITER = 400;
    const cw = Math.max(480, canvas.clientWidth);
    const C = Math.max(3, Math.min(14, Math.floor(cw / PX)));
    const GX = PX - NW, GY = PY - NH, L0 = PX * 1.05;
    const els = {};
    canvas.querySelectorAll('.node').forEach((el) => { els[el.dataset.name] = el; });
    const set = new Set(members.map((r) => r.name));
    const N = members.map((r, i) => ({ name: r.name, i, w: NW, h: NH, x: 0, y: 0, layer: primary.has(r.name) ? (r.kind === 'master' ? 0 : Math.min(depth[r.name], 6)) : -1 }));
    const idx = {};
    N.forEach((n) => { idx[n.name] = n.i; });
    const E = [];
    drawn.forEach((e, key) => {
      if (set.has(e.a) && set.has(e.b) && e.a !== e.b && (primary.has(e.a) || primary.has(e.b))) E.push({ a: idx[e.a], b: idx[e.b], key, e });
    });
    const nbr = N.map(() => []);
    E.forEach((r) => { nbr[r.a].push(r.b); nbr[r.b].push(r.a); });
    N.forEach((n) => {
      if (n.layer >= 0) return;
      const ls = nbr[n.i].map((j) => N[j].layer).filter((l) => l >= 0);
      n.layer = ls.length ? Math.round(ls.reduce((p, q) => p + q, 0) / ls.length) : 1;
    });

    // initial rows by distance from the world map
    const W = C * PX;
    const layers = {};
    N.forEach((n) => { (layers[n.layer] = layers[n.layer] || []).push(n); });
    const placed = {};
    let y = 0;
    Object.keys(layers).map(Number).sort((p, q) => p - q).forEach((L) => {
      const score = (n) => { const v = nbr[n.i].filter((j) => placed[j] != null).map((j) => placed[j]); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : 1e9; };
      const list = layers[L].slice().sort((p, q) => (score(p) - score(q)) || (members[p.i].level - members[q.i].level) || p.name.localeCompare(q.name));
      for (let s = 0; s < list.length; s += C) {
        const line = list.slice(s, s + C);
        let x = (W - line.length * PX) / 2 + PX / 2;
        line.forEach((n) => { n.x = x; n.y = y; x += PX; });
        y += PY;
      }
      list.forEach((n) => { placed[n.i] = n.x; });
    });
    N.forEach((n) => { n.hy = n.y; });

    for (let it = 0; it < ITER + 120; it++) {
      const fin = it >= ITER;
      const T = fin ? 14 : 30 * (1 - it / ITER) + 1.5;
      N.forEach((n) => { n.dx = 0; n.dy = 0; });
      if (!fin) {
        E.forEach((r) => {
          const p = N[r.a], q = N[r.b];
          const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
          const f = (d - L0) * 0.07;
          p.dx += dx / d * f; p.dy += dy / d * f; q.dx -= dx / d * f; q.dy -= dy / d * f;
        });
      }
      for (let a = 0; a < N.length; a++) {
        for (let b = a + 1; b < N.length; b++) {
          const p = N[a], q = N[b];
          let dx = p.x - q.x, dy = p.y - q.y;
          if (!dx && !dy) { dx = (a % 2 ? 1 : -1); dy = 0.5; }
          const ox = PX - Math.abs(dx), oy = PY - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            if (ox < oy) { const s = Math.sign(dx) * ox / 2; p.dx += s; q.dx -= s; } else { const s = Math.sign(dy) * oy / 2; p.dy += s; q.dy -= s; }
          } else if (!fin) {
            const d2 = dx * dx + dy * dy, d = Math.sqrt(d2), f = Math.min(20, 9000 / d2);
            p.dx += dx / d * f; p.dy += dy / d * f; q.dx -= dx / d * f; q.dy -= dy / d * f;
          }
        }
      }
      N.forEach((n) => {
        if (!fin) { n.dy += (n.hy - n.y) * 0.01; n.dx += (W / 2 - n.x) * 0.002; }
        const m = Math.hypot(n.dx, n.dy);
        if (m > T) { n.dx *= T / m; n.dy *= T / m; }
        n.x = Math.min(W - PX / 2, Math.max(PX / 2, n.x + n.dx));
        n.y += n.dy;
      });
    }

    // snap to grid cells (busiest areas first so hubs keep their ideal cell)
    const minY = Math.min.apply(null, N.map((n) => n.y));
    N.forEach((n) => { n.gc = Math.min(C - 1, Math.max(0, n.x / PX - 0.5)); n.gr = (n.y - minY) / PY; });
    const maxRow = Math.ceil(Math.max.apply(null, N.map((n) => n.gr))) + 3;
    const taken = new Set();
    N.slice().sort((p, q) => nbr[q.i].length - nbr[p.i].length || p.i - q.i).forEach((n) => {
      let best = null, bd = Infinity;
      for (let r = 0; r <= maxRow; r++) {
        for (let c = 0; c < C; c++) {
          if (taken.has(c + ',' + r)) continue;
          const d = (c - n.gc) * (c - n.gc) + (r - n.gr) * (r - n.gr) * 1.1;
          if (d < bd) { bd = d; best = [c, r]; }
        }
      }
      n.c = best[0]; n.r = best[1];
      taken.add(best[0] + ',' + best[1]);
    });
    // drop rows nobody uses
    const usedRows = Array.from(new Set(N.map((n) => n.r))).sort((p, q) => p - q);
    N.forEach((n) => { n.r = usedRows.indexOf(n.r); });
    const R = usedRows.length;

    // route every connection through the channels. Lattice point (X,Y): cell (c,r) is at (2c+1,2r+1), channels at even coordinates.
    const LW = 2 * C + 1, LH = 2 * R + 1;
    const occ = new Int32Array(LW * LH).fill(-1);
    N.forEach((n) => { occ[(2 * n.r + 1) * LW + 2 * n.c + 1] = n.i; });
    const use = {}, vh = {}, vv = {};
    const segKey = (x, y, nx, ny) => (y === ny ? 'h' + Math.min(x, nx) + ',' + y : 'v' + x + ',' + Math.min(y, ny));
    const DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const book = (verts, sign) => {
      for (let i = 0; i + 1 < verts.length; i++) {
        const k = segKey(verts[i][0], verts[i][1], verts[i + 1][0], verts[i + 1][1]);
        use[k] = (use[k] || 0) + sign;
        if (i > 0) {
          const p = verts[i][0] + ',' + verts[i][1];
          const h1 = verts[i - 1][1] === verts[i][1], h2 = verts[i][1] === verts[i + 1][1];
          if (h1 && h2) vh[p] = (vh[p] || 0) + sign;
          else if (!h1 && !h2) vv[p] = (vv[p] || 0) + sign;
        }
      }
    };
    const routeOne = (ed) => {
      const A = N[ed.a], B = N[ed.b];
      const sx = 2 * A.c + 1, sy = 2 * A.r + 1, gx = 2 * B.c + 1, gy = 2 * B.r + 1;
      const S = LW * LH * 5;
      const dist = new Float64Array(S).fill(Infinity);
      const prev = new Int32Array(S).fill(-1);
      const heap = new MinHeap();
      const st = (x, y, d) => (y * LW + x) * 5 + d;
      dist[st(sx, sy, 4)] = 0;
      heap.push(0, st(sx, sy, 4));
      let end = -1;
      while (heap.size) {
        const [cd, s] = heap.pop();
        if (cd > dist[s]) continue;
        const d = s % 5, p = (s - d) / 5, x = p % LW, y = (p - x) / LW;
        if (x === gx && y === gy) { end = s; break; }
        for (let k = 0; k < 4; k++) {
          const nx = x + DIR[k][0], ny = y + DIR[k][1];
          if (nx < 0 || ny < 0 || nx >= LW || ny >= LH) continue;
          const o = occ[ny * LW + nx];
          if (o >= 0 && !(nx === gx && ny === gy)) continue;
          let c = 1 + (d !== 4 && d !== k ? 1.5 : 0) + 2.5 * (use[segKey(x, y, nx, ny)] || 0);
          if (d === k) { const pk = x + ',' + y; if (k % 2 === 0 ? vv[pk] > 0 : vh[pk] > 0) c += 6; } // would cross another line
          if ((nx & 1) && (ny & 1) && o < 0) c += 0.4;
          const ns = st(nx, ny, k);
          if (cd + c < dist[ns]) { dist[ns] = cd + c; prev[ns] = s; heap.push(cd + c, ns); }
        }
      }
      if (end < 0) return [[sx, sy], [gx, gy]];
      const verts = [];
      for (let s = end; s >= 0; s = prev[s]) { const p = (s - (s % 5)) / 5; verts.push([p % LW, (p - (p % LW)) / LW]); }
      return verts.reverse();
    };
    const order = E.slice().sort((p, q) => (Math.abs(N[p.a].c - N[p.b].c) + Math.abs(N[p.a].r - N[p.b].r)) - (Math.abs(N[q.a].c - N[q.b].c) + Math.abs(N[q.a].r - N[q.b].r)));
    const routed = order.map((ed) => ({ ed, A: N[ed.a], B: N[ed.b], verts: null }));
    routed.forEach((r) => { r.verts = routeOne(r.ed); book(r.verts, 1); });
    // rip up and re-route each line once the others are known, which untangles most crossings
    for (let pass = 0; pass < 3; pass++) {
      routed.forEach((r) => { book(r.verts, -1); r.verts = routeOne(r.ed); book(r.verts, 1); });
    }

    // spread lines that share a channel into lanes
    const lanes = {};
    routed.forEach((r) => {
      for (let i = 0; i + 1 < r.verts.length; i++) {
        const k = segKey(r.verts[i][0], r.verts[i][1], r.verts[i + 1][0], r.verts[i + 1][1]);
        (lanes[k] = lanes[k] || []).push(r);
      }
    });
    const px = (X) => X * PX / 2, py = (Y) => Y * PY / 2;
    const routes = routed.map((r) => {
      const v = r.verts, n = v.length;
      const off = [];
      for (let i = 0; i + 1 < n; i++) {
        const horiz = v[i][1] === v[i + 1][1];
        const k = segKey(v[i][0], v[i][1], v[i + 1][0], v[i + 1][1]);
        const list = lanes[k];
        const touches = (v[i][0] === v[0][0] && v[i][1] === v[0][1]) || (v[i + 1][0] === v[n - 1][0] && v[i + 1][1] === v[n - 1][1]);
        let o = 0;
        if (!touches && list.length > 1) {
          const maxOff = (horiz ? GY : GX) / 2 - 5;
          const step = Math.min(5, 2 * maxOff / (list.length - 1));
          o = (list.indexOf(r) - (list.length - 1) / 2) * step;
        }
        off.push(horiz ? [0, o] : [o, 0]);
      }
      const pts = [[px(v[0][0]), py(v[0][1])]];
      for (let i = 1; i < n - 1; i++) {
        const a = off[i - 1], b = off[i];
        const horizA = v[i - 1][1] === v[i][1], horizB = v[i][1] === v[i + 1][1];
        const bx = px(v[i][0]), by = py(v[i][1]);
        if (horizA !== horizB) pts.push([bx + a[0] + b[0], by + a[1] + b[1]]);
        else if (a[0] !== b[0] || a[1] !== b[1]) { pts.push([bx + a[0], by + a[1]]); pts.push([bx + b[0], by + b[1]]); }
      }
      pts.push([px(v[n - 1][0]), py(v[n - 1][1])]);
      return { key: r.ed.key, a: r.ed.e.a, b: r.ed.e.b, kind: r.ed.e.kind, pts };
    });

    N.forEach((n) => {
      els[n.name].style.left = Math.round(n.c * PX + (PX - NW) / 2) + 'px';
      els[n.name].style.top = Math.round(n.r * PY + (PY - NH) / 2) + 'px';
    });
    canvas.style.width = (C * PX) + 'px';
    canvas.style.height = (R * PY) + 'px';
    return routes;
  }

  const graphs = [];
  // Put the given areas (plus ghost copies of the areas they connect to in other world maps) on a canvas and route the lines.
  function mountGraph(canvas, primaryAreas, master, masterHere, pid) {
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
    graphs.push({ canvas, routes: layoutCanvas(canvas, primaryAreas.concat(ghosts), primary) });
  }

  function renderPage(pid) {
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
      mountGraph(canvas, [m].concat(items), m, masterHere, pid);
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
      mountGraph(canvas, ev, null, true, pid);
    }

    // an area can also appear as a copy in a neighbouring map (a ghost); the real box is the one that gets highlighted
    wrap.querySelectorAll('.node:not(.dup)').forEach((el) => { nodeEls[el.dataset.name] = el; });
    wrap.querySelectorAll('.node.dup').forEach((el) => { if (!nodeEls[el.dataset.name]) nodeEls[el.dataset.name] = el; });
    renderTabs();
    renderStrip();
    drawEdges();
    applyRoute();
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
  function renderLegend() {
    const mini = (cls, label, extra, name) =>
      '<div class="it"><div class="node ' + cls + ' legend-node" style="--c:' + extra + '"><span class="nm">' + name + '</span></div><span>' + label + '</span></div>';
    const grad = 'linear-gradient(90deg,' + [1, 10, 20, 30, 40, 50].map((l) => 'rgb(' + rgbStr(levelRGB(l)) + ')').join(',') + ')';
    $('#legend').innerHTML =
      mini('master', '<b>Master Realm</b> (world map)', 'rgb(' + rgbStr(levelRGB(20)) + ')', 'Name') +
      mini('realm', '<b>Realm</b>', 'rgb(' + rgbStr(levelRGB(20)) + ')', 'Name') +
      '<div class="it"><div class="node realm legend-node" style="--c:rgb(' + rgbStr(levelRGB(20)) + ')"><span class="dr">DR</span><span class="nm">Name</span></div><span><b>Dark Realm</b> (needs the Vision skill)</span></div>' +
      mini('realm next', '<b>Continues</b> on another page / at higher levels', 'rgb(' + rgbStr(levelRGB(20)) + ')', 'Name') +
      mini('realm event', '<b>Special event</b> area', '#6f747d', 'Name') +
      '<div class="it">' + ICON.portal + '<span><b>Portal</b> &mdash; coordinates in the info card</span></div>' +
      '<div class="it">' + ICON.shop + '<span><b>Shop</b></span></div>' +
      '<div class="it">' + ICON.quest + '<span><b>Quest</b></span></div>' +
      '<div class="it">' + ICON.relic + '<span><b>Relic</b></span></div>' +
      '<div class="it"><div><div class="bar" style="background:' + grad + '"></div><div class="bar-l"><span>1</span><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span></div></div><span>Minimum <b>level</b></span></div>';
  }

  // ---------------------------------------------------------------- info card
  // The guide has a page per realm; master realms are not in it, so they link to the guide's search for the name.
  const guideUrl = (a) => a.guideId
    ? 'https://guide.fallensword.com/index.php?cmd=realms&subcmd=view&realm_id=' + a.guideId
    : 'https://guide.fallensword.com/index.php?cmd=realms&search_name=' + encodeURIComponent(a.name);
  const wikiUrl = (a) => 'https://wiki.fallensword.com/index.php/' +
    encodeURIComponent((a.wikiTitle || a.name).replace(/ /g, '_')).replace(/%28/g, '(').replace(/%29/g, ')').replace(/%2C/g, ',').replace(/%27/g, "'");
  const linksHTML = (a, cls) =>
    '<span class="' + cls + '"><a href="' + guideUrl(a) + '" target="_blank" rel="noopener" title="Open ' + esc(a.name) + ' in the Guide">Guide</a>' +
    '<a href="' + wikiUrl(a) + '" target="_blank" rel="noopener" title="Open ' + esc(a.name) + ' on the Wiki">Wiki</a></span>';
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
        return '<li><div class="stair"><span>&rarr; <a data-go="' + esc(s.to) + '">' + esc(s.to) + '</a>' + (o ? ' <span class="coord">Lv ' + o.level + '</span>' : '') +
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
    if (pageOf(a).id !== state.page) renderPage(pageOf(a).id);
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
    const hh = () => $('#side').style.setProperty('--hh', $('#top').offsetHeight + 'px');
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
      if (!$('#w-' + norm(m.name))) renderPage(pageOf(m).id);
      const sec = $('#w-' + norm(m.name));
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#legendBtn').addEventListener('click', () => {
      const l = $('#legend');
      l.hidden = !l.hidden;
      $('#legendBtn').setAttribute('aria-expanded', String(!l.hidden));
    });

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
      if (e.key === 'Escape') hideCard();
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

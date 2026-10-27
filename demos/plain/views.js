// view(state) for the movies vocabulary, with no framework: DOM + SVG, built
// from the rixse store's state. Each view runs its own ZQL in zega (in this
// page) and draws the rows. layout() decides the grid; the agent never
// positions anything. The chart math (series, lineData, statOf, capped) is the
// shared module the canvas demo also uses.
import { layout } from 'rixse/ui';
import { getZega } from 'rixse-demo-shared/zega';
import { capped, lineData, series, statOf } from 'rixse-demo-shared/movies';

const SVG = 'http://www.w3.org/2000/svg';
const PALETTE = ['#4f7cff', '#e2531f', '#1f9d6b', '#9b6cff', '#e0a21b', '#e04f8c', '#2bb3c0', '#8a9a3a'];
const LINE_COLORS = ['#f0845e', '#3cc49a', '#e8ecef', '#6d9bff', '#c49bff'];

const money = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : n.toLocaleString('en-US'));
const fmt = (n, isMoney) => (isMoney ? money(n) : n.toLocaleString('en-US', { maximumFractionDigits: 1 }));

function el(tag, attrs = {}, ...children) {
  const node = tag === 'svg' || SVG_TAGS.has(tag) ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c) node.append(c);
  return node;
}
const SVG_TAGS = new Set(['g', 'rect', 'circle', 'line', 'path', 'text', 'defs', 'marker']);

/** One number, large: the answer to "how much / how many / when". */
function StatView(v, rows) {
  const stat = statOf(rows, v);
  if (!stat) return el('p', { class: 'err', text: 'no number' });
  const isMoney = /gross/.test(v.value), isYear = /year/.test(v.value) && !/count/.test(v.value);
  return el('div', { class: 'stat' },
    el('div', { class: 'num', text: isMoney ? money(stat.value) : isYear ? String(Math.round(stat.value)) : fmt(stat.value, false) }),
    el('div', { class: 'cap', text: stat.caption + (isMoney ? ' · worldwide box office' : '') }));
}

/** Compare amounts across things: one bar per label, capped at CAP.bar. */
function BarView(v, rows, store, selected) {
  const { data, hidden } = capped(series(rows, v), 'bar');
  const isMoney = /gross/.test(v.value);
  const W = 620, LABEL = 180, ROW = 30, H = Math.max(60, data.length * ROW + 8);
  const max = Math.max(1, ...data.map((d) => d.value));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `${v.title}: bar chart` });
  data.forEach((d, i) => {
    const w = Math.max(1, (d.value / max) * (W - LABEL - 90));
    const bar = el('rect', { x: LABEL, y: i * ROW + 4, width: w, height: ROW - 10, rx: 4, fill: selected.includes(d.label) ? PALETTE[1] : PALETTE[0], 'data-bar': d.label });
    bar.addEventListener('click', () => {
      const on = selected.includes(d.label);
      store.dispatch(on && selected.length === 1 ? { type: 'select.clear', payload: {} } : { type: 'select.set', payload: { view: v.id, items: d.label } }, 'you');
    });
    svg.append(el('g', { class: 'bar-row' },
      el('text', { x: LABEL - 8, y: i * ROW + ROW / 2 + 3, 'text-anchor': 'end', text: d.label.length > 26 ? d.label.slice(0, 25) + '…' : d.label }),
      bar,
      el('text', { x: LABEL + w + 6, y: i * ROW + ROW / 2 + 3, text: fmt(d.value, isMoney) })));
  });
  const out = el('div', {}, svg);
  if (hidden > 0) out.append(el('p', { class: 'soft', text: `Showing the first ${data.length} of ${data.length + hidden}. Ask for a limit to change it.` }));
  return out;
}

/** Shares of a whole: slices plus a legend with percentages. */
function PieView(v, rows) {
  const { data } = capped(series(rows, v), 'pie');
  const isMoney = /gross/.test(v.value);
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const R = 90, C = 110;
  const svg = el('svg', { viewBox: '0 0 220 220', width: '220', role: 'img', 'aria-label': `${v.title}: pie chart` });
  let angle = -Math.PI / 2;
  data.forEach((d, i) => {
    const a = (d.value / total) * Math.PI * 2;
    const [x1, y1] = [C + R * Math.cos(angle), C + R * Math.sin(angle)];
    const [x2, y2] = [C + R * Math.cos(angle + a), C + R * Math.sin(angle + a)];
    svg.append(el('path', { d: `M${C},${C} L${x1},${y1} A${R},${R} 0 ${a > Math.PI ? 1 : 0} 1 ${x2},${y2} Z`, fill: PALETTE[i % PALETTE.length], 'data-slice': d.label }));
    angle += a;
  });
  return el('div', {}, svg,
    el('ul', { class: 'legend' }, data.map((d, i) => el('li', {},
      el('i', { style: `background:${PALETTE[i % PALETTE.length]}` }),
      `${d.label} · ${fmt(d.value, isMoney)}`,
      el('span', { class: 'pct', text: `${Math.round((d.value / total) * 100)}%` })))));
}

/** Change over time: one smooth path per series, points as circles. */
function LineView(v, rows) {
  const data = lineData(rows, v);
  const isMoney = /gross/.test(v.value);
  const f = (n) => (isMoney ? money(n) : fmt(n, false));
  const W = 820, H = 340, padL = 56, padR = 96, padT = 24, padB = 30;
  const xs = data.xs;
  const maxY = Math.max(1, ...data.series.flatMap((s) => s.points.map((p) => p.y)));
  const X = (x) => padL + (xs.length > 1 ? ((x - xs[0]) / (xs.at(-1) - xs[0])) * (W - padL - padR) : 0);
  const Y = (y) => padT + (1 - y / maxY) * (H - padT - padB);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `${v.title}: line chart` });
  for (let i = 0; i <= 4; i++) {
    const t = (maxY / 4) * i;
    svg.append(el('line', { x1: padL, x2: W - padR, y1: Y(t), y2: Y(t), stroke: '#232830' }),
      el('text', { x: padL - 10, y: Y(t) + 4, 'text-anchor': 'end', 'font-size': 11, text: f(t) }));
  }
  const stepX = Math.max(1, Math.ceil(xs.length / 10));
  xs.filter((_, i) => i % stepX === 0 || i === xs.length - 1).forEach((x) =>
    svg.append(el('text', { x: X(x), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, text: String(x) })));
  data.series.forEach((s, i) => {
    const c = LINE_COLORS[i % LINE_COLORS.length];
    const pts = s.points.map((p) => ({ x: X(p.x), y: Y(p.y) }));
    // Catmull-Rom as cubic Béziers, like the canvas demo's smooth path.
    let d = pts.length ? `M${pts[0].x},${pts[0].y}` : '';
    for (let k = 0; k < pts.length - 1; k++) {
      const p0 = pts[k - 1] ?? pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] ?? p2;
      d += ` C${p1.x + (p2.x - p0.x) / 6},${Math.min(Y(0), p1.y + (p2.y - p0.y) / 6)} ${p2.x - (p3.x - p1.x) / 6},${Math.min(Y(0), p2.y - (p3.y - p1.y) / 6)} ${p2.x},${p2.y}`;
    }
    svg.append(el('path', { d, fill: 'none', stroke: c, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'data-series': s.name }));
    for (const p of pts) svg.append(el('circle', { cx: p.x, cy: p.y, r: 3, fill: c, 'data-point': s.name }));
    const last = pts.at(-1);
    if (last) svg.append(el('text', { x: last.x + 8, y: last.y + 4, fill: c, 'font-size': 12, 'font-weight': 600, text: `${s.name} ${f(s.points.at(-1).y)}` }));
  });
  return el('div', {}, svg);
}

/** Detail rows: scalar fields as columns, nested lists as joined names. */
function TableView(rows) {
  const flat = rows.slice(0, 100).map((r) => r);
  const rank = (k) => (k === 'title' || k === 'name' ? 0 : 1);
  const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))].sort((a, b) => rank(a) - rank(b)).slice(0, 6);
  const cell = (val, k) => Array.isArray(val)
    ? val.map((x) => (x && typeof x === 'object' ? String(x.name ?? x.title ?? '') : String(x))).filter(Boolean).join(', ')
    : typeof val === 'number' && /gross/.test(k) ? money(val) : String(val ?? '');
  return el('table', { class: 'rows' },
    el('thead', {}, el('tr', {}, cols.map((c) => el('th', { text: c })))),
    el('tbody', {}, flat.map((r) => el('tr', {}, cols.map((c) => el('td', { text: cell(r[c], c) }))))));
}

/** Rows → a graph: every object with a title or name is a node; nesting is an edge. */
function toGraph(rows) {
  const nodes = new Map();
  const links = [];
  const visit = (o, parent) => {
    if (!o || typeof o !== 'object') return;
    const label = String(o.title ?? o.name ?? '');
    let id = parent;
    if (label) {
      const type = o.title !== undefined ? 'movie' : o.name !== undefined ? 'person' : 'other';
      id = `${type}:${label}`;
      if (!nodes.has(id)) nodes.set(id, { id, label, type, degree: 0, x: 0, y: 0, vx: 0, vy: 0 });
      if (parent && parent !== id) { links.push({ source: parent, target: id }); nodes.get(parent).degree++; nodes.get(id).degree++; }
    }
    for (const v of Object.values(o)) if (Array.isArray(v)) v.forEach((x) => visit(x, id));
  };
  rows.forEach((r) => visit(r, null));
  const all = [...nodes.values()];
  const movies = all.filter((n) => n.type === 'movie').length;
  const kept = (movies >= 2 ? all.filter((n) => n.type === 'movie' || n.degree >= 2) : all).slice(0, 120);
  const ids = new Set(kept.map((n) => n.id));
  return { nodes: kept, links: links.filter((l) => ids.has(l.source) && ids.has(l.target)).slice(0, 400) };
}

/** How movies and people connect: a small hand-rolled force layout, no library. */
function GraphView(v, rows) {
  const { nodes, links } = toGraph(rows);
  const W = 800, H = 460;
  nodes.forEach((n, i) => { const a = (i / Math.max(1, nodes.length)) * Math.PI * 2; n.x = W / 2 + Math.cos(a) * 180; n.y = H / 2 + Math.sin(a) * 150; });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let step = 0; step < 250; step++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      let d2 = dx * dx + dy * dy || 1;
      const f = Math.min(8, 2600 / d2);
      const d = Math.sqrt(d2);
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const l of links) {
      const a = byId.get(l.source), b = byId.get(l.target);
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const f = (d - 110) * 0.02;
      a.vx += dx / d * f * d * 0.02; a.vy += dy / d * f * d * 0.02; b.vx -= dx / d * f * d * 0.02; b.vy -= dy / d * f * d * 0.02;
    }
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.002; n.vy += (H / 2 - n.y) * 0.002;
      n.x += n.vx * 0.6; n.y += n.vy * 0.6; n.vx *= 0.82; n.vy *= 0.82;
    }
  }
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'graph of movies and people' });
  for (const l of links) {
    const a = byId.get(l.source), b = byId.get(l.target);
    svg.append(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#9a9aa4', 'stroke-width': 1, 'data-edge': `${l.source} > ${l.target}` }));
  }
  const colorOf = (() => { const m = new Map(); for (const n of nodes) if (!m.has(n.type)) m.set(n.type, PALETTE[m.size % PALETTE.length]); return (t) => m.get(t); })();
  for (const n of nodes) {
    svg.append(el('g', { 'data-node': n.id },
      el('circle', { cx: n.x, cy: n.y, r: 16, fill: colorOf(n.type), stroke: '#232830' }),
      el('text', { x: n.x, y: n.y + 30, 'text-anchor': 'middle', 'font-size': 10.5, text: n.label.length > 20 ? n.label.slice(0, 19) + '…' : n.label })));
  }
  return el('div', {}, svg);
}

const RENDER = { stat: StatView, bar: BarView, pie: PieView, line: LineView, table: TableView, graph: GraphView };

/**
 * Draw the whole screen from the store's state. Rebuilt on every applied
 * action — at demo scale a full redraw is simpler than diffing, and layout()
 * keeps the grid stable.
 */
export function renderScreen(container, state, store, width) {
  container.textContent = '';
  if (!state.order.length) {
    container.append(el('p', { class: 'hint', text: 'Ask about movies, e.g. “top 10 movies by box office”, “box office by genre”, “Christopher Nolan’s films”.' }));
    return;
  }
  const grid = layout(state, width || container.clientWidth);
  const views = el('div', { class: 'views' });
  views.style.gridTemplateColumns = `repeat(${grid.cols}, minmax(0, 1fr))`;
  for (const { id, cols } of grid.cells) {
    const v = state.items[id];
    const t = performance.now();
    let rows = [], error = '';
    try { rows = getZega()?.run(v.query) ?? []; }
    catch (e) { error = String(e); }
    const ms = performance.now() - t;
    const selected = state.selection?.view === id ? state.selection.items : [];
    const card = el('div', { class: 'view', 'data-view': id, 'data-kind': v.kind, 'data-size': v.size },
      el('h3', { text: v.title }),
      el('div', { class: 'meta', text: `${v.kind} · ${rows.length} rows · zega ${ms.toFixed(1)} ms`, title: v.query }));
    card.style.gridColumn = `span ${cols}`;
    if (error) card.append(el('p', { class: 'err', text: error }));
    else card.append(RENDER[v.kind]?.(v, rows, store, selected) ?? el('p', { class: 'err', text: `no renderer for ${v.kind}` }));
    if (selected.length) card.append(el('p', { class: 'selected-note', text: `Selected: ${selected.join(', ')}` }));
    views.append(card);
  }
  container.append(views);
}

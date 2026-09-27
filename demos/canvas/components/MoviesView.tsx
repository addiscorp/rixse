'use client';
// view(state) for the movies vocabulary. Each view runs its own ZQL in zega (in
// this page) and draws the rows. The layout places views on a grid; the agent
// never positions anything.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import { useRixseState } from 'rixse-react';
import { loadZega, getZega } from '@/lib/zega';
import { Component, type ReactNode } from 'react';
import { capped, series, type MoviesStore, type View } from '@/lib/movies';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const money = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : n.toLocaleString('en-US'));
const fmt = (n: number, isMoney: boolean) => (isMoney ? money(n) : n.toLocaleString('en-US', { maximumFractionDigits: 1 }));
const PALETTE = ['#4f7cff', '#e2531f', '#1f9d6b', '#9b6cff', '#e0a21b', '#e04f8c', '#2bb3c0', '#8a9a3a'];

function BarView({ v, rows, store, selected }: { v: View; rows: unknown[]; store: MoviesStore; selected: string[] }) {
  const { data, hidden } = capped(series(rows, v), 'bar');
  const isMoney = /gross/.test(v.value);
  const config = { value: { label: v.value || 'value', color: PALETTE[0] } } satisfies ChartConfig;
  return (
    <div className="relative">
    <ChartContainer config={config} className="w-full" style={{ height: Math.max(180, data.length * 30 + 20) }}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid horizontal={false} />
        <YAxis dataKey="label" type="category" width={170} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} interval={0} />
        <XAxis type="number" tickFormatter={(n: number) => fmt(n, isMoney)} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent formatter={(val) => fmt(Number(val), isMoney)} />} />
        <Bar dataKey="value" radius={4} className="cursor-pointer"
          onClick={(d: { label?: string; payload?: { label?: string } }) => {
            const label = d.payload?.label ?? d.label; if (!label) return;
            const on = selected.includes(label);
            store.dispatch(on && selected.length === 1 ? { type: 'select.clear', payload: {} } : { type: 'select.set', payload: { view: v.id, items: label } }, 'you');
          }}>
          {data.map((d) => <Cell key={d.label} fill={selected.includes(d.label) ? PALETTE[1] : PALETTE[0]} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
    {hidden > 0 && <p className="text-xs text-muted-foreground mt-2">Showing the first {data.length} of {data.length + hidden}. Ask for a limit to change it.</p>}
    <SelectionOverlay selected={selected} store={store} />
  </div>
  );
}

function PieView({ v, rows }: { v: View; rows: unknown[] }) {
  const { data } = capped(series(rows, v), 'pie');
  const isMoney = /gross/.test(v.value);
  const total = data.reduce((a, d) => a + d.value, 0);
  const config = Object.fromEntries(data.map((d, i) => [d.label, { label: d.label, color: PALETTE[i % PALETTE.length] }])) satisfies ChartConfig;
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center">
      <ChartContainer config={config} className="aspect-square w-full max-w-[260px] mx-auto">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="label" formatter={(val) => fmt(Number(val), isMoney)} />} />
          <Pie data={data} dataKey="value" nameKey="label" innerRadius="45%" strokeWidth={2}>
            {data.map((d, i) => <Cell key={d.label} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="grid gap-1 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 min-w-0">
            <i className="size-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="truncate text-foreground">{d.label}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Rows → table columns: scalar fields as-is, nested lists as their names. */
function TableView({ rows }: { rows: unknown[] }) {
  const flat = rows.flatMap((r) => {
    const o = r as Record<string, unknown>;
    const nestedKey = Object.keys(o).find((k) => Array.isArray(o[k]) && (o[k] as unknown[]).some((x) => x && typeof x === 'object'));
    // A single parent with one nested list (a person's films): show the list's rows.
    if (rows.length <= 3 && nestedKey) return (o[nestedKey] as Record<string, unknown>[]).map((x) => ({ ...x }));
    return [o];
  });
  const rank = (k: string) => (k === 'title' || k === 'name' ? 0 : 1);
  const cols = [...new Set(flat.flatMap((r) => Object.keys(r as object)))].sort((a, b) => rank(a) - rank(b)).slice(0, 6);
  const cell = (v: unknown, k: string) => Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).title ?? '') : String(x))).filter(Boolean).join(', ') : typeof v === 'number' && /gross/.test(k) ? money(v) : String(v ?? '');
  return (
    <div className="max-h-80 overflow-auto">
      <Table>
        <TableHeader><TableRow>{cols.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{flat.slice(0, 100).map((r, i) => <TableRow key={i}>{cols.map((c) => <TableCell key={c} className="max-w-72 truncate">{cell((r as Record<string, unknown>)[c], c)}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
  );
}

type GNode = SimulationNodeDatum & { id: string; label: string; type: 'movie' | 'person' | 'other'; degree: number };
/** Rows → a graph: every object with a title or name is a node; nesting is an edge. */
function toGraph(rows: unknown[]) {
  const nodes = new Map<string, GNode>();
  const links: { source: string; target: string; rel: string }[] = [];
  const visit = (o: unknown, parent: string | null, rel = '') => {
    if (!o || typeof o !== 'object') return;
    const r = o as Record<string, unknown>;
    const label = String(r.title ?? r.name ?? '');
    let id = parent;
    if (label) {
      const type = r.title !== undefined ? 'movie' : r.name !== undefined ? 'person' : 'other';
      id = `${type}:${label}`;
      if (!nodes.has(id)) nodes.set(id, { id, label, type, degree: 0 });
      if (parent && parent !== id) { links.push({ source: parent, target: id, rel }); nodes.get(parent)!.degree++; nodes.get(id)!.degree++; }
    }
    for (const [k, v] of Object.entries(r)) if (Array.isArray(v)) v.forEach((x) => visit(x, id, k));
  };
  rows.forEach((r) => visit(r, null));
  // With several movies, the story is who they share: drop people linked to only one.
  const all = [...nodes.values()];
  const movies = all.filter((n) => n.type === 'movie').length;
  const shared = movies >= 2 ? all.filter((n) => n.type === 'movie' || n.degree >= 2) : all;
  // Cap the drawing, and keep only links whose both ends survived
  // (a link to a dropped node makes d3's forceLink throw).
  const kept = shared.slice(0, 160);
  const ids = new Set(kept.map((n) => n.id));
  return { nodes: kept, links: links.filter((l) => ids.has(l.source) && ids.has(l.target)).slice(0, 600) };
}

const edgeKey = (a: string, b: string) => `${a} > ${b}`;

/** What is selected, overlaid in the bottom-left corner of a chart: it never moves the layout. */
function SelectionOverlay({ selected, store }: { selected: string[]; store: MoviesStore }) {
  if (!selected.length) return null;
  return (
    <div className="pointer-events-auto absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5 rounded-md border bg-background/90 px-2 py-1 text-xs text-foreground shadow-sm backdrop-blur-sm" aria-label="Selected">
      <span className="text-muted-foreground">Selected</span>
      {selected.map((it) => <span key={it} className="rounded border px-1.5 py-0.5" style={{ borderColor: PALETTE[1] }}>{it.replace(/(^|> )(person|movie|other):/g, '$1')}</span>)}
      <button type="button" className="underline text-muted-foreground" onClick={() => store.dispatch({ type: 'select.clear', payload: {} }, 'you')}>clear</button>
    </div>
  );
}

// Layout physics, ported from zega's explorer graph (zegadb/zega browser/graph.js):
// same defaults, ranges and charge scaling. Remembered per viewer.
type Phys = { repulsion: number; linkDist: number; pad: number; gravity: number; /** how many hops around a selected node stay lit */ hops: number };
const PHYS_DEFAULTS: Phys = { repulsion: 100, linkDist: 105, pad: 10, gravity: 0, hops: 1 };
const PHYS_KEY = 'rixse.demo.graph.physics';
const loadPhys = (): Phys => { try { return { ...PHYS_DEFAULTS, ...JSON.parse(localStorage.getItem(PHYS_KEY) || '{}') }; } catch { return { ...PHYS_DEFAULTS }; } };
const savePhys = (p: Phys) => { try { localStorage.setItem(PHYS_KEY, JSON.stringify(p)); } catch { /* private mode */ } };
const PHYS_ROWS: { key: Exclude<keyof Phys, 'hops'>; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'repulsion', label: 'Repulsion', min: 25, max: 300, step: 5, unit: '%' },
  { key: 'linkDist', label: 'Link distance', min: 40, max: 300, step: 5, unit: '' },
  { key: 'pad', label: 'Node padding', min: 0, max: 40, step: 1, unit: '' },
  { key: 'gravity', label: 'Center pull', min: 0, max: 12, step: 1, unit: '%' },
];
/** A stable phase per node, so each one bobs on its own rhythm (zega's drift). */
const phaseOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return (Math.abs(h) % 1000) / 1000 * 6.283; };
// zega's node geometry: every plain node is a circle of radius 22 (node-display.js).
const R = 22;
const radiusOf = (_n: GNode) => R;
// zega's label palette, assigned per node type in order of first appearance (graph.js).
const ZEGA_PALETTE = ['#8dd3c7', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#bc80bd', '#ccebc5', '#ffed6f', '#a6cee3', '#fdbf6f'];
const EDGE = '#9a9aa4';
/** zega's fade for what is not lit: 20% and a small blur. */
const DIM = { opacity: 0.2, filter: 'blur(1.4px)' };

/**
 * The interactive graph. Drag the background to pan, wheel or +/− to zoom,
 * drag a node to move it, ⚙ for layout physics. Click a node or an edge to
 * select it (shift adds). The selection is rixse state, dispatched as "you",
 * so the agent sees it. Selecting nodes fades everything outside their
 * neighbourhood (zega's blur fade); selecting only edges does not blur.
 */
function GraphView({ rows, v, store, selected }: { rows: unknown[]; v: View; store: MoviesStore; selected: string[] }) {
  const { nodes, links } = useMemo(() => toGraph(rows), [rows]);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [phys, setPhys] = useState<Phys>(PHYS_DEFAULTS);
  const [panel, setPanel] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'pan' | 'node'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const sim = useRef<ReturnType<typeof forceSimulation<GNode>> | null>(null);
  // Whether the last press moved: a drag must not also count as a click.
  const lastMoved = useRef(false);
  // zega's fit: frame the whole graph once the layout is settled (and again after a
  // drag settles), unless the reader has zoomed, panned or dragged since.
  const interacted = useRef(false);
  const fit = () => {
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    if (!xs.length || xs.some((x) => !Number.isFinite(x))) return;
    const minX = Math.min(...(xs as number[])) - 70, maxX = Math.max(...(xs as number[])) + 70;
    const minY = Math.min(...(ys as number[])) - 70, maxY = Math.max(...(ys as number[])) + 70;
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const k = Math.min(W / w, H / h, 1.4);
    setView({ k, x: (W - w * k) / 2 - minX * k, y: (H - h * k) / 2 - minY * k });
  };
  const fitRef = useRef(fit); fitRef.current = fit;
  const W = 800, H = 480; // zega's viewBox
  useEffect(() => { setPhys(loadPhys()); }, []);
  const colorOf = useMemo(() => { const m = new Map<string, string>(); for (const n of nodes) if (!m.has(n.type)) m.set(n.type, ZEGA_PALETTE[m.size % ZEGA_PALETTE.length]!); return (t: string) => m.get(t)!; }, [nodes]);

  useEffect(() => {
    const base = -Math.max(140, 45 * Math.sqrt(nodes.length));
    const s = forceSimulation(nodes)
      .force('charge', forceManyBody().strength(base * phys.repulsion / 100))
      .force('link', forceLink(links as { source: string; target: string }[]).id((d) => (d as GNode).id).distance(phys.linkDist))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide((d) => radiusOf(d as GNode) + phys.pad))
      .force('x', forceX(W / 2).strength(phys.gravity / 100))
      .force('y', forceY(H / 2).strength(phys.gravity / 100))
      .alphaDecay(nodes.length > 60 ? 0.012 : 0.0228);
    interacted.current = false;
    // Settle the layout before it is shown (no visible explosion or re-zooming on load):
    // run the physics to rest now — a few tens of ms for a graph this size — then fit once.
    s.stop();
    const steps = Math.min(400, Math.ceil(Math.log(s.alphaMin()) / Math.log(1 - s.alphaDecay())));
    s.tick(steps);
    requestAnimationFrame(() => fitRef.current());
    s.on('end.fit', () => { if (!interacted.current) fitRef.current(); });
    sim.current = s;
    return () => { s.stop(); };
    // Physics changes are applied in place below, without restarting the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links]);

  useEffect(() => {
    const s = sim.current; if (!s) return;
    const base = -Math.max(140, 45 * Math.sqrt(nodes.length));
    (s.force('charge') as ReturnType<typeof forceManyBody>).strength(base * phys.repulsion / 100);
    (s.force('link') as ReturnType<typeof forceLink>).distance(phys.linkDist);
    (s.force('collide') as ReturnType<typeof forceCollide>).radius((d) => radiusOf(d as GNode) + phys.pad);
    (s.force('x') as ReturnType<typeof forceX>).strength(phys.gravity / 100);
    (s.force('y') as ReturnType<typeof forceY>).strength(phys.gravity / 100);
    if (s.alpha() < 0.2) s.alpha(0.25);
    s.restart();
    // Only the physics fields move the layout; the highlight depth does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phys.repulsion, phys.linkDist, phys.pad, phys.gravity, nodes.length]);
  useEffect(() => { savePhys(phys); }, [phys]);

  // The latest selection state, read by the motion loop (declared before anything that reads it).
  const live = useRef<{ litSet: Set<string> | null; sel: Set<string> }>({ litSet: null, sel: new Set() });
  const at = (n: GNode, t = performance.now() / 1000) => {
    if (!Number.isFinite(n.x)) return { x: W / 2, y: H / 2 };
    // Pinned nodes, and faded ones while something is selected, hold still: a still
    // blurred layer costs the browser nothing per frame; a moving one is re-blurred.
    const cur = live.current;
    if (n.fx != null || (cur.litSet && !cur.litSet.has(n.id) && !cur.sel.has(n.id))) return { x: n.x!, y: n.y! };
    const ph = phaseOf(n.id);
    return { x: n.x! + Math.sin(t * 0.7 + ph) * 3.2, y: n.y! + Math.cos(t * 0.5 + ph * 1.4) * 4.4 };
  };

  const sel = new Set(selected);
  const L = links as unknown as { source: GNode; target: GNode }[];
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of L) {
      const a = l.source.id ?? (l.source as unknown as string), b = l.target.id ?? (l.target as unknown as string);
      (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
      (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a);
    }
    return m;
  }, [L]);
  const selNodes = selected.filter((i) => !i.includes(' > '));
  // Selected edges, as [from, to] node ids ("a > b").
  const selEdges = selected.filter((i) => i.includes(' > ')).map((i) => i.split(' > ') as [string, string]);
  const litSet = useMemo(() => {
    if (!selNodes.length && !selEdges.length) return null;
    // Everything within phys.hops links of a selected node stays lit (0 = only the selection).
    const seen = new Set(selNodes);
    let frontier = selNodes;
    for (let h = 0; h < phys.hops; h++) {
      const next: string[] = [];
      for (const id of frontier) for (const nb of neighbours.get(id) ?? []) if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
      frontier = next;
    }
    // A selected edge lights just its two ends, so the edge itself stands out.
    for (const [a, b] of selEdges) { seen.add(a); seen.add(b); }
    return seen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join('|'), phys.hops, neighbours]);
  const lit = (id: string) => !litSet || litSet.has(id);

  const toGraphXY = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    return { x: (px - view.x) / view.k, y: (py - view.y) / view.k, px, py };
  };
  const zoomBy = (f: number, px = W / 2, py = H / 2) => setView((vv) => { const k = Math.max(0.1, Math.min(4, vv.k * f)); return { k, x: px - ((px - vv.x) / vv.k) * k, y: py - ((py - vv.y) / vv.k) * k }; });
  const choose = (item: string, add: boolean) => {
    const items = add ? (sel.has(item) ? selected.filter((x) => x !== item) : [...selected, item]) : sel.has(item) && selected.length === 1 ? [] : [item];
    store.dispatch(items.length ? { type: 'select.set', payload: { view: v.id, items: items.join('|') } } : { type: 'select.clear', payload: {} }, 'you');
  };

  const edge = (l: { source: GNode; target: GNode }, i: number) => {
    const a = at(l.source), b = at(l.target);
    // Stop the line at the circle's edge so the arrow is visible (zega's outline).
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const x1 = a.x + ux * R, y1 = a.y + uy * R, x2 = b.x - ux * (R + 2), y2 = b.y - uy * (R + 2);
    const key = edgeKey(l.source.id, l.target.id), on = sel.has(key);
    const rel = (l as unknown as { rel?: string }).rel;
    return (
      <g key={`e${i}`} data-e={i} className="cursor-pointer" onPointerDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.stopPropagation(); choose(key, e.shiftKey); }}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? PALETTE[1] : EDGE} strokeWidth={on ? 2.5 : 1.4} markerEnd={`url(#arrow-${v.id})`} />
        {rel && L.length <= 100 && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 3} textAnchor="middle" fontSize={10} fill="#77777f" className="pointer-events-none">{rel}</text>}
      </g>
    );
  };
  const node = (n: GNode) => {
    const on = sel.has(n.id), p = at(n), r = radiusOf(n);
    const touched = !on && selected.some((i) => i.includes(' > ') && (i.startsWith(n.id + ' > ') || i.endsWith(' > ' + n.id)));
    return (
      <g key={n.id} data-n={n.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer"
        onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); const q = toGraphXY(e); drag.current = { kind: 'node', id: n.id, sx: q.px, sy: q.py, ox: 0, oy: 0, moved: false }; }}
        onClick={(e) => { e.stopPropagation(); if (!lastMoved.current) choose(n.id, e.shiftKey); }}>
        <title>{n.label}</title>
        {(on || touched) && <circle r={r + 5} fill="none" stroke={PALETTE[1]} strokeWidth={2.5} />}
        <circle r={r} fill={colorOf(n.type)} stroke="var(--border)" strokeWidth={on ? 2.5 : 1} />
        <text dy={r + 17} textAnchor="middle" className="fill-foreground pointer-events-none" style={{ fontSize: 11.5, fontWeight: on ? 600 : 400 }}>{n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}</text>
      </g>
    );
  };
  const edgeLit = (l: { source: GNode; target: GNode }) => !litSet || sel.has(edgeKey(l.source.id, l.target.id)) || (selNodes.length > 0 && lit(l.source.id) && lit(l.target.id));
  const nodeLit = (n: GNode) => sel.has(n.id) || lit(n.id);
  // zega's fade, drawn as ONE blurred layer under the lit one: one filter, not hundreds.
  const faded = useMemo(
    () => (litSet ? <g data-layer="faded" style={DIM}>{L.filter((l) => !edgeLit(l)).map(edge)}{nodes.filter((n) => !nodeLit(n)).map(node)}</g> : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [litSet, selected.join('|'), L, nodes],
  );

  // Motion without React (zega's approach): React builds the graph when data, selection,
  // zoom or settings change; this loop only writes positions, every frame. Faded elements
  // hold still once the layout is at rest, so the blurred layer is not re-blurred.
  live.current = { litSet, sel };
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const root = svg.current; if (!root) return;
      const t = performance.now() / 1000;
      const hot = !!sim.current && sim.current.alpha() > sim.current.alphaMin();
      const pos = new Map<string, { x: number; y: number }>();
      for (const n of nodes) pos.set(n.id, at(n, t));
      root.querySelectorAll<SVGGElement>(hot ? '[data-n]' : '[data-layer="lit"] [data-n]').forEach((g) => {
        const q = pos.get(g.dataset.n!); if (q) g.setAttribute('transform', `translate(${q.x},${q.y})`);
      });
      root.querySelectorAll<SVGGElement>(hot ? '[data-e]' : '[data-layer="lit"] [data-e]').forEach((g) => {
        const l = L[Number(g.dataset.e)]; if (!l) return;
        const a = pos.get(l.source.id), b = pos.get(l.target.id); if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
        const x1 = a.x + ux * R, y1 = a.y + uy * R, x2 = b.x - ux * (R + 2), y2 = b.y - uy * (R + 2);
        g.querySelectorAll('line').forEach((ln) => { ln.setAttribute('x1', String(x1)); ln.setAttribute('y1', String(y1)); ln.setAttribute('x2', String(x2)); ln.setAttribute('y2', String(y2)); });
        const tx = g.querySelector('text'); if (tx) { tx.setAttribute('x', String((x1 + x2) / 2)); tx.setAttribute('y', String((y1 + y2) / 2 - 3)); }
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, L]);

  return (
    <div className="grid gap-2">
      <div className="relative">
        <svg
          ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto rounded-lg bg-muted/30 touch-none select-none cursor-grab" role="img" aria-label="graph of movies and people"
          onWheel={(e) => { e.preventDefault(); interacted.current = true; const { px, py } = toGraphXY(e); zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, px, py); }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); const { px, py } = toGraphXY(e); drag.current = { kind: 'pan', sx: px, sy: py, ox: view.x, oy: view.y, moved: false }; }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d) return;
            const { x, y, px, py } = toGraphXY(e);
            if (Math.abs(px - d.sx) + Math.abs(py - d.sy) > 3) d.moved = true;
            if (d.moved) interacted.current = true;
            if (d.kind === 'pan') setView((vv) => ({ ...vv, x: d.ox + px - d.sx, y: d.oy + py - d.sy }));
            else { const n = nodes.find((nn) => nn.id === d.id); if (n) { n.fx = x; n.fy = y; sim.current?.alphaTarget(0.25).restart(); } }
          }}
          onPointerUp={() => {
            const d = drag.current; drag.current = null; lastMoved.current = !!d?.moved;
            if (d?.kind === 'node') { const n = nodes.find((nn) => nn.id === d.id); if (n) { n.fx = null; n.fy = null; } sim.current?.alphaTarget(0); }
            else if (d && !d.moved && selected.length) store.dispatch({ type: 'select.clear', payload: {} }, 'you');
          }}
        >
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            <defs><marker id={`arrow-${v.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE} /></marker></defs>
            {faded}
            <g data-layer="lit">{L.filter(edgeLit).map(edge)}{nodes.filter(nodeLit).map(node)}</g>
          </g>
        </svg>
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <button type="button" title="layout settings" aria-expanded={panel} onClick={() => setPanel((o) => !o)} className="size-7 rounded-md border bg-background/90 text-sm text-foreground">⚙</button>
          <button type="button" title="fit the graph" onClick={() => { interacted.current = false; fit(); }} className="size-7 rounded-md border bg-background/90 text-xs text-foreground">⤢</button>
          <button type="button" title="zoom in" onClick={() => { interacted.current = true; zoomBy(1.12); }} className="size-7 rounded-md border bg-background/90 text-sm text-foreground">+</button>
          <button type="button" title="zoom out" onClick={() => { interacted.current = true; zoomBy(1 / 1.12); }} className="size-7 rounded-md border bg-background/90 text-sm text-foreground">−</button>
        </div>
        <SelectionOverlay selected={selected} store={store} />
        {panel && (
          <div className="absolute right-11 top-2 w-60 rounded-lg border bg-background/95 p-3 shadow-sm grid gap-2 text-xs text-foreground" role="group" aria-label="Layout physics">
            {PHYS_ROWS.map((row) => (
              <label key={row.key} className="grid grid-cols-[88px_minmax(0,1fr)_36px] items-center gap-2">
                <span className="text-muted-foreground">{row.label}</span>
                <input type="range" min={row.min} max={row.max} step={row.step} value={phys[row.key]} onChange={(e) => setPhys((p) => ({ ...p, [row.key]: Number(e.target.value) }))} />
                <b className="text-right tabular-nums font-medium">{phys[row.key]}{row.unit}</b>
              </label>
            ))}
            <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 border-t pt-2" role="group" aria-label="Highlight depth">
              <span className="text-muted-foreground">Highlight depth</span>
              <span className="inline-flex rounded-md border overflow-hidden justify-self-start">
                {[0, 1, 2, 3].map((h) => (
                  <button key={h} type="button" aria-pressed={phys.hops === h} title={h === 0 ? 'only the selected nodes' : `${h} hop${h > 1 ? 's' : ''} around the selection`}
                    onClick={() => setPhys((p) => ({ ...p, hops: h }))}
                    className={cn('px-2.5 py-0.5 text-xs', h > 0 && 'border-l', phys.hops === h ? 'bg-foreground text-background' : 'text-foreground')}>{h}</button>
                ))}
              </span>
            </div>
            <button type="button" className="justify-self-end underline text-muted-foreground" onClick={() => setPhys({ ...PHYS_DEFAULTS })}>reset</button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Click a node or edge to select it and fade the rest · shift-click to add · click the background to clear · the agent sees the selection (bottom left) · drag to move · scroll or +/− to zoom · ⤢ fit · ⚙ layout. The agent can see what you select.</p>
    </div>
  );
}

/** One broken view must never take the page down: it shows its own error instead. */
class ViewBoundary extends Component<{ children: ReactNode; title: string }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(e: unknown) { return { error: String(e instanceof Error ? e.message : e) }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <Card className="min-w-0"><CardHeader><CardTitle>{this.props.title}</CardTitle><CardDescription className="text-destructive">This view failed to draw: {this.state.error}</CardDescription></CardHeader></Card>;
  }
}

function ViewCard({ v, store, selected }: { v: View; store: MoviesStore; selected: string[] }) {
  const { rows, ms, error } = useMemo(() => {
    const t = performance.now();
    try { return { rows: getZega()?.run(v.query) ?? [], ms: performance.now() - t, error: '' }; }
    catch (e) { return { rows: [], ms: 0, error: String(e) }; }
  }, [v.query]);
  return (
    <Card className="gap-3 min-w-0">
      <CardHeader>
        <CardTitle>{v.title}</CardTitle>
        <CardDescription className="font-mono text-[11px] truncate" title={v.query}>{v.kind} · {rows.length} rows · zega {ms.toFixed(1)} ms</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? <p className="text-sm text-destructive">{error}</p>
          : v.kind === 'bar' ? <BarView v={v} rows={rows} store={store} selected={selected} />
          : v.kind === 'pie' ? <PieView v={v} rows={rows} />
          : v.kind === 'table' ? <TableView rows={rows} />
          : <GraphView rows={rows} v={v} store={store} selected={selected} />}
      </CardContent>
    </Card>
  );
}

export function MoviesView({ store }: { store: MoviesStore }) {
  const state = useRixseState(store);
  const [status, setStatus] = useState('loading zega…');
  const [dark, setDark] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { loadZega().then((z) => { const n = (q: string) => z.run(q).length.toLocaleString('en-US'); setStatus(`zega loaded in ${z.loadMs} ms · ${n('{ Movie limit 100000 { qid } }')} movies · ${n('{ Person limit 100000 { qid } }')} people`); }).catch((e) => setStatus(`zega failed: ${e}`)); }, []);
  useEffect(() => { const m = matchMedia('(prefers-color-scheme: dark)'); setDark(m.matches); const on = (e: MediaQueryListEvent) => setDark(e.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [state.order.length]);
  return (
    <section className="pane canvas" aria-label="Movies">
      <div className="pane-head">
        <h2 className="pane-title">Movies</h2>
        <span className="soft">{status} · views: bar, pie, table, graph</span>
      </div>
      <div className="screen-scroll" ref={scroller}>
        <div className={cn('ui-screen bg-background text-foreground', dark && 'dark')}>
          {state.order.length === 0
            ? <p className="text-sm text-muted-foreground">Ask about movies, e.g. “top 10 movies by box office”, “box office by genre”, “movies Tom Hanks and Meg Ryan are both in”, “Christopher Nolan’s films”.</p>
            : <div className="grid gap-4 lg:grid-cols-2">{state.order.map((id) => <div key={id} className={cn('min-w-0', state.views[id]!.size === 'full' && 'lg:col-span-2')}><ViewBoundary key={`${id}:${state.views[id]!.query}:${state.views[id]!.kind}`} title={state.views[id]!.title}><ViewCard v={state.views[id]!} store={store} selected={state.selection?.view === id ? state.selection.items : []} /></ViewBoundary></div>)}</div>}
        </div>
      </div>
    </section>
  );
}

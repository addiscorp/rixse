'use client';
// view(state) for the movies vocabulary. Each view runs its own ZQL in zega (in
// this page) and draws the rows. The layout places views on a grid; the agent
// never positions anything.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force';
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

function BarView({ v, rows }: { v: View; rows: unknown[] }) {
  const { data, hidden } = capped(series(rows, v), 'bar');
  const isMoney = /gross/.test(v.value);
  const config = { value: { label: v.value || 'value', color: PALETTE[0] } } satisfies ChartConfig;
  return (
    <>
    <ChartContainer config={config} className="w-full" style={{ height: Math.max(180, data.length * 30 + 20) }}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid horizontal={false} />
        <YAxis dataKey="label" type="category" width={170} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} interval={0} />
        <XAxis type="number" tickFormatter={(n: number) => fmt(n, isMoney)} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent formatter={(val) => fmt(Number(val), isMoney)} />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={4} />
      </BarChart>
    </ChartContainer>
    {hidden > 0 && <p className="text-xs text-muted-foreground mt-2">Showing the first {data.length} of {data.length + hidden}. Ask for a limit to change it.</p>}
  </>
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
  const links: { source: string; target: string }[] = [];
  const visit = (o: unknown, parent: string | null) => {
    if (!o || typeof o !== 'object') return;
    const r = o as Record<string, unknown>;
    const label = String(r.title ?? r.name ?? '');
    let id = parent;
    if (label) {
      const type = r.title !== undefined ? 'movie' : r.name !== undefined ? 'person' : 'other';
      id = `${type}:${label}`;
      if (!nodes.has(id)) nodes.set(id, { id, label, type, degree: 0 });
      if (parent && parent !== id) { links.push({ source: parent, target: id }); nodes.get(parent)!.degree++; nodes.get(id)!.degree++; }
    }
    for (const v of Object.values(r)) if (Array.isArray(v)) v.forEach((x) => visit(x, id));
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

function GraphView({ rows }: { rows: unknown[] }) {
  const { nodes, links } = useMemo(() => toGraph(rows), [rows]);
  const [, tick] = useState(0);
  const W = 720, H = 460;
  useEffect(() => {
    const sim = forceSimulation(nodes)
      .force('link', forceLink(links as { source: string; target: string }[]).id((d) => (d as GNode).id).distance(60))
      .force('charge', forceManyBody().strength(-220))
      .force('collide', forceCollide(18))
      .force('center', forceCenter(W / 2, H / 2))
      .on('tick', () => tick((n) => n + 1));
    return () => { sim.stop(); };
  }, [nodes, links]);
  const clamp = (v: number | undefined, max: number) => Math.max(12, Math.min(max - 12, v ?? max / 2));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-lg bg-muted/30" role="img" aria-label="graph of movies and people">
      {(links as unknown as { source: GNode; target: GNode }[]).map((l, i) => <line key={i} x1={clamp(l.source.x, W)} y1={clamp(l.source.y, H)} x2={clamp(l.target.x, W)} y2={clamp(l.target.y, H)} className="stroke-muted-foreground/40" strokeWidth={1} />)}
      {nodes.map((n) => (
        <g key={n.id} transform={`translate(${clamp(n.x, W)},${clamp(n.y, H)})`}>
          <circle r={n.type === 'movie' ? 9 : 5 + Math.min(4, n.degree)} fill={n.type === 'movie' ? PALETTE[0] : PALETTE[1]} />
          {(n.type === 'movie' || n.degree > 1) && <text y={-12} textAnchor="middle" className="fill-foreground" style={{ fontSize: 10 }}>{n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label}</text>}
        </g>
      ))}
    </svg>
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

function ViewCard({ v }: { v: View }) {
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
          : v.kind === 'bar' ? <BarView v={v} rows={rows} />
          : v.kind === 'pie' ? <PieView v={v} rows={rows} />
          : v.kind === 'table' ? <TableView rows={rows} />
          : <GraphView rows={rows} />}
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
            : <div className="grid gap-4 lg:grid-cols-2">{state.order.map((id) => <ViewBoundary key={`${id}:${state.views[id]!.query}:${state.views[id]!.kind}`} title={state.views[id]!.title}><ViewCard v={state.views[id]!} /></ViewBoundary>)}</div>}
        </div>
      </div>
    </section>
  );
}

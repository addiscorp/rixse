'use client';
// view(state) for the UI vocabulary: each node kind is a shadcn/ui component,
// and layout intent becomes flexbox or grid. The browser does all placement —
// rixse state holds no coordinates. SwiftUI would map the same tree to
// VStack/HStack/LazyVGrid; Ink to <Box flexDirection>.
import { useEffect, useState, type ReactNode } from 'react';
import { icons, CircleHelp } from 'lucide-react';
import { useRixseState } from 'rixse-react';
import { ROOT, type UiNode, type UiStore } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

const GAP = { none: 'gap-0', sm: 'gap-2', md: 'gap-4', lg: 'gap-6' } as const;
const ALIGN = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' } as const;
const JUSTIFY = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' } as const;

/** Layout intent → classes. Empty means the platform default (a column, top to bottom). */
function layout(n: UiNode, grid = false) {
  if (grid) return cn('grid', GAP[n.gap || 'md'], ALIGN[n.align || 'stretch']);
  return cn('flex', n.dir === 'row' ? 'flex-row flex-wrap' : 'flex-col', GAP[n.gap || 'md'], n.align && ALIGN[n.align], n.justify && JUSTIFY[n.justify]);
}

const pascal = (name: string) => name.replace(/(^|[-_ ])(\w)/g, (_, __, c: string) => c.toUpperCase());
function Icon({ name }: { name: string }) {
  const I = (icons as Record<string, typeof CircleHelp>)[pascal(name.trim().toLowerCase())] ?? CircleHelp;
  return <I className="size-5 text-foreground" aria-label={name} />;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <Skeleton className="h-16 w-full" />;
  const max = Math.max(...values), min = Math.min(...values), w = 240, h = 64;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / (max - min || 1)) * (h - 8)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none" aria-label="chart">
      <path d={`${d} L${w} ${h} L0 ${h} Z`} className="fill-primary/10" />
      <path d={d} className="stroke-primary" fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Leaf({ n }: { n: UiNode }) {
  const parts = n.text.split('|').map((x) => x.trim());
  switch (n.kind) {
    case 'heading': {
      const size = n.variant === 'h1' ? 'text-3xl' : n.variant === 'h3' ? 'text-lg' : 'text-2xl';
      return <h2 className={cn('font-semibold tracking-tight text-foreground', size)}>{n.text}</h2>;
    }
    case 'text': return <p className="text-sm text-muted-foreground leading-relaxed">{n.text}</p>;
    case 'button': return <Button variant={(['default', 'secondary', 'outline', 'ghost', 'destructive'].includes(n.variant) ? n.variant : 'default') as 'default'}>{n.text || 'Button'}</Button>;
    case 'badge': return <Badge variant={(['default', 'secondary', 'outline', 'destructive'].includes(n.variant) ? n.variant : 'secondary') as 'default'}>{n.text}</Badge>;
    case 'input': return <Input placeholder={n.text} />;
    case 'switch': return <label className="flex items-center gap-2 text-sm text-foreground"><Switch />{n.text}</label>;
    case 'avatar': return <Avatar><AvatarFallback>{n.text.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'}</AvatarFallback></Avatar>;
    case 'separator': return <Separator />;
    case 'progress': return <Progress value={Math.max(0, Math.min(100, Number(n.text) || 0))} />;
    case 'skeleton': return <Skeleton className="h-6 w-full" />;
    case 'icon': return <Icon name={n.text || 'circle-help'} />;
    case 'image': return <div className="aspect-[4/3] w-full rounded-lg border bg-muted grid place-items-center text-xs text-muted-foreground">{n.text || 'image'}</div>;
    case 'alert': return <Alert variant={n.variant === 'destructive' ? 'destructive' : 'default'}><AlertTitle>{parts[0]}</AlertTitle>{parts[1] && <AlertDescription>{parts[1]}</AlertDescription>}</Alert>;
    case 'list': return <ul className="list-disc pl-5 text-sm text-foreground space-y-1">{parts.filter(Boolean).map((x, i) => <li key={i}>{x}</li>)}</ul>;
    case 'chart': return <Sparkline values={n.text.split(',').map(Number).filter((v) => Number.isFinite(v))} />;
    case 'metric': return (
      <div className="grid gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{parts[0]}</span>
        <span className="text-2xl font-semibold tabular-nums text-foreground">{parts[1]}</span>
        {parts[2] && <span className={cn('text-xs font-medium', n.variant === 'down' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400')}>{parts[2]}</span>}
      </div>
    );
    case 'table': {
      const rows = n.text.split(';').map((r) => r.split(',').map((c) => c.trim()));
      const [head, ...body] = rows;
      return (
        <Table>
          <TableHeader><TableRow>{(head ?? []).map((h, i) => <TableHead key={i}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{body.map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j}>{c}</TableCell>)}</TableRow>)}</TableBody>
        </Table>
      );
    }
    default: return null;
  }
}

function NodeView({ id, nodes, selected, onSelect, agentMade }: { id: string; nodes: Record<string, UiNode>; selected: string | null; onSelect: (id: string) => void; agentMade: Set<string> }) {
  const n = nodes[id];
  if (!n) return null;
  const kids = n.children.map((c) => <NodeView key={c} id={c} nodes={nodes} selected={selected} onSelect={onSelect} agentMade={agentMade} />);
  let body: ReactNode;
  if (n.kind === 'grid') body = <div className={layout(n, true)} style={{ gridTemplateColumns: `repeat(${n.cols || 2}, minmax(0, 1fr))` }}>{kids}</div>;
  else if (n.kind === 'card') body = (
    <Card className="gap-4">
      {n.text && <CardHeader><CardTitle>{n.text}</CardTitle></CardHeader>}
      <CardContent className={layout(n)}>{kids}</CardContent>
    </Card>
  );
  else if (n.kind === 'stack' || n.kind === 'screen') body = <div className={layout(n)}>{kids}</div>;
  else body = <Leaf n={n} />;
  if (n.kind === 'screen') return body;
  return (
    <div
      data-node={id}
      className={cn('rx-node min-w-0', n.grow && 'flex-1 [&>*]:w-full', selected === id && 'rx-selected', agentMade.has(id) && 'rx-agent')}
      onClick={(e) => { e.stopPropagation(); onSelect(id); }}
      title={`${id} · ${n.kind}`}
    >
      {body}
    </div>
  );
}

export function UiView({ store }: { store: UiStore }) {
  const state = useRixseState(store);
  const [selected, setSelected] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    setDark(m.matches);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const agentMade = new Set(store.log.filter((e) => !e.undone && e.author === 'agent' && e.type === 'ui.add').map((e) => (e.payload as { id: string }).id));
  const count = Object.keys(state.nodes).length - 1;
  const sel = selected && state.nodes[selected] ? state.nodes[selected] : null;
  const move = (delta: number) => {
    if (!sel?.parent) return;
    const siblings = state.nodes[sel.parent]!.children;
    store.dispatch({ type: 'ui.move', payload: { id: sel.id, parent: sel.parent, index: siblings.indexOf(sel.id) + delta } }, 'you');
  };

  return (
    <section className="pane canvas" aria-label="App screen">
      <div className="pane-head">
        <h2 className="pane-title">Screen</h2>
        <span className="soft">{count} nodes · shadcn/ui · layout by the browser · click to select</span>
        {sel && (
          <span className="sel-tools">
            <span className="mono soft">{sel.id}</span>
            <button type="button" onClick={() => move(-1)} aria-label="Move up">↑</button>
            <button type="button" onClick={() => move(1)} aria-label="Move down">↓</button>
            <button type="button" onClick={() => { store.dispatch({ type: 'ui.remove', payload: { id: sel.id } }, 'you'); setSelected(null); }}>Remove</button>
          </span>
        )}
      </div>
      <div className="screen-scroll" onClick={() => setSelected(null)}>
        <div className={cn('ui-screen bg-background text-foreground', dark && 'dark')}>
          {count === 0
            ? <p className="text-sm text-muted-foreground">An empty screen. Ask the agent for one, e.g. “a store product page with a cart icon in the top right”.</p>
            : <NodeView id={ROOT} nodes={state.nodes} selected={selected} onSelect={setSelected} agentMade={agentMade} />}
        </div>
      </div>
    </section>
  );
}

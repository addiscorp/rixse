'use client';
// The library's output: every applied, rejected and undone action, plus the
// agent's round trips. Undo walks back the latest action, whoever made it.
import { useEffect, useRef } from 'react';
import { useRixseEvents } from 'rixse-react';
import type { Store } from 'rixse/ui';

export type Note = { at: number; order: number; kind: 'agent' | 'error'; text: string };

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });
const short = (v: unknown) => { const s = JSON.stringify(v ?? {}); return s.length > 140 ? s.slice(0, 139) + '…' : s; };

export function Logs({ store, notes }: { store: Store<any>; notes: Note[] }) {
  const events = useRixseEvents(store);
  const end = useRef<HTMLDivElement>(null);
  const rows = [
    ...events.map((e) => ({ at: e.at, order: e.order, key: `e${e.at}-${e.kind}-${'entry' in e ? e.entry.seq : ''}`, e })),
    ...notes.map((n, i) => ({ at: n.at, order: n.order, key: `n${n.at}-${i}`, n })),
  ].sort((a, b) => a.order - b.order);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [rows.length]);
  const canUndo = store.log.some((e) => !e.undone);

  return (
    <section className="pane logs" aria-label="Logs">
      <div className="pane-head">
        <h2 className="pane-title">Logs</h2>
        <span className="soft">{store.log.filter((e) => !e.undone).length} actions in effect</span>
        <button type="button" onClick={() => store.undo()} disabled={!canUndo}>Undo</button>
      </div>
      <div className="log mono" role="log">
        {rows.length === 0 && <div className="row soft">Nothing yet. Every action — yours or the agent's — prints here.</div>}
        {rows.map((r) => {
          if ('n' in r && r.n) return <div key={r.key} className={`row note ${r.n.kind}`}><span className="t">{time(r.at)}</span><span className="who">{r.n.kind === 'error' ? 'error' : 'agent'}</span><span className="what">{r.n.text}</span></div>;
          const e = (r as { e: (typeof events)[number] }).e;
          if (e.kind === 'rejected') return <div key={r.key} className="row rejected"><span className="t">{time(r.at)}</span><span className={`who ${e.author}`}>{e.author}</span><span className="what">✕ {e.action?.type} {short(e.action?.payload)} — {e.error}</span></div>;
          const verb = e.kind === 'undone' ? '↶ undo' : `#${e.entry.seq}`;
          return <div key={r.key} className={`row ${e.kind}`}><span className="t">{time(r.at)}</span><span className={`who ${e.entry.author}`}>{e.kind === 'undone' ? 'you' : e.entry.author}</span><span className="what">{verb} {e.entry.type} {short(e.entry.payload)}</span></div>;
        })}
        <div ref={end} />
      </div>
    </section>
  );
}

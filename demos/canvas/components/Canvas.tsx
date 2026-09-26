'use client';
// view(state). Your edits go through store.dispatch as author "you" — the same
// door the agent uses. Drag a card to move it; double-click empty space to add one.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useRixseState } from 'rixse-react';
import { HEIGHT, WIDTH, type CanvasStore } from '@/lib/canvas';

const CARD_W = 220;

export function Canvas({ store }: { store: CanvasStore }) {
  const state = useRixseState(store);
  const board = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // Fit the whole board in the pane: the agent places cards on a fixed 1200×800 board.
  useEffect(() => {
    const el = board.current!;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 16) / WIDTH, (el.clientHeight - 16) / HEIGHT));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);
  const agentMade = new Set(store.log.filter((e) => !e.undone && e.author === 'agent' && e.type === 'card.add').map((e) => (e.payload as { id: string }).id));

  const point = (e: PointerEvent) => {
    const r = board.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - 8) / scale, y: (e.clientY - r.top - 8) / scale };
  };
  const cards = Object.values(state.cards).map((c) => (drag?.id === c.id ? { ...c, x: drag.x, y: drag.y } : c));
  const at = Object.fromEntries(cards.map((c) => [c.id, c]));

  return (
    <section className="pane canvas" aria-label="Canvas">
      <div className="pane-head">
        <h2 className="pane-title">Canvas</h2>
        <span className="soft">{cards.length} cards · {state.links.length} arrows · drag to move · double-click to add · {Math.round(scale * 100)}%</span>
      </div>
      <div className="board-scroll" ref={board}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('board')) return;
          const p = point(e as unknown as PointerEvent);
          const id = `card-${Date.now().toString(36)}`;
          store.dispatch({ type: 'card.add', payload: { id, title: 'New card', x: p.x - CARD_W / 2, y: p.y - 30 } }, 'you');
        }}>
        <div className="board" style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})` }}>
          <svg className="links" width={WIDTH} height={HEIGHT} aria-hidden="true">
            <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" /></marker></defs>
            {state.links.map((l) => {
              const a = at[l.from], b = at[l.to];
              if (!a || !b) return null;
              const x1 = a.x + CARD_W, y1 = a.y + 36, x2 = b.x, y2 = b.y + 36;
              const back = x2 < x1;
              const d = back ? `M${a.x + CARD_W / 2} ${a.y + 72} C ${a.x + CARD_W / 2} ${a.y + 140}, ${b.x + CARD_W / 2} ${b.y - 60}, ${b.x + CARD_W / 2} ${b.y}` : `M${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`;
              return (
                <g key={`${l.from}>${l.to}`}>
                  <path d={d} markerEnd="url(#arrow)" />
                  {l.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle">{l.label}</text>}
                </g>
              );
            })}
          </svg>
          {cards.map((c) => (
            <article key={c.id} className={`card tone-${c.tone}${agentMade.has(c.id) ? ' by-agent' : ''}${drag?.id === c.id ? ' dragging' : ''}`}
              style={{ left: c.x, top: c.y, width: CARD_W }}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const p = point(e);
                setDrag({ id: c.id, dx: p.x - c.x, dy: p.y - c.y, x: c.x, y: c.y });
              }}
              onPointerMove={(e) => { if (drag?.id === c.id) { const p = point(e); setDrag({ ...drag, x: p.x - drag.dx, y: p.y - drag.dy }); } }}
              onPointerUp={() => {
                if (drag?.id !== c.id) return;
                const moved = Math.abs(drag.x - store.state.cards[c.id]!.x) + Math.abs(drag.y - store.state.cards[c.id]!.y) > 2;
                setDrag(null);
                if (moved) store.dispatch({ type: 'card.move', payload: { id: c.id, x: Math.round(drag.x), y: Math.round(drag.y) } }, 'you');
              }}>
              <header>
                <strong>{c.title}</strong>
                <button type="button" aria-label={`Remove ${c.title}`} onClick={() => store.dispatch({ type: 'card.remove', payload: { id: c.id } }, 'you')}>×</button>
              </header>
              {c.body && <p>{c.body}</p>}
              <small className="mono">{c.id}{agentMade.has(c.id) ? ' · by agent' : ''}</small>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

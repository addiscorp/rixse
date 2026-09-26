'use client';
// Chat is conversation. The agent's work lands on the canvas, not here.
import { useRef, useState, type FormEvent } from 'react';
import type { CanvasStore } from '@/lib/canvas';
import type { Note } from './Logs';

type Turn = { role: 'user' | 'assistant'; content: string };
type Proposal = { say: string; actions: { type: string; payload?: unknown }[]; ms: number; model: string; parseError?: boolean; error?: string };

export function Chat({ store, note }: { store: CanvasStore; note: (n: Omit<Note, 'at' | 'order'>) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const rejections = useRef<string[]>([]);
  const end = useRef<HTMLDivElement>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setDraft('');
    setBusy(true);
    const history = turns;
    setTurns([...history, { role: 'user', content: message }]);
    note({ kind: 'agent', text: `→ model: message + state (${Object.keys(store.state.cards).length} cards) + vocabulary` });
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, history, state: store.state, vocabulary: store.vocabulary(), rejections: rejections.current }),
      });
      const p = (await res.json()) as Proposal;
      if (!res.ok || p.error) throw new Error(p.error ?? `HTTP ${res.status}`);
      note({ kind: 'agent', text: `← proposal: ${p.actions.length} action${p.actions.length === 1 ? '' : 's'} in ${p.ms} ms${p.parseError ? ' (reply was not JSON)' : ''}` });
      const results = store.applyProposal(p.actions, message);
      rejections.current = results.filter((r) => !r.result.ok).map((r) => `${r.action.type} ${JSON.stringify(r.action.payload ?? {})}: ${(r.result as { error: string }).error}`);
      setTurns((t) => [...t, { role: 'assistant', content: p.say || '(done)' }]);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      note({ kind: 'error', text });
      setTurns((t) => [...t, { role: 'assistant', content: `Couldn't reach the agent: ${text}` }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'end' }));
    }
  }

  return (
    <section className="pane chat" aria-label="Chat">
      <h2 className="pane-title">Chat</h2>
      <div className="turns">
        {turns.length === 0 && <p className="hint">Ask for something on the canvas, e.g. “sketch a signup funnel with 4 steps and mark where people drop”.</p>}
        {turns.map((t, i) => <div key={i} className={`msg ${t.role === 'user' ? 'you' : 'agent'}`}>{t.content}</div>)}
        {busy && <div className="msg agent pending">thinking…</div>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={send}>
        <textarea id="chat-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the agent" rows={2}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <button type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </section>
  );
}

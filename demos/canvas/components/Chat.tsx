'use client';
// Chat is conversation. The agent's work lands on the canvas, not here.
import { useRef, useState, type FormEvent } from 'react';
import type { Store, Wire } from 'rixse';
import type { Note } from './Logs';

type Turn = { role: 'user' | 'assistant'; content: string; footnote?: string };
type Timing = { readBody: number; buildPrompt: number; model: number; parse: number; server: number };
type Proposal = { timing?: Timing; say: string; actions: { type: string; payload?: unknown }[]; ms: number; model: string; usage?: { input: number; output: number }; parseError?: boolean; error?: string };
type Format = 'wire' | 'json';
type Model = 'gemma' | 'opus';
const fmt = (n: number) => n.toLocaleString('en-US');

export function Chat<S>({ store, wire, brief, describe, note, hint }: { store: Store<S>; wire: Wire<S>; brief: string; describe: (state: S) => string; hint: string; note: (n: Omit<Note, 'at' | 'order'>) => void }) {
  const [format, setFormat] = useState<Format>('wire');
  const [model, setModel] = useState<Model>('gemma');
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
    const history = turns.map((t) => ({ role: t.role, content: t.footnote ? `${t.content}\n(${t.footnote})` : t.content }));
    setTurns([...history, { role: 'user', content: message }]);
    const t0 = performance.now();
    const wireText = wire.encode(store.state);
    const jsonText = JSON.stringify(store.state);
    const context = format === 'wire' ? wireText : jsonText;
    note({ kind: 'agent', text: `→ ${model === 'opus' ? 'Opus 5.5' : 'Gemma 4'} · ${format} context ${fmt(context.length)} chars (${format === 'wire' ? `JSON would be ${fmt(jsonText.length)}` : `wire would be ${fmt(wireText.length)}`}) · ${describe(store.state)}` });
    try {
      const tContext = performance.now();
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief, message, history, context, format, legend: wire.legend(), model, vocabulary: store.vocabulary(), rejections: rejections.current }),
      });
      const p = (await res.json()) as Proposal;
      const tResponse = performance.now();
      if (!res.ok || p.error) throw new Error(p.error ?? `HTTP ${res.status}`);
      note({ kind: 'agent', text: `← ${p.model}: ${p.actions.length} action${p.actions.length === 1 ? '' : 's'} · ${p.usage ? `${fmt(p.usage.input)} in / ${fmt(p.usage.output)} out tokens · ` : ''}${fmt(p.ms)} ms${p.parseError ? ' · reply was not JSON' : ''}` });
      // The model refers to items by wire handle; translate back to real ids before dispatch.
      const actions = format === 'wire' ? p.actions.map((a) => wire.resolve(a, store.params(a.type))) : p.actions;
      const results = store.applyProposal(actions, message);
      const tApplied = performance.now();
      rejections.current = results.filter((r) => !r.result.ok).map((r) => `${r.action.type} ${JSON.stringify(r.action.payload ?? {})}: ${(r.result as { error: string }).error}`);
      // The reply was written before rixse applied anything: say plainly what did not land.
      const failed = results.filter((r) => !r.result.ok).length;
      const footnote = failed ? `${failed} of ${results.length} change${results.length === 1 ? '' : 's'} didn't apply — see the logs.` : undefined;
      setTurns((t) => [...t, { role: 'assistant', content: p.say || '(done)', footnote }]);
      // Time to first paint of the result: two frames after React commits.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const tPaint = performance.now();
        const r = (a: number, b: number) => fmt(Math.round(b - a));
        const tm = p.timing;
        const overhead = tm ? Math.round(tResponse - tContext) - tm.model : 0;
        const rate = p.usage && tm && tm.model > 0 ? Math.round((p.usage.output / tm.model) * 1000) : 0;
        note({ kind: 'agent', text: `⏱ ${r(t0, tPaint)} ms = context ${r(t0, tContext)} · model ${tm ? fmt(tm.model) : '?'}${p.usage ? ` (${fmt(p.usage.output)} out tok, ${rate} tok/s)` : ''} · network+server ${fmt(overhead)} · apply ${r(tResponse, tApplied)} · paint ${r(tApplied, tPaint)}` });
      }));
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
      <div className="pane-head">
        <h2 className="pane-title">Chat</h2>
        <span className="soft" />
        <div className="seg" role="group" aria-label="Model">
          {(['gemma', 'opus'] as const).map((m) => <button key={m} type="button" aria-pressed={model === m} onClick={() => setModel(m)}>{m === 'gemma' ? 'Gemma 4' : 'Opus 5.5'}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Context format">
          {(['wire', 'json'] as const).map((f) => <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)}>{f}</button>)}
        </div>
      </div>
      <div className="turns">
        {turns.length === 0 && <p className="hint">{hint}</p>}
        {turns.map((t, i) => <div key={i} className={`msg ${t.role === 'user' ? 'you' : 'agent'}`}>{t.content}{t.footnote && <small className="footnote">{t.footnote}</small>}</div>)}
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

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
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      // Streamed: the reply and each action arrive as their own lines, and each
      // action is applied the moment it arrives.
      let say = '', tFirstAction = 0, tSay = 0, applyMs = 0;
      let done: { model?: string; usage?: { input: number; output: number }; timing?: Timing & { firstToken: number | null } } | null = null;
      const results: { ok: boolean; line: string }[] = [];
      setTurns((t) => [...t, { role: 'assistant', content: '…' }]);
      const show = (content: string, footnote?: string) => setTurns((t) => [...t.slice(0, -1), { role: 'assistant', content, footnote }]);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let pending = '';
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        pending += dec.decode(value, { stream: true });
        let i;
        while ((i = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, i); pending = pending.slice(i + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { kind: string; say?: string; action?: { type: string; payload?: unknown }; error?: string; model?: string; usage?: { input: number; output: number }; timing?: Timing & { firstToken: number | null } };
          if (ev.kind === 'say' && ev.say) { say = ev.say; if (!tSay) tSay = performance.now(); show(say); }
          else if (ev.kind === 'action' && ev.action) {
            if (!tFirstAction) tFirstAction = performance.now();
            const a0 = performance.now();
            // The model refers to items by wire handle; translate back to real ids before dispatch.
            const a = format === 'wire' ? wire.resolve(ev.action, store.params(ev.action.type)) : ev.action;
            const r = store.dispatch(a, 'agent', { why: message });
            applyMs += performance.now() - a0;
            results.push({ ok: r.ok, line: r.ok ? '' : `${a.type} ${JSON.stringify(a.payload ?? {})}: ${(r as { error: string }).error}` });
          } else if (ev.kind === 'error') throw new Error(ev.error);
          else if (ev.kind === 'done') done = ev;
        }
      }
      const tEnd = performance.now();
      rejections.current = results.filter((r) => !r.ok).map((r) => r.line);
      const failed = results.filter((r) => !r.ok).length;
      // The reply was written before rixse applied anything: say plainly what did not land.
      show(say || '(done)', failed ? `${failed} of ${results.length} change${results.length === 1 ? '' : 's'} didn't apply — see the logs.` : undefined);
      const tm = done?.timing, u = done?.usage;
      note({ kind: 'agent', text: `← ${done?.model ?? model}: ${results.length} action${results.length === 1 ? '' : 's'}${u ? ` · ${fmt(u.input)} in / ${fmt(u.output)} out tokens` : ''}` });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const tPaint = performance.now();
        const r = (a: number, b: number) => fmt(Math.round(b - a));
        const rate = u && tm && tm.model > 0 ? Math.round((u.output / tm.model) * 1000) : 0;
        note({ kind: 'agent', text: `⏱ first action ${tFirstAction ? r(t0, tFirstAction) : '—'} ms · reply ${tSay ? r(t0, tSay) : '—'} ms · all done ${r(t0, tPaint)} ms = context ${r(t0, tContext)} · model first token ${tm?.firstToken ?? '?'} / total ${tm ? fmt(tm.model) : '?'}${u ? ` (${fmt(u.output)} out tok, ${rate} tok/s)` : ''} · apply ${fmt(Math.round(applyMs))} · last paint ${r(tEnd, tPaint)}` });
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

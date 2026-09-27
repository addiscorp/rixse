// The agent: one model call per chat message. It is sent the vocabulary, the
// current state and the conversation, and answers with a proposal — a chat
// reply and a list of actions. It never touches state; the client's rixse
// store applies (or rejects) each action. Same model and call shape as
// zega.earth (zegadb/earth lib/ask.ts).
import { getCloudflareContext } from '@opennextjs/cloudflare';

const MODELS = {
  gemma: { label: 'Gemma 4 26B', id: '@cf/google/gemma-4-26b-a4b-it' },
  oss: { label: 'gpt-oss 20B (low effort)', id: '@cf/openai/gpt-oss-20b' },
  opus: { label: 'Opus 5.5', id: 'claude-opus-5-5' },
} as const;
type ModelKey = keyof typeof MODELS;
// Local demo only: Opus goes through Ava's capped proxy, so no Anthropic key is ever in this app.
const ANTHROPIC_PROXY = 'http://127.0.0.1:8977/anthropic/v1/messages';
const HISTORY_MAX = 8;
const STATE_MAX = 20_000;

type Turn = { role: 'user' | 'assistant'; content: string };
type Body = { brief?: string; message: string; history: Turn[]; context: string; format: 'wire' | 'json'; legend?: string; model?: ModelKey; vocabulary: string; rejections?: string[] };

function system(brief: string, vocabulary: string, context: string, format: 'wire' | 'json', legend: string, rejections: string[]) {
  const s = context;
  return `${brief}

You change it ONLY by proposing actions from this vocabulary:

${vocabulary}

Current state (${format === 'wire' ? `rixse wire. ${legend}` : 'JSON'}):
${s.length > STATE_MAX ? s.slice(0, STATE_MAX) + '…(truncated)' : s}
${rejections.length ? `\nYour previous proposal had rejected actions:\n${rejections.map((r) => `- ${r}`).join('\n')}\nFix them if they still matter.\n` : ''}
Reply in JSON Lines, no code fence, no other text. Line 1 is your chat reply; then ONE line per action, in the order to apply them:
{"say": "<one or two short sentences for the chat>"}
{"<action type>": {...payload}}
{"<action type>": {...payload}}
Each line is a complete JSON object on a single line. Actions are applied the moment each line arrives, so put parents before children.
Rules:
- "say" is conversation only. Never list the data in "say"; put it on the screen.
- Refer to existing items by ${format === 'wire' ? 'their handle (c1, n1…)' : 'id'}. Give a NEW item a short descriptive slug id. Reuse and update existing items instead of duplicating them.
- If the user only chats, send only the say line.`;
}

/** The first balanced {...} in the text, parsed. Tolerates code fences and stray prose. */
function firstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export function replyText(result: unknown): string {
  const r = result as { response?: unknown; choices?: { message?: { content?: string } }[] };
  if (typeof r?.response === 'string') return r.response;
  if (r?.response && typeof r.response === 'object') return JSON.stringify(r.response);
  return r?.choices?.[0]?.message?.content ?? '';
}

export async function POST(request: Request) {
  const t0 = performance.now();
  const body = (await request.json()) as Body;
  const tBody = performance.now();
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return Response.json({ error: 'empty message' }, { status: 400 });
  }
  const key: ModelKey = body.model === 'opus' || body.model === 'oss' ? body.model : 'gemma';
  const sys = system(String(body.brief ?? 'You operate an interface on behalf of the user.').slice(0, 4000), String(body.vocabulary ?? ''), String(body.context ?? ''), body.format === 'wire' ? 'wire' : 'json', String(body.legend ?? ''), (body.rejections ?? []).slice(0, 10));
  const turns = [...(body.history ?? []).slice(-HISTORY_MAX), { role: 'user' as const, content: body.message.slice(0, 2000) }];
  const tPrompt = performance.now();
  const model = MODELS[key].label;
  const enc = new TextEncoder();

  // NDJSON to the browser: {kind:"say"}, {kind:"action"} as soon as each line is
  // complete, then {kind:"done"} with usage and timings.
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      let buf = '', raw = '', lines = 0, actions = 0, firstText = 0;
      const usage = { input: 0, output: 0 };
      const line = (text: string) => {
        const l = text.trim();
        if (!l || l.startsWith('```')) return;
        let o: { say?: unknown; type?: unknown; payload?: unknown; actions?: unknown } | null = null;
        try { o = JSON.parse(l); } catch { return; }
        if (!o || typeof o !== 'object') return;
        if (typeof o.say === 'string') { lines++; send({ kind: 'say', say: o.say }); }
        if (typeof o.type === 'string') { lines++; actions++; send({ kind: 'action', action: { type: o.type, payload: o.payload } }); }
        else if (typeof o.say !== 'string' && !Array.isArray(o.actions)) {
          // The compact line shape {"ui.add": {...}}: the action type is the only key.
          const keys = Object.keys(o);
          const v = keys.length === 1 ? (o as Record<string, unknown>)[keys[0]!] : undefined;
          if (v && typeof v === 'object' && !Array.isArray(v)) { lines++; actions++; send({ kind: 'action', action: { type: keys[0], payload: v } }); }
        }
        if (Array.isArray(o.actions)) for (const a of o.actions) { lines++; send({ kind: 'action', action: a }); } // a model that ignored the line format
      };
      const onText = (t: string) => {
        if (!t) return;
        if (!firstText) firstText = performance.now();
        raw += t; buf += t;
        let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
      };
      /** Server-sent events → one parsed JSON payload per data line. */
      const sse = async (body: ReadableStream<Uint8Array>, each: (e: any) => void) => {
        const dec = new TextDecoder(); let pending = '';
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += dec.decode(value, { stream: true });
          let i; while ((i = pending.indexOf('\n')) >= 0) {
            const l = pending.slice(0, i).trim(); pending = pending.slice(i + 1);
            if (!l.startsWith('data:')) continue;
            const d = l.slice(5).trim();
            if (d === '[DONE]') continue;
            try { each(JSON.parse(d)); } catch { /* keep-alive or partial */ }
          }
        }
      };
      try {
        if (key === 'opus') {
          const r = await fetch(ANTHROPIC_PROXY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODELS.opus.id, max_tokens: 4096, system: sys, messages: turns, stream: true }) });
          if (!r.ok || !r.body) throw new Error(`Opus via proxy: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
          await sse(r.body, (e) => {
            if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') onText(e.delta.text);
            if (e.type === 'message_start') usage.input = e.message?.usage?.input_tokens ?? 0;
            if (e.type === 'message_delta' && e.usage) usage.output = e.usage.output_tokens ?? usage.output;
          });
        } else {
          const { env } = getCloudflareContext() as unknown as { env: { AI?: { run(model: string, input: unknown): Promise<unknown> } } };
          if (!env.AI) throw new Error('The AI binding is missing (run with wrangler credentials).');
          const out = await env.AI.run(MODELS[key].id, { messages: [{ role: 'system', content: sys }, ...turns], max_tokens: 4096, temperature: 0, stream: true, ...(key === 'oss' ? { reasoning_effort: 'low' } : { chat_template_kwargs: { enable_thinking: false } }) });
          await sse(out as ReadableStream<Uint8Array>, (e) => {
            onText(e.choices?.[0]?.delta?.content ?? (typeof e.response === 'string' ? e.response : ''));
            const u = e.usage;
            if (u) {
              usage.input = Math.max(usage.input, u.prompt_tokens ?? 0);
              // Per-chunk counts are 1 each; a summary chunk carries the total.
              usage.output = (u.completion_tokens ?? 0) > 1 ? u.completion_tokens : usage.output + (u.completion_tokens ?? 0);
            }
          });
        }
        line(buf);
        if (!lines) {
          // Neither lines nor a proposal: fall back to the first JSON object, else show the text.
          const parsed = firstJsonObject(raw) as { say?: unknown; actions?: unknown } | null;
          if (parsed && typeof parsed.say === 'string') send({ kind: 'say', say: parsed.say });
          if (parsed && Array.isArray(parsed.actions)) for (const a of parsed.actions) send({ kind: 'action', action: a });
          if (!parsed) send({ kind: 'say', say: raw.trim().slice(0, 500) || '(no reply)', parseError: true });
        }
        const tEnd = performance.now();
        send({ kind: 'done', model, usage, raw: actions ? undefined : raw.slice(0, 4000), lines, actions, timing: { readBody: Math.round(tBody - t0), buildPrompt: Math.round(tPrompt - tBody), firstToken: firstText ? Math.round(firstText - tPrompt) : null, model: Math.round(tEnd - tPrompt), server: Math.round(tEnd - t0) } });
      } catch (err) {
        send({ kind: 'error', error: `model call failed: ${err instanceof Error ? err.message : String(err)}` });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}

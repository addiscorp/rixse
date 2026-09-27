// The agent: one model call per chat message. It is sent the vocabulary, the
// current state and the conversation, and answers with a proposal — a chat
// reply and a list of actions. It never touches state; the client's rixse
// store applies (or rejects) each action. Same model and call shape as
// zega.earth (zegadb/earth lib/ask.ts).
import { getCloudflareContext } from '@opennextjs/cloudflare';

const MODELS = {
  gemma: { label: 'Gemma 4 26B', id: '@cf/google/gemma-4-26b-a4b-it' },
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
Reply with ONE JSON object and nothing else, no code fence:
{"say": "<one or two short sentences for the chat>", "actions": [{"type": "<action type>", "payload": {...}}]}
Rules:
- "say" is conversation only. Never list the data in "say"; put it on the canvas.
- Refer to existing items by ${format === 'wire' ? 'their handle (c1, c2…)' : 'id'}. Give a NEW item a short descriptive slug id. Reuse and update existing items instead of duplicating them.
- If the user only chats, return "actions": [].`;
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

function replyText(result: unknown): string {
  const r = result as { response?: unknown; choices?: { message?: { content?: string } }[] };
  if (typeof r?.response === 'string') return r.response;
  if (r?.response && typeof r.response === 'object') return JSON.stringify(r.response);
  return r?.choices?.[0]?.message?.content ?? '';
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return Response.json({ error: 'empty message' }, { status: 400 });
  }
  const key: ModelKey = body.model === 'opus' ? 'opus' : 'gemma';
  const sys = system(String(body.brief ?? 'You operate an interface on behalf of the user.').slice(0, 4000), String(body.vocabulary ?? ''), String(body.context ?? ''), body.format === 'wire' ? 'wire' : 'json', String(body.legend ?? ''), (body.rejections ?? []).slice(0, 10));
  const turns = [...(body.history ?? []).slice(-HISTORY_MAX), { role: 'user' as const, content: body.message.slice(0, 2000) }];
  const started = Date.now();
  let raw = '';
  let usage = { input: 0, output: 0 };
  try {
    if (key === 'opus') {
      const r = await fetch(ANTHROPIC_PROXY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODELS.opus.id, max_tokens: 4096, system: sys, messages: turns }) });
      const j = (await r.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: unknown };
      if (!r.ok) throw new Error(`Opus via proxy: HTTP ${r.status} ${JSON.stringify(j.error ?? j).slice(0, 200)}`);
      raw = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      usage = { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 };
    } else {
      const { env } = getCloudflareContext() as unknown as { env: { AI?: { run(model: string, input: unknown): Promise<unknown> } } };
      if (!env.AI) return Response.json({ error: 'The AI binding is missing (run with wrangler credentials).' }, { status: 503 });
      const result = await env.AI.run(MODELS.gemma.id, { messages: [{ role: 'system', content: sys }, ...turns], max_tokens: 4096, temperature: 0, chat_template_kwargs: { enable_thinking: false } });
      raw = replyText(result);
      const u = (result as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
      usage = { input: u?.prompt_tokens ?? 0, output: u?.completion_tokens ?? 0 };
    }
  } catch (err) {
    return Response.json({ error: `model call failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
  const ms = Date.now() - started;
  const parsed = firstJsonObject(raw) as { say?: unknown; actions?: unknown } | null;
  const model = MODELS[key].label;
  if (!parsed) return Response.json({ say: raw.trim().slice(0, 500) || '(no reply)', actions: [], ms, model, usage, parseError: true, raw });
  return Response.json({
    say: typeof parsed.say === 'string' ? parsed.say : '',
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    ms,
    model,
    usage,
    raw,
  });
}

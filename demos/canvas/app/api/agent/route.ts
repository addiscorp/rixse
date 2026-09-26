// The agent: one model call per chat message. It is sent the vocabulary, the
// current state and the conversation, and answers with a proposal — a chat
// reply and a list of actions. It never touches state; the client's rixse
// store applies (or rejects) each action. Same model and call shape as
// zega.earth (zegadb/earth lib/ask.ts).
import { getCloudflareContext } from '@opennextjs/cloudflare';

const MODEL = '@cf/google/gemma-4-26b-a4b-it';
const HISTORY_MAX = 8;
const STATE_MAX = 20_000;

type Turn = { role: 'user' | 'assistant'; content: string };
type Body = { message: string; history: Turn[]; state: unknown; vocabulary: string; rejections?: string[] };

function system(vocabulary: string, state: unknown, rejections: string[]) {
  const s = JSON.stringify(state);
  return `You operate a canvas of cards and arrows on behalf of the user. You change it ONLY by proposing actions from this vocabulary:

${vocabulary}

The canvas is ${1200}×${800}. Current state (JSON):
${s.length > STATE_MAX ? s.slice(0, STATE_MAX) + '…(truncated)' : s}
${rejections.length ? `\nYour previous proposal had rejected actions:\n${rejections.map((r) => `- ${r}`).join('\n')}\nFix them if they still matter.\n` : ''}
Reply with ONE JSON object and nothing else, no code fence:
{"say": "<one or two short sentences for the chat>", "actions": [{"type": "<action type>", "payload": {...}}]}
Rules:
- "say" is conversation only. Never list the data in "say"; put it on the canvas.
- Use ids you created or that exist in the state. Reuse existing cards instead of duplicating them.
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
  const { env } = getCloudflareContext() as unknown as { env: { AI?: { run(model: string, input: unknown): Promise<unknown> } } };
  if (!env.AI) return Response.json({ error: 'The AI binding is missing (run with wrangler credentials).' }, { status: 503 });

  const messages = [
    { role: 'system', content: system(String(body.vocabulary ?? ''), body.state, (body.rejections ?? []).slice(0, 10)) },
    ...(body.history ?? []).slice(-HISTORY_MAX),
    { role: 'user', content: body.message.slice(0, 2000) },
  ];
  const started = Date.now();
  let raw = '';
  try {
    const result = await env.AI.run(MODEL, { messages, max_tokens: 1200, temperature: 0, chat_template_kwargs: { enable_thinking: false } });
    raw = replyText(result);
  } catch (err) {
    return Response.json({ error: `model call failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
  const ms = Date.now() - started;
  const parsed = firstJsonObject(raw) as { say?: unknown; actions?: unknown } | null;
  if (!parsed) return Response.json({ say: raw.trim().slice(0, 500) || '(no reply)', actions: [], ms, model: MODEL, parseError: true, raw });
  return Response.json({
    say: typeof parsed.say === 'string' ? parsed.say : '',
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    ms,
    model: MODEL,
    raw,
  });
}

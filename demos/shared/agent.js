// The agent route client, framework-free. One POST per chat message to the
// canvas demo's /api/agent route; the reply streams back as NDJSON:
// {kind:"say"}, {kind:"action"} as soon as each line is complete, then
// {kind:"done"} (or {kind:"error"}). Extracted from demos/canvas/components/Chat.tsx
// so both demos speak the same contract.

/**
 * @typedef {{ kind: 'say', say: string }
 *   | { kind: 'action', action: { type: string, payload?: unknown } }
 *   | { kind: 'done', model?: string, usage?: { input: number, output: number }, timing?: { readBody: number, buildPrompt: number, firstToken: number | null, model: number, server: number }, lines?: number, actions?: number, raw?: string }
 *   | { kind: 'error', error: string }} AgentEvent
 */

/**
 * POST one turn to the agent route and hand each streamed event to onEvent as
 * it arrives (so actions can be applied the moment they land).
 * @param {string} endpoint e.g. "/api/agent" or "http://localhost:3100/api/agent"
 * @param {unknown} body the route's request body (brief, message, history, context, format, legend, model, vocabulary, rejections)
 * @param {(ev: AgentEvent) => void} onEvent
 */
export async function streamAgent(endpoint, body, onEvent) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += dec.decode(value, { stream: true });
    let i;
    while ((i = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, i); pending = pending.slice(i + 1);
      if (!line.trim()) continue;
      onEvent(JSON.parse(line));
    }
  }
}

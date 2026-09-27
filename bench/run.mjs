import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ReactDOMServer from 'react-dom/server';
import { createCanvasStore } from '../demos/canvas/lib/canvas.ts';
import { createWireContext, encodeWireState, parseWireOps } from './wire-v0.js';
import { tasks, makeTaskState } from './tasks.ts';
import { canvasTree } from './tree.mjs';
import { mergeCheckpointRows } from './result-store.mjs';

const endpoint = 'http://127.0.0.1:8977';
const opusOnly = process.argv.includes('--opus-only');
const probeOnly = process.argv.includes('--probe');
// --only=<model key> runs one model and merges it onto the newest complete run.
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? (opusOnly ? 'opus-5.5' : null);
await mkdir('bench/results', { recursive: true });
await mkdir('.tmp', { recursive: true });
const models = [
  { key: 'gemma', id: '@cf/google/gemma-4-26b-a4b-it', provider: 'workers', temperature: 0 },
  { key: 'qwen', id: '@cf/qwen/qwen3-30b-a3b-fp8', provider: 'workers', temperature: 0 },
  { key: 'gemma-repeat', id: '@cf/google/gemma-4-26b-a4b-it', provider: 'workers', temperature: 0 },
  { key: 'opus-5.5', id: 'claude-opus-5-5', provider: 'anthropic', temperature: null },
  { key: 'glm-4.7-flash', id: '@cf/zai-org/glm-4.7-flash', provider: 'workers', temperature: 0 },
];
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputPath = `bench/results/${runId}.json`;
const inputs = ['markup', 'json', 'flight', 'wire'];
const vocab = createCanvasStore().vocabulary();
const promptStart = 'You operate a canvas of cards and arrows on behalf of the user. Propose only actions from this vocabulary:\n\n' + vocab + '\n\nThe canvas is 1200×800.';

function flight(state) {
  const child = spawnSync(process.execPath, ['--conditions=react-server', '--experimental-strip-types', 'bench/flight-worker.mjs'], { input: JSON.stringify(state), encoding: 'utf8', maxBuffer: 8_000_000 });
  if (child.status !== 0) throw new Error(`Flight render failed (${child.status}): ${child.stderr.trim()}`);
  return child.stdout;
}

function inputState(format, state, context) {
  if (format === 'markup') return ReactDOMServer.renderToStaticMarkup(canvasTree(state));
  if (format === 'json') return JSON.stringify(state);
  if (format === 'flight') return flight(state);
  return encodeWireState(state, context);
}

function promptFor(format, snapshot, item, output) {
  const formatLabel = { markup: 'HTML rendered by the canvas', json: 'JSON canvas state', flight: 'React Server Components Flight payload', wire: 'rixse wire v0 state' }[format];
  const outputRule = output === 'json'
    ? 'Reply with ONE JSON object and nothing else: {"say":"short reply","actions":[{"type":"<action>","payload":{...}}]}. Use only existing IDs visible in state; for wire input, use its handles in id/from/to fields.'
    : 'Reply with a say: line and then one wire v0 operation per line. Operations: +cN card "Title" [tone] x,y ["body"] | ~cN tone=good title="New" | >cN x,y | -cN | =cN cN "label" | !cN cN | clear. Use existing handles, and the next unused handle for a new card.';
  const rejection = item.rejections?.length ? `\nPrevious turn rejection reasons (recover if relevant):\n${item.rejections.map((x) => `- ${x}`).join('\n')}` : '';
  return [{ role: 'system', content: `${promptStart}\n\nCurrent state (${formatLabel}):\n${snapshot}${rejection}\n\nRules: the assistant's say is conversation only. If the user is only asking a question or chatting, propose no actions.\n${outputRule}` }, ...(item.history ?? []), { role: 'user', content: item.message }];
}

function textFromResponse(data) {
  const result = data?.result ?? data;
  if (Array.isArray(result?.content)) return result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  if (typeof result?.response === 'string') return result.response;
  if (typeof result?.response === 'object' && result.response) return JSON.stringify(result.response);
  if (typeof result?.choices?.[0]?.message?.content === 'string') return result.choices[0].message.content;
  if (typeof result?.choices?.[0]?.message?.reasoning_content === 'string') return result.choices[0].message.reasoning_content;
  if (typeof result?.choices?.[0]?.message?.reasoning === 'string') return result.choices[0].message.reasoning;
  return '';
}

function usageFrom(data, provider) {
  const u = data?.result?.usage ?? data?.usage ?? {};
  return provider === 'anthropic'
    ? { input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null, token_count_source: 'Anthropic Messages usage' }
    : { input_tokens: u.input_tokens ?? u.prompt_tokens ?? u.promptTokens ?? null, output_tokens: u.output_tokens ?? u.completion_tokens ?? u.completionTokens ?? null, token_count_source: 'Workers AI response usage' };
}

function parseJsonActions(raw) {
  const start = raw.indexOf('{');
  if (start < 0) return { say: '', actions: [], parseError: true };
  let depth = 0, quoted = false, escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { const parsed = JSON.parse(raw.slice(start, i + 1)); return { say: parsed.say ?? '', actions: Array.isArray(parsed.actions) ? parsed.actions : [], parseError: false }; }
      catch { return { say: '', actions: [], parseError: true }; }
    }
  }
  return { say: '', actions: [], parseError: true };
}

function translateWireHandles(actions, context) {
  return actions.map((action) => {
    const payload = { ...(action.payload ?? {}) };
    for (const field of ['id', 'from', 'to']) if (typeof payload[field] === 'string' && context.handleToId.has(payload[field])) payload[field] = context.handleToId.get(payload[field]);
    return { ...action, payload };
  });
}

function unwrapError(data) {
  const item = data?.errors?.[0]?.message ?? data?.error?.message ?? '';
  const match = /maximum context length is (\d+) tokens[\s\S]*total of at least (\d+) tokens/i.exec(item);
  return match ? { message: item, sizeLimit: Number(match[1]), sizeTokens: Number(match[2]) } : { message: item || JSON.stringify(data) };
}

async function call(model, messages) {
  const url = model.provider === 'anthropic' ? `${endpoint}/anthropic/v1/messages` : `${endpoint}/run/${model.id}`;
  const body = model.provider === 'anthropic'
    ? { model: model.id, max_tokens: 1200, messages: messages.filter((m) => m.role !== 'system'), system: messages.find((m) => m.role === 'system')?.content ?? '' }
    : { messages, max_tokens: 1200, temperature: 0, chat_template_kwargs: { enable_thinking: false }, ...(model.extra ?? {}) };
  const started = performance.now();
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const responseBody = await response.text();
  const latency = performance.now() - started;
  let data;
  try { data = JSON.parse(responseBody); } catch { throw new Error(`proxy returned HTTP ${response.status} with invalid JSON`); }
  if (!response.ok) throw Object.assign(new Error(`proxy HTTP ${response.status}: ${unwrapError(data).message}`), { sizeInfo: unwrapError(data) });
  return { data, raw: textFromResponse(data), latency };
}

if (probeOnly) {
  const model = models.find((item) => item.key === 'opus-5.5');
  const message = [{ role: 'system', content: 'Reply with one word.' }, { role: 'user', content: 'Probe.' }];
  const { data } = await call(model, message);
  console.log(`probe HTTP 200; model=${model.id}; usage=${Boolean(data?.result?.usage ?? data?.usage)}`);
  process.exit(0);
}

const rows = [];
let completed = 0;
const total = only ? (only === 'opus-5.5' ? 60 : tasks.length * 5) : 460;
let baseRun = null;
if (only) {
  const files = await readdir('bench/results');
  const entries = await Promise.all(files.filter((name) => name.endsWith('.json')).map(async (filename) => ({ filename, ...JSON.parse(await readFile(`bench/results/${filename}`, 'utf8')) })));
  baseRun = entries.filter((entry) => entry.complete && entry.rows.some((row) => row.model !== only)).sort((a, b) => b.filename.localeCompare(a.filename))[0];
  if (!baseRun) throw new Error('No complete Workers AI run exists');
}
await writeFile(outputPath, JSON.stringify({ run_id: runId, complete: false, request_count: 0, proxy_model_calls: 0, models, task_count: tasks.length, formats: inputs, rows: [] }, null, 2) + '\n', { flag: 'wx' });
async function checkpoint(complete = false) {
  const combined = baseRun ? mergeCheckpointRows(baseRun.rows, rows) : rows;
  const output = { run_id: runId, complete, request_count: combined.length, proxy_model_calls: baseRun ? baseRun.proxy_model_calls + rows.length : rows.length, models, task_count: tasks.length, formats: inputs, adapter_seam: { name: 'anthropic-messages', enabled: true }, rows: [...combined], ...(baseRun ? { base_run_id: baseRun.run_id, added_model: only, added_run_id: runId } : {}) };
  await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
}

for (const model of models.filter((item) => (only ? item.key === only : !['glm-4.7-flash'].includes(item.key)))) {
  const selected = model.provider === 'anthropic' ? [['json', 'json'], ['wire', 'json'], ['wire', 'wire']] : inputs.flatMap((format) => [['json', format], ...(format === 'wire' ? [['wire', format]] : [])].map(([output, input]) => [input, output]));
  for (const item of tasks) {
    const { store, initial } = makeTaskState(item);
    const state = structuredClone(store.state);
    const context = createWireContext(state);
    const snapshots = Object.fromEntries(inputs.map((format) => [format, inputState(format, state, context)]));
    for (const [format, output] of selected) {
      const base = { model: model.key, model_id: model.id, task: item.id, input: format, output };
      try {
        const result = await call(model, promptFor(format, snapshots[format], item, output));
        const callContext = createWireContext(state);
        const parsed = output === 'json' ? parseJsonActions(result.raw) : parseWireOps(result.raw, callContext);
        const proposed = output === 'json' && format === 'wire' ? translateWireHandles(parsed.actions, callContext) : parsed.actions;
        const proposedCount = proposed.length + (parsed.rejected?.length ?? 0);
        const freshStore = createCanvasStore();
        item.setup(freshStore);
        const application = freshStore.applyProposal(proposed, `bench:${item.id}`);
        const accepted = application.filter((r) => r.result.ok).length;
        const rejectedByStore = application.filter((r) => !r.result.ok).map((r) => r.result.error);
        const pass = item.check(freshStore.state, initial, { proposed: proposedCount, accepted });
        rows.push({ ...base, ...usageFrom(result.data, model.provider), latency_ms: result.latency, proposed_actions: proposedCount, accepted_actions: accepted, valid_first_try_share: proposedCount ? accepted / proposedCount : 1, parsed_rejections: parsed.rejected?.length ?? 0, parse_error: parsed.parseError ?? false, checker: pass ? 'pass' : 'fail', say: parsed.say ?? '', raw: result.raw, rejected: [...(parsed.rejected ?? []).map((r) => r.reason), ...rejectedByStore] });
      } catch (error) {
        const row = { ...base, ...usageFrom({}, model.provider), latency_ms: null, proposed_actions: 0, accepted_actions: 0, valid_first_try_share: 0, parsed_rejections: 0, parse_error: true, checker: 'fail', raw: '' };
        if (error.sizeInfo?.sizeLimit) Object.assign(row, { error: 'failed-by-size', size_limit: error.sizeInfo.sizeLimit, size_tokens: error.sizeInfo.sizeTokens, detail: error.sizeInfo.message });
        else row.error = error instanceof Error ? error.message : String(error);
        rows.push(row);
      }
      completed++;
      if (completed % 20 === 0 || completed === total) {
        await checkpoint(completed === total);
        console.log(`completed ${completed}/${total} calls`);
      }
    }
  }
}

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { newestCompleteRun } from './result-store.mjs';
import { tasks } from './tasks.ts';

const files = await readdir('bench/results');
const entries = await Promise.all(files.filter((name) => name.endsWith('.json')).map(async (filename) => ({ filename, ...JSON.parse(await readFile(`bench/results/${filename}`, 'utf8')) })));
const data = newestCompleteRun(entries);
if (!data) throw new Error('No complete benchmark result file exists');
const combinations = [...new Set(data.rows.map((r) => `${r.input}/${r.output}`))];
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const p50 = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const show = (n, places = 1) => n === null || n === undefined ? 'n/a' : Number(n).toFixed(places);
let md = `# Benchmark results — ${data.run_id}\n\n`;
md += `Completed measurements: ${data.request_count}. Proxy model calls in this run: ${data.proxy_model_calls}. Fixed tasks: ${data.task_count}. Flight is a React Server Components payload rendered from the same element tree used for markup. The result file is **${data.filename}**.\n\n`;
md += '## Summary by model\n\nMetrics average model-reported API token counts and latency. First-try validity is accepted actions divided by proposed actions. Task pass rate is the final-store checker rate.\n\n';
for (const model of data.models) {
  md += `### ${model.key} (${model.id})\n\n| Input / output | Mean input tokens | Mean output tokens | P50 latency (ms) | First-try valid | Task pass | Request errors |\n|---|---:|---:|---:|---:|---:|---:|\n`;
  for (const combo of combinations) {
    const rows = data.rows.filter((r) => r.model === model.key && `${r.input}/${r.output}` === combo);
    if (!rows.length) continue;
    const valid = rows.reduce((a, r) => a + (r.accepted_actions ?? 0), 0) / Math.max(1, rows.reduce((a, r) => a + (r.proposed_actions ?? 0), 0));
    const passed = rows.filter((r) => r.checker === 'pass').length / rows.length;
    md += `| ${combo} | ${show(mean(rows.map((r) => r.input_tokens).filter(Number.isFinite)))} | ${show(mean(rows.map((r) => r.output_tokens).filter(Number.isFinite)))} | ${show(p50(rows.map((r) => r.latency_ms).filter(Number.isFinite)))} | ${show(valid * 100)}% | ${show(passed * 100)}% | ${rows.filter((r) => r.error).length} |\n`;
  }
  md += '\n';
}

md += '## Input size for the 60-card state\n\nAPI input tokens for task `sixty-card`, JSON output only. Counts are model-tokenizer-specific. A context overflow is reported as a failed-by-size result.\n\n| Input format | ' + data.models.map((m) => m.key).join(' | ') + ' |\n|---|' + data.models.map(() => '---:').join('|') + '|\n';
for (const format of data.formats) {
  const cells = data.models.map((m) => {
    const row = data.rows.find((r) => r.model === m.key && r.task === 'sixty-card' && r.input === format && r.output === 'json');
    return row?.error === 'failed-by-size' ? `does not fit: ${row.size_tokens.toLocaleString()} tokens > ${row.size_limit.toLocaleString()}` : show(mean(data.rows.filter((r) => r.model === m.key && r.task === 'sixty-card' && r.input === format && r.output === 'json').map((r) => r.input_tokens).filter(Number.isFinite)), 0);
  });
  md += `| ${format} | ${cells.join(' | ')} |\n`;
}

md += '\n## Token-normalized result\n\nChecker-passing tasks per 1,000 combined input and output tokens, by model and input/output combination.\n\n| Model | Input / output | Passes / 1k tokens |\n|---|---|---:|\n';
const normalized = [];
for (const model of data.models) for (const combo of combinations) {
  const rows = data.rows.filter((r) => r.model === model.key && `${r.input}/${r.output}` === combo);
  if (!rows.length) continue;
  const pass = rows.filter((r) => r.checker === 'pass').length;
  const tokens = rows.reduce((n, r) => n + (Number.isFinite(r.input_tokens) ? r.input_tokens : 0) + (Number.isFinite(r.output_tokens) ? r.output_tokens : 0), 0);
  if (!tokens) continue;
  const rate = pass * 1000 / tokens;
  normalized.push({ model: model.key, combo, rate });
  md += `| ${model.key} | ${combo} | ${show(rate, 3)} |\n`;
}
const winner = normalized.sort((a, b) => b.rate - a.rate)[0];
md += `\nHighest observed rate: **${winner?.model ?? 'n/a'} ${winner?.combo ?? ''}** (${show(winner?.rate, 3)} passes/1k tokens).\n`;

const failures = data.rows.filter((r) => r.checker !== 'pass').sort((a, b) => (b.rejected?.length ?? 0) - (a.rejected?.length ?? 0)).slice(0, 5);
md += '\n## Five notable failures\n\n';
for (const row of failures) md += `### ${row.model} · ${row.input}/${row.output} · ${row.task}\n\nChecker: ${row.error === 'failed-by-size' ? `failed by size (${row.size_tokens} > ${row.size_limit} tokens)` : row.checker}${row.rejected?.length ? `; rejection: ${row.rejected[0]}` : ''}\n\n~~~text\n${row.raw || row.error || '(empty model response)'}\n~~~\n\n`;
if (!failures.length) md += 'No checker failures occurred, so there are no failure responses to quote.\n';

md += '\n## Method\n\n### Tasks\n\n';
for (const task of tasks) md += `- ${task.id}: ${task.message.replaceAll('\n', ' ')}\n`;
md += '\n### Models, temperature, and token counts\n\n';
for (const model of data.models) md += `- ${model.key}: ${model.id}; temperature ${model.provider === 'anthropic' && model.temperature == null ? 'provider default (omitted)' : model.temperature}; ${model.provider === 'anthropic' ? 'Anthropic Messages input_tokens / output_tokens (Anthropic tokenizer)' : 'Workers AI response usage fields (model tokenizer)'}\n`;
md += '\n### Rerun\n\nRun `npm run bench` for the full 460-call comparison. The runner creates a timestamped JSON file, checkpoints every 20 calls, and marks it complete only after all calls finish. An approved Opus-only retry uses `node --experimental-strip-types bench/run.mjs --opus-only`; it replaces the 60 Opus rows in the newest complete Workers AI result and records the underlying proxy call total. The report selects the newest complete combined file.\n';
const opusErrors = data.rows.filter((row) => row.model === 'opus-5.5' && row.error);
md += `\n## Measurement limits\n\nThe repeated Gemma pass measures same-model variance. Qwen’s 60-card Flight input exceeds its 32,768-token context window after the requested output budget; it is retained as a failed-by-size measurement. ${opusErrors.length ? `The Opus proxy rejected ${opusErrors.length} requests; no Anthropic token counts were returned. First error: ${opusErrors[0].error}.` : 'Opus token counts come from the Anthropic Messages usage object.'} Validity is counted from the real canvas store dispatch result on the first proposal. Recovery tasks include prior-turn rejection reasons in the prompt. Wire input translates session handles back to canvas IDs before dispatch.\n`;

await writeFile('bench/RESULTS.md', md);
console.log(`wrote RESULTS.md from ${data.filename}; highest observed rate=${winner?.model ?? 'n/a'} ${winner?.combo ?? ''}`);

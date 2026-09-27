import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeCheckpointRows, newestCompleteRun } from './result-store.mjs';

test('checkpoint merge replaces the updated measurement and preserves every other row', () => {
  const previous = [
    { model: 'qwen', task: 'a', input: 'json', output: 'json', value: 'old' },
    { model: 'gemma', task: 'a', input: 'json', output: 'json', value: 'keep' },
  ];
  const incoming = [
    { model: 'qwen', task: 'a', input: 'json', output: 'json', value: 'new' },
    { model: 'qwen', task: 'b', input: 'wire', output: 'wire', value: 'add' },
  ];
  assert.deepEqual(mergeCheckpointRows(previous, incoming), [previous[1], ...incoming]);
});

test('report selection ignores newer incomplete runs', () => {
  assert.equal(newestCompleteRun([
    { filename: '2026-09-26T10-00-00Z.json', complete: true },
    { filename: '2026-09-26T11-00-00Z.json', complete: false },
  ]).filename, '2026-09-26T10-00-00Z.json');
});

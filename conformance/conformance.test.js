// The conformance vectors are generated from the JS core (conformance/
// generate.mjs) and committed. If a core change alters behaviour without
// regenerating, this test fails — the files on disk are the definition both
// JS and Swift are held to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './generate.mjs';

const DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

test('the committed vectors are exactly what the JS core generates', async () => {
  const files = await build();
  const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.json') || f.endsWith('.txt')).sort();
  assert.deepEqual([...files.keys()].sort(), onDisk, 'generated file set matches the committed files');
  for (const [name, content] of files) {
    assert.equal(readFileSync(path.join(DIR, name), 'utf8'), content, `conformance/${name} is stale — run: node conformance/generate.mjs`);
  }
});

test('the vector files parse', async () => {
  const files = await build();
  for (const [name, content] of files) {
    if (name.endsWith('.json')) assert.doesNotThrow(() => JSON.parse(content), name);
  }
});

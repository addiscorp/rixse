// Publish proof: the npm tarball for rixse holds only what its package.json
// `files` allows (no tests), installs into a scratch project, gives the
// gateway under Bun (and its `rixse` CLI), and says plainly on Node that it
// runs on Bun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = ROOT;
// npm always includes these, even when a `files` whitelist is set.
const ALWAYS_INCLUDED = ['package.json', 'README.md', 'LICENSE'];

function packDryRun() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: DIR, encoding: 'utf8' });
  const [result] = JSON.parse(out);
  const pkg = JSON.parse(readFileSync(path.join(DIR, 'package.json'), 'utf8'));
  return { result, pkg };
}

test('rixse: tarball contains only what files allows', () => {
  const { result, pkg } = packDryRun();
  assert.ok(Array.isArray(pkg.files), 'package.json has no files whitelist');
  const allowed = pkg.files.filter((f) => !f.startsWith('!'));
  for (const file of result.files) {
    const ok =
      ALWAYS_INCLUDED.includes(file.path) ||
      allowed.some((entry) => file.path === entry || file.path.startsWith(`${entry}/`));
    assert.ok(ok, `tarball contains "${file.path}", which files does not allow`);
    assert.ok(!file.path.includes('test'), `tarball contains a test file: ${file.path}`);
    assert.ok(!file.path.endsWith('tsconfig.json'), `tarball contains ${file.path}`);
  }
  // The entry points the published package advertises must be in the tarball.
  for (const required of ['package.json', 'README.md', 'LICENSE', 'src/index.ts', 'src/node.js', 'src/cli.ts']) {
    assert.ok(result.files.some((f) => f.path === required), `tarball is missing ${required}`);
  }
});

const ON_NODE = `
import assert from 'node:assert/strict';
await assert.rejects(import('rixse'), { message: "rixse runs on Bun: the gateway uses Bun's runtime" });
console.log('NODE-OK');
`;
const ON_BUN = `
import { gateway, decide, gatewayBody } from 'rixse';
if (typeof gateway !== 'function') throw new Error('gateway is not a function');
const v = decide([{ host: 'h.test', method: 'GET', effect: 'apply' }], { host: 'h.test', method: 'POST', path: '/' });
if (v.effect !== 'request') throw new Error('decide: ' + JSON.stringify(v));
if (JSON.parse(gatewayBody('held', { request: 'r_1' })).rixse.status !== 'held') throw new Error('gatewayBody');
console.log('BUN-OK');
`;

test('the packed tarball installs: the gateway and CLI on Bun, a plain error on Node', { timeout: 300000 }, () => {
  const scratch = path.join(ROOT, '.tmp', `pack-proof-${process.pid}`);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    const { pkg } = packDryRun();
    execFileSync('npm', ['pack', '--pack-destination', scratch], { cwd: DIR, stdio: 'pipe' });
    writeFileSync(
      path.join(scratch, 'package.json'),
      `${JSON.stringify({ name: 'pack-proof', private: true, type: 'module', dependencies: { rixse: `file:./rixse-${pkg.version}.tgz` } }, null, 2)}\n`,
    );
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: scratch, stdio: 'pipe' });
    writeFileSync(path.join(scratch, 'node.mjs'), ON_NODE);
    writeFileSync(path.join(scratch, 'bun.ts'), ON_BUN);
    assert.match(execFileSync(process.execPath, ['node.mjs'], { cwd: scratch, encoding: 'utf8' }), /NODE-OK/);
    assert.match(execFileSync('bun', ['bun.ts'], { cwd: scratch, encoding: 'utf8' }), /BUN-OK/);
    const help = execFileSync('bun', ['node_modules/.bin/rixse', 'help'], { cwd: scratch, encoding: 'utf8' });
    assert.ok(JSON.parse(help).usage.some((u) => u.startsWith('rixse decide')), help);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// Publish proof: the npm tarballs for rixse and rixse-react contain only what
// each package.json `files` allows (no tests, no demos), and both tarballs
// install into a scratch project, import every export as ESM, and render one
// rixse-react component with react-dom/server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACKAGES = [
  ['rixse', 'packages/rixse'],
  ['rixse-react', 'packages/rixse-react'],
];
// npm always includes these, even when a `files` whitelist is set.
const ALWAYS_INCLUDED = ['package.json', 'README.md', 'LICENSE'];

function isAllowed(pathInTarball, files) {
  const base = pathInTarball.split('/')[0];
  if (ALWAYS_INCLUDED.includes(base)) return true;
  return files.some((entry) => pathInTarball === entry || pathInTarball.startsWith(`${entry}/`));
}

function packDryRun(name, dir) {
  const cwd = path.join(ROOT, dir);
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd, encoding: 'utf8' });
  const [result] = JSON.parse(out);
  const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  return { result, pkg };
}

for (const [name, dir] of PACKAGES) {
  test(`${name}: tarball contains only what files allows`, () => {
    const { result, pkg } = packDryRun(name, dir);
    assert.ok(Array.isArray(pkg.files), `${name} package.json has no files whitelist`);
    for (const file of result.files) {
      assert.ok(
        isAllowed(file.path, pkg.files),
        `${name} tarball contains "${file.path}", which files does not allow`,
      );
      assert.ok(!file.path.includes('test'), `${name} tarball contains a test file: ${file.path}`);
    }
    // The entry points the published package advertises must be in the tarball.
    for (const required of ['package.json', 'README.md', 'LICENSE', 'src/index.js', 'index.d.ts']) {
      assert.ok(
        result.files.some((f) => f.path === required),
        `${name} tarball is missing ${required}`,
      );
    }
  });
}

// Runs inside the scratch install (below): import every export of both
// packages as ESM and render one rixse-react component via react-dom/server.
const CHECK_SOURCE = `
import assert from 'node:assert/strict';
import * as rixse from 'rixse';
import * as bindings from 'rixse-react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const EXPECTED = {
  rixse: ['createStore', 'defineAction', 'validate', 'Rejected', 'createWire', 'defineComponent', 'defineSource', 'place', 'layout', 'createViewport', 'SIZES', 'PLACES'],
  'rixse-react': ['useRixseState', 'useRixseEvents', 'nextOrder'],
};
const mods = { rixse, 'rixse-react': bindings };
for (const [name, ns] of Object.entries(mods)) {
  assert.ok(Object.keys(ns).length > 0, name + ' has no ESM exports');
  for (const key of Object.keys(ns)) {
    assert.notEqual(ns[key], undefined, name + '.' + key + ' imported as undefined');
  }
  for (const key of EXPECTED[name]) {
    assert.ok(key in ns, name + ' is missing export ' + key);
  }
}

const store = rixse.createStore({
  initial: { count: 0 },
  actions: [
    rixse.defineAction('count.increment', {
      describe: 'Increment the counter',
      params: {},
      apply: (state) => ({ ...state, count: state.count + 1 }),
    }),
  ],
});
store.dispatch({ type: 'count.increment', payload: {} }, 'agent');
function Counter() {
  const state = bindings.useRixseState(store);
  return createElement('span', null, 'count: ' + state.count);
}
const html = renderToString(createElement(Counter));
assert.ok(html.includes('count: 1'), 'rendered html missing store state: ' + html);
console.log('PACK-PROOF-OK');
`;

test('packed tarballs install, import every export (ESM), and render with react-dom/server', { timeout: 300000 }, () => {
  const scratch = path.join(ROOT, '.tmp', `pack-proof-${process.pid}`);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    const tarballs = {};
    for (const [name, dir] of PACKAGES) {
      const { pkg } = packDryRun(name, dir);
      execFileSync('npm', ['pack', '--pack-destination', scratch], { cwd: path.join(ROOT, dir), stdio: 'pipe' });
      tarballs[name] = `${name}-${pkg.version}.tgz`;
    }
    writeFileSync(
      path.join(scratch, 'package.json'),
      `${JSON.stringify(
        {
          name: 'pack-proof',
          private: true,
          type: 'module',
          dependencies: {
            rixse: `file:./${tarballs['rixse']}`,
            'rixse-react': `file:./${tarballs['rixse-react']}`,
            react: '^19',
            'react-dom': '^19',
          },
        },
        null,
        2,
      )}\n`,
    );
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: scratch, stdio: 'pipe' });
    writeFileSync(path.join(scratch, 'check.mjs'), CHECK_SOURCE);
    const out = execFileSync(process.execPath, ['check.mjs'], { cwd: scratch, encoding: 'utf8' });
    console.log(out.trim());
    assert.ok(out.includes('PACK-PROOF-OK'), `scratch check did not pass:\n${out}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

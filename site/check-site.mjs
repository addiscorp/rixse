import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// Install the browser with `npx playwright install chromium`; headless only.
const root = resolve('site/public');
await mkdir(resolve('.tmp'), { recursive: true, mode: 0o700 });
const example = JSON.parse(await readFile(resolve(root, 'movies-example.json'), 'utf8'));
const pages = ['/', '/docs', '/docs/', ...[ 'components.html', 'sources.html', 'viewport.html', 'selection-voice.html', 'platforms.html' ].map((name) => `/docs/${name}`)];
const widths = [1280, 390];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    let file = resolve(root, relative);
    if (!file.startsWith(root + sep) && file !== root) throw new Error('path outside site');
    try { if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html'); }
    catch { if (!extname(file)) file = resolve(file, 'index.html'); }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const failures = [];
const links = new Set();
function assertNoOverflow(dimensions, width, path) {
  assert.ok(dimensions.document <= width && dimensions.body <= width, `${path} overflows at ${width}px: ${JSON.stringify(dimensions)}`);
}
try {
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  const agentRequests = [];
  page.on('request', request => { if (/\/api\/agent|anthropic|openai/.test(request.url())) agentRequests.push(request.url()); });
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of pages) {
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      assertNoOverflow(dimensions, width, path);
      const hrefs = await page.locator('a[href]').evaluateAll((nodes) => nodes.map((node) => ({ href: node.getAttribute('href'), base: document.baseURI })));
      for (const { href, base: hrefBase } of hrefs) {
        if (!href || /^(https?:|mailto:|tel:|data:|javascript:)/i.test(href)) continue;
        const target = new URL(href, hrefBase);
        if (target.origin !== base) continue;
        if (target.hash && (target.pathname === new URL(`${base}${path}`).pathname || !target.pathname)) {
          const found = await page.evaluate((id) => Boolean(document.getElementById(id)), decodeURIComponent(target.hash.slice(1)));
          assert.ok(found, `missing internal anchor ${href} on ${path}`);
        }
        links.add(`${target.pathname}${target.search}`);
      }
      console.log(`PASS ${width}px ${path} overflow (${dimensions.document}/${dimensions.body})`);
      if (path === '/') {
        // Before interaction, all six stages are readable as well as stage 1.
        assert.equal(await page.locator('.stage-index').getAttribute('open'), '');
        assert.equal(await page.locator('.stage-index li').count(), 6);
        const request = JSON.parse(await page.locator('#full-request').textContent());
        assert.deepEqual(request, example.request, 'visible full payload must match the demo-generated request');
        assert.equal(Buffer.byteLength(JSON.stringify(request)), example.requestBytes);
        for (const scheme of ['light', 'dark']) {
          await page.emulateMedia({ colorScheme: scheme });
          await page.locator('[data-step="1"]').click();
          for (let stage = 1; stage <= 6; stage++) {
            if (stage > 1) await page.keyboard.press('ArrowRight');
            assert.equal(await page.locator('#explainer').getAttribute('data-stage'), String(stage), 'ArrowRight must advance the stage');
            assert.match(await page.locator('#step-number').textContent(), new RegExp(`^0${stage} / 06$`));
            assert.equal(await page.locator('[aria-current="step"]').getAttribute('data-step'), String(stage));
            assert.equal(await page.locator('#model-count').textContent(), stage < 3 ? '0' : '1', `stage ${stage}: model request count`);
            assert.equal(await page.locator('#request-log').isVisible(), stage >= 3);
            assert.equal(await page.locator('#payload').isVisible(), stage === 4);
            assert.equal(await page.locator('#response').isVisible(), stage === 5);
            assert.equal(await page.locator('#line').isVisible(), stage === 6);
            assert.equal(await page.locator('#bars').isVisible(), stage !== 6);
            assert.equal(await page.locator('.bar-row.selected').count(), stage >= 2 && stage <= 5 ? 2 : 0);
            assert.ok(await page.locator('.edge.active').count() > 0, 'active flow edge');
            assert.equal(await page.locator('.edge.active .packet').first().evaluate(el => getComputedStyle(el).display), 'block', 'active edge has a moving packet');
            assert.ok(await page.locator('.node.active').count() > 0, 'active diagram node');
            assert.ok(await page.locator('[data-term].lit').count() > 0, 'active formula term');
            if (stage <= 2) {
              assert.equal(await page.locator('.model-edge.active').count(), 0, 'model edges stay inactive before ask');
              assert.equal(await page.locator('#node-model.active').count(), 0);
            }
            if (stage === 2) {
              await page.locator('#filter').click();
              assert.equal(await page.locator('.bar-row:visible').count(), 2, 'selected-only filter changes the rendered page');
              assert.equal(await page.locator('#model-count').textContent(), '0', 'filtering stays local');
              await page.locator('#filter').click();
              assert.equal(await page.locator('.bar-row:visible').count(), 10);
              await page.locator('.bar-row[data-name="Avatar"]').click();
              assert.equal(await page.locator('.bar-row.selected').count(), 1, 'clicking a selected bar changes local selection');
              await page.locator('.bar-row[data-name="Avatar"]').click();
              assert.equal(await page.locator('.bar-row.selected').count(), 2);
            }
            if (stage === 3) assert.equal(await page.locator('#edge-prompt.active').count(), 1);
            if (stage === 4) assert.equal(await page.locator('#edge-summary.active').count(), 1);
            if (stage === 5) assert.equal(await page.locator('#edge-reply.active').count(), 1);
            if (stage === 6) {
              assert.match(await page.locator('#source-log').textContent(), /2 rows/);
              for (const row of example.rows) assert.ok((await page.locator('#line').textContent()).includes(row.gross.toLocaleString('en-US')));
            }
            assertNoOverflow(await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth })), width, `/ stage ${stage} ${scheme}`);
            if ([1, 4, 6].includes(stage)) {
              const dest = resolve('.tmp', `home-${width === 1280 ? 'desktop' : 'phone'}-stage-${stage}-${scheme}.png`);
              await page.evaluate(() => document.activeElement?.blur());
              // Let the 200 ms color transitions settle; SVG packets keep moving.
              await page.waitForTimeout(250);
              await page.screenshot({ path: dest, fullPage: true });
              console.log(`SCREENSHOT ${dest}`);
            }
          }
          assert.equal(await page.locator('#next').isDisabled(), true);
          for (let stage = 5; stage >= 1; stage--) {
            await page.keyboard.press('ArrowLeft');
            assert.equal(await page.locator('#explainer').getAttribute('data-stage'), String(stage), 'ArrowLeft must go back');
          }
          assert.equal(await page.locator('#back').isDisabled(), true);
          await page.locator('#next').click();
          assert.equal(await page.locator('#explainer').getAttribute('data-stage'), '2');
          await page.locator('#back').click();
          assert.equal(await page.locator('#explainer').getAttribute('data-stage'), '1');
          for (const stage of [4, 6, 2, 3, 5, 1]) {
            await page.locator(`[data-step="${stage}"]`).click();
            assert.equal(await page.locator('#explainer').getAttribute('data-stage'), String(stage), 'step markers navigate');
          }
          console.log(`PASS ${width}px ${scheme}: six stages, keyboard forward/back, buttons, dots, highlights, counts 0/0/1/1/1/1`);
        }
        await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
        assert.equal(await page.locator('.edge.active .packet').first().evaluate(el => getComputedStyle(el).display), 'none', 'reduced-motion disables packet animation');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
      if (path === '/docs/') await page.screenshot({ path: resolve('.tmp', `docs-${width}.png`), fullPage: true });
    }
  }
  for (const path of links) {
    const response = await page.request.get(`${base}${path}`);
    assert.equal(response.status(), 200, `internal link ${path} returned ${response.status()}`);
  }
  assert.deepEqual(agentRequests, [], 'the explainer must never call a real model');
  assert.deepEqual(failures, [], failures.join('\n'));
  console.log(`PASS internal links (${links.size} unique targets) and console (0 errors)`);

  // Progressive enhancement: the server-delivered HTML has the real chart,
  // stage 1 flow, zero count, and an open, readable six-stage summary.
  const noJS = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await noJS.newPage();
  for (const width of widths) {
    await fallback.setViewportSize({ width, height: 900 });
    await fallback.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await fallback.locator('.bar-row').count(), 10);
    assert.equal(await fallback.locator('#model-count').textContent(), '0');
    assert.equal(await fallback.locator('.stage-index li:visible').count(), 6);
    assert.equal(await fallback.locator('#node-view.active').count(), 1);
    assertNoOverflow(await fallback.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth })), width, '/ no JS');
  }
  await noJS.close();
  console.log('PASS no-JS stage 1 and all-stage summary at both widths');

  if (process.env.PROVE_OVERFLOW_ASSERTION === '1') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/`);
    await page.evaluate(() => { const fixture = document.createElement('div'); fixture.id = 'overflow-control'; fixture.style.cssText = 'position:absolute;width:900px;height:1px;left:0;top:0'; document.body.append(fixture); });
    const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.throws(() => assertNoOverflow(dimensions, 390, '/ (reverted overflow fix)'), /overflows at 390px/, 'the same overflow assertion must fail when the wide element is restored');
    console.log(`PASS reverted overflow assertion control (${dimensions.document}/${dimensions.body} > 390)`);
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

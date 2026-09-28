import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// Install the browser with `npx playwright install chromium`; headless only.
const root = resolve('site/public');
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
  const page = await browser.newPage();
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
      if (path === '/' || path === '/docs/') {
        const suffix = width === 1280 ? 'desktop' : 'phone';
        const dest = resolve('.tmp', `${path === '/' ? 'home' : 'docs'}-${suffix}.png`);
        await page.screenshot({ path: dest, fullPage: true });
        console.log(`SCREENSHOT ${dest}`);
      }
    }
  }
  for (const path of links) {
    const response = await page.request.get(`${base}${path}`);
    assert.equal(response.status(), 200, `internal link ${path} returned ${response.status()}`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  console.log(`PASS internal links (${links.size} unique targets) and console (0 errors)`);

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

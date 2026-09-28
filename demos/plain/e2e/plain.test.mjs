// End-to-end proof that rixse works with no framework: a headless Chromium
// loads the plain demo, plays a scripted two-step turn against a STUBBED
// agent (fixed actions, no model call), and the bar chart, then the line
// chart, must render with the right row counts — all drawn by DOM + SVG from
// the same rixse store the agent wrote to.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../serve.mjs';

const BAR = { type: 'view.show', payload: { id: 'top-10', kind: 'bar', title: 'Top 10 · worldwide box office', query: '{ Movie order by gross desc limit 10 { title gross } }', label: 'title', value: 'gross', limit: 10 } };
const LINE = { type: 'view.show', payload: { id: 'by-year', kind: 'line', title: 'Box office by year', query: '{ Genre(name = "superhero" || name = "science fiction") limit 100000 { name movies <- Movie { year gross } } }', label: 'name', x: 'movies.year', value: 'sum(movies.gross)' } };
// Points the two genre series have between them in the shipped movies graph
// (superhero + science fiction, years with a top-250 film): fixed data, so an
// exact count.
const LINE_POINTS = 46;

let server, browser, base;

before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

test('a two-step turn renders the bar chart, then the line chart, with the right rows', async () => {
  const page = await browser.newPage();
  const calls = [];
  // The stubbed agent: fixed actions, no model call. Same route contract as
  // the canvas demo's /api/agent: JSON body in, NDJSON events out.
  await page.route('**/api/agent', async (route) => {
    const body = JSON.parse(route.request().postData());
    calls.push(body);
    const action = /top 10/.test(body.message) ? BAR : LINE;
    await route.fulfill({
      contentType: 'application/x-ndjson; charset=utf-8',
      body: [
        { kind: 'say', say: 'On the screen.' },
        { kind: 'action', action },
        { kind: 'done', model: 'stub', usage: { input: 0, output: 0 }, lines: 2, actions: 1 },
      ].map((e) => JSON.stringify(e)).join('\n') + '\n',
    });
  });
  await page.goto(base);
  await page.waitForSelector('#status[data-ready="true"]', { timeout: 30000 });

  // Step 1: the agent proposes a bar chart; the page runs its query in zega and draws it.
  await page.fill('#chat-input', 'top 10 movies by box office');
  await page.click('#send');
  await page.waitForSelector('[data-view="top-10"][data-kind="bar"]', { timeout: 15000 });
  assert.equal(await page.locator('[data-kind="bar"] rect[data-bar]').count(), 10, 'bar chart draws one bar per row');
  assert.match(await page.locator('[data-view="top-10"] .meta').textContent(), /10 rows/);

  // Step 2: a line chart over two genres; one path per series, one circle per point.
  await page.fill('#chat-input', 'box office by year for superhero and science fiction');
  await page.click('#send');
  await page.waitForSelector('[data-view="by-year"][data-kind="line"]', { timeout: 15000 });
  assert.equal(await page.locator('[data-kind="line"] path[data-series]').count(), 2, 'line chart draws one path per genre');
  assert.equal(await page.locator('[data-kind="line"] circle[data-point]').count(), LINE_POINTS, 'line chart draws one circle per data point');
  assert.match(await page.locator('[data-view="by-year"] .meta').textContent(), /2 rows/);

  // Both turns landed in order, and every agent call went to the stub.
  assert.deepEqual(await page.locator('[data-view]').evaluateAll((els) => els.map((e) => e.dataset.view)), ['top-10', 'by-year']);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.format === 'wire' && typeof c.vocabulary === 'string' && c.vocabulary.includes('view.show')));
  await page.close();
});

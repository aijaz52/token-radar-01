import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import assert from 'node:assert/strict';
import { buildRadar, parseSnapshot, dataScript } from './lib/model.ts';

const root = import.meta.dirname;
const { radar } = buildRadar(parseSnapshot(readFileSync(join(root, 'snapshot.json'), 'utf8')));
const errors = [], external = [];
const server = createServer((req, res) => {
  if (req.url === '/data.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.end(dataScript(radar)); return;
  }
  const path = resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!path.startsWith(join(root, 'dashboard') + '/')) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[extname(path)] || 'text/plain');
    res.end(readFileSync(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/root/.hermes/tools/chromium-1208/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!r.url().startsWith(origin)) external.push(r.url()); });
  await page.goto(origin + '/dashboard/index.html');
  await page.waitForSelector('#rows tr');
  assert.equal(await page.locator('#rows tr').count(), radar.rows.length);
  assert.equal(await page.locator('#rows tr').first().getAttribute('data-slug'), radar.rows[0].slug);
  const shot = name => page.screenshot({ path: join(root, 'screenshots', name), type: 'jpeg', quality: 85 });
  const boardTop = async () => {
    await page.evaluate(() => {
      document.querySelector('.table-wrap').scrollTop = 0;
      document.querySelector('#board').scrollIntoView({ block: 'start' });
    });
    for (const selector of ['.controls', '#method-band', 'thead', '#rows tr:first-child']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= 800, `${selector} must be fully visible`);
    }
  };
  await boardTop();
  await shot('1-board.jpg');
  await page.locator('#rows tr').first().locator('.name').click();
  await page.waitForSelector('dialog[open]');
  assert.equal(await page.locator('.plan li').count(), 6);
  assert.ok((await page.locator('.value-card strong').textContent()).includes(radar.rows[0].implied_value_usd.toLocaleString('en-US')));
  assert.match(await page.locator('#detail-title').textContent(), new RegExp(radar.rows[0].name));
  assert.ok((await page.locator('.arithmetic').textContent()).includes(String(radar.model.coefficients[0])));
  const traceBox = await page.locator('.regression-trace').boundingBox();
  assert.ok(traceBox.y >= 0 && traceBox.y + traceBox.height <= 800);
  assert.equal(await page.locator('.comp').count(), 3);
  const compsBox = await page.locator('.comp').last().boundingBox();
  assert.ok(compsBox.y >= 0 && compsBox.y + compsBox.height <= 800, 'Calibration neighbours must be visible');
  await shot('2-detail.jpg');
  await page.locator('.close').click();
  await page.selectOption('#category', 'Risk Curators');
  await page.selectOption('#chain', 'Ethereum');
  await page.locator('#watch').check();
  const expected = radar.rows.filter(p => p.category === 'Risk Curators' && p.chains.includes('Ethereum') && p.watchlist);
  assert.ok(expected.length > 0);
  assert.equal(await page.locator('#rows tr').count(), expected.length);
  await page.locator('[data-sort="tvl_usd"]').click();
  const actual = await page.locator('#rows tr').evaluateAll(rows => rows.map(r => r.dataset.slug));
  assert.deepEqual(actual, expected.sort((a,b) => b.tvl_usd - a.tvl_usd).map(p => p.slug));
  await boardTop();
  await shot('3-filtered.jpg');
  await page.fill('#search', 'nothing-matches-this-query');
  assert.equal(await page.locator('#rows tr').count(), 0);
  assert.ok(await page.locator('#empty').isVisible());
  await page.locator('#reset').click();
  await page.locator('[data-sort="implied_value_usd"]').click();
  await page.locator('[data-sort="implied_value_usd"]').click();
  const ascending = await page.locator('#rows tr').evaluateAll(rows => rows.map(r => r.dataset.slug));
  assert.deepEqual(ascending, [...radar.rows].sort((a,b)=>a.implied_value_usd-b.implied_value_usd || a.slug.localeCompare(b.slug)).map(p=>p.slug));
  await page.locator('#live').click();
  assert.equal(await page.locator('#rows tr').count(), radar.live.length);
  assert.match(await page.locator('#results').textContent(), /Already trading/);
  await page.locator('#rows tr').first().locator('.name').click();
  assert.match(await page.locator('.value-card').textContent(), /OBSERVED MARKET CAP/);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  for (const name of readdirSync(join(root, 'screenshots'))) assert.ok(statSync(join(root, 'screenshots', name)).size <= 512 * 1024);
  console.log(`Captured 3 real 1280×800 JPEG renders. Verified ${radar.rows.length} board rows, detail values, category + chain + watchlist filters, search, sorting and ${radar.live.length} separate live tokens; no browser errors or external requests.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

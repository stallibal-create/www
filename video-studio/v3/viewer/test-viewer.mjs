#!/usr/bin/env node
// Headless check of the V3 viewer prototype: loads the page in Chromium (SwiftShader WebGL), drives every control,
// fails on page errors, saves screenshots of each state to v3/reports/viewer-*.png.
// Usage: NODE_TOOLS=/path/to/node_modules node v3/viewer/test-viewer.mjs [--glb /url/of/model.glb]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const REPORTS = join(HERE, '..', 'reports'); mkdirSync(REPORTS, { recursive: true });
const req = createRequire(join(process.env.NODE_TOOLS || join(REPO, 'video-studio', 'node_modules'), 'noop.js'));
const { chromium } = req('playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };

const server = createServer((rq, rs) => {
  let p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = normalize(join(REPO, p));
  if (!f.startsWith(REPO) || !existsSync(f) || !statSync(f).isFile()) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); rs.end(readFileSync(f));
});
await new Promise(r => server.listen(4394, '127.0.0.1', r));
const glb = process.argv.includes('--glb') ? process.argv[process.argv.indexOf('--glb') + 1] : null;
const url = `http://127.0.0.1:4394/video-studio/v3/viewer/?test${glb ? '&glb=' + encodeURIComponent(glb) : ''}`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
let failed = false;
const check = (name, ok, detail = '') => { results.push(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed = true; };
for (const [label, viewport, reduced] of [['desktop', { width: 1280, height: 800 }, false], ['mobile', { width: 390, height: 844 }, false], ['reduced', { width: 1280, height: 800 }, true]]) {
  const ctx = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).catch(() => {});
  const ready = await page.evaluate(() => window.__ready === true);
  check(`${label}: viewer ready`, ready, errs.join(' | '));
  if (!ready) { await ctx.close(); continue; }
  const parts = await page.evaluate(() => window.__viewer.parts);
  check(`${label}: contract parts found`, parts.length >= 16, `${parts.length} parts`);
  const shot = async (name) => {
    await page.waitForTimeout(50);
    await page.waitForFunction(() => window.__viewer.idle(), null, { timeout: 60000 }); await page.waitForTimeout(400); await page.locator('#view').screenshot({ path: join(REPORTS, `viewer-${label}-${name}.png`) }); };
  await shot('assembled');
  await page.click('[data-act=explode]'); await shot('exploded');
  await page.click('[data-act=assemble]'); await shot('reassembled');
  await page.click('[data-act=airflow]'); await shot('airflow');
  const note = await page.textContent('#note');
  check(`${label}: airflow labelled illustrative`, /pas une simulation CFD/.test(note));
  await page.click('[data-act=reset]'); await shot('reset');
  // drag to orbit
  const b = await page.locator('#view').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 200, b.y + b.height / 2 + 30, { steps: 10 }); await page.mouse.up();
  await shot('orbited');
  // scroll section
  await page.evaluate(() => document.getElementById('scrolly').scrollIntoView());
  await page.mouse.wheel(0, viewport.height * 1.2); await page.waitForTimeout(1500);
  await page.locator('#view2').screenshot({ path: join(REPORTS, `viewer-${label}-scroll.png`) });
  const stats = await page.evaluate(() => window.__viewer.stats());
  check(`${label}: render stats`, stats.calls > 0, `${stats.calls} draw calls, ${stats.triangles} triangles`);
  check(`${label}: no page errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close(); server.close();
console.log(results.join('\n'));
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// End-to-end tests with Playwright (library mode, no test-runner dependency).
// Usage: npm test   (needs Playwright + Chromium; set PLAYWRIGHT_MODULE to its path if not resolvable)
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests/output');
const require = createRequire(import.meta.url);
let chromium;
for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '@playwright/test'].filter(Boolean)) { try { ({ chromium } = require(m)); break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright not found. npm i -D playwright  (or set PLAYWRIGHT_MODULE)'); process.exit(2); }

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
execFileSync(process.execPath, [join(ROOT, 'scripts/build.mjs')], { stdio: 'inherit', env: { ...process.env, SITE_URL: 'https://www.libalstal.example' } });

// ---------- harness ----------
const results = []; let current = '';
async function test(name, fn) {
  current = name; const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

// ---------- servers ----------
const hooks = [];
const mock = createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { hooks.push({ auth: req.headers.authorization, body: JSON.parse(b || '{}') }); res.end('ok'); }); });
await new Promise(r => mock.listen(4301, '127.0.0.1', r));
const procs = [];
function startServer(port, extra) {
  const p = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RFQ_STORAGE_DIR: join(OUT, `storage-${port}`), ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', d => (log += d)); p.stderr.on('data', d => (log += d)); p.getLog = () => log;
  procs.push(p); return p;
}
const A = 'http://127.0.0.1:4311', B = 'http://127.0.0.1:4312', C = 'http://127.0.0.1:4313';
startServer(4311, {});                                                              // RFQ not configured
const srvB = startServer(4312, { RFQ_WEBHOOK_URL: 'http://127.0.0.1:4301/hook', RFQ_WEBHOOK_TOKEN: 'tkn', RFQ_RATE_MAX: '50' });
startServer(4313, { RFQ_WEBHOOK_URL: 'http://127.0.0.1:4301/hook', RFQ_RATE_MAX: '2' });
for (const base of [A, B, C]) for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* wait */ } await new Promise(r => setTimeout(r, 100)); }

const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const DIST = join(ROOT, 'dist');
const pages = walk(DIST).filter(f => f.endsWith('index.html') && f !== join(DIST, 'index.html')).map(f => f.slice(DIST.length).replace(/index\.html$/, ''));

// test fixtures
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const DXF = Buffer.from('  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n');
writeFileSync(join(OUT, 'plan-test.pdf'), PDF); writeFileSync(join(OUT, 'coupe.dxf'), DXF); writeFileSync(join(OUT, 'virus.exe'), Buffer.from('MZ....'));
function rfqForm(over = {}) {
  const fd = new FormData();
  const base = { lang: 'fr', name: 'Test Ingénieur', company: 'ACME BET', email: 'test@example.com', phone: '+213 555 00 00 00', country: 'Algérie', category: 'elbows', timeline: '1', material: 'Galva 0,8', quantity: '40', requirements: 'Ø 315', consent: 'yes', website: '', ...over };
  for (const [k, v] of Object.entries(base)) if (v !== undefined) fd.append(k, v);
  return fd;
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] }); // software WebGL so the 3D hero really renders in CI
const CDN = /cdn\.jsdelivr\.net/; // blocked in the CI sandbox; hero falls back by design
// The browser's own WebGL failures (no GPU / broken software rasteriser) are not site errors: the 3D code catches
// them and keeps its static fallback. They are counted separately and reported at the end, never hidden.
const WEBGL_ENV = /^THREE\.WebGLRenderer: (A WebGL context could not be created|Error creating WebGL context)|^WebGL: CONTEXT_LOST_WEBGL|^THREE\.WebGLProgram: Shader Error|INVALID_OPERATION: (useProgram|drawElements)/;
const webglEnv = [];
async function newPage(opts = {}, b = browser) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error' || CDN.test(m.text()) || /ERR_TUNNEL|Failed to load resource/.test(m.text())) return;
    if (WEBGL_ENV.test(m.text())) webglEnv.push(m.text().slice(0, 100)); else page.errors.push(m.text());
  });
  return page;
}

console.log('\nHTTP & server');
await test('Montserrat is loaded and allowed by the CSP', async () => {
  const r = await fetch(A + '/fr/'); const csp = r.headers.get('content-security-policy'); const h = await r.text();
  const local = h.includes('/assets/fonts/montserrat.css');
  if (!local) { assert.match(h, /fonts\.googleapis\.com\/css2\?family=Montserrat/); assert.match(csp, /style-src 'self' https:\/\/fonts\.googleapis\.com/); assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/); }
  const css = await (await fetch(A + h.match(/href="(\/assets\/css\/site\.css[^"]*)"/)[1])).text();
  assert.match(css, /--font: "Montserrat"/);
  assert.match(css, /:root\[dir="rtl"\] \{ --font: "Montserrat", "Cairo"/);
  if (!local) { assert.match(await (await fetch(A + '/ar/')).text(), /family=Cairo:wght@400\.\.700&family=Montserrat/); assert.doesNotMatch(h, /Cairo/); }
});
await test('every built page returns 200 with security headers', async () => {
  for (const p of pages) {
    const r = await fetch(A + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-security-policy') || '', /default-src 'self'/, p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
});
await test('all internal links and assets resolve (no dead links)', async () => {
  const seen = new Set(); const bad = [];
  for (const p of pages) {
    const html = await (await fetch(A + p)).text();
    for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) seen.add(m[1]);
  }
  for (const u of seen) { if (u.startsWith('/api/')) continue; const r = await fetch(A + u); if (r.status !== 200) bad.push(`${r.status} ${u}`); }
  assert.deepEqual(bad, [], 'dead: ' + bad.join(', '));
  assert.ok(seen.size > 40, 'link count');
});
await test('external links are only the declared ones', async () => {
  const ext = new Set();
  for (const p of pages) for (const m of (await (await fetch(A + p)).text()).matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/g)) if (!m[1].startsWith('https://www.libalstal.example')) ext.add(m[1]);
  assert.deepEqual([...ext].sort(), ['https://wa.me/213561631942', 'https://www.facebook.com/Libalstal/', 'https://www.google.com/maps/search/?api=1&amp;query=Zaouia%20Center%2C%20Beni%20Tamou%2C%20Blida%2C%20Algeria'].sort());
});
await test('root redirects by Accept-Language; unknown paths 404 in the right language', async () => {
  const r = await fetch(A + '/', { redirect: 'manual', headers: { 'Accept-Language': 'ar-DZ,ar;q=0.9' } });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/ar/');
  const r2 = await fetch(A + '/', { redirect: 'manual', headers: { 'Accept-Language': 'de-DE' } }); assert.equal(r2.headers.get('location'), '/fr/');
  const nf = await fetch(A + '/en/does-not-exist/'); assert.equal(nf.status, 404); assert.match(await nf.text(), /<title>Page not found \| LIBALSTAL<\/title>/);
  const tr = await fetch(A + '/..%2f..%2fpackage.json'); assert.ok([403, 404].includes(tr.status));
});
await test('SEO files: sitemap with hreflang, robots, canonical, no draft pages indexed', async () => {
  const sm = await (await fetch(A + '/sitemap.xml')).text();
  assert.match(sm, /hreflang="ar"/); assert.doesNotMatch(sm, /projects\/modele/);
  assert.equal((sm.match(/<url>/g) || []).length, pages.filter(p => !p.includes('/projects/modele') && !p.includes('/assembly/')).length);
  assert.match(await (await fetch(A + '/robots.txt')).text(), /Sitemap: https:\/\/www\.libalstal\.example\/sitemap\.xml/);
  const home = await (await fetch(A + '/en/')).text();
  assert.match(home, /<link rel="canonical" href="https:\/\/www\.libalstal\.example\/en\/">/);
  assert.match(home, /"@type":"Organization"/);
  assert.doesNotMatch(home, /"@type":"Product"/, 'no Product schema without real data');
  assert.match(await (await fetch(A + '/fr/projects/modele/')).text(), /noindex/);
});

await test('precompressed static files: br/gzip negotiation, identical content, headers kept, API and images untouched', async () => {
  const { request } = await import('node:http');
  const { brotliDecompressSync, gunzipSync } = await import('node:zlib');
  const get = (path, ae, method = 'GET') => new Promise((res, rej) => {
    const r = request(A + path, { method, headers: ae == null ? {} : { 'Accept-Encoding': ae, Accept: 'application/json' } }, x => { const b = []; x.on('data', c => b.push(c)); x.on('end', () => res({ status: x.statusCode, h: x.headers, body: Buffer.concat(b) })); });
    r.on('error', rej); r.end();
  });
  const js = '/assets/vendor/three/build/three.module.min.js', orig = readFileSync(join(DIST, js));
  let r = await get(js, 'gzip, deflate, br');
  assert.equal(r.h['content-encoding'], 'br'); assert.equal(r.h.vary, 'Accept-Encoding');
  assert.equal(+r.h['content-length'], r.body.length); assert.ok(r.body.length < orig.length / 4);
  assert.deepEqual(brotliDecompressSync(r.body), orig);
  assert.match(r.h['content-type'], /^text\/javascript/); assert.equal(r.h['x-content-type-options'], 'nosniff'); assert.match(r.h['content-security-policy'], /default-src 'self'/);
  r = await get(js, 'br;q=0, gzip'); assert.equal(r.h['content-encoding'], 'gzip'); assert.deepEqual(gunzipSync(r.body), orig);
  r = await get(js, null); assert.equal(r.h['content-encoding'], undefined); assert.deepEqual(r.body, orig);
  r = await get(js, 'identity'); assert.equal(r.h['content-encoding'], undefined);
  r = await get(js, 'br', 'HEAD'); assert.equal(r.h['content-encoding'], 'br'); assert.equal(r.body.length, 0);
  r = await get('/fr/assembly/', 'br'); assert.equal(r.h['content-encoding'], 'br'); assert.equal(r.h['cache-control'], 'no-cache');
  assert.equal(brotliDecompressSync(r.body).toString(), readFileSync(join(DIST, 'fr/assembly/index.html'), 'utf8'));
  r = await get('/assets/img/logo-480.webp', 'br, gzip'); assert.equal(r.h['content-encoding'], undefined); assert.equal(r.h.vary, undefined);
  r = await get('/en/does-not-exist/', 'br'); assert.equal(r.status, 404); assert.equal(r.h['content-encoding'], undefined);
  const api = await new Promise((res, rej) => { const q = request(A + '/api/rfq', { method: 'POST', headers: { 'Accept-Encoding': 'br, gzip', Accept: 'application/json', 'Content-Type': 'multipart/form-data; boundary=x' } }, x => { x.resume(); x.on('end', () => res(x)); }); q.on('error', rej); q.end('--x--\r\n'); });
  assert.equal(api.statusCode, 503); assert.equal(api.headers['content-encoding'], undefined);
});

console.log('\nRFQ API');
await test('not configured → 503 not_configured, nothing stored', async () => {
  const r = await fetch(A + '/api/rfq', { method: 'POST', body: rfqForm(), headers: { Accept: 'application/json' } });
  assert.equal(r.status, 503); assert.equal((await r.json()).error, 'not_configured');
  assert.ok(!existsSync(join(OUT, 'storage-4311')) || walk(join(OUT, 'storage-4311')).length === 0);
});
await test('GET /api/rfq → 405', async () => { assert.equal((await fetch(B + '/api/rfq')).status, 405); });
await test('server-side validation rejects bad input', async () => {
  const cases = [{ email: 'nope' }, { consent: undefined }, { category: 'rocket' }, { name: 'x' }, { website: 'http://spam' }, { timeline: '9' }];
  for (const c of cases) {
    const r = await fetch(B + '/api/rfq', { method: 'POST', body: rfqForm(c), headers: { Accept: 'application/json' } });
    assert.equal(r.status, 400, JSON.stringify(c)); assert.equal((await r.json()).error, 'invalid');
  }
});
await test('file checks: wrong extension, spoofed PDF, too many files are rejected', async () => {
  let fd = rfqForm(); fd.append('files', new Blob([Buffer.from('MZ')]), 'x.exe');
  assert.equal((await fetch(B + '/api/rfq', { method: 'POST', body: fd, headers: { Accept: 'application/json' } })).status, 400);
  fd = rfqForm(); fd.append('files', new Blob([Buffer.from('not a pdf at all')]), 'fake.pdf');
  assert.equal((await fetch(B + '/api/rfq', { method: 'POST', body: fd, headers: { Accept: 'application/json' } })).status, 400);
  fd = rfqForm(); for (let i = 0; i < 6; i++) fd.append('files', new Blob([PDF]), `p${i}.pdf`);
  assert.equal((await fetch(B + '/api/rfq', { method: 'POST', body: fd, headers: { Accept: 'application/json' } })).status, 400);
});
await test('valid request → stored privately + webhook notified + reference returned', async () => {
  hooks.length = 0;
  const fd = rfqForm(); fd.append('files', new Blob([PDF]), 'plan ../../etc.pdf'); fd.append('files', new Blob([DXF]), 'coupe.dxf');
  const r = await fetch(B + '/api/rfq', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
  const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); assert.match(j.ref, /^RFQ-\d{8}-[0-9A-F]{6}$/);
  const dir = join(OUT, 'storage-4312', j.ref);
  const rec = JSON.parse(readFileSync(join(dir, 'request.json'), 'utf8'));
  assert.equal(rec.status, 'notified'); assert.equal(rec.files.length, 2);
  assert.ok(rec.files.every(f => !f.name.includes('/') && !f.name.startsWith('.')), 'sanitised names');
  assert.equal((statSync(join(dir, 'request.json')).mode & 0o777).toString(8), '600');
  assert.equal(hooks.length, 1); assert.equal(hooks[0].auth, 'Bearer tkn'); assert.equal(hooks[0].body.ref, j.ref);
  assert.equal((await fetch(B + '/storage/rfq/' + j.ref + '/request.json')).status, 404, 'storage not web-accessible');
});
await test('rate limiting → 429 after the limit', async () => {
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await fetch(C + '/api/rfq', { method: 'POST', body: rfqForm(), headers: { Accept: 'application/json' } })).status);
  assert.deepEqual(codes, [200, 200, 429]);
});
await test('cross-origin POST is refused', async () => {
  const r = await fetch(B + '/api/rfq', { method: 'POST', body: rfqForm(), headers: { Accept: 'application/json', Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

console.log('\nBrowser: navigation & UI');
await test('desktop nav, language switch keeps the page, theme persists', async () => {
  const p = await newPage();
  await p.goto(A + '/fr/');
  await p.click('.nav-links a[href="/fr/products/"]');
  await p.waitForURL('**/fr/products/'); assert.equal(await p.textContent('h1'), 'Systèmes de gaines & accessoires');
  assert.equal(await p.getAttribute('.nav-links a[href="/fr/products/"]', 'aria-current'), 'page');
  await p.click('.lang a[hreflang="ar"]'); await p.waitForURL('**/ar/products/');
  assert.equal(await p.getAttribute('html', 'dir'), 'rtl'); assert.equal(await p.getAttribute('html', 'lang'), 'ar');
  assert.equal(await p.getAttribute('html', 'data-theme'), 'dark');
  await p.click('.theme-btn'); assert.equal(await p.getAttribute('html', 'data-theme'), 'light');
  await p.reload(); assert.equal(await p.getAttribute('html', 'data-theme'), 'light');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('mobile menu: open, Escape closes and returns focus, contact reachable', async () => {
  const p = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await p.goto(A + '/en/');
  assert.equal(await p.isVisible('.site-nav'), false);
  await p.click('.burger'); assert.equal(await p.getAttribute('.burger', 'aria-expanded'), 'true');
  assert.ok(await p.isVisible('.nav-contact a'));
  await p.keyboard.press('Escape'); assert.equal(await p.getAttribute('.burger', 'aria-expanded'), 'false');
  assert.equal(await p.evaluate(() => document.activeElement.classList.contains('burger')), true);
  await p.click('.burger'); await p.click('.nav-contact a'); await p.waitForURL('**/en/contact/');
  await p.context().close();
});
await test('product filter updates cards, count and URL', async () => {
  const p = await newPage(); await p.goto(A + '/fr/products/');
  await p.click('.chip[data-filter="fit"]');
  assert.equal(await p.locator('.card:visible').count(), 3);
  assert.equal(await p.textContent('.count'), '3 produit(s)');
  assert.match(p.url(), /#cat=fit$/);
  await p.reload(); assert.equal(await p.locator('.card:visible').count(), 3, 'state from hash');
  await p.click('.chip[data-filter="all"]'); assert.equal(await p.locator('.card:visible').count(), 8);
  await p.context().close();
});
await test('product page CTA pre-fills the quote form', async () => {
  const p = await newPage(); await p.goto(A + '/en/products/elbows/');
  await p.click('.cta-box a'); await p.waitForURL(/contact\/\?product=elbows/);
  await p.fill('#f-name', 'A B'); await p.fill('#f-company', 'C'); await p.fill('#f-email', 'a@b.co'); await p.fill('#f-country', 'DZ');
  await p.click('[data-action="next"]');
  assert.equal(await p.inputValue('#f-category'), 'elbows');
  assert.match(await p.inputValue('#f-req'), /Product: Elbows/);
  await p.context().close();
});
await test('hero: 3D renders within the draw-call budget (or falls back cleanly)', async () => {
  const p = await newPage(); const info = []; p.on('console', m => { if (m.text().startsWith('[hero3d]')) info.push(m.text()); });
  await p.goto(A + '/fr/?debug3d'); await p.waitForFunction(() => document.getElementById('hero-art').classList.contains('is-3d') || performance.now() > 12000, null, { timeout: 15000 }).catch(() => {});
  const st = await p.evaluate(() => ({ is3d: document.getElementById('hero-art').classList.contains('is-3d'), tag: document.querySelector('.hero-tag').textContent, fb: getComputedStyle(document.querySelector('.hero-fallback')).opacity }));
  if (st.is3d) {
    assert.match(st.tag, /3D conceptuel/);
    const m = info.join(' ').match(/first frame: (\d+) draw calls/); assert.ok(m, 'debug info logged');
    assert.ok(+m[1] <= 12, `draw calls ${m[1]} > 12`);
    console.log(`      (3D rendered: ${m[1]} draw calls)`);
  } else { assert.match(st.tag, /Visuel conceptuel/); assert.equal(st.fb, '1'); console.log('      (3D unavailable → static fallback shown)'); }
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('reduced motion: content visible without animation', async () => {
  const p = await newPage({ reducedMotion: 'reduce' }); await p.goto(A + '/fr/');
  assert.equal(await p.evaluate(() => [...document.querySelectorAll('.rv')].every(e => getComputedStyle(e).opacity === '1')), true);
  await p.context().close();
});

console.log('\n3D assembly (development page)');
const ASM_DEMO = { fr: 'Modèle de démonstration', en: 'Demonstration model', ar: 'نموذج توضيحي' };
const ASM_PENDING = { fr: 'Spécification à confirmer', en: 'Specification pending', ar: 'المواصفات قيد التأكيد' };
const asmState = p => p.evaluate(() => ({ state: document.querySelector('.asm-view').dataset.state, status: document.querySelector('.asm-status').textContent }));
await test('assembly pages: noindex, out of sitemap and navigation, demo and pending labels in FR/EN/AR', async () => {
  for (const l of ['fr', 'en', 'ar']) {
    const r = await fetch(`${A}/${l}/assembly/`); assert.equal(r.status, 200);
    const h = await r.text();
    assert.match(h, /<meta name="robots" content="noindex, nofollow">/);
    assert.doesNotMatch(h, /rel="canonical"/);
    assert.ok(h.includes(ASM_DEMO[l]) && h.includes(ASM_PENDING[l]), l);
    assert.match(h, /<svg class="asm-svg"[^>]*role="img" aria-labelledby="asm-svg-t"/);
    assert.equal((h.match(/class="asm-part"/g) || []).length, 8);
    assert.match(h, new RegExp(`href="/${l}/contact/\\?product=tees-branches"`));
  }
  assert.doesNotMatch(await (await fetch(A + '/sitemap.xml')).text(), /assembly/);
  for (const p of pages.filter(p => !p.includes('/assembly/'))) assert.doesNotMatch(await (await fetch(A + p)).text(), /\/assembly\//, `${p} links to the dev page`);
});
await test('lazy loading: no 3D code elsewhere; on the page nothing 3D until the view approaches', async () => {
  const p = await newPage({ viewport: { width: 390, height: 200 } }); const reqs = [];
  p.on('request', r => reqs.push(new URL(r.url()).pathname));
  for (const path of ['/fr/products/', '/fr/contact/', '/en/company/']) { await p.goto(A + path, { waitUntil: 'load' }); await p.waitForTimeout(300); }
  assert.deepEqual(reqs.filter(u => /assembly|three/.test(u)), [], 'other pages request no assembly or three.js code');
  reqs.length = 0;
  await p.goto(A + '/fr/assembly/', { waitUntil: 'load' }); await p.waitForTimeout(1200);
  assert.deepEqual(reqs.filter(u => /viewer\.js|three/.test(u)), [], 'nothing 3D before the view is near');
  assert.equal((await asmState(p)).state, 'preview');
  await p.locator('.asm-view').scrollIntoViewIfNeeded();
  await p.waitForFunction(() => document.querySelector('.asm-view').dataset.state !== 'preview', null, { timeout: 8000 });
  const st = await asmState(p);
  if (st.state === 'fallback') assert.match(st.status, /n'est pas disponible/); // no WebGL 2 here → no download at all
  else assert.ok(reqs.some(u => u.endsWith('/assembly/viewer.js')), 'viewer requested on approach');
  console.log(`      (after scrolling: ${st.state})`);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('production: assembly modules, import map and CSP load without violations', async () => {
  const p = await newPage(); const refused = [];
  p.on('console', m => { if (/Refused to|Content Security Policy/i.test(m.text())) refused.push(m.text()); });
  const r = await p.goto(A + '/fr/assembly/');
  assert.match(r.headers()['content-security-policy'], /script-src 'self' 'sha256-/);
  const mods = await p.evaluate(async () => {
    const [v, T, oc, g] = await Promise.all([import('/assets/js/assembly/viewer.js'), import('three'), import('three/addons/controls/OrbitControls.js'), import('/assets/js/assembly/geometry.js')]);
    return { createViewer: typeof v.createViewer, revision: T.REVISION, orbit: typeof oc.OrbitControls, types: g.PART_TYPES.length };
  });
  assert.deepEqual(mods, { createViewer: 'function', revision: '170', orbit: 'function', types: 6 });
  assert.deepEqual(refused, []); assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('server: three.js, OrbitControls and assembly modules — paths, MIME, headers; CSP covers every import map', async () => {
  const html = await (await fetch(A + '/fr/assembly/')).text();
  const map = html.match(/<script type="importmap">([^<]*)<\/script>/)[1];
  const imports = JSON.parse(map).imports;
  const urls = [imports.three, imports['three/addons/'] + 'controls/OrbitControls.js', imports['three/addons/'] + 'environments/RoomEnvironment.js',
    html.match(/src="(\/assets\/js\/assembly\/boot\.js\?v=[^"]+)"/)[1], ...['viewer', 'geometry', 'assembly', 'units', 'motion'].map(n => imports[`/assets/js/assembly/${n}.js`])];
  for (const u of urls) {
    const r = await fetch(A + u);
    assert.equal(r.status, 200, u);
    assert.match(r.headers.get('content-type'), /^text\/javascript/, u);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', u);
    assert.match(r.headers.get('content-security-policy') || '', /default-src 'self'/, u);
  }
  for (const n of ['viewer', 'geometry', 'assembly', 'units', 'motion']) assert.match(imports[`/assets/js/assembly/${n}.js`], /\?v=[0-9a-f]{10}$/, `${n} is versioned (cache busting)`);
  const { createHash } = await import('node:crypto');
  const csp = (await fetch(A + '/fr/assembly/')).headers.get('content-security-policy');
  for (const page of ['/fr/assembly/', '/fr/']) {
    const m = (await (await fetch(A + page)).text()).match(/<script type="importmap">([^<]*)<\/script>/)[1];
    assert.ok(csp.includes(`'sha256-${createHash('sha256').update(m).digest('base64')}'`), `CSP allows the import map of ${page}`);
  }
});
await test('?debug3d=1 diagnostics panel: WebGL, renderer status, selection; absent without the flag', async () => {
  const p = await newPage();
  await p.goto(A + '/fr/assembly/'); await p.waitForTimeout(500);
  assert.equal(await p.locator('.asm-diag').count(), 0, 'no panel for normal visitors');
  await p.goto(A + '/fr/assembly/?debug3d=1');
  await p.waitForFunction(() => ['3d', 'fallback'].includes(document.querySelector('.asm-view').dataset.state), null, { timeout: 30000 });
  const rows = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.asm-diag [data-key]')].map(r => [r.dataset.key, r.querySelector('dd').textContent])));
  for (const k of ['state', 'webgl', 'status', 'painted', 'shaderErrors', 'frames', 'draw', 'selected', 'resolution', 'context', 'contextEvent']) assert.ok(k in rows, k);
  assert.match(rows.webgl, /^WebGL 2 (available|NOT available)/);
  if (rows.state === '3d') assert.match(rows.status, /^rendered — first frame verified/);
  else assert.match(rows.status, /^(FAILED|not started)/);
  console.log(`      (diagnostics here: ${rows.webgl.slice(0, 60)} | ${rows.status.slice(0, 110)})`);
  await p.click('.asm-pick >> nth=2');
  assert.equal(await p.textContent('.asm-diag [data-key="selected"] dd'), 'duct-2');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('cinematic controls and translations are present on all three assembly pages', async () => {
  const names = ['explode', 'reassemble', 'replay', 'skip'];
  for (const lang of ['fr', 'en', 'ar']) {
    const h = await (await fetch(`${A}/${lang}/assembly/`)).text();
    for (const cmd of names) assert.match(h, new RegExp(`data-cmd="${cmd}"`), `${lang}: ${cmd}`);
    assert.match(h, /asm-tools/);
    const m = h.match(/<script type="importmap">([^<]+)<\/script>/);
    assert.ok(m && JSON.parse(m[1]).imports['/assets/js/assembly/motion.js'], `${lang}: versioned motion module`);
  }
});
await test('motion controller imports with production CSP and finishes reassembled', async () => {
  const p = await newPage(); await p.goto(A + '/fr/assembly/');
  const result = await p.evaluate(async () => {
    const { createMotion, INTRO_DURATION_MS } = await import('/assets/js/assembly/motion.js');
    const m = createMotion(); m.playIntro(); m.tick(3400);
    const top = m.state().factor;
    m.tick(INTRO_DURATION_MS - 3400);
    return { top, end: m.state() };
  });
  assert.equal(result.top, 1);
  assert.equal(result.end.mode, 'idle');
  assert.equal(result.end.factor, 0);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('reduced-motion preference disables cinematic replay without disabling static product access', async () => {
  const p = await newPage({ reducedMotion: 'reduce' }); await p.goto(A + '/en/assembly/');
  assert.equal(await p.isDisabled('[data-cmd="replay"]'), true);
  await p.click('.asm-pick >> nth=0');
  assert.ok(await p.isVisible('#part-duct-1'));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('renderer failure (simulated) keeps the SVG drawing and the part sheets; modules were loaded', async () => {
  const p = await newPage(); const reqs = [];
  p.on('request', r => reqs.push(new URL(r.url()).pathname + new URL(r.url()).search));
  await p.goto(A + '/fr/assembly/?debug3d=1&simulate=init');
  await p.waitForFunction(() => document.querySelector('.asm-view').dataset.state === 'fallback', null, { timeout: 30000 });
  assert.ok(reqs.some(u => /^\/assets\/js\/assembly\/viewer\.js\?v=/.test(u)), 'versioned viewer.js requested');
  assert.ok(reqs.some(u => u.startsWith('/assets/vendor/three/build/three.module.min.js')), 'three.js loaded before the failure');
  assert.match(await p.textContent('.asm-diag [data-key="status"] dd'), /FAILED: simulated renderer failure/);
  assert.ok(await p.isVisible('.asm-svg')); assert.equal(await p.locator('.asm-canvas canvas').count(), 0, 'no orphan canvas');
  assert.equal(await p.isVisible('.asm-tools'), false);
  await p.click('.asm-pick >> nth=0'); assert.ok(await p.isVisible('#part-duct-1'));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('part list and sheet: keyboard selection, focus moves to the sheet, Escape returns it', async () => {
  const p = await newPage(); await p.goto(A + '/fr/assembly/');
  assert.ok(await p.isVisible('.asm-empty'));
  assert.equal(await p.locator('.asm-part:visible').count(), 0, 'sheets hidden until a part is selected');
  await p.focus('.asm-pick >> nth=1'); await p.keyboard.press('Enter');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'part-elbow-1-h');
  assert.equal(await p.getAttribute('.asm-pick >> nth=1', 'aria-pressed'), 'true');
  const txt = await p.textContent('#part-elbow-1');
  for (const s of ['Coude 90°', ASM_DEMO.fr, ASM_PENDING.fr, '400 × 300 mm', '150 mm', 'Demander un devis']) assert.ok(txt.includes(s), s);
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.part), 'elbow-1');
  assert.equal(await p.getAttribute('.asm-pick >> nth=1', 'aria-pressed'), 'false');
  assert.ok(await p.isVisible('.asm-empty'));
  await p.click('.asm-pick >> nth=4'); await p.click('#part-reducer-1 .asm-close');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.part), 'reducer-1', 'close button returns focus');
  await p.click('.asm-pick >> nth=3'); await p.click('#part-tee-1 .btn-primary'); await p.waitForURL(/contact\/\?product=tees-branches/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('3D view renders, or keeps the drawing and says why (WebGL-dependent: reported, not assumed)', async () => {
  const p = await newPage(); const info = []; p.on('console', m => { if (m.text().startsWith('[assembly3d]')) info.push(m.text()); });
  await p.goto(A + '/fr/assembly/?debug3d');
  await p.waitForFunction(() => ['3d', 'fallback'].includes(document.querySelector('.asm-view').dataset.state), null, { timeout: 30000 });
  const st = await asmState(p);
  if (st.state === '3d') {
    assert.equal(await p.locator('.asm-canvas canvas').count(), 1);
    assert.ok(await p.isVisible('.asm-tools'));
    console.log(`      (3D rendered: ${info.join(' ')})`);
  } else {
    assert.ok(await p.isVisible('.asm-svg')); assert.equal(await p.isVisible('.asm-tools'), false, 'no dead controls');
    assert.match(st.status, /n'est pas disponible/);
    console.log(`      (UNVERIFIED: no working WebGL in this browser → static drawing kept. ${info.join(' ')})`);
  }
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('WebGL disabled: static drawing, full part list and sheets still work', async () => {
  const nogl = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
  const p = await newPage({ viewport: { width: 390, height: 844 } }, nogl); const reqs = [];
  p.on('request', r => reqs.push(new URL(r.url()).pathname));
  await p.goto(A + '/en/assembly/'); await p.locator('.asm-view').scrollIntoViewIfNeeded();
  await p.waitForFunction(() => document.querySelector('.asm-view').dataset.state === 'fallback', null, { timeout: 5000 });
  assert.match((await asmState(p)).status, /not available on this device/);
  assert.ok(await p.isVisible('.asm-svg')); assert.equal(await p.locator('.asm-pick').count(), 8);
  assert.deepEqual(reqs.filter(u => /viewer\.js|three/.test(u)), [], 'no 3D download without WebGL');
  await p.click('.asm-pick >> nth=7'); assert.ok(await p.isVisible('#part-branch-1'));
  assert.ok((await p.textContent('#part-branch-1')).includes('Specification pending'));
  assert.deepEqual(p.errors, []);
  await p.context().close(); await nogl.close();
});
await test('Arabic assembly page: RTL, Western digits, no overflow on a 390 px phone', async () => {
  const p = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await p.goto(A + '/ar/assembly/');
  assert.equal(await p.getAttribute('html', 'dir'), 'rtl');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  await p.tap('.asm-pick >> nth=1');
  const card = await p.textContent('#part-elbow-1');
  assert.ok(card.includes('400 × 300 mm') && card.includes('نموذج توضيحي'));
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#part-elbow-1 dd span[dir="ltr"]')).direction), 'ltr');
  assert.ok(await p.evaluate(() => document.querySelector('.asm-pick').getBoundingClientRect().height >= 44));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

console.log('\nBrowser: RFQ form');
await test('client validation: required, email, file type, focus management', async () => {
  const p = await newPage(); await p.goto(B + '/fr/contact/');
  await p.click('[data-action="next"]');
  assert.equal(await p.getAttribute('#f-name', 'aria-invalid'), 'true');
  assert.equal(await p.evaluate(() => document.activeElement.className), 'err-summary', 'several errors → linked summary focused');
  assert.equal(await p.textContent('#e-name'), 'Ce champ est obligatoire.');
  assert.equal(await p.locator('.err-summary a').count(), 4);
  await p.click('.err-summary a >> nth=0'); assert.equal(await p.evaluate(() => document.activeElement.id), 'f-name');
  await p.fill('#f-name', 'Jean Test'); await p.fill('#f-company', 'BET'); await p.fill('#f-email', 'pas-un-email'); await p.fill('#f-country', 'Algérie');
  await p.click('[data-action="next"]'); assert.equal(await p.textContent('#e-email'), 'Saisissez une adresse e-mail valide.');
  await p.fill('#f-email', 'jean@example.dz'); await p.click('[data-action="next"]');
  assert.ok(await p.isVisible('fieldset[data-step="1"]'));
  await p.selectOption('#f-category', 'rectangular-duct');
  await p.setInputFiles('#f-files', join(OUT, 'virus.exe'));
  assert.match(await p.textContent('#e-files'), /format non accepté/);
  await p.click('[data-action="next"]'); assert.ok(await p.isVisible('fieldset[data-step="1"]'), 'blocked on bad file');
  await p.context().close();
});
async function fillAll(p, base) {
  await p.goto(base + '/fr/contact/');
  await p.fill('#f-name', 'Jean Test'); await p.fill('#f-company', 'BET Est'); await p.fill('#f-email', 'jean@example.dz'); await p.fill('#f-country', 'Algérie');
  await p.click('[data-action="next"]');
  await p.selectOption('#f-category', 'spiral-round-duct'); await p.fill('#f-quantity', '120 ml'); await p.fill('#f-req', 'Ø 250 et 315, galva.');
  await p.setInputFiles('#f-files', [join(OUT, 'plan-test.pdf'), join(OUT, 'coupe.dxf')]);
  await p.click('[data-action="next"]');
}
await test('review step shows entered data; consent required', async () => {
  const p = await newPage(); await fillAll(p, B);
  const review = await p.textContent('#rfq-review');
  for (const s of ['Jean Test', 'BET Est', 'Gaine circulaire spiralée', 'plan-test.pdf', 'coupe.dxf', '120 ml']) assert.ok(review.includes(s), s);
  await p.click('[data-action="submit"]'); assert.equal(await p.textContent('#e-consent'), 'Votre accord est nécessaire pour traiter la demande.');
  await p.click('.edit-btn >> nth=0'); assert.ok(await p.isVisible('fieldset[data-step="0"]'));
  await p.context().close();
});
await test('submission when backend not configured → honest failure, no success state', async () => {
  const p = await newPage(); await fillAll(p, A);
  await p.check('#f-consent'); await p.click('[data-action="submit"]');
  await p.waitForSelector('#rfq-result:not([hidden])');
  assert.equal(await p.getAttribute('#rfq-result', 'class'), 'result fail');
  assert.match(await p.textContent('#rfq-result'), /pas encore activé.*Rien n'a été transmis/s);
  assert.equal(await p.getAttribute('#rfq-result', 'role'), 'alert');
  await p.context().close();
});
await test('submission with backend configured → success with reference, files received', async () => {
  hooks.length = 0;
  const p = await newPage(); await fillAll(p, B);
  await p.check('#f-consent'); await p.click('[data-action="submit"]');
  await p.waitForSelector('#rfq-result.ok');
  const txt = await p.textContent('#rfq-result'); const ref = /RFQ-\d{8}-[0-9A-F]{6}/.exec(txt)?.[0];
  assert.ok(ref, txt);
  assert.equal(hooks.at(-1).body.ref, ref); assert.equal(hooks.at(-1).body.files.length, 2);
  assert.equal(await p.evaluate(() => document.activeElement.id), 'rfq-result');
  assert.equal(await p.isVisible('[data-action="submit"]'), false, 'no resubmit after success');
  assert.equal(await p.isVisible('.steps'), false);
  assert.deepEqual(p.errors, []);
  await p.screenshot({ path: join(OUT, 'rfq-success.png') });
  await p.context().close();
});
await test('Arabic RTL form works end to end', async () => {
  hooks.length = 0;
  const p = await newPage({ viewport: { width: 390, height: 844 } }); await p.goto(B + '/ar/contact/');
  await p.fill('#f-name', 'محمد'); await p.fill('#f-company', 'شركة'); await p.fill('#f-email', 'm@example.dz'); await p.fill('#f-country', 'الجزائر');
  await p.click('[data-action="next"]'); await p.selectOption('#f-category', 'other'); await p.click('[data-action="next"]');
  await p.check('#f-consent'); await p.click('[data-action="submit"]');
  await p.waitForSelector('#rfq-result.ok'); assert.match(await p.textContent('#rfq-result'), /أُرسل الطلب/);
  assert.equal(hooks.at(-1).body.lang, 'ar');
  await p.context().close();
});

console.log('\nLayouts & accessibility');
const VIEWPORTS = [[375, 812, 'mobile'], [844, 390, 'landscape'], [768, 1024, 'tablet'], [1440, 900, 'desktop']];
await test(`no horizontal overflow, no JS errors: ${pages.length} pages × 4 viewports`, async () => {
  const bad = [];
  for (const [w, h, label] of VIEWPORTS) {
    const p = await newPage({ viewport: { width: w, height: h } });
    for (const path of pages) {
      p.errors.length = 0;
      await p.goto(A + path, { waitUntil: 'load' });
      const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (o > 0) bad.push(`${label} ${path} overflow ${o}px`);
      if (p.errors.length) bad.push(`${label} ${path} errors: ${p.errors.join('; ')}`);
    }
    await p.context().close();
  }
  assert.deepEqual(bad, []);
});
await test('screenshots: key pages at mobile / tablet / desktop', async () => {
  for (const [w, h, label] of VIEWPORTS) {
    const p = await newPage({ viewport: { width: w, height: h } });
    for (const path of ['/fr/', '/fr/products/', '/fr/contact/', '/ar/', '/en/quality/', '/fr/assembly/', '/ar/assembly/']) {
      await p.goto(A + path); await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 40)); } scrollTo({ top: 0, behavior: 'instant' }); });
      await p.waitForTimeout(800);
      await p.screenshot({ path: join(OUT, `${label}${path.replace(/\//g, '_')}.png`), fullPage: true });
    }
    await p.context().close();
  }
});

// Contrast (WCAG 1.4.3), target size (2.5.8), focus visible (2.4.7), names for controls.
const A11Y = () => {
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
  const bgOf = el => { let stack = []; for (let e = el; e; e = e.parentElement) { const b = parse(getComputedStyle(e).backgroundColor); if (b && b.a > 0) { stack.push(b); if (b.a >= 1) break; } } let c = [255, 255, 255]; for (const b of stack.reverse()) c = c.map((v, i) => b.c[i] * b.a + v * (1 - b.a)); return c; };
  const issues = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode; const el = n.parentElement;
    if (!n.textContent.trim() || seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden],.sr,.hp,.skip,[aria-hidden="true"]') || el.getClientRects().length === 0) continue;
    if (el.closest('.hero-art')) continue; // over the visual: checked manually (tag has its own dark plate)
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el); const f = fg.c.map((v, i) => v * fg.a + bg[i] * (1 - fg.a));
    const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) issues.push(`contrast ${ratio.toFixed(2)} < ${need} "${n.textContent.trim().slice(0, 40)}"`);
  }
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea')) {
    if (el.closest('.hp,[hidden]') || el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p,dd,address,li');
    if (!inline && (r.width < 44 || r.height < 44) && !el.closest('.err-summary')) issues.push(`target ${Math.round(r.width)}×${Math.round(r.height)} ${el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
    const name = (el.getAttribute('aria-label') || el.textContent || '').trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) || el.querySelector('img')?.alt;
    if (!name) issues.push(`no accessible name: ${el.outerHTML.slice(0, 60)}`);
  }
  return issues;
};
await test('contrast, target size and accessible names (dark + light, FR/AR)', async () => {
  const all = [];
  for (const theme of ['dark', 'light']) {
    const p = await newPage({ viewport: { width: 1280, height: 900 } });
    if (theme === 'light') await p.addInitScript(() => { try { localStorage.setItem('libalstal-theme', 'light'); } catch { } });
    for (const path of ['/fr/', '/fr/products/', '/fr/products/elbows/', '/fr/capabilities/', '/fr/quality/', '/fr/company/', '/fr/contact/', '/ar/', '/ar/contact/', '/en/privacy/', '/fr/projects/', '/fr/assembly/', '/ar/assembly/']) {
      await p.goto(A + path); await p.emulateMedia({ reducedMotion: 'reduce' });
      await p.evaluate(() => document.querySelectorAll('.rv').forEach(e => e.classList.add('in')));
      if (path.endsWith('/assembly/')) await p.click('.asm-pick >> nth=3'); // check an open part sheet too
      await p.waitForTimeout(50);
      for (const i of await p.evaluate(A11Y)) all.push(`${theme} ${path}: ${i}`);
    }
    await p.context().close();
  }
  assert.deepEqual([...new Set(all)], []);
});
await test('large text (200%) and 375px: no overflow, nothing clipped', async () => {
  const p = await newPage({ viewport: { width: 375, height: 812 } }); const bad = [];
  for (const path of ['/fr/', '/fr/contact/', '/ar/', '/en/products/elbows/']) {
    await p.goto(A + path); await p.evaluate(() => document.documentElement.style.setProperty('font-size', '200%', 'important')); await p.waitForTimeout(100);
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 0) bad.push(`${path} overflow ${o}px`);
  }
  assert.deepEqual(bad, []);
  await p.context().close();
});
await test('keyboard: skip link first, focus always visible', async () => {
  const p = await newPage(); await p.goto(A + '/fr/');
  await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => document.activeElement.className), 'skip');
  assert.ok(await p.isVisible('.skip'));
  const missing = [];
  for (let i = 0; i < 25; i++) {
    await p.keyboard.press('Tab');
    const s = await p.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { tag: e.tagName + (e.className ? '.' + e.className : ''), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }; });
    if (!s.outline) missing.push(s.tag);
  }
  assert.deepEqual(missing, []);
  await p.keyboard.press('Shift+Tab');
  await p.goto(A + '/fr/'); await p.keyboard.press('Tab'); await p.keyboard.press('Enter');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'main');
  await p.context().close();
});

// ---------- teardown ----------
await browser.close();
for (const p of procs) p.kill();
mock.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tests passed`);
if (webglEnv.length) console.log(`WebGL unavailable in this test browser (${webglEnv.length} context/shader errors, e.g. "${webglEnv[0]}"): 3D rendering NOT verified here.`);
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
if (failed.length && srvB) console.log('\nserver B log (tail):\n' + srvB.getLog().split('\n').slice(-15).join('\n'));
process.exit(failed.length ? 1 : 0);

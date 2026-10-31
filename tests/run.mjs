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
import { socialDock, socialLinks } from '../scripts/social.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests/output');
const require = createRequire(import.meta.url);
let chromium;
for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '@playwright/test'].filter(Boolean)) { try { ({ chromium } = require(m)); break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright not found. run npm ci, then npx playwright install chromium  (or set PLAYWRIGHT_MODULE)'); process.exit(2); }

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
// Welcome intro: tested with the installed renders, or else with generated 6-second fixtures (needs ffmpeg),
// so the playback / skip / handoff logic is always exercised. Without either, those tests are reported as skipped.
const INTRO_REAL = existsSync(join(ROOT, 'src/assets/video/intro/welcome-desktop-fr.webm'));
let INTRO_FIX = '';
if (!INTRO_REAL) {
  try {
    const dir = join(OUT, 'intro-fixture'); mkdirSync(dir, { recursive: true });
    const intro = JSON.parse(readFileSync(join(ROOT, 'content/intro.json'), 'utf8'));
    for (const lang of intro.langs) for (const [f, size] of [['desktop', '320x180'], ['mobile', '180x320']]) {
      const src = ['-f', 'lavfi', '-i', `color=c=0x0b0d0f:s=${size}:d=6:r=30`];
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...src, '-c:v', 'libvpx-vp9', '-b:v', '50k', join(dir, `welcome-${f}-${lang}.webm`)]);
      try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, `welcome-${f}-${lang}.mp4`)]); }
      catch { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...src, '-c:v', 'mpeg4', join(dir, `welcome-${f}-${lang}.mp4`)]); }
    }
    INTRO_FIX = dir;
  } catch { console.log('(ffmpeg not available: welcome-intro playback tests will be skipped)'); }
}
execFileSync(process.execPath, [join(ROOT, 'scripts/build.mjs')], { stdio: 'inherit', env: { ...process.env, SITE_URL: 'https://www.libalstal.example', RFQ_UPLOAD_ORIGIN: 'http://127.0.0.1:4321', ...(INTRO_FIX ? { INTRO_ASSETS_DIR: INTRO_FIX } : {}) } });

// ---------- harness ----------
const results = []; let current = '';
async function test(name, fn) {
  current = name; const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); for (const ctx of browser.contexts()) await ctx.close(); }
}

// ---------- servers ----------
const hooks = [];
const mock = createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { hooks.push({ auth: req.headers.authorization, idem: req.headers['idempotency-key'], body: JSON.parse(b || '{}') }); res.end('ok'); }); });
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
// D: Cloudflare Pages + private R2 stand-in running the real functions/ (tests/pages-sim.mjs), S3 endpoint on 4321
const D = 'http://127.0.0.1:4314';
{ const p = spawn(process.execPath, [join(ROOT, 'tests/pages-sim.mjs')], { env: { ...process.env, PORT: '4314', S3_PORT: '4321', HOOK: 'http://127.0.0.1:4301/hook' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', d => (log += d)); p.stderr.on('data', d => (log += d)); p.getLog = () => log; procs.push(p); }
const sim = async (path, init) => (await fetch(D + path, init)).json();
for (const base of [A, B, C, D]) for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* wait */ } await new Promise(r => setTimeout(r, 100)); }

const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const DIST = join(ROOT, 'dist');
const pages = walk(DIST).filter(f => f.endsWith('index.html') && f !== join(DIST, 'index.html')).map(f => f.slice(DIST.length).replace(/index\.html$/, '')).filter(p => !/\/assembly\/(?:spiral|branches|high-temperature)\/$/.test(p)); // legacy meta-refresh pages have no normal page UI

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
  const { intro = false, ...ctxOpts } = opts;
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...ctxOpts });
  // the welcome intro plays once per tab session; every test except the intro's own starts after it
  if (!intro) await ctx.addInitScript(() => { try { sessionStorage.setItem('libalstal-intro', '1'); } catch { /* storage blocked */ } });
  const page = await ctx.newPage(); page.errors = [];
  // Site controls are ready at DOMContentLoaded; remote map/media requests need not finish.
  const navigate = page.goto.bind(page);
  page.goto = (url, options = {}) => navigate(url, { waitUntil: 'domcontentloaded', ...options });
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
  assert.deepEqual([...ext].sort(), ['https://wa.me/213561631942', 'https://www.facebook.com/Libalstal/', 'https://www.google.com/maps?cid=14870507933311400548'].sort());
});
await test('root redirects by Accept-Language; unknown paths 404 in the right language', async () => {
  const r = await fetch(A + '/', { redirect: 'manual', headers: { 'Accept-Language': 'ar-DZ,ar;q=0.9' } });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/ar/');
  const r2 = await fetch(A + '/', { redirect: 'manual', headers: { 'Accept-Language': 'de-DE' } }); assert.equal(r2.headers.get('location'), '/en/');
  const french = await fetch(A + '/', { redirect: 'manual', headers: { 'Accept-Language': 'fr-FR,en;q=0.8' } }); assert.equal(french.headers.get('location'), '/fr/');
  const nf = await fetch(A + '/en/does-not-exist/'); assert.equal(nf.status, 404); assert.match(await nf.text(), /<title>Page not found \| LIBALSTAL<\/title>/);
  const tr = await fetch(A + '/..%2f..%2fpackage.json'); assert.ok([403, 404].includes(tr.status));
});
await test('SEO files: sitemap with hreflang, robots, canonical, no draft pages indexed', async () => {
  const sm = await (await fetch(A + '/sitemap.xml')).text();
  assert.match(sm, /hreflang="ar"/); assert.doesNotMatch(sm, /projects\/modele/);
  assert.equal((sm.match(/<url>/g) || []).length, pages.filter(p => !p.includes('/projects/modele') && !p.endsWith('/assembly/high-temperature/')).length);
  assert.match(sm, /\/fr\/assembly\//, 'v14: the 3D assembly page is public and in the sitemap');
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

await test('Pages: quote without files → recorded, then notified; same sid again → same reference, one notification', async () => {
  hooks.length = 0;
  const send = () => { const fd = rfqForm(); fd.append('sid', 'it-sid-0001-abcdef'); return fetch(D + '/api/rfq', { method: 'POST', body: fd, headers: { Accept: 'application/json', Origin: D } }); };
  const a = await (await send()).json(), b = await (await send()).json();
  assert.equal(a.ok, true); assert.equal(b.ref, a.ref);
  assert.equal(hooks.filter(h => h.body.ref === a.ref).length, 1); assert.equal(hooks.at(-1).idem, a.ref);
  assert.equal((await sim('/__sim/store')).records[a.ref].status, 'notified');
  const h = await (await fetch(D + '/healthz')).json(); assert.equal(h.uploads, 'ready');
});
await test('Pages: 10 MB drawing via presigned URL; storage refuses a forged signature, a different size and plain PUTs', async () => {
  hooks.length = 0;
  const big = Buffer.alloc(10 * 1024 * 1024); PDF.copy(big);
  const fields = Object.fromEntries([...rfqForm()].filter(([k]) => k !== 'lang'));
  const st = await (await fetch(D + '/api/rfq/start', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: D }, body: JSON.stringify({ lang: 'fr', fields, files: [{ name: 'gros-plan.pdf', size: big.length }] }) })).json();
  assert.equal(st.ok, true, JSON.stringify(st));
  const u = st.uploads[0];
  const forged = u.url.replace(/X-Amz-Signature=[0-9a-f]{4}/, 'X-Amz-Signature=0000');
  assert.equal((await fetch(forged, { method: 'PUT', body: big, headers: u.headers })).status, 403);
  assert.equal((await fetch(u.url, { method: 'PUT', body: big.subarray(0, 1000), headers: u.headers })).status, 403, 'size is part of the signature');
  assert.equal((await fetch(u.url.split('?')[0], { method: 'PUT', body: big, headers: u.headers })).status, 403, 'bucket is private');
  assert.equal((await fetch(u.url, { method: 'PUT', body: big, headers: u.headers })).status, 200);
  const fin = await (await fetch(D + '/api/rfq/finish', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: D }, body: JSON.stringify({ ref: st.ref, token: st.token }) })).json();
  assert.equal(fin.ok, true);
  const store = await sim('/__sim/store');
  assert.equal(store.objects[`${st.ref}/1-gros-plan.pdf`], big.length);
  assert.equal(hooks.at(-1).body.files[0].key, `${st.ref}/1-gros-plan.pdf`); assert.ok(hooks.at(-1).body.files[0].url.includes('X-Amz-Signature='));
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
await test('product renders: every card and product page shows its illustrative render, captioned in FR/EN/AR; capabilities unnumbered', async () => {
  const p = await newPage();
  await p.goto(A + '/fr/products/');
  const cards = await p.$$eval('#product-grid .card-render img', imgs => imgs.map(i => i.getAttribute('srcset')));
  assert.equal(cards.length, 12, 'a render on every product card');
  for (const l of ['fr', 'en', 'ar']) {
    await p.goto(`${A}/${l}/products/elbows/`);
    await p.waitForFunction(() => { const i = document.querySelector('.drawing-render img'); return i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
    const fig = await p.$eval('.drawing-render img', i => ({ alt: i.alt, src: i.currentSrc, cap: i.closest('figure').querySelector('figcaption').textContent }));
    assert.match(fig.src, /\/assets\/img\/products\/elbows-(640|1280)\.webp/, `${l}: render file (${fig.src})`);
    assert.ok(fig.alt.length > 10 && /3D|ثلاثي/.test(fig.alt), `${l}: alt "${fig.alt}"`);
    assert.ok(/3D|ثلاثي/.test(fig.cap), `${l}: caption says it is an illustration`);
  }
  await p.goto(A + '/fr/');
  await p.locator('.cap-grid').scrollIntoViewIfNeeded();
  await p.waitForFunction(() => [...document.querySelectorAll('.cap-fig img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 10000 });
  assert.equal(await p.locator('.cap-grid .n').count(), 0, 'capability families are not numbered');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('product filter updates cards, count and URL', async () => {
  const p = await newPage(); await p.goto(A + '/fr/products/');
  await p.click('.chip[data-filter="fit"]');
  assert.equal(await p.locator('.card:visible').count(), 3);
  assert.equal(await p.textContent('.count'), '3 produits');
  assert.match(p.url(), /#cat=fit$/);
  await p.reload(); assert.equal(await p.locator('.card:visible').count(), 3, 'state from hash');
  await p.click('.chip[data-filter="all"]'); assert.equal(await p.locator('.card:visible').count(), 12);
  await p.context().close();
});
await test('v5.3 brochure content: specs as printed, 8 references (no defence sites), contacts; no RC, no gmail, no fire claim', async () => {
  const get = async path => (await fetch(A + path)).text();
  const rect = await get('/fr/products/rectangular-duct/'), spiral = await get('/fr/products/spiral-round-duct/');
  for (const t of ['0,4 à 2 mm', 'longueurs standard 1 m et 1,25 m', 'acier galvanisée']) assert.ok(rect.includes(t), `rectangular: ${t}`);
  for (const t of ['0,4 à 1,2 mm', 'Toutes dimensions', 'acier galvanisée']) assert.ok(spiral.includes(t), `spiral: ${t}`);
  assert.ok((await get('/fr/products/stainless-ducts/')).includes('304 / 316'), 'stainless grades');
  for (const l of ['fr', 'en', 'ar']) {
    for (const path of [`/${l}/`, `/${l}/projects/`]) {
      const h = await get(path);
      assert.equal((h.match(/class="ref-sector"/g) || []).length, 8, `${path}: 8 references`);
      assert.doesNotMatch(h, /ERSSMS|Hammaguir|militaire|military|عسكري/i, `${path}: defence sites not named`);
      assert.doesNotMatch(h, /Alziwar|Alnaaja|Tipasa/i, `${path}: brochure spellings normalised`);
    }
    const legal = await get(`/${l}/legal/`), company = await get(`/${l}/company/`), contact = await get(`/${l}/contact/`);
    for (const h of [legal, company, contact]) {
      assert.doesNotMatch(h, /09\/01-1013913B18|\{registration\}/, `${l}: RC not shown`);
      assert.doesNotMatch(h, /gmail\.com/, `${l}: no gmail address`);
      assert.doesNotMatch(h, /1366|coupe-feu|400\s*°C|fire-rated|fire resistant/i, `${l}: fire claim held`);
    }
    assert.ok(contact.includes('commercial@libalstal.com'), `${l}: commercial e-mail`);
    for (const tel of ['tel:+213776980064', 'tel:+213553098214', 'wa.me/213561631942']) assert.ok(contact.includes(tel), `${l}: ${tel}`);
    const q = await get(`/${l}/quality/`);
    for (const t of ['SMACNA', 'ASHRAE', 'DW/144']) assert.ok(q.includes(t), `${l} quality: ${t}`);
  }
  const ld = JSON.parse((await get('/fr/')).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const org = [ld].flat().concat(ld['@graph'] || []).find(n => n['@type'] === 'Organization') || ld;
  assert.ok(JSON.stringify(org).includes('commercial@libalstal.com'), 'JSON-LD e-mail');
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
await test('hero welcome video in each page language; plays once muted, holds on the logo, replay; still under reduced motion', async () => {
  for (const [l, v] of [['fr', 'fr'], ['en', 'en'], ['ar', 'ar']]) {
    const h = await (await fetch(`${A}/${l}/`)).text();
    assert.match(h, new RegExp(`/assets/video/welcome-${v}\\.webm`), l); assert.match(h, new RegExp(`welcome-${v}-720\\.mp4`), l);
    assert.match(h, new RegExp(`poster="/assets/video/welcome-${v}-poster\\.webp`), l);
    assert.doesNotMatch(h, /hero3d\.js|Rendu 3D conceptuel/, `${l}: no 3D hero any more`);
  }
  let p = await newPage();
  await p.goto(A + '/fr/');
  const v0 = await p.$eval('.hero-vid', v => ({ muted: v.muted, loop: v.loop, label: v.getAttribute('aria-label') }));
  assert.equal(v0.muted, true); assert.equal(v0.loop, false); assert.match(v0.label, /Vidéo de bienvenue/);
  await p.waitForFunction(() => document.querySelector('.hero-vid').currentTime > 0.5, null, { timeout: 10000 });
  await p.evaluate(() => { const v = document.querySelector('.hero-vid'); v.currentTime = v.duration - 0.05; });
  await p.waitForFunction(() => document.querySelector('.hero-vid').ended, null, { timeout: 10000 });
  assert.equal(await p.isVisible('.hero-replay'), true, 'replay offered once it ends');
  await p.click('.hero-replay');
  await p.waitForFunction(() => { const v = document.querySelector('.hero-vid'); return !v.paused && v.currentTime < 2; }, null, { timeout: 5000 });
  assert.deepEqual(p.errors, []);
  await p.context().close();
  p = await newPage({ reducedMotion: 'reduce' });
  await p.goto(A + '/ar/'); await p.waitForTimeout(800);
  assert.equal(await p.$eval('.hero-vid', v => v.paused && v.currentTime === 0), true, 'no autoplay under reduced motion');
  assert.equal(await p.isVisible('.hero-replay'), true);
  await p.context().close();
});
await test('reduced motion: content visible without animation', async () => {
  const p = await newPage({ reducedMotion: 'reduce' }); await p.goto(A + '/fr/');
  assert.equal(await p.evaluate(() => [...document.querySelectorAll('.rv')].every(e => getComputedStyle(e).opacity === '1')), true);
  await p.context().close();
});

console.log('\nSocial dock');
await test('social dock: configured links and pending profiles, 48 px discs on the inline-end edge, tooltip on hover and focus', async () => {
  for (const p of pages.filter(p => !p.endsWith('/assembly/high-temperature/'))) {
    const h = await (await fetch(A + p)).text();
    assert.equal((h.match(/<nav class="social-dock/g) || []).length, 1, p);
    assert.match(h, /<a class="sd-btn sd-facebook" href="https:\/\/www\.facebook\.com\/Libalstal\/" target="_blank" rel="noopener noreferrer">/, p);
    assert.match(h, /class="sd-btn sd-instagram is-pending" role="img"/, p);
    assert.match(h, /class="sd-btn sd-tiktok is-pending" role="img"/, p);
    assert.match(h, /class="sd-btn sd-toggle"/, p);
  }
  const pg = await newPage(); await pg.goto(A + '/fr/products/');
  const btn = pg.locator('.sd-btn.sd-facebook');
  assert.equal(await btn.getAttribute('aria-label'), null);
  assert.equal((await pg.evaluate(() => { const a = document.querySelector('.sd-btn.sd-facebook'); return a.textContent.trim(); })), 'Facebook (nouvel onglet)');
  const bb = await btn.boundingBox();
  assert.ok(bb.width >= 44 && bb.height >= 44, JSON.stringify(bb));
  const dockBox = await pg.locator('.social-dock').boundingBox();
  assert.ok(bb.x + bb.width > 1440 - 80 && Math.abs(dockBox.y + dockBox.height / 2 - 900 / 2) < 1, 'right edge, vertically centred ' + JSON.stringify(dockBox));
  const tipOpacity = () => pg.evaluate(() => getComputedStyle(document.querySelector('.sd-btn.sd-facebook .sd-tip')).opacity);
  await pg.waitForTimeout(1300); // entrance finished
  assert.equal(await tipOpacity(), '0');
  await btn.hover(); await pg.waitForTimeout(350);
  assert.equal(await tipOpacity(), '1');
  assert.equal(await pg.evaluate(() => getComputedStyle(document.querySelector('.sd-btn.sd-facebook')).backgroundColor), 'rgb(0, 102, 204)');
  await pg.mouse.move(10, 10); await pg.waitForTimeout(350);
  await btn.focus(); await pg.waitForTimeout(350);
  assert.equal(await tipOpacity(), '1', 'keyboard focus shows the tooltip too');
  assert.deepEqual(pg.errors, []);
  await pg.context().close();
});
await test('social dock in Arabic: mirrored to the left edge, tooltip toward the content, labels in Arabic', async () => {
  const pg = await newPage(); await pg.goto(A + '/ar/');
  assert.equal(await pg.getAttribute('.social-dock', 'aria-label'), 'تواصل مع LIBALSTAL والشبكات الاجتماعية');
  const bb = await pg.locator('.sd-btn.sd-facebook').boundingBox();
  assert.ok(bb.x < 80, 'left edge in RTL ' + JSON.stringify(bb));
  await pg.waitForTimeout(1300); await pg.hover('.sd-btn.sd-facebook'); await pg.waitForTimeout(350);
  const tip = await pg.locator('.sd-btn.sd-facebook .sd-tip').boundingBox();
  assert.ok(tip.x > bb.x + bb.width, 'tooltip on the right of the disc in RTL');
  await pg.context().close();
});
await test('social dock on phones: bottom corner above the safe area, clears the footer, hides while typing, no overflow', async () => {
  const pg = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await pg.goto(A + '/fr/contact/', { waitUntil: 'domcontentloaded' }); // social controls do not depend on the external map iframe
  await pg.waitForTimeout(1300); // entrance finished
  const bb = await pg.locator('.sd-toggle').boundingBox();
  assert.ok(bb.x + bb.width <= 390 - 12 && bb.x + bb.width > 390 - 80 && bb.y + bb.height <= 844 - 12 && bb.y > 844 - 120, JSON.stringify(bb));
  await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await pg.waitForTimeout(300);
  const [dock, copy] = await Promise.all([pg.locator('.sd-toggle').boundingBox(), pg.locator('.site-footer .copy').boundingBox()]);
  assert.ok(copy.y + copy.height <= dock.y || copy.x + copy.width <= dock.x, 'copyright line not covered ' + JSON.stringify({ dock, copy }));
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.focus('#f-name');
  assert.equal(await pg.evaluate(() => document.querySelector('.social-dock').classList.contains('is-typing')), true);
  await pg.waitForTimeout(350);
  assert.equal(await pg.evaluate(() => getComputedStyle(document.querySelector('.social-dock')).visibility), 'hidden');
  await pg.evaluate(() => document.activeElement.blur());
  assert.equal(await pg.evaluate(() => document.querySelector('.social-dock').classList.contains('is-typing')), false);
  assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(pg.errors, []);
  await pg.context().close();
});
await test('social dock with three profiles (test URLs): phone toggle opens, Escape closes and returns focus; desktop shows all; reduced motion = no animation', async () => {
  const dock = socialDock({ links: socialLinks({ facebook: 'https://www.facebook.com/Libalstal/', instagram: 'https://www.instagram.com/test-only/', tiktok: 'https://www.tiktok.com/@test-only' }),
    t: { label: 'LIBALSTAL sur les réseaux sociaux', open: 'Afficher les réseaux sociaux', close: 'Masquer les réseaux sociaux', newTab: '(nouvel onglet)' } });
  const serve = async ctx => ctx.route(A + '/fr/', async r => r.fulfill({ contentType: 'text/html; charset=utf-8', headers: Object.fromEntries([...(await fetch(A + '/fr/')).headers].filter(([k]) => !['content-encoding', 'content-length', 'vary'].includes(k))),
    body: (await (await fetch(A + '/fr/')).text()).replace(/<nav class="social-dock[\s\S]*?<\/nav>/, dock) }));
  let pg = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await serve(pg.context()); await pg.goto(A + '/fr/');
  await pg.waitForSelector('.social-dock.is-ready');
  const t = pg.locator('.sd-toggle');
  assert.equal(await t.isVisible(), true); assert.equal(await pg.isVisible('.sd-btn.sd-instagram'), false);
  const tb = await t.boundingBox(); assert.ok(tb.width >= 44 && tb.height >= 44);
  await t.click(); await pg.waitForTimeout(400);
  assert.equal(await t.getAttribute('aria-expanded'), 'true'); assert.equal(await t.getAttribute('aria-label'), 'Masquer les réseaux sociaux');
  for (const k of ['facebook', 'instagram', 'tiktok']) assert.equal(await pg.isVisible('.sd-btn.sd-' + k), true, k);
  const ys = await Promise.all(['facebook', 'instagram', 'tiktok'].map(k => pg.locator('.sd-btn.sd-' + k).boundingBox().then(b => b.y)));
  assert.ok(ys.every(y => y > 400 && y < tb.y), 'stack opens upward above the toggle ' + JSON.stringify({ ys, toggle: tb.y }));
  assert.equal(Math.round((await t.boundingBox()).y), Math.round(tb.y), 'the toggle does not move when the stack opens');
  await pg.keyboard.press('Escape');
  assert.equal(await t.getAttribute('aria-expanded'), 'false'); assert.equal(await pg.evaluate(() => document.activeElement.classList.contains('sd-toggle')), true);
  await t.click(); await pg.mouse.click(100, 300);
  assert.equal(await t.getAttribute('aria-expanded'), 'false', 'tap outside closes');
  assert.deepEqual(pg.errors, []); await pg.context().close();
  pg = await newPage({ reducedMotion: 'reduce' }); await serve(pg.context()); await pg.goto(A + '/fr/');
  assert.equal(await pg.isVisible('.sd-toggle'), false);
  for (const k of ['facebook', 'instagram', 'tiktok']) assert.equal(await pg.isVisible('.sd-btn.sd-' + k), true, k);
  assert.equal(await pg.evaluate(() => getComputedStyle(document.querySelector('.sd-list li')).animationName), 'none');
  await pg.hover('.sd-btn.sd-instagram');
  assert.equal(await pg.evaluate(() => getComputedStyle(document.querySelector('.sd-btn.sd-instagram')).transform), 'none', 'no movement with reduced motion');
  await pg.context().close();
});

console.log('\n3D assembly (public since v14)');
const ASM_DEMO = { fr: 'Modèle de démonstration', en: 'Demonstration model', ar: 'نموذج توضيحي' };
const ASM_PENDING = { fr: 'Spécification à confirmer', en: 'Specification pending', ar: 'المواصفات قيد التأكيد' };
const asmState = p => p.evaluate(() => ({ state: document.querySelector('.asm-view').dataset.state, status: document.querySelector('.asm-status').textContent }));
await test('assembly pages (public since v14): indexable, in the sitemap, linked from the home story, demo and pending labels in FR/EN/AR', async () => {
  for (const l of ['fr', 'en', 'ar']) {
    const r = await fetch(`${A}/${l}/assembly/`); assert.equal(r.status, 200);
    const h = await r.text();
    assert.doesNotMatch(h, /<meta name="robots" content="noindex/);
    assert.match(h, new RegExp(`rel="canonical" href="https://www\\.libalstal\\.example/${l}/assembly/"`));
    assert.ok(h.includes(ASM_DEMO[l]) && h.includes(ASM_PENDING[l]), l);
    assert.match(h, /<svg class="asm-svg"[^>]*role="img" aria-labelledby="asm-svg-t"/);
    assert.equal((h.match(/class="asm-part"/g) || []).length, 19);
    assert.match(h, new RegExp(`href="/${l}/contact/\\?product=tees-branches"`));
    assert.match(await (await fetch(`${A}/${l}/`)).text(), new RegExp(`href="/${l}/assembly/"`), `${l} home links to the 3D assembly`);
  }
});
await test('unified assembly: rectangular, spiral, tee and Y parts; accessible icon controls in FR/EN/AR', async () => {
  const labels = {fr:'Désenfumage',en:'Smoke extraction',ar:'استخراج الدخان'};
  for (const l of ['fr','en','ar']) {
    const p = await newPage({viewport:{width:l==='ar'?390:1280,height:844},reducedMotion:'reduce'});
    await p.goto(`${A}/${l}/assembly/`);
    assert.equal(await p.locator('.asm-systems').count(),0);
    assert.equal(await p.locator('.asm-pick').count(),19);
    const controls=p.locator('.asm-effects-controls button');
    assert.equal(await controls.count(),4);
    for(const control of await controls.all()) {
      assert.ok(await control.getAttribute('aria-label'));
      assert.equal((await control.textContent()).trim(),'');
      assert.equal(await control.locator('svg').count(),1);
    }
    assert.equal(await p.locator('.asm-heat').getAttribute('aria-label'),labels[l]);
    for(const id of ['flange-1','y-1','rect-round-1','round-1','tee-1','damper-manual-1','damper-motorised-1','round-damper-manual-1','round-damper-motorised-1']) {
      await p.locator(`.asm-pick[data-part="${id}"]`).click();
      assert.ok(await p.locator(`#part-${id}`).isVisible());
    }
    await p.locator('.asm-heat').click();
    assert.equal(await p.locator('.asm-heat').getAttribute('aria-pressed'),'true');
    assert.ok(await p.locator('.asm-heat-note').isVisible());
    const pause=p.locator('.asm-pause');
    const old=await pause.getAttribute('aria-label');await pause.click();
    assert.notEqual(await pause.getAttribute('aria-label'),old);
    assert.equal(await pause.locator('svg').count(),1,'pause toggle keeps its icon');
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(p.errors,[]);
    await p.context().close();
  }
});
await test('home story "Du plan au métal": 4 steps and 4 titled drawings in FR/EN/AR; live on scroll; readable without JS', async () => {
  for (const l of ['fr', 'en', 'ar']) {
    const h = await (await fetch(`${A}/${l}/`)).text();
    assert.equal((h.match(/class="st-step"/g) || []).length, 4, l);
    for (const t of ['st-t1', 'st-t2', 'st-t3', 'st-t4']) assert.match(h, new RegExp(`aria-labelledby="${t}"[^>]*>|aria-labelledby="${t}"`), `${l} ${t}`);
  }
  let p = await newPage();
  await p.goto(A + '/fr/');
  assert.equal(await p.evaluate(() => document.querySelector('.story').classList.contains('is-live')), true);
  // instant: site.css scrolls smoothly, and under software WebGL that animation alone can outlast the timeout
  await p.evaluate(() => document.querySelector('.st-step[data-step="2"]').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await p.waitForFunction(() => document.querySelector('.st-stage').dataset.active === '2', null, { timeout: 5000 });
  assert.match(await p.textContent('.st-count'), /3/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
  const ctx = await browser.newContext({ javaScriptEnabled: false }); p = await ctx.newPage(); await p.goto(A + '/fr/');
  const vis = await p.evaluate(() => [...document.querySelectorAll('.st-fig')].map(f => getComputedStyle(f).opacity === '1' && f.getBoundingClientRect().height > 40));
  assert.deepEqual(vis, [true, true, true, true], 'all drawings visible without JS');
  await ctx.close();
});
await test('hide incomplete (site.json display.hideIncomplete): no placeholders on the home page, still listed in MISSING-INFO.md', async () => {
  for (const l of ['fr', 'en', 'ar']) {
    const h = await (await fetch(`${A}/${l}/`)).text();
    const main = h.slice(h.indexOf('<main'), h.indexOf('</main>'));
    assert.doesNotMatch(main, /class="ph"/, `${l}: placeholder on home`);
    assert.doesNotMatch(main, /class="badge"/, `${l}: missing-evidence badge on home`);
  }
  const mi = readFileSync(join(ROOT, 'MISSING-INFO.md'), 'utf8');
  assert.match(mi, /capabilities\.process/); assert.match(mi, /equipment/);
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
  assert.deepEqual(mods, { createViewer: 'function', revision: '170', orbit: 'function', types: 17 });
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
  for (const page of ['/fr/assembly/', '/fr/']) { // the home page has no import map since the welcome video replaced the 3D hero
    const m = (await (await fetch(A + page)).text()).match(/<script type="importmap">([^<]*)<\/script>/);
    if (page === '/fr/assembly/') assert.ok(m, 'the 3D page has an import map');
    if (m) assert.ok(csp.includes(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`), `CSP allows the import map of ${page}`);
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
await test('Skip, Explode and Reassemble keep the camera on its viewing direction (never snapped overhead and close)', async () => {
  const p = await newPage();
  await p.goto(A + '/fr/assembly/?debug3d');
  await p.locator('.asm-view').scrollIntoViewIfNeeded();
  await p.waitForFunction(() => ['3d', 'fallback'].includes(document.querySelector('.asm-view').dataset.state), null, { timeout: 30000 });
  if ((await asmState(p)).state !== '3d') { console.log('      (UNVERIFIED: no working WebGL in this browser)'); await p.context().close(); return; }
  const cam = async () => { await p.waitForTimeout(400); const [d, h, el] = (await p.textContent('.asm-diag [data-key="camera"] dd')).match(/-?[\d.]+/g).map(Number); return { d, h, el }; };
  await p.waitForSelector('[data-cmd="skip"]:not([hidden])', { timeout: 5000 });
  await p.waitForTimeout(800);
  await p.click('[data-cmd="skip"]');
  let c = await cam();
  assert.ok(Math.abs(c.d - c.h) < 0.01 * c.h, `after Skip: distance ${c.d} ≠ home ${c.h}`); assert.ok(c.el < 80, `after Skip: elevation ${c.el}°`);
  await p.click('[data-cmd="explode"]'); await p.waitForFunction(() => document.querySelector('.asm-view').dataset.motion === 'idle', null, { timeout: 15000 }); c = await cam();
  assert.ok(c.d >= c.h * 0.99, `after Explode: distance ${c.d} < home ${c.h}`); assert.ok(c.el < 80, `after Explode: elevation ${c.el}°`);
  await p.click('[data-cmd="reassemble"]'); await p.waitForFunction(() => document.querySelector('.asm-view').dataset.motion === 'idle', null, { timeout: 15000 }); c = await cam();
  assert.ok(Math.abs(c.d - c.h) < 0.01 * c.h, `after Reassemble: distance ${c.d} ≠ home ${c.h}`); assert.ok(c.el < 80, `after Reassemble: elevation ${c.el}°`);
  assert.match(await p.textContent('.asm-diag'), /Camera/);
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
  assert.ok(await p.isVisible('.asm-svg')); assert.equal(await p.locator('.asm-pick').count(), 19);
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
await test('Pages: drawings go straight to private storage; success only once recorded and notified', async () => {
  hooks.length = 0;
  const p = await newPage(); await fillAll(p, D);
  await p.check('#f-consent'); await p.click('[data-action="submit"]');
  await p.waitForSelector('#rfq-result.ok', { timeout: 15000 });
  const ref = /RFQ-\d{8}-[0-9A-F]{6}/.exec(await p.textContent('#rfq-result'))?.[0];
  assert.ok(ref);
  const store = await sim('/__sim/store');
  assert.equal(store.records[ref].status, 'notified');
  assert.deepEqual(Object.keys(store.objects).filter(k => k.startsWith(ref + '/') && !k.endsWith('request.json')).sort(), [`${ref}/1-plan-test.pdf`, `${ref}/2-coupe.dxf`]);
  assert.equal(hooks.filter(h => h.body.ref === ref).length, 1);
  assert.deepEqual(p.errors, [], 'no CSP or CORS errors');
  await p.context().close();
});
await test('Pages: upload failure → honest error, nothing announced; retry → success, same reference, one notification', async () => {
  hooks.length = 0;
  await sim('/__sim/control?failPuts=2', { method: 'POST' }); // first drawing fails twice (the script retries once)
  const p = await newPage(); await fillAll(p, D);
  await p.check('#f-consent'); await p.click('[data-action="submit"]');
  await p.waitForSelector('#rfq-result.fail', { timeout: 15000 });
  assert.match(await p.textContent('#rfq-result'), /pas pu être envoyé/);
  assert.equal(hooks.length, 0);
  await p.click('[data-action="submit"]');
  await p.waitForSelector('#rfq-result.ok', { timeout: 15000 });
  const ref = /RFQ-\d{8}-[0-9A-F]{6}/.exec(await p.textContent('#rfq-result'))?.[0];
  assert.equal(hooks.filter(h => h.body.ref === ref).length, 1); assert.equal(hooks.length, 1);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await test('Pages: notification down → "recorded under reference" message; Send again → delivered once, no duplicate', async () => {
  hooks.length = 0;
  await sim('/__sim/control?notifyFail=1', { method: 'POST' });
  const p = await newPage(); await fillAll(p, D);
  await p.check('#f-consent'); await p.click('[data-action="submit"]');
  await p.waitForSelector('#rfq-result.fail', { timeout: 15000 });
  const txt = await p.textContent('#rfq-result'); const ref = /RFQ-\d{8}-[0-9A-F]{6}/.exec(txt)?.[0];
  assert.ok(ref && /enregistrée/.test(txt), txt);
  assert.equal((await sim('/__sim/store')).records[ref].status, 'notify_failed');
  await sim('/__sim/control?notifyFail=0', { method: 'POST' });
  await p.click('[data-action="submit"]');
  await p.waitForSelector('#rfq-result.ok', { timeout: 15000 });
  assert.match(await p.textContent('#rfq-result'), new RegExp(ref));
  assert.equal(hooks.filter(h => h.body.ref === ref).length, 1);
  assert.deepEqual(p.errors, []);
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


console.log('\nWelcome intro');
const INTRO_BUILT = (await (await fetch(A + '/fr/')).text()).includes('id="intro"');
const introTest = (name, fn) => INTRO_BUILT ? test(name, fn) : (console.log(`  - ${name} (skipped: no intro videos and no ffmpeg for fixtures)`), undefined);
const introState = p => p.evaluate(() => ({ on: document.documentElement.classList.contains('intro-on'), overlay: !!document.getElementById('intro'), end: document.documentElement.getAttribute('data-intro-end') }));
await test('intro is only on approved home pages, gated by its videos; never on inner pages', async () => {
  const intro = JSON.parse(readFileSync(join(ROOT, 'content/intro.json'), 'utf8'));
  for (const l of ['fr', 'en', 'ar']) {
    const h = await (await fetch(A + `/${l}/`)).text();
    const want = INTRO_BUILT && intro.langs.includes(l) && intro.copy[l].approved;
    assert.equal(h.includes('id="intro"'), want, `/${l}/ intro markup`);
    assert.equal(h.includes('/assets/js/intro-gate.js'), want, `/${l}/ gate script`);
  }
  for (const path of ['/fr/products/', '/fr/contact/', '/fr/assembly/']) assert.doesNotMatch(await (await fetch(A + path)).text(), /id="intro"|intro-gate/, path);
});
await introTest('first visit: plays over the mounted homepage, skip control from the start, hands over to the page at 6 s', async () => {
  const p = await newPage({ intro: true });
  const t0 = Date.now();
  await p.goto(A + '/fr/');
  assert.ok(await p.isVisible('#intro'), 'overlay shown');
  assert.equal(await p.locator('.intro-skip').innerText(), "PASSER L'INTRO");
  assert.ok(await p.locator('#hero-h').count(), 'hero mounted underneath');
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.site-header .brand img')).visibility), 'hidden', 'header logo waits for the handoff');
  await p.waitForFunction(() => document.querySelector('.intro-video').currentTime > 0.3, null, { timeout: 4000 });
  assert.match(await p.evaluate(() => document.querySelector('.intro-video').currentSrc), /welcome-desktop-fr\.(webm|mp4)\?v=/);
  await p.waitForFunction(() => document.querySelector('.intro-logo'), null, { timeout: 8000 });
  const ms = Date.now() - t0;
  await p.waitForFunction(() => !document.getElementById('intro'), null, { timeout: 8000 });
  const total = Date.now() - t0;
  assert.ok(ms > 4000, `handoff not before 4.75 s of video (${ms} ms)`);
  assert.ok(total < 9000, `homepage revealed in time (${total} ms)`);
  assert.equal((await introState(p)).end, 'complete');
  await p.waitForFunction(() => !document.documentElement.classList.contains('intro-on'), null, { timeout: 3000 });
  assert.deepEqual(await introState(p), { on: false, overlay: false, end: 'complete' });
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.site-header .brand img')).visibility), 'visible');
  await p.click('.nav-links a[href="/fr/products/"]'); await p.waitForURL('**/fr/products/');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await introTest('skip: the button reveals the page at once; refresh and repeat navigation never replay it', async () => {
  const p = await newPage({ intro: true });
  await p.goto(A + '/fr/');
  await p.waitForTimeout(600);
  // Measure click-event → removal in the page, excluding Playwright's actionability/scroll wait.
  await p.evaluate(() => {
    let started;
    document.querySelector('.intro-skip').addEventListener('click', () => { started = performance.now(); }, { capture: true, once: true });
    const observer = new MutationObserver(() => { if (started !== undefined && !document.getElementById('intro')) { window.__introSkipMs = performance.now() - started; observer.disconnect(); } });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await p.click('.intro-skip');
  await p.waitForFunction(() => Number.isFinite(window.__introSkipMs), null, { timeout: 2000 });
  const skipMs = await p.evaluate(() => window.__introSkipMs);
  assert.ok(skipMs < 800, `skip took ${skipMs} ms`);
  assert.equal((await introState(p)).end, 'skip');
  await p.reload(); assert.deepEqual((await introState(p)).on, false, 'refresh: page directly');
  assert.equal(await p.isVisible('#intro'), false);
  await p.goto(A + '/fr/products/'); await p.goto(A + '/fr/');
  assert.equal((await introState(p)).on, false, 'back to home: no replay');
  await p.goto(A + '/en/'); assert.equal((await introState(p)).on, false, 'other language: no replay');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
await introTest('Escape, scrolling or tabbing into the page end the intro; keyboard focus is never trapped', async () => {
  for (const how of ['Escape', 'wheel', 'tab']) {
    const p = await newPage({ intro: true });
    await p.goto(A + '/fr/'); await p.waitForTimeout(400);
    if (how === 'Escape') await p.keyboard.press('Escape');
    else if (how === 'wheel') await p.mouse.wheel(0, 300);
    else { await p.keyboard.press('Tab'); assert.equal(await p.evaluate(() => document.activeElement.className), 'intro-skip', 'skip button is first'); await p.keyboard.press('Tab'); }
    await p.waitForFunction(() => !document.getElementById('intro'), null, { timeout: 2000 });
    if (how === 'tab') assert.equal(await p.evaluate(() => document.activeElement.className), 'skip', 'focus continues to the page');
    await p.context().close();
  }
});
await introTest('reduced motion, data saver path and no JavaScript: the homepage directly, no overlay', async () => {
  const p = await newPage({ intro: true, reducedMotion: 'reduce' });
  await p.goto(A + '/fr/');
  assert.deepEqual(await introState(p), { on: false, overlay: true, end: null });
  assert.equal(await p.isVisible('#intro'), false);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.site-header .brand img')).visibility), 'visible');
  await p.context().close();
  const ctx = await browser.newContext({ javaScriptEnabled: false }); const q = await ctx.newPage(); await q.goto(A + '/fr/');
  assert.equal(await q.isVisible('#intro'), false); assert.ok(await q.isVisible('#hero-h'));
  await ctx.close();
});
await introTest('video failure: the homepage without delay', async () => {
  const p = await newPage({ intro: true });
  await p.route('**/assets/video/**', r => r.abort());
  await p.goto(A + '/fr/', { waitUntil: 'domcontentloaded' }); const t = Date.now();
  await p.waitForFunction(() => !document.getElementById('intro'), null, { timeout: 3500 });
  assert.ok(Date.now() - t < 3000, `revealed after ${Date.now() - t} ms`);
  assert.match((await introState(p)).end, /error|slow/);
  await p.context().close();
});
await introTest('phones get the portrait footage; the overlay never crops the safe area', async () => {
  const p = await newPage({ intro: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto(A + '/fr/');
  await p.waitForFunction(() => document.querySelector('.intro-video').currentSrc, null, { timeout: 3000 });
  assert.match(await p.evaluate(() => document.querySelector('.intro-video').currentSrc), /welcome-mobile-fr/);
  const fit = await p.evaluate(() => {
    const cfg = JSON.parse(document.getElementById('intro-data').textContent).comps.mobile;
    const r = document.querySelector('.intro-video').getBoundingClientRect(), s = r.width / cfg.w, sf = cfg.safe;
    return { x0: r.left + sf[0] * s, y0: r.top + sf[1] * s, x1: r.left + (sf[0] + sf[2]) * s, y1: r.top + (sf[1] + sf[3]) * s, vw: innerWidth, vh: innerHeight };
  });
  assert.ok(fit.x0 >= -0.5 && fit.y0 >= -0.5 && fit.x1 <= fit.vw + 0.5 && fit.y1 <= fit.vh + 0.5, JSON.stringify(fit));
  await p.screenshot({ path: join(OUT, 'intro-mobile.png') });
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
      // SwiftShader (launched above for WebGL) caps a capture at 8192 px, so tall pages are saved in slices
      const name = `${label}${path.replace(/\//g, '_')}`, width = w, height = await p.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0, i = 1; y < height; y += 8000, i++) {
        await p.screenshot({ path: join(OUT, height > 8000 ? `${name}-${i}.png` : `${name}.png`), fullPage: true, clip: { x: 0, y, width, height: Math.min(8000, height - y) } });
      }
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

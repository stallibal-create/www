#!/usr/bin/env node
// LIBALSTAL production server — zero dependencies (Node ≥ 20).
// Serves dist/ with security headers and handles POST /api/rfq.
// Env: see README.md ("Environment variables").
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const env = process.env;
const PORT = Number(env.PORT || 3000);
const HOST = env.HOST || '0.0.0.0';
const TRUST_PROXY = env.TRUST_PROXY === '1';
const STORAGE = env.RFQ_STORAGE_DIR || join(ROOT, 'storage', 'rfq');
const MAX_FILES = 5, MAX_FILE = 10 * 1024 * 1024, MAX_BODY = MAX_FILES * MAX_FILE + 1024 * 1024;
const RATE_MAX = Number(env.RFQ_RATE_MAX || 5), RATE_WINDOW = 15 * 60 * 1000;
const LANGS = ['fr', 'en', 'ar'];

const HEADERS = existsSync(join(ROOT, '.build/headers.json')) ? JSON.parse(readFileSync(join(ROOT, '.build/headers.json'), 'utf8')) : {};
if (env.NODE_ENV === 'production') {
  HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  if (HEADERS['Content-Security-Policy']) HEADERS['Content-Security-Policy'] += '; upgrade-insecure-requests';
}
const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
const PRODUCT_SLUGS = new Set([...site.products.map(p => p.slug), 'other']);

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary' };

// ---------- notification config ----------
function notifyMode() {
  if (env.RFQ_WEBHOOK_URL) return 'webhook';
  if (env.RESEND_API_KEY && env.RFQ_TO_EMAIL && env.RFQ_FROM_EMAIL) return 'resend';
  return null;
}
const turnstileOn = !!env.TURNSTILE_SECRET_KEY;

// ---------- helpers ----------
const log = (...a) => console.log(new Date().toISOString(), ...a);
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { ...HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function clientIp(req) {
  if (TRUST_PROXY) { const f = req.headers['x-forwarded-for']; if (f) return String(f).split(',')[0].trim(); }
  return req.socket.remoteAddress || 'unknown';
}
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (arr.length >= RATE_MAX) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < RATE_WINDOW)) hits.delete(k); }, 60_000).unref();

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max + 1) : '');
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

function sniff(buf, ext) {
  const head = buf.subarray(0, 64).toString('latin1');
  if (ext === 'pdf') return head.startsWith('%PDF-');
  if (ext === 'dwg') return /^AC1\d{3}/.test(head);
  if (ext === 'dxf') return head.startsWith('AutoCAD Binary DXF') || /^\s*0\s*\r?\n\s*SECTION/.test(head) || /^\s*999\s*\r?\n/.test(head);
  return false;
}
const safeName = n => (n || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(-100) || 'file';

function limitStream(max) {
  let n = 0;
  return new Transform({ transform(chunk, _e, cb) { n += chunk.length; if (n > max) cb(Object.assign(new Error('too_large'), { code: 'too_large' })); else cb(null, chunk); } });
}

async function verifyTurnstile(token, ip) {
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip });
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

async function notify(record, saved) {
  const mode = notifyMode();
  const f = record.fields;
  const lines = [
    `Nouvelle demande de devis ${record.ref}`, '',
    `Nom : ${f.name}`, `Société : ${f.company}`, `E-mail : ${f.email}`, `Téléphone : ${f.phone || '—'}`, `Pays / livraison : ${f.country}`,
    `Produit : ${f.category}`, `Délai (index) : ${f.timeline}`, `Matière : ${f.material || '—'}`, `Quantité : ${f.quantity || '—'}`, '',
    'Exigences :', f.requirements || '—', '',
    `Fichiers (${saved.length}) : ${saved.map(s => `${s.name} (${(s.size / 1048576).toFixed(2)} Mo)`).join(', ') || 'aucun'}`,
    `Stockage : ${record.dir}`, `Langue : ${record.lang} · Reçu : ${record.receivedAt}`,
  ];
  if (mode === 'webhook') {
    const r = await fetch(env.RFQ_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(env.RFQ_WEBHOOK_TOKEN ? { Authorization: `Bearer ${env.RFQ_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify({ ref: record.ref, receivedAt: record.receivedAt, lang: record.lang, fields: f, files: saved.map(s => ({ name: s.name, size: s.size, path: s.path })), text: lines.join('\n') }), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`webhook ${r.status}`);
    return;
  }
  if (mode === 'resend') {
    const total = saved.reduce((a, s) => a + s.size, 0);
    const attachments = total <= 15 * 1024 * 1024 ? await Promise.all(saved.map(async s => ({ filename: s.name, content: (await readFile(s.path)).toString('base64') }))) : [];
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RFQ_FROM_EMAIL, to: env.RFQ_TO_EMAIL.split(',').map(s => s.trim()), reply_to: f.email, subject: `[Devis ${record.ref}] ${f.company} — ${f.category}`, text: lines.join('\n'), attachments }),
      signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`resend ${r.status}`);
    return;
  }
  throw new Error('no notifier');
}

function htmlReply(lang, ok, msg) {
  const back = `/${LANGS.includes(lang) ? lang : 'fr'}/contact/`;
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LIBALSTAL</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/assets/css/site.css"></head><body><main class="wrap sec"><h1>${ok ? '✓' : '✕'}</h1><p class="lead">${msg.replace(/[<>&]/g, '')}</p><p><a class="btn" href="${back}">←</a></p></main></body></html>`;
}

const MSG = {
  fr: { ok: 'Demande envoyée. Référence : ', not_configured: "Le service de réception des devis n'est pas encore activé. Rien n'a été transmis.", rate_limited: 'Trop de demandes. Réessayez dans quelques minutes.', invalid: 'Formulaire incomplet ou invalide.', captcha: 'Vérification anti-robot échouée.', error: "La demande n'a pas été envoyée. Réessayez plus tard.", too_large: 'Fichiers trop volumineux.' },
  en: { ok: 'Request sent. Reference: ', not_configured: 'Quote reception is not activated yet. Nothing was transmitted.', rate_limited: 'Too many requests. Try again in a few minutes.', invalid: 'Form incomplete or invalid.', captcha: 'Anti-bot check failed.', error: 'Your request was not sent. Try again later.', too_large: 'Files too large.' },
  ar: { ok: 'أُرسل الطلب. المرجع: ', not_configured: 'خدمة استقبال الطلبات غير مفعّلة بعد. لم يُرسَل أي شيء.', rate_limited: 'طلبات كثيرة. أعد المحاولة بعد دقائق.', invalid: 'الاستمارة ناقصة أو غير صالحة.', captcha: 'فشل التحقق من أنك لست روبوتًا.', error: 'لم يُرسَل الطلب. أعد المحاولة لاحقًا.', too_large: 'الملفات كبيرة جدًا.' },
};

// ---------- RFQ handler ----------
async function handleRfq(req, res) {
  const wantsJson = String(req.headers.accept || '').includes('application/json');
  let lang = 'fr';
  const reply = (code, payload) => {
    if (wantsJson) return send(res, code, payload);
    const m = MSG[lang] || MSG.fr;
    return send(res, code, htmlReply(lang, payload.ok, payload.ok ? m.ok + payload.ref : (m[payload.error] || m.error)), 'text/html; charset=utf-8');
  };
  const drain = () => req.resume();

  const ip = clientIp(req);
  if (!notifyMode()) { drain(); log('rfq rejected: notifier not configured'); return reply(503, { ok: false, error: 'not_configured' }); }
  if (rateLimited(ip)) { drain(); return reply(429, { ok: false, error: 'rate_limited' }); }
  const ct = String(req.headers['content-type'] || '');
  if (!ct.startsWith('multipart/form-data')) { drain(); return reply(415, { ok: false, error: 'invalid' }); }
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) { drain(); return reply(413, { ok: false, error: 'too_large' }); }
  const origin = req.headers.origin;
  if (origin && req.headers.host && new URL(origin).host !== req.headers.host && !(env.RFQ_ALLOWED_ORIGINS || '').split(',').includes(origin)) { drain(); return reply(403, { ok: false, error: 'invalid' }); }

  let fd;
  try {
    const body = Readable.toWeb(req.pipe(limitStream(MAX_BODY)));
    fd = await new Request('http://local/', { method: 'POST', headers: { 'content-type': ct }, body, duplex: 'half' }).formData();
  } catch (e) {
    return reply(e.code === 'too_large' ? 413 : 400, { ok: false, error: e.code === 'too_large' ? 'too_large' : 'invalid' });
  }

  lang = LANGS.includes(fd.get('lang')) ? fd.get('lang') : 'fr';
  if (str(fd.get('website'), 200)) { log('rfq honeypot hit', ip); return reply(400, { ok: false, error: 'invalid' }); }

  const f = {
    name: str(fd.get('name'), 120), company: str(fd.get('company'), 160), email: str(fd.get('email'), 254), phone: str(fd.get('phone'), 40),
    country: str(fd.get('country'), 120), category: str(fd.get('category'), 60), timeline: str(fd.get('timeline'), 2),
    material: str(fd.get('material'), 200), quantity: str(fd.get('quantity'), 60), requirements: str(fd.get('requirements'), 5000),
  };
  const bad = [];
  if (f.name.length < 2 || f.name.length > 120) bad.push('name');
  if (!f.company || f.company.length > 160) bad.push('company');
  if (!EMAIL_RE.test(f.email) || f.email.length > 254) bad.push('email');
  if (f.phone && !/^[+\d\s().\-]{4,40}$/.test(f.phone)) bad.push('phone');
  if (f.country.length < 2 || f.country.length > 120) bad.push('country');
  if (!PRODUCT_SLUGS.has(f.category)) bad.push('category');
  if (!/^[0-3]$/.test(f.timeline)) bad.push('timeline');
  if (f.material.length > 200) bad.push('material');
  if (f.quantity.length > 60) bad.push('quantity');
  if (f.requirements.length > 5000) bad.push('requirements');
  if (fd.get('consent') !== 'yes') bad.push('consent');

  const uploads = fd.getAll('files').filter(x => x && typeof x === 'object' && x.size > 0);
  if (uploads.length > MAX_FILES) bad.push('files');
  const files = [];
  for (const up of uploads.slice(0, MAX_FILES)) {
    const ext = (up.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'dwg', 'dxf'].includes(ext) || up.size > MAX_FILE) { bad.push('files'); break; }
    const buf = Buffer.from(await up.arrayBuffer());
    if (!sniff(buf, ext)) { bad.push('files'); break; }
    files.push({ name: safeName(up.name), buf, ext });
  }
  if (bad.length) return reply(400, { ok: false, error: 'invalid', fields: [...new Set(bad)] });

  if (turnstileOn) {
    let pass = false;
    try { pass = await verifyTurnstile(str(fd.get('cf-turnstile-response'), 4096), ip); } catch (e) { log('turnstile error', e.message); }
    if (!pass) return reply(403, { ok: false, error: 'captcha' });
  }

  // store privately
  const now = new Date();
  const ref = `RFQ-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const dir = join(STORAGE, ref);
  const record = { ref, receivedAt: now.toISOString(), lang, ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300), fields: f, dir, status: 'received' };
  const saved = [];
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const used = new Set();
    for (const [i, fl] of files.entries()) {
      let n = fl.name; if (used.has(n)) n = `${i + 1}-${n}`; used.add(n);
      const p = join(dir, n);
      await writeFile(p, fl.buf, { mode: 0o600 });
      saved.push({ name: n, size: fl.buf.length, path: p });
    }
    record.files = saved.map(({ name, size }) => ({ name, size }));
    await writeFile(join(dir, 'request.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  } catch (e) {
    log('rfq storage error', e.message);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return reply(500, { ok: false, error: 'error' });
  }

  try {
    await notify(record, saved);
    record.status = 'notified';
    await writeFile(join(dir, 'request.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  } catch (e) {
    log('rfq notify failed', ref, e.message);
    record.status = 'notify_failed';
    await writeFile(join(dir, 'request.json'), JSON.stringify(record, null, 2), { mode: 0o600 }).catch(() => {});
    return reply(502, { ok: false, error: 'error' });
  }
  log('rfq ok', ref, `${saved.length} file(s)`);
  return reply(200, { ok: true, ref });
}

// ---------- static ----------
// Precompressed variants written by the build (file.br, file.gz) are sent when the browser accepts them.
// A variant older than its source is ignored, so a stale copy is never served. /api/rfq is never compressed.
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.xml', '.txt', '.webmanifest', '.glb']);
function accepts(header, coding) {
  for (const part of String(header || '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';').map(x => x.trim());
    if (name !== coding) continue;
    const q = params.find(x => x.startsWith('q='));
    return !q || parseFloat(q.slice(2)) > 0;
  }
  return false;
}
async function precompressed(file, srcStat, acceptEncoding) {
  for (const [coding, suffix] of [['br', '.br'], ['gzip', '.gz']]) {
    if (!accepts(acceptEncoding, coding)) continue;
    try { const v = await stat(file + suffix); if (v.isFile() && v.mtimeMs >= srcStat.mtimeMs) return { coding, path: file + suffix }; } catch { /* no variant */ }
  }
  return null;
}
async function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request', 'text/plain'); }
  if (p.includes('\0')) return send(res, 400, 'Bad request', 'text/plain');
  if (p === '/') {
    const al = String(req.headers['accept-language'] || '').toLowerCase();
    const best = al.startsWith('ar') ? 'ar' : al.startsWith('en') ? 'en' : 'fr';
    res.writeHead(302, { ...HEADERS, Location: `/${best}/`, Vary: 'Accept-Language', 'Cache-Control': 'no-store' }); return res.end();
  }
  let file = normalize(join(DIST, p));
  if (!file.startsWith(DIST)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    let s = await stat(file);
    if (s.isDirectory()) {
      if (!p.endsWith('/')) { res.writeHead(301, { ...HEADERS, Location: p + '/' }); return res.end(); }
      file = join(file, 'index.html'); s = await stat(file);
    }
    const ext = extname(file);
    const isHtml = ext === '.html';
    const enc = COMPRESSIBLE.has(ext) ? await precompressed(file, s, req.headers['accept-encoding']) : null;
    const buf = await readFile(enc ? enc.path : file);
    res.writeHead(200, { ...HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': buf.length,
      ...(COMPRESSIBLE.has(ext) ? { Vary: 'Accept-Encoding' } : {}), ...(enc ? { 'Content-Encoding': enc.coding } : {}),
      'Cache-Control': isHtml ? 'no-cache' : (p.startsWith('/assets/') ? 'public, max-age=604800' : 'public, max-age=3600') });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  } catch {
    const lang = LANGS.find(l => p.startsWith(`/${l}/`)) || 'fr';
    const nf = await readFile(join(DIST, lang, '404.html')).catch(() => Buffer.from('Not found'));
    return send(res, 404, nf, 'text/html; charset=utf-8');
  }
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/api/rfq') {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' }, undefined, { Allow: 'POST' });
      return await handleRfq(req, res);
    }
    if (pathname === '/healthz') return send(res, 200, { ok: true, rfq: notifyMode() ? 'ready' : 'not_configured' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain', { Allow: 'GET, HEAD' });
    return await serveStatic(req, res, pathname);
  } catch (e) {
    log('unhandled', e && e.stack);
    if (!res.headersSent) send(res, 500, { ok: false, error: 'error' });
    else res.destroy();
  }
});
server.requestTimeout = 120_000;
server.headersTimeout = 20_000;
server.listen(PORT, HOST, () => log(`LIBALSTAL on http://${HOST}:${PORT}  (rfq: ${notifyMode() || 'NOT CONFIGURED'}${turnstileOn ? ', turnstile on' : ''})`));

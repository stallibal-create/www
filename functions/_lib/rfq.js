// LIBALSTAL — quote request (RFQ) handlers for Cloudflare Pages Functions, Web APIs only.
// Built for the Workers Free limits (10 ms CPU, 128 MB): drawing bytes never pass through the function.
//
//   POST /api/rfq          quote without attachments (also the no-JavaScript form). Body capped at 64 KB.
//   POST /api/rfq/start    JSON: fields + file list → reference, one-time token, presigned PUT URLs (private R2)
//   (browser)              PUT each file straight to R2 with its presigned URL
//   POST /api/rfq/finish   JSON: reference + token → checks every object (exists, size, file signature),
//                          records the request, notifies once
//
// Success is only returned once the request is recorded (R2 request.json, or accepted by the notifier
// when there is no bucket) and the team has been notified. Retries with the same submission id ("sid")
// return the same reference and never notify twice (R2 conditional writes + Idempotency-Key).
//
// Bindings / variables (Cloudflare dashboard → Pages project → Settings):
//   RFQ_BUCKET            R2 bucket binding: request records + drawings, private
//   R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//                         R2 S3 API token (Object Read & Write, this bucket only) for presigned URLs; without
//                         them, attachments are refused with uploads_unavailable (quotes without files still work)
//   R2_S3_ENDPOINT        optional, e.g. https://<account>.eu.r2.cloudflarestorage.com for an EU bucket
//   RFQ_LINK_DAYS         download links for the team in notifications, 1–7 days (default 7, 0 = no links)
//   RFQ_WEBHOOK_URL       option A: POST JSON to Make / Zapier / n8n / your endpoint (Idempotency-Key = reference)
//   RFQ_WEBHOOK_TOKEN     optional bearer token for the webhook
//   RESEND_API_KEY, RFQ_TO_EMAIL, RFQ_FROM_EMAIL   option B: e-mail through resend.com (no attachments, links instead)
//   TURNSTILE_SECRET_KEY  anti-bot check (with TURNSTILE_SITE_KEY at build time)
//   RFQ_ALLOWED_ORIGINS   extra allowed Origins, comma-separated
// Without option A or B every endpoint answers 503 not_configured and stores nothing (never a fake success).

import { presign, sha256Hex } from './sigv4.js';

export const LANGS = ['fr', 'en', 'ar'];
export const MAX_FILES = 5;
export const MAX_FILE = 10 * 1024 * 1024;
export const MAX_FORM = 64 * 1024; // POST /api/rfq: fields only
const MAX_JSON = 32 * 1024;
const UPLOAD_TTL = 15 * 60; // seconds a presigned PUT stays valid
const CLAIM_TTL = 60 * 1000; // a 'notifying' claim older than this is considered abandoned
const RATE_MAX = 5, FINISH_MAX = 30, RATE_WINDOW = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
const REF_RE = /^RFQ-\d{8}-[0-9A-F]{6}$/;
const SID_RE = /^[A-Za-z0-9-]{16,64}$/;
const TYPES = { pdf: 'application/pdf', dwg: 'application/octet-stream', dxf: 'application/octet-stream' };

export const MSG = {
  fr: { ok: 'Demande envoyée. Référence : ', not_configured: "Le service de réception des devis n'est pas encore activé. Rien n'a été transmis.", rate_limited: 'Trop de demandes. Réessayez dans quelques minutes.', invalid: 'Formulaire incomplet ou invalide.', captcha: 'Vérification anti-robot échouée.', error: "La demande n'a pas été envoyée. Réessayez plus tard.", too_large: 'Fichiers trop volumineux.', files_need_js: "Pour joindre des plans, activez JavaScript ou envoyez-les par e-mail. Rien n'a été transmis.", notify_failed: "Votre demande est enregistrée, mais l'équipe n'a pas encore été prévenue. Renvoyez le formulaire : elle ne sera pas dupliquée." },
  en: { ok: 'Request sent. Reference: ', not_configured: 'Quote reception is not activated yet. Nothing was transmitted.', rate_limited: 'Too many requests. Try again in a few minutes.', invalid: 'Form incomplete or invalid.', captcha: 'Anti-bot check failed.', error: 'Your request was not sent. Try again later.', too_large: 'Files too large.', files_need_js: 'To attach drawings, turn on JavaScript or send them by e-mail. Nothing was transmitted.', notify_failed: 'Your request is recorded, but the team has not been notified yet. Send the form again: it will not be duplicated.' },
  ar: { ok: 'أُرسل الطلب. المرجع: ', not_configured: 'خدمة استقبال الطلبات غير مفعّلة بعد. لم يُرسَل أي شيء.', rate_limited: 'طلبات كثيرة. أعد المحاولة بعد دقائق.', invalid: 'الاستمارة ناقصة أو غير صالحة.', captcha: 'فشل التحقق من أنك لست روبوتًا.', error: 'لم يُرسَل الطلب. أعد المحاولة لاحقًا.', too_large: 'الملفات كبيرة جدًا.', files_need_js: 'لإرفاق المخططات فعّل JavaScript أو أرسلها بالبريد الإلكتروني. لم يُرسَل أي شيء.', notify_failed: 'سُجّل طلبك لكن الفريق لم يُبلَّغ بعد. أعد إرسال الاستمارة: لن يتكرر الطلب.' },
};

// Function responses do not get dist/_headers, so they carry their own.
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
};

export function notifyMode(env) {
  if (env.RFQ_WEBHOOK_URL) return 'webhook';
  if (env.RESEND_API_KEY && env.RFQ_TO_EMAIL && env.RFQ_FROM_EMAIL) return 'resend';
  return null;
}
export const uploadsReady = env => !!(env.RFQ_BUCKET && env.R2_ACCOUNT_ID && env.R2_BUCKET_NAME && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max + 1) : '');
export const safeName = n => (n || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(-100) || 'file';
const extOf = n => (String(n).split('.').pop() || '').toLowerCase();

export function sniff(bytes, ext) {
  let head = '';
  for (let i = 0; i < Math.min(64, bytes.length); i++) head += String.fromCharCode(bytes[i]);
  if (ext === 'pdf') return head.startsWith('%PDF-');
  if (ext === 'dwg') return /^AC1\d{3}/.test(head);
  if (ext === 'dxf') return head.startsWith('AutoCAD Binary DXF') || /^\s*0\s*\r?\n\s*SECTION/.test(head) || /^\s*999\s*\r?\n/.test(head);
  return false;
}

const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const day = now => now.toISOString().slice(0, 10).replace(/-/g, '');

// Best effort only: each Cloudflare isolate has its own memory. Add a WAF rate-limiting rule on /api/rfq* for a real limit.
const hits = new Map();
function rateLimited(key, max, now = Date.now()) {
  const arr = (hits.get(key) || []).filter(t => now - t < RATE_WINDOW);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}
export const _resetRateLimit = () => hits.clear();

/** @param {(k: string) => any} get field getter (FormData.get or a JSON object) */
export function validate(get, productSlugs) {
  const f = {
    name: str(get('name'), 120), company: str(get('company'), 160), email: str(get('email'), 254), phone: str(get('phone'), 40),
    country: str(get('country'), 120), category: str(get('category'), 60), timeline: str(get('timeline'), 2),
    material: str(get('material'), 200), quantity: str(get('quantity'), 60), requirements: str(get('requirements'), 5000),
  };
  const bad = [];
  if (f.name.length < 2 || f.name.length > 120) bad.push('name');
  if (!f.company || f.company.length > 160) bad.push('company');
  if (!EMAIL_RE.test(f.email) || f.email.length > 254) bad.push('email');
  if (f.phone && !/^[+\d\s().\-]{4,40}$/.test(f.phone)) bad.push('phone');
  if (f.country.length < 2 || f.country.length > 120) bad.push('country');
  if (!productSlugs.has(f.category)) bad.push('category');
  if (!/^[0-3]$/.test(f.timeline)) bad.push('timeline');
  if (f.material.length > 200) bad.push('material');
  if (f.quantity.length > 60) bad.push('quantity');
  if (f.requirements.length > 5000) bad.push('requirements');
  if (get('consent') !== 'yes') bad.push('consent');
  return { fields: f, bad };
}

/** File list announced by the browser before uploading: names, sizes and types are checked again after upload. */
export function validateManifest(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_FILES) return null;
  const out = [], used = new Set();
  for (const [i, x] of list.entries()) {
    const ext = extOf(x && x.name);
    if (!TYPES[ext] || !Number.isInteger(x.size) || x.size < 1 || x.size > MAX_FILE) return null;
    let name = safeName(x.name); if (used.has(name)) name = `${i + 1}-${name}`; used.add(name);
    out.push({ name, size: x.size, ext, type: TYPES[ext] });
  }
  return out;
}

async function verifyTurnstile(secret, token, ip, fetchImpl) {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const r = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

// Reads at most `max` bytes of the body; null if it is longer (nothing larger is ever buffered).
async function readCapped(request, max) {
  if (Number(request.headers.get('content-length') || 0) > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader(); const parts = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

// ---------- storage (R2 binding) ----------
const recordKey = ref => `${ref}/request.json`;
async function loadRecord(env, ref) {
  const obj = await env.RFQ_BUCKET.get(recordKey(ref));
  if (!obj) return null;
  return { rec: JSON.parse(await obj.text()), etag: obj.etag };
}
const saveRecord = (env, rec, etag) => env.RFQ_BUCKET.put(recordKey(rec.ref), JSON.stringify(rec, null, 2),
  { httpMetadata: { contentType: 'application/json' }, ...(etag ? { onlyIf: { etagMatches: etag } } : {}) });

// Same sid → same reference (so a retry finds its earlier record); a different request that happens to hash to an
// existing reference gets a random one instead.
async function referenceFor(env, sid, now) {
  const sidHash = SID_RE.test(sid || '') ? await sha256Hex('rfq-sid:' + sid) : null;
  const ref = sidHash ? `RFQ-${day(now)}-${sidHash.slice(0, 6).toUpperCase()}` : `RFQ-${day(now)}-${randomHex(3).toUpperCase()}`;
  if (!env.RFQ_BUCKET) return { ref, sidHash, existing: null };
  const existing = await loadRecord(env, ref);
  if (existing && sidHash && existing.rec.sidHash === sidHash) return { ref, sidHash, existing };
  if (existing) return { ref: `RFQ-${day(now)}-${randomHex(3).toUpperCase()}`, sidHash, existing: null };
  return { ref, sidHash, existing: null };
}

function s3Url(env, key) {
  const base = env.R2_S3_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return `${base.replace(/\/$/, '')}/${env.R2_BUCKET_NAME}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
const signed = (env, method, key, expires, headers, now) => presign({ method, url: s3Url(env, key), accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY, expires, headers, now });

// ---------- notification ----------
function summary(rec, links) {
  const f = rec.fields;
  return [
    `Nouvelle demande de devis ${rec.ref}`, '',
    `Nom : ${f.name}`, `Société : ${f.company}`, `E-mail : ${f.email}`, `Téléphone : ${f.phone || '—'}`, `Pays / livraison : ${f.country}`,
    `Produit : ${f.category}`, `Délai (index) : ${f.timeline}`, `Matière : ${f.material || '—'}`, `Quantité : ${f.quantity || '—'}`, '',
    'Exigences :', f.requirements || '—', '',
    `Fichiers (${rec.files.length}) : ${rec.files.map(s => `${s.name} (${(s.size / 1048576).toFixed(2)} Mo)`).join(', ') || 'aucun'}`,
    ...rec.files.map((s, i) => (links[i] ? `  ${s.name} : ${links[i]}` : `  ${s.name} : R2 ${s.key}`)),
    `Stockage : ${rec.storage}`, `Langue : ${rec.lang} · Reçu : ${rec.receivedAt}`,
  ].join('\n');
}

async function notify(env, rec, fetchImpl, now) {
  const mode = notifyMode(env);
  const days = Math.min(7, Math.max(0, Number(env.RFQ_LINK_DAYS ?? 7) || 0));
  const links = uploadsReady(env) && days ? await Promise.all(rec.files.map(s => signed(env, 'GET', s.key, days * 86400, {}, now))) : [];
  const text = summary(rec, links);
  const files = rec.files.map((s, i) => ({ name: s.name, size: s.size, key: s.key, ...(links[i] ? { url: links[i] } : {}) }));
  if (mode === 'webhook') {
    const r = await fetchImpl(env.RFQ_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': rec.ref, ...(env.RFQ_WEBHOOK_TOKEN ? { Authorization: `Bearer ${env.RFQ_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify({ ref: rec.ref, receivedAt: rec.receivedAt, lang: rec.lang, fields: rec.fields, files, ...(links.length ? { linksExpireDays: days } : {}), text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`webhook ${r.status}`);
    return;
  }
  if (mode === 'resend') {
    const f = rec.fields;
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `rfq-${rec.ref}` },
      body: JSON.stringify({ from: env.RFQ_FROM_EMAIL, to: env.RFQ_TO_EMAIL.split(',').map(s => s.trim()), reply_to: f.email,
        subject: `[Devis ${rec.ref}] ${f.company} — ${f.category}`, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`resend ${r.status}`);
    return;
  }
  throw new Error('no notifier');
}

// Notify exactly once per recorded request. With R2, the record is claimed with a conditional write first,
// so two concurrent retries cannot both notify. → 'ok' | 'busy' | 'failed'
async function notifyOnce(env, rec, etag, { fetchImpl, log, now }) {
  if (!env.RFQ_BUCKET) {
    try { await notify(env, rec, fetchImpl, now); return 'ok'; } catch (e) { log('rfq notify failed', rec.ref, e.message); return 'failed'; }
  }
  if (rec.status === 'notified') return 'ok';
  if (rec.status === 'notifying' && now - new Date(rec.claimedAt) < CLAIM_TTL) return 'busy';
  rec.status = 'notifying'; rec.claimedAt = now.toISOString(); rec.attempts = (rec.attempts || 0) + 1;
  const claim = await saveRecord(env, rec, etag);
  if (!claim) return 'busy';
  try {
    await notify(env, rec, fetchImpl, now);
  } catch (e) {
    log('rfq notify failed', rec.ref, e.message);
    rec.status = 'notify_failed';
    await saveRecord(env, rec, claim.etag).catch(() => {});
    return 'failed';
  }
  rec.status = 'notified'; rec.notifiedAt = new Date().toISOString();
  await saveRecord(env, rec, claim.etag).catch(e => log('rfq status write failed', rec.ref, e.message)); // already notified: never undo
  log('rfq ok', rec.ref, `${rec.files.length} file(s)`);
  return 'ok';
}

const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
export function htmlReply(lang, ok, msg) {
  const back = `/${LANGS.includes(lang) ? lang : 'fr'}/contact/`;
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LIBALSTAL</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/assets/css/site.css"></head><body><main class="wrap sec"><h1>${ok ? '✓' : '✕'}</h1><p class="lead">${esc(msg)}</p><p><a class="btn" href="${back}">←</a></p></main></body></html>`;
}

// Common entry checks: notifier, rate limit, origin. Returns a reply or null.
function context(request, env, { json = false } = {}) {
  const wantsJson = json || (request.headers.get('accept') || '').includes('application/json');
  const c = { lang: 'fr', ip: request.headers.get('cf-connecting-ip') || 'unknown' };
  try { const p = new URL(request.headers.get('referer') || '').pathname.split('/')[1]; if (LANGS.includes(p)) c.lang = p; } catch { /* no referer */ }
  c.reply = (status, payload) => {
    if (wantsJson) return new Response(JSON.stringify(payload), { status, headers: { ...SEC, 'Content-Type': 'application/json; charset=utf-8' } });
    const m = MSG[c.lang] || MSG.fr;
    return new Response(htmlReply(c.lang, payload.ok, payload.ok ? m.ok + payload.ref : (m[payload.error] || m.error)),
      { status, headers: { ...SEC, 'Content-Type': 'text/html; charset=utf-8' } });
  };
  c.originOk = () => {
    const origin = request.headers.get('origin');
    if (!origin) return true;
    let oh = ''; try { oh = new URL(origin).host; } catch { /* invalid origin */ }
    return oh === new URL(request.url).host || (env.RFQ_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).includes(origin);
  };
  return c;
}
const defaults = o => ({ fetchImpl: fetch, log: console.log, now: new Date(), ...o });

// ---------- POST /api/rfq: quote without attachments ----------
export async function handleRfq(request, env, opts = {}) {
  const { productSlugs, fetchImpl, log, now } = defaults(opts);
  const c = context(request, env);
  if (!notifyMode(env)) { log('rfq rejected: notifier not configured'); return c.reply(503, { ok: false, error: 'not_configured' }); }
  if (rateLimited(c.ip, RATE_MAX)) return c.reply(429, { ok: false, error: 'rate_limited' });
  const ct = request.headers.get('content-type') || '';
  if (!ct.startsWith('multipart/form-data') && !ct.startsWith('application/x-www-form-urlencoded')) return c.reply(415, { ok: false, error: 'invalid' });
  if (!c.originOk()) return c.reply(403, { ok: false, error: 'invalid' });
  const body = await readCapped(request, MAX_FORM);
  if (!body) return c.reply(413, { ok: false, error: 'files_need_js' }); // only attachments make a quote this large

  let fd;
  try { fd = await new Response(body, { headers: { 'content-type': ct } }).formData(); } catch { return c.reply(400, { ok: false, error: 'invalid' }); }
  c.lang = LANGS.includes(fd.get('lang')) ? fd.get('lang') : 'fr';
  if (str(fd.get('website'), 200)) { log('rfq honeypot hit', c.ip); return c.reply(400, { ok: false, error: 'invalid' }); }
  const { fields, bad } = validate(k => fd.get(k), productSlugs);
  if (fd.getAll('files').some(x => x && typeof x === 'object' && x.size > 0)) return c.reply(400, { ok: false, error: 'files_need_js', fields: ['files'] });
  if (bad.length) return c.reply(400, { ok: false, error: 'invalid', fields: [...new Set(bad)] });

  if (env.TURNSTILE_SECRET_KEY) {
    let pass = false;
    try { pass = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, str(fd.get('cf-turnstile-response'), 4096), c.ip, fetchImpl); } catch (e) { log('turnstile error', e.message); }
    if (!pass) return c.reply(403, { ok: false, error: 'captcha' });
  }

  let rec, etag;
  try {
    const r = await referenceFor(env, str(fd.get('sid'), 64), now);
    if (r.existing && r.existing.rec.files.length === 0) ({ rec, etag } = r.existing); // retry of this same quote
    else {
      const ref = r.existing ? `RFQ-${day(now)}-${randomHex(3).toUpperCase()}` : r.ref; // sid last used for an upload: new quote
      rec = { ref, sidHash: r.existing ? null : r.sidHash, receivedAt: now.toISOString(), lang: c.lang, ip: c.ip, userAgent: (request.headers.get('user-agent') || '').slice(0, 300),
        fields, files: [], storage: env.RFQ_BUCKET ? `R2 ${ref}/` : 'aucun (notification uniquement)', status: 'received' };
      if (env.RFQ_BUCKET) etag = (await saveRecord(env, rec)).etag; // durable before anything else
    }
  } catch (e) { log('rfq storage error', e.message); return c.reply(500, { ok: false, error: 'error' }); }

  const res = await notifyOnce(env, rec, etag, { fetchImpl, log, now });
  if (res === 'ok') return c.reply(200, { ok: true, ref: rec.ref });
  if (res === 'busy') return c.reply(409, { ok: false, error: 'in_progress', ref: rec.ref });
  return c.reply(502, { ok: false, error: env.RFQ_BUCKET ? 'notify_failed' : 'error', ref: env.RFQ_BUCKET ? rec.ref : undefined });
}

async function readJson(request, c) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) return { err: c.reply(415, { ok: false, error: 'invalid' }) };
  const body = await readCapped(request, MAX_JSON);
  if (!body) return { err: c.reply(413, { ok: false, error: 'too_large' }) };
  try { const j = JSON.parse(new TextDecoder().decode(body)); if (j && typeof j === 'object') return { j }; } catch { /* below */ }
  return { err: c.reply(400, { ok: false, error: 'invalid' }) };
}

// ---------- POST /api/rfq/start ----------
export async function handleStart(request, env, opts = {}) {
  const { productSlugs, fetchImpl, log, now } = defaults(opts);
  const c = context(request, env, { json: true });
  if (!notifyMode(env)) return c.reply(503, { ok: false, error: 'not_configured' });
  if (!uploadsReady(env)) return c.reply(503, { ok: false, error: 'uploads_unavailable' });
  if (rateLimited(c.ip, RATE_MAX)) return c.reply(429, { ok: false, error: 'rate_limited' });
  if (!c.originOk()) return c.reply(403, { ok: false, error: 'invalid' });
  const { j, err } = await readJson(request, c); if (err) return err;

  c.lang = LANGS.includes(j.lang) ? j.lang : 'fr';
  const fv = j.fields && typeof j.fields === 'object' ? j.fields : {};
  if (str(fv.website, 200)) { log('rfq honeypot hit', c.ip); return c.reply(400, { ok: false, error: 'invalid' }); }
  const { fields, bad } = validate(k => fv[k], productSlugs);
  const files = validateManifest(j.files);
  if (!files) bad.push('files');
  if (bad.length) return c.reply(400, { ok: false, error: 'invalid', fields: [...new Set(bad)] });

  if (env.TURNSTILE_SECRET_KEY) {
    let pass = false;
    try { pass = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, str(j.turnstile, 4096), c.ip, fetchImpl); } catch (e) { log('turnstile error', e.message); }
    if (!pass) return c.reply(403, { ok: false, error: 'captcha' });
  }

  const token = randomHex(32);
  let rec;
  try {
    const r = await referenceFor(env, str(j.sid, 64), now);
    const same = r.existing && r.existing.rec.status !== 'rejected' && r.existing.rec.files.length === files.length
      && r.existing.rec.files.every((x, i) => x.name === files[i].name && x.size === files[i].size);
    if (same && r.existing.rec.status === 'notified') return c.reply(200, { ok: true, ref: r.ref, done: true });
    if (same) {
      // retry: same reference and a new token; new upload URLs only while the files are not verified yet
      rec = r.existing.rec; rec.tokenHash = await sha256Hex(token);
      if (!await saveRecord(env, rec, r.existing.etag)) return c.reply(409, { ok: false, error: 'in_progress', ref: rec.ref });
      if (rec.status !== 'awaiting_upload') return c.reply(200, { ok: true, ref: rec.ref, token, uploads: [], expiresIn: UPLOAD_TTL });
    } else {
      const ref = r.existing ? `RFQ-${day(now)}-${randomHex(3).toUpperCase()}` : r.ref;
      rec = { ref, sidHash: r.existing ? null : r.sidHash, createdAt: now.toISOString(), lang: c.lang, ip: c.ip, userAgent: (request.headers.get('user-agent') || '').slice(0, 300),
        fields, files: files.map((f, i) => ({ ...f, key: `${ref}/${i + 1}-${f.name}` })), storage: `R2 ${ref}/`, status: 'awaiting_upload',
        tokenHash: await sha256Hex(token) };
      await saveRecord(env, rec);
    }
  } catch (e) { log('rfq storage error', e.message); return c.reply(500, { ok: false, error: 'error' }); }

  const uploads = await Promise.all(rec.files.map(async f => {
    const headers = { 'Content-Type': f.type };
    return { url: await signed(env, 'PUT', f.key, UPLOAD_TTL, { ...headers, 'Content-Length': f.size }, now), headers, size: f.size };
  }));
  return c.reply(200, { ok: true, ref: rec.ref, token, uploads, expiresIn: UPLOAD_TTL });
}

// ---------- POST /api/rfq/finish ----------
export async function handleFinish(request, env, opts = {}) {
  const { fetchImpl, log, now } = defaults(opts);
  const c = context(request, env, { json: true });
  if (!notifyMode(env)) return c.reply(503, { ok: false, error: 'not_configured' });
  if (!uploadsReady(env)) return c.reply(503, { ok: false, error: 'uploads_unavailable' });
  if (rateLimited('finish:' + c.ip, FINISH_MAX)) return c.reply(429, { ok: false, error: 'rate_limited' });
  if (!c.originOk()) return c.reply(403, { ok: false, error: 'invalid' });
  const { j, err } = await readJson(request, c); if (err) return err;
  if (!REF_RE.test(j.ref || '') || typeof j.token !== 'string' || !/^[0-9a-f]{64}$/.test(j.token)) return c.reply(400, { ok: false, error: 'invalid' });

  let rec, etag;
  try {
    const got = await loadRecord(env, j.ref);
    if (!got || got.rec.tokenHash !== await sha256Hex(j.token)) return c.reply(403, { ok: false, error: 'invalid' });
    ({ rec, etag } = got);
    if (rec.status === 'rejected') return c.reply(400, { ok: false, error: 'invalid', fields: ['files'] });
    if (rec.status === 'awaiting_upload') {
      const missing = [];
      for (const [i, f] of rec.files.entries()) {
        const head = await env.RFQ_BUCKET.head(f.key);
        if (!head) { missing.push(i); continue; }
        let ok = head.size === f.size;
        if (ok) { const part = await env.RFQ_BUCKET.get(f.key, { range: { offset: 0, length: 64 } }); ok = !!part && sniff(new Uint8Array(await part.arrayBuffer()), f.ext); }
        if (!ok) {
          log('rfq upload rejected', rec.ref, f.name);
          await env.RFQ_BUCKET.delete(rec.files.map(x => x.key)).catch(() => {});
          rec.status = 'rejected'; await saveRecord(env, rec, etag).catch(() => {});
          return c.reply(400, { ok: false, error: 'invalid', fields: ['files'] });
        }
      }
      if (missing.length) return c.reply(409, { ok: false, error: 'upload_incomplete', missing });
      rec.status = 'received'; rec.receivedAt = now.toISOString();
      const w = await saveRecord(env, rec, etag); // durable record of the complete request
      if (!w) return c.reply(409, { ok: false, error: 'in_progress', ref: rec.ref });
      etag = w.etag;
    }
  } catch (e) { log('rfq storage error', e.message); return c.reply(500, { ok: false, error: 'error' }); }

  const res = await notifyOnce(env, rec, etag, { fetchImpl, log, now });
  if (res === 'ok') return c.reply(200, { ok: true, ref: rec.ref });
  if (res === 'busy') return c.reply(409, { ok: false, error: 'in_progress', ref: rec.ref });
  return c.reply(502, { ok: false, error: 'notify_failed', ref: rec.ref });
}

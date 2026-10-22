// Unit tests: the Cloudflare Pages Functions for quote requests (functions/_lib/rfq.js), run in Node with Web APIs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleRfq, handleStart, handleFinish, notifyMode, uploadsReady, sniff, _resetRateLimit, MAX_FILE, MAX_FORM } from '../../functions/_lib/rfq.js';
import { presign } from '../../functions/_lib/sigv4.js';
import { onRequestPost, onRequest } from '../../functions/api/rfq/index.js';
import * as startRoute from '../../functions/api/rfq/start.js';
import * as finishRoute from '../../functions/api/rfq/finish.js';
import { onRequestGet as healthz } from '../../functions/healthz.js';

const SLUGS = new Set(['elbows', 'other']);
const BASE = 'https://www.libalstal.com/api/rfq';
const PDF = new TextEncoder().encode('%PDF-1.7\n%test\n');
const DWG = new TextEncoder().encode('AC1032' + '\0'.repeat(40));
const quiet = () => {};
const FIELDS = { name: 'Amine K.', company: 'Bureau Test', email: 'a@example.com', phone: '+213 555 00 00 00', country: 'Algérie',
  category: 'elbows', timeline: '1', material: 'Galva 0,8 mm', quantity: '20', requirements: 'Ø 315', consent: 'yes' };
const SID = 'sid-0123456789abcdef';

function form(over = {}, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...FIELDS, lang: 'fr', website: '', ...over })) if (v !== undefined) fd.append(k, v);
  for (const f of files) fd.append('files', f);
  return fd;
}
const req = (fd, headers = {}) => new Request(BASE, { method: 'POST', body: fd, headers: { accept: 'application/json', 'cf-connecting-ip': '1.2.3.4', ...headers } });
const jreq = (path, body, headers = {}) => new Request(BASE + path, { method: 'POST', body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', origin: 'https://www.libalstal.com', 'cf-connecting-ip': '1.2.3.4', ...headers } });

// R2 binding double: etags, conditional writes (onlyIf.etagMatches → null on mismatch), ranged reads, deletes.
function r2() {
  const store = new Map(), reads = []; let n = 0;
  const view = (o, b) => ({ etag: o.etag, size: o.bytes.length, text: async () => new TextDecoder().decode(b), arrayBuffer: async () => b.slice().buffer });
  return {
    store, reads,
    async put(k, v, opts = {}) {
      await null; const cur = store.get(k);
      if (opts.onlyIf && 'etagMatches' in opts.onlyIf && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
      const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v instanceof ArrayBuffer ? v : v.buffer ?? v);
      const etag = 'e' + (++n); store.set(k, { bytes, etag }); return { key: k, etag, size: bytes.length };
    },
    async get(k, opts = {}) {
      await null; reads.push([k, opts.range || null]); const o = store.get(k); if (!o) return null;
      return view(o, opts.range ? o.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length) : o.bytes);
    },
    async head(k) { await null; const o = store.get(k); return o ? { key: k, size: o.bytes.length, etag: o.etag } : null; },
    async delete(keys) { for (const k of [].concat(keys)) store.delete(k); },
  };
}
const rec = (b, ref) => JSON.parse(new TextDecoder().decode(b.store.get(`${ref}/request.json`).bytes));
function mockFetch(...statuses) {
  const calls = [];
  return { calls, fn: async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: statuses.length > 1 ? statuses.shift() : statuses[0] ?? 200 }); } };
}
const S3 = { R2_ACCOUNT_ID: 'acc123', R2_BUCKET_NAME: 'rfq-private', R2_ACCESS_KEY_ID: 'AKIDTEST', R2_SECRET_ACCESS_KEY: 'secret/test' };
const webhookEnv = extra => ({ RFQ_WEBHOOK_URL: 'https://hook.example/x', ...extra });
const fullEnv = (b, extra) => webhookEnv({ RFQ_BUCKET: b, ...S3, ...extra });
const o = (m, extra) => ({ productSlugs: SLUGS, fetchImpl: m.fn, log: quiet, ...extra });
// What the browser does with a presigned URL (the signature itself is checked against AWS's vector below).
const upload = (b, start, contents) => Promise.all(start.uploads.map((u, i) => b.put(decodeURIComponent(new URL(u.url).pathname).split('/').slice(2).join('/'), contents[i])));
const startBody = (over = {}) => ({ lang: 'fr', sid: SID, fields: FIELDS, files: [{ name: 'plan coude.pdf', size: PDF.length }], ...over });

beforeEach(() => _resetRateLimit());

// ---------- configuration ----------
test('not configured → 503 everywhere and nothing stored or sent', async () => {
  const b = r2(), m = mockFetch();
  for (const r of [await handleRfq(req(form()), { RFQ_BUCKET: b }, o(m)), await handleStart(jreq('/start', startBody()), { RFQ_BUCKET: b, ...S3 }, o(m)),
    await handleFinish(jreq('/finish', { ref: 'RFQ-20260101-ABCDEF', token: 'a'.repeat(64) }), { RFQ_BUCKET: b, ...S3 }, o(m))]) {
    assert.equal(r.status, 503); assert.equal((await r.json()).error, 'not_configured');
  }
  assert.equal(b.store.size, 0); assert.equal(m.calls.length, 0);
});

test('notifyMode picks webhook first, then complete Resend settings; uploads need the bucket and the S3 token', () => {
  assert.equal(notifyMode({}), null);
  assert.equal(notifyMode({ RESEND_API_KEY: 'k', RFQ_TO_EMAIL: 'a@b.c' }), null);
  assert.equal(notifyMode({ RESEND_API_KEY: 'k', RFQ_TO_EMAIL: 'a@b.c', RFQ_FROM_EMAIL: 'x@b.c' }), 'resend');
  assert.equal(notifyMode({ RFQ_WEBHOOK_URL: 'https://h', RESEND_API_KEY: 'k' }), 'webhook');
  assert.equal(uploadsReady({ RFQ_BUCKET: r2() }), false);
  assert.equal(uploadsReady({ RFQ_BUCKET: r2(), ...S3 }), true);
});

test('/healthz reports readiness without revealing secrets', async () => {
  const j = await (healthz({ env: fullEnv(r2(), { RFQ_WEBHOOK_TOKEN: 'tok-secret' }) })).json();
  assert.deepEqual(j, { ok: true, rfq: 'ready', storage: 'r2', uploads: 'ready', turnstile: 'off' });
  assert.equal((await healthz({ env: webhookEnv() }).json()).uploads, 'off');
});

// ---------- quote without attachments ----------
test('quote without files → recorded in R2 before notifying, webhook called once with Idempotency-Key', async () => {
  const b = r2(), m = mockFetch();
  const r = await handleRfq(req(form({ sid: SID })), webhookEnv({ RFQ_BUCKET: b }), o(m));
  const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.ok, true); assert.match(j.ref, /^RFQ-\d{8}-[0-9A-F]{6}$/);
  assert.equal(rec(b, j.ref).status, 'notified');
  assert.equal(m.calls.length, 1); assert.equal(m.calls[0].init.headers['Idempotency-Key'], j.ref);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('without R2, a quote without files is only a success once the notifier accepted it', async () => {
  let r = await handleRfq(req(form()), webhookEnv(), o(mockFetch()));
  assert.equal(r.status, 200);
  _resetRateLimit();
  r = await handleRfq(req(form()), webhookEnv(), o(mockFetch(500)));
  assert.equal(r.status, 502); assert.equal((await r.json()).error, 'error', 'nothing recorded: plain failure, no reference');
});

test('Resend mode: reply-to, Idempotency-Key, no attachments in the e-mail', async () => {
  const m = mockFetch();
  const env = { RESEND_API_KEY: 'k', RFQ_TO_EMAIL: 'devis@libalstal.com, b@x.dz', RFQ_FROM_EMAIL: 'site@libalstal.com' };
  const r = await handleRfq(req(form()), env, o(m));
  assert.equal(r.status, 200);
  const body = JSON.parse(m.calls[0].init.body);
  assert.equal(m.calls[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(body.to, ['devis@libalstal.com', 'b@x.dz']);
  assert.equal(body.reply_to, 'a@example.com');
  assert.equal(body.attachments, undefined);
  assert.match(m.calls[0].init.headers['Idempotency-Key'], /^rfq-RFQ-/);
});

test('validation errors and honeypot → 400, nothing sent; a file in the single-shot form → files_need_js', async () => {
  for (const [fd, field] of [[form({ email: 'nope' }), 'email'], [form({ consent: undefined }), 'consent'], [form({ category: 'rockets' }), 'category']]) {
    _resetRateLimit(); const m = mockFetch();
    const r = await handleRfq(req(fd), webhookEnv(), o(m)); const j = await r.json();
    assert.equal(r.status, 400, field); assert.ok(j.fields.includes(field), field); assert.equal(m.calls.length, 0);
  }
  let m = mockFetch();
  let r = await handleRfq(req(form({ website: 'spam' })), webhookEnv(), o(m));
  assert.equal(r.status, 400); assert.equal(m.calls.length, 0);
  m = mockFetch();
  r = await handleRfq(req(form({}, [new File([PDF], 'p.pdf')])), webhookEnv(), o(m));
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'files_need_js'); assert.equal(m.calls.length, 0);
});

test('body over 64 KB (attachments without JavaScript) → 413 files_need_js, read stops at the cap', async () => {
  const big = new Uint8Array(MAX_FILE); big.set(PDF);
  const m = mockFetch();
  // Serialized like a browser upload: cancelling Node's own FormData body stream throws inside undici after the test ends.
  const encoded = new Response(form({}, [new File([big], 'big.pdf')]));
  const bytes = await encoded.arrayBuffer();
  const r = await handleRfq(req(bytes, { 'content-type': encoded.headers.get('content-type'), 'content-length': String(bytes.byteLength) }), webhookEnv(), o(m));
  assert.equal(r.status, 413); assert.equal((await r.json()).error, 'files_need_js'); assert.equal(m.calls.length, 0);
  // no Content-Length (chunked): still capped while streaming
  const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(16 * 1024)); } });
  const r2_ = await handleRfq(new Request(BASE, { method: 'POST', body: stream, duplex: 'half', headers: { accept: 'application/json', 'content-type': 'multipart/form-data; boundary=x' } }), webhookEnv(), o(m));
  assert.equal(r2_.status, 413);
  assert.ok(MAX_FORM <= 64 * 1024);
});

test('cross-origin post → 403 on every endpoint; allowed origin passes', async () => {
  const evil = { origin: 'https://evil.example' };
  assert.equal((await handleRfq(req(form(), evil), webhookEnv(), o(mockFetch()))).status, 403);
  assert.equal((await handleStart(jreq('/start', startBody(), evil), fullEnv(r2()), o(mockFetch()))).status, 403);
  assert.equal((await handleFinish(jreq('/finish', { ref: 'RFQ-20260101-ABCDEF', token: 'a'.repeat(64) }, evil), fullEnv(r2()), o(mockFetch()))).status, 403);
  assert.equal((await handleRfq(req(form(), { origin: 'https://www.libalstal.com' }), webhookEnv(), o(mockFetch()))).status, 200);
});

test('rate limit → 429 after 5 requests from one IP (start and single-shot share it)', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await handleRfq(req(form()), webhookEnv(), o(mockFetch()))).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await handleStart(jreq('/start', startBody({ sid: undefined })), fullEnv(r2()), o(mockFetch()))).status, 200);
  assert.equal((await handleRfq(req(form()), webhookEnv(), o(mockFetch()))).status, 429);
  assert.equal((await handleStart(jreq('/start', startBody()), fullEnv(r2()), o(mockFetch()))).status, 429);
});

test('notification failure → 502 notify_failed with the reference; retry with the same sid → same reference, notified once', async () => {
  const b = r2(), m = mockFetch(500, 200);
  let r = await handleRfq(req(form({ sid: SID })), webhookEnv({ RFQ_BUCKET: b }), o(m));
  let j = await r.json();
  assert.equal(r.status, 502); assert.equal(j.error, 'notify_failed');
  assert.equal(rec(b, j.ref).status, 'notify_failed');
  const ref = j.ref;
  r = await handleRfq(req(form({ sid: SID })), webhookEnv({ RFQ_BUCKET: b }), o(m));
  j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.ref, ref); assert.equal(rec(b, ref).status, 'notified');
  r = await handleRfq(req(form({ sid: SID })), webhookEnv({ RFQ_BUCKET: b }), o(m));
  assert.equal((await r.json()).ref, ref);
  assert.equal(m.calls.length, 2, 'one failed attempt + one delivery, then nothing more');
});

test('double submission at the same moment (same sid) → exactly one notification', async () => {
  const b = r2(), m = mockFetch();
  const [a, c] = await Promise.all([0, 1].map(() => handleRfq(req(form({ sid: SID })), webhookEnv({ RFQ_BUCKET: b }), o(m))));
  assert.ok([a.status, c.status].every(x => x === 200 || x === 409), `${a.status} ${c.status}`);
  const refs = new Set([(await a.json()).ref, (await c.json()).ref]);
  assert.equal(refs.size, 1, 'one reference for both');
  assert.equal(m.calls.length, 1);
});

test('Turnstile: missing or failed token → 403 captcha (single-shot and start)', async () => {
  const m = { calls: [], fn: async () => new Response(JSON.stringify({ success: false })) };
  let r = await handleRfq(req(form()), webhookEnv({ TURNSTILE_SECRET_KEY: 's' }), o(m));
  assert.equal(r.status, 403); assert.equal((await r.json()).error, 'captcha');
  r = await handleRfq(req(form({ 'cf-turnstile-response': 'tok' })), webhookEnv({ TURNSTILE_SECRET_KEY: 's' }), o(m));
  assert.equal(r.status, 403);
  const b = r2();
  r = await handleStart(jreq('/start', startBody({ turnstile: 'tok' })), fullEnv(b, { TURNSTILE_SECRET_KEY: 's' }), o(m));
  assert.equal(r.status, 403); assert.equal(b.store.size, 0);
});

test('without JSON accept, replies with a localised HTML page (Arabic, RTL)', async () => {
  const r = await handleRfq(new Request(BASE, { method: 'POST', body: form({ lang: 'ar' }), headers: { 'cf-connecting-ip': '9.9.9.9', referer: 'https://www.libalstal.com/ar/contact/' } }), {}, { productSlugs: SLUGS, log: quiet });
  const h = await r.text();
  assert.equal(r.status, 503); assert.match(h, /dir="rtl"/); assert.match(h, /غير مفعّلة/);
});

test('route files: real product slugs from site.json, 405 on other methods', async () => {
  assert.equal((await onRequestPost({ request: req(form({ category: 'elbows' })), env: {} })).status, 503);
  for (const fn of [onRequest, startRoute.onRequest, finishRoute.onRequest]) { const g = fn(); assert.equal(g.status, 405); assert.equal(g.headers.get('allow'), 'POST'); }
  assert.equal((await startRoute.onRequestPost({ request: jreq('/start', startBody()), env: webhookEnv() })).status, 503, 'uploads_unavailable without R2');
});

// ---------- presigned URLs ----------
test('SigV4 presigning reproduces the AWS S3 documentation example', async () => {
  const u = await presign({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', expires: 86400, now: new Date('2013-05-24T00:00:00Z') });
  assert.equal(new URL(u).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('start → private presigned PUT per file: 15 min, size and type signed, safe key; token stored only as a hash', async () => {
  const b = r2();
  const r = await handleStart(jreq('/start', startBody({ files: [{ name: '../plan coude.pdf', size: 1234 }, { name: 'reseau.dwg', size: 99 }] })), fullEnv(b), o(mockFetch()));
  const j = await r.json();
  assert.equal(r.status, 200); assert.match(j.ref, /^RFQ-\d{8}-[0-9A-F]{6}$/); assert.match(j.token, /^[0-9a-f]{64}$/);
  const u = new URL(j.uploads[0].url);
  assert.equal(u.host, 'acc123.r2.cloudflarestorage.com');
  assert.equal(decodeURIComponent(u.pathname), `/rfq-private/${j.ref}/1-_plan_coude.pdf`);
  assert.equal(u.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
  assert.deepEqual(j.uploads[0].headers, { 'Content-Type': 'application/pdf' });
  assert.equal(j.uploads[1].headers['Content-Type'], 'application/octet-stream');
  const saved = rec(b, j.ref);
  assert.equal(saved.status, 'awaiting_upload'); assert.ok(!JSON.stringify(saved).includes(j.token));
  assert.ok(!JSON.stringify(j).includes('secret/test'), 'no credentials in the reply');
});

test('start rejects bad file lists: wrong type, empty, over 10 MB, more than 5, none', async () => {
  for (const files of [[{ name: 'x.exe', size: 10 }], [{ name: 'a.pdf', size: 0 }], [{ name: 'a.pdf', size: MAX_FILE + 1 }],
    Array.from({ length: 6 }, (_, i) => ({ name: `p${i}.pdf`, size: 10 })), [], 'nope']) {
    _resetRateLimit(); const b = r2();
    const r = await handleStart(jreq('/start', startBody({ files })), fullEnv(b), o(mockFetch()));
    assert.equal(r.status, 400, JSON.stringify(files).slice(0, 40)); assert.ok((await r.json()).fields.includes('files')); assert.equal(b.store.size, 0);
  }
  const r = await handleStart(jreq('/start', startBody({ files: [{ name: 'max.pdf', size: MAX_FILE }] })), fullEnv(r2()), o(mockFetch()));
  assert.equal(r.status, 200, 'exactly 10 MB is allowed');
});

test('start without the S3 token → 503 uploads_unavailable (quotes without files still work)', async () => {
  const r = await handleStart(jreq('/start', startBody()), webhookEnv({ RFQ_BUCKET: r2() }), o(mockFetch()));
  assert.equal(r.status, 503); assert.equal((await r.json()).error, 'uploads_unavailable');
});

// ---------- finish ----------
test('full flow: start → upload → finish → recorded, notified once, links instead of file bytes', async () => {
  const b = r2(), m = mockFetch();
  const s = await (await handleStart(jreq('/start', startBody({ files: [{ name: 'plan.pdf', size: PDF.length }, { name: 'reseau.dwg', size: DWG.length }] })), fullEnv(b), o(m))).json();
  await upload(b, s, [PDF, DWG]);
  const r = await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m));
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, ref: s.ref });
  assert.equal(rec(b, s.ref).status, 'notified');
  assert.equal(m.calls.length, 1);
  const sent = JSON.parse(m.calls[0].init.body);
  assert.deepEqual(sent.files.map(f => f.key), [`${s.ref}/1-plan.pdf`, `${s.ref}/2-reseau.dwg`]);
  assert.equal(new URL(sent.files[0].url).searchParams.get('X-Amz-Expires'), String(7 * 86400));
  assert.ok(!('contentBase64' in sent.files[0]));
  assert.ok(m.calls[0].init.body.length < 8000, 'notification stays small');
  // only the first 64 bytes of each drawing were read
  assert.ok(b.reads.filter(([k]) => !k.endsWith('request.json')).every(([, rg]) => rg && rg.length === 64));
});

test('finish before the upload completed → 409 upload_incomplete with the missing files; works once uploaded', async () => {
  const b = r2(), m = mockFetch();
  const s = await (await handleStart(jreq('/start', startBody({ files: [{ name: 'a.pdf', size: PDF.length }, { name: 'b.pdf', size: PDF.length }] })), fullEnv(b), o(m))).json();
  await b.put(`${s.ref}/1-a.pdf`, PDF);
  let r = await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m));
  assert.equal(r.status, 409); assert.deepEqual(await r.json(), { ok: false, error: 'upload_incomplete', missing: [1] });
  assert.equal(m.calls.length, 0, 'nothing announced before every drawing is stored');
  await b.put(`${s.ref}/2-b.pdf`, PDF);
  r = await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m));
  assert.equal(r.status, 200); assert.equal(m.calls.length, 1);
});

test('finish: wrong token → 403, malformed reference → 400, nothing sent', async () => {
  const b = r2(), m = mockFetch();
  const s = await (await handleStart(jreq('/start', startBody()), fullEnv(b), o(m))).json();
  assert.equal((await handleFinish(jreq('/finish', { ref: s.ref, token: 'b'.repeat(64) }), fullEnv(b), o(m))).status, 403);
  assert.equal((await handleFinish(jreq('/finish', { ref: '../x', token: s.token }), fullEnv(b), o(m))).status, 400);
  assert.equal(m.calls.length, 0);
});

test('uploaded object with the wrong size or a spoofed signature → 400, drawings deleted, request rejected', async () => {
  for (const bad of [new TextEncoder().encode('MZ not a pdf...'), new TextEncoder().encode('%PDF-1.7 but longer than announced')]) {
    _resetRateLimit(); const b = r2(), m = mockFetch();
    const s = await (await handleStart(jreq('/start', startBody({ files: [{ name: 'p.pdf', size: 15 }] })), fullEnv(b), o(m))).json();
    await upload(b, s, [bad]);
    const r = await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m));
    assert.equal(r.status, 400); assert.ok((await r.json()).fields.includes('files'));
    assert.equal(b.store.has(`${s.ref}/1-p.pdf`), false); assert.equal(rec(b, s.ref).status, 'rejected'); assert.equal(m.calls.length, 0);
  }
});

test('large drawings: 5 × 10 MB are verified by reading 64 bytes each', async () => {
  const b = r2(), m = mockFetch();
  const big = new Uint8Array(MAX_FILE); big.set(PDF);
  const files = [1, 2, 3, 4, 5].map(i => ({ name: `p${i}.pdf`, size: MAX_FILE }));
  const s = await (await handleStart(jreq('/start', startBody({ files })), fullEnv(b), o(m))).json();
  await upload(b, s, files.map(() => big));
  const r = await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m));
  assert.equal(r.status, 200);
  const bytesRead = b.reads.filter(([k]) => !k.endsWith('request.json')).reduce((a, [, rg]) => a + rg.length, 0);
  assert.equal(bytesRead, 5 * 64);
});

test('duplicate finish: sequential and concurrent calls → one notification, same reference', async () => {
  const b = r2(), m = mockFetch();
  const s = await (await handleStart(jreq('/start', startBody()), fullEnv(b), o(m))).json();
  await upload(b, s, [PDF]);
  const rs = await Promise.all([0, 1, 2].map(() => handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m))));
  assert.ok(rs.some(r => r.status === 200)); assert.ok(rs.every(r => [200, 409].includes(r.status)));
  const again = await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m));
  assert.equal(again.status, 200); assert.equal((await again.json()).ref, s.ref);
  assert.equal(m.calls.length, 1);
});

test('finish: notification failure → 502 notify_failed, record kept; retry notifies once', async () => {
  const b = r2(), m = mockFetch(503, 200);
  const s = await (await handleStart(jreq('/start', startBody()), fullEnv(b), o(m))).json();
  await upload(b, s, [PDF]);
  let r = await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m));
  assert.equal(r.status, 502); assert.deepEqual(await r.json(), { ok: false, error: 'notify_failed', ref: s.ref });
  assert.equal(rec(b, s.ref).status, 'notify_failed');
  r = await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m));
  assert.equal(r.status, 200); assert.equal(rec(b, s.ref).status, 'notified');
  await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m));
  assert.equal(m.calls.length, 2);
});

test('an abandoned notification claim (older than 60 s) is taken over; a fresh one is not', async () => {
  const b = r2(), m = mockFetch();
  const s = await (await handleStart(jreq('/start', startBody()), fullEnv(b), o(m))).json();
  await upload(b, s, [PDF]);
  const key = `${s.ref}/request.json`;
  const set = async (claimedAt) => { const x = rec(b, s.ref); x.status = 'notifying'; x.claimedAt = claimedAt; await b.put(key, JSON.stringify(x)); };
  await set(new Date().toISOString());
  assert.equal((await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m))).status, 409);
  await set(new Date(Date.now() - 120_000).toISOString());
  assert.equal((await handleFinish(jreq('/finish', { ref: s.ref, token: s.token }), fullEnv(b), o(m))).status, 200);
  assert.equal(m.calls.length, 1);
});

test('start retried with the same sid → same reference, new token (old one refused), no new record; after success → done', async () => {
  const b = r2(), m = mockFetch();
  const a = await (await handleStart(jreq('/start', startBody()), fullEnv(b), o(m))).json();
  const c = await (await handleStart(jreq('/start', startBody()), fullEnv(b), o(m))).json();
  assert.equal(c.ref, a.ref); assert.notEqual(c.token, a.token);
  assert.equal([...b.store.keys()].filter(k => k.endsWith('request.json')).length, 1);
  await upload(b, c, [PDF]);
  assert.equal((await handleFinish(jreq('/finish', { ref: a.ref, token: a.token }), fullEnv(b), o(m))).status, 403);
  assert.equal((await handleFinish(jreq('/finish', { ref: c.ref, token: c.token }), fullEnv(b), o(m))).status, 200);
  const d = await (await handleStart(jreq('/start', startBody()), fullEnv(b), o(m))).json();
  assert.deepEqual(d, { ok: true, ref: a.ref, done: true });
  assert.equal(m.calls.length, 1);
});

test('signature sniffing matches the Node server rules', () => {
  const enc = s => new TextEncoder().encode(s);
  assert.ok(sniff(enc('%PDF-1.4'), 'pdf'));
  assert.ok(sniff(enc('AC1027xxxx'), 'dwg'));
  assert.ok(sniff(enc('  0\nSECTION\n'), 'dxf'));
  assert.ok(!sniff(enc('MZ'), 'pdf'));
});

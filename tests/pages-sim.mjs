#!/usr/bin/env node
// Test fixture (not deployed): a local stand-in for Cloudflare Pages + R2, used by tests/run.mjs.
//   PORT       dist/ with the built headers, and the real Pages Functions (functions/) for /api/rfq*, /healthz
//   S3_PORT    a private "R2 S3 endpoint": accepts PUT only with a valid, unexpired presigned URL (SigV4 checked with
//              the same signer as production, size and type signed), answers CORS preflights for the site origin
// Test-only routes: GET /__sim/store (objects + records), POST /__sim/control?failPuts=n&notifyFail=0|1
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { presign } from '../functions/_lib/sigv4.js';
import * as rfq from '../functions/api/rfq/index.js';
import * as start from '../functions/api/rfq/start.js';
import * as finish from '../functions/api/rfq/finish.js';
import * as health from '../functions/healthz.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 4314), S3_PORT = Number(process.env.S3_PORT || 4321);
const SITE = `http://127.0.0.1:${PORT}`;
const HEADERS = existsSync(join(ROOT, '.build/headers.json')) ? JSON.parse(readFileSync(join(ROOT, '.build/headers.json'), 'utf8')) : {};
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const control = { failPuts: 0, notifyFail: false };

// ---------- R2 binding (in memory) ----------
const store = new Map(); let etagN = 0;
const view = (o, b) => ({ etag: o.etag, size: o.bytes.length, text: async () => new TextDecoder().decode(b), arrayBuffer: async () => b.slice().buffer });
const bucket = {
  async put(k, v, opts = {}) {
    const cur = store.get(k);
    if (opts.onlyIf && 'etagMatches' in opts.onlyIf && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
    const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v);
    const etag = 'e' + (++etagN); store.set(k, { bytes, etag }); return { key: k, etag, size: bytes.length };
  },
  async get(k, opts = {}) { const o = store.get(k); if (!o) return null; return view(o, opts.range ? o.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length) : o.bytes); },
  async head(k) { const o = store.get(k); return o ? { key: k, size: o.bytes.length, etag: o.etag } : null; },
  async delete(keys) { for (const k of [].concat(keys)) store.delete(k); },
};
const env = {
  RFQ_BUCKET: bucket, R2_ACCOUNT_ID: 'sim', R2_BUCKET_NAME: 'rfq-sim', R2_ACCESS_KEY_ID: 'SIMKEY', R2_SECRET_ACCESS_KEY: 'sim-secret',
  R2_S3_ENDPOINT: `http://127.0.0.1:${S3_PORT}`, RFQ_WEBHOOK_URL: `${SITE}/__sim/hook`, RFQ_WEBHOOK_TOKEN: 'tkn',
};

const readBody = req => new Promise((res, rej) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej); });
async function sendResponse(res, r) {
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

let ipN = 0;
createServer(async (req, res) => {
  try {
    const u = new URL(req.url, SITE);
    const routes = { '/api/rfq': rfq, '/api/rfq/start': start, '/api/rfq/finish': finish };
    if (routes[u.pathname]) {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(k)));
      headers['cf-connecting-ip'] = `10.20.0.${++ipN % 250}`;
      const request = new Request(SITE + req.url, { method: req.method, headers, body: req.method === 'POST' ? Readable.toWeb(req) : undefined, duplex: 'half' });
      return sendResponse(res, req.method === 'POST' ? await routes[u.pathname].onRequestPost({ request, env }) : routes[u.pathname].onRequest());
    }
    if (u.pathname === '/healthz') return sendResponse(res, health.onRequestGet({ env }));
    if (u.pathname === '/__sim/hook') { // webhook relay to the test's mock (or a failure on demand)
      const body = await readBody(req);
      if (control.notifyFail) { res.writeHead(500); return res.end('down'); }
      const r = await fetch(process.env.HOOK || 'http://127.0.0.1:4301/hook', { method: 'POST', headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '', 'idempotency-key': req.headers['idempotency-key'] || '' }, body });
      res.writeHead(r.status); return res.end();
    }
    if (u.pathname === '/__sim/store') {
      const out = { objects: {}, records: {} };
      for (const [k, o] of store) { out.objects[k] = o.bytes.length; if (k.endsWith('/request.json')) out.records[k.split('/')[0]] = JSON.parse(new TextDecoder().decode(o.bytes)); }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out));
    }
    if (u.pathname === '/__sim/control' && req.method === 'POST') {
      if (u.searchParams.has('failPuts')) control.failPuts = Number(u.searchParams.get('failPuts'));
      if (u.searchParams.has('notifyFail')) control.notifyFail = u.searchParams.get('notifyFail') === '1';
      res.writeHead(200); return res.end(JSON.stringify(control));
    }
    // static (as Pages serves dist/, with _headers)
    let p = decodeURIComponent(u.pathname); if (p === '/') p = '/fr/';
    let file = normalize(join(DIST, p)); if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); const buf = await readFile(file); res.writeHead(200, { ...HEADERS, 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }); return res.end(buf); }
    catch { res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' }); return res.end(await readFile(join(DIST, '404.html')).catch(() => 'Not found')); }
  } catch (e) { console.error('sim error', e); if (!res.headersSent) res.writeHead(500); res.end(); }
}).listen(PORT, '127.0.0.1');

// ---------- private S3 endpoint ----------
const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'content-type', Vary: 'Origin' };
createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') { res.writeHead(req.headers.origin === SITE ? 204 : 403, req.headers.origin === SITE ? cors : {}); return res.end(); }
  const deny = (code, why) => { res.writeHead(code, { ...cors, 'content-type': 'text/plain' }); res.end(why); };
  if (req.method !== 'PUT') return deny(403, 'private bucket: presigned PUT only');
  const q = u.searchParams, date = q.get('X-Amz-Date') || '', expires = Number(q.get('X-Amz-Expires'));
  const t = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
  if (!t || !(Date.now() < t + expires * 1000)) return deny(403, 'expired');
  const signedNames = (q.get('X-Amz-SignedHeaders') || '').split(';').filter(n => n !== 'host');
  const headers = Object.fromEntries(signedNames.map(n => [n, req.headers[n] ?? '']));
  const bare = new URL(u); for (const k of [...bare.searchParams.keys()]) if (k.startsWith('X-Amz-')) bare.searchParams.delete(k);
  const expected = new URL(await presign({ method: 'PUT', url: bare.toString(), accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, expires, headers, now: new Date(t) })).searchParams.get('X-Amz-Signature');
  if (expected !== q.get('X-Amz-Signature')) return deny(403, 'SignatureDoesNotMatch');
  const body = await readBody(req);
  if (control.failPuts > 0) { control.failPuts--; return deny(500, 'simulated upload failure'); }
  if (body.length !== Number(req.headers['content-length'])) return deny(400, 'length mismatch');
  const key = decodeURIComponent(u.pathname).split('/').slice(2).join('/'); // /<bucket>/<key>
  await bucket.put(key, body);
  res.writeHead(200, { ...cors, ETag: `"${store.get(key).etag}"` }); res.end();
}).listen(S3_PORT, '127.0.0.1');

// Cloudflare Pages Function: GET /healthz — reports whether quote reception is configured (never reveals secrets).
import { notifyMode, uploadsReady } from './_lib/rfq.js';

export const onRequestGet = ({ env }) => new Response(JSON.stringify({
  ok: true,
  rfq: notifyMode(env) ? 'ready' : 'not_configured',
  storage: env.RFQ_BUCKET ? 'r2' : 'none',
  uploads: notifyMode(env) && uploadsReady(env) ? 'ready' : 'off',
  turnstile: env.TURNSTILE_SECRET_KEY ? 'on' : 'off',
}), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

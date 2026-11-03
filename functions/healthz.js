// Cloudflare Pages Function: GET /healthz — reports whether quote reception is configured (never reveals secrets).
// Public: ok, rfq, uploads (what a visitor can already see on the contact page).
// Storage and anti-bot details are only returned with the header `X-Health-Token: <HEALTHZ_TOKEN>`,
// so the page does not advertise that the bot check is off.
import { notifyMode, uploadsReady } from './_lib/rfq.js';

export const onRequestGet = ({ request, env }) => {
  const body = {
    ok: true,
    rfq: notifyMode(env) ? 'ready' : 'not_configured',
    uploads: notifyMode(env) && uploadsReady(env) ? 'ready' : 'off',
  };
  const token = request?.headers?.get('x-health-token');
  if (env.HEALTHZ_TOKEN && token && token === env.HEALTHZ_TOKEN) {
    body.storage = env.RFQ_BUCKET ? 'r2' : 'none';
    body.turnstile = env.TURNSTILE_SECRET_KEY ? 'on' : 'off';
  }
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
};

// Cloudflare Pages Function: POST /api/rfq (quote without attachments, also the no-JavaScript form). Logic lives in ../../_lib/rfq.js.
import site from '../../../content/site.json' with { type: 'json' };
import { handleRfq } from '../../_lib/rfq.js';

export const PRODUCT_SLUGS = new Set([...site.products.map(p => p.slug), 'other']);

export const onRequestPost = ({ request, env }) => handleRfq(request, env, { productSlugs: PRODUCT_SLUGS });

export const methodNotAllowed = () => new Response(JSON.stringify({ ok: false, error: 'method' }), {
  status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'POST', 'Cache-Control': 'no-store' },
});
export const onRequest = methodNotAllowed;

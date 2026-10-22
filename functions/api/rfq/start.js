// Cloudflare Pages Function: POST /api/rfq/start (quote with attachments: presigned upload URLs to private R2).
import { handleStart } from '../../_lib/rfq.js';
import { PRODUCT_SLUGS, methodNotAllowed } from './index.js';

export const onRequestPost = ({ request, env }) => handleStart(request, env, { productSlugs: PRODUCT_SLUGS });
export const onRequest = methodNotAllowed;

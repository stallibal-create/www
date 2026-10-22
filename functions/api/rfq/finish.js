// Cloudflare Pages Function: POST /api/rfq/finish (checks the uploaded drawings, records the request, notifies once).
import { handleFinish } from '../../_lib/rfq.js';
import { methodNotAllowed } from './index.js';

export const onRequestPost = ({ request, env }) => handleFinish(request, env);
export const onRequest = methodNotAllowed;

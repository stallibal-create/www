import { visitorLanguage } from './_lib/language.js';

export function onRequest({ request }) {
  const url = new URL(request.url);
  url.pathname = `/${visitorLanguage(request.headers.get('accept-language'))}/`;
  return new Response(null, { status: 302, headers: {
    Location: url.toString(), Vary: 'Accept-Language', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  } });
}

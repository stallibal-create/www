// AWS Signature V4 query-string signing (presigned URLs) for R2's S3 API, Web Crypto only.
// R2 stays private: a presigned URL allows one method on one key until it expires.

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async s => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s));
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
// The derived key only changes per day: derive it once per isolate (4 HMACs saved on every URL).
const keys = new Map();
async function signingKey(secret, date, region, service) {
  const id = `${date}/${region}/${service}/${await sha256Hex(secret)}`;
  if (!keys.has(id)) {
    let k = await hmac('AWS4' + secret, date);
    for (const part of [region, service, 'aws4_request']) k = await hmac(k, part);
    if (keys.size > 8) keys.clear();
    keys.set(id, await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  }
  return keys.get(id);
}
// RFC 3986 encoding, as S3 expects ('/' kept in paths)
const uriEnc = (s, keepSlash = false) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(keepSlash ? /%2F/g : /$^/, '/');

/**
 * @param {{ method: string, url: string, accessKeyId: string, secretAccessKey: string, region?: string, service?: string,
 *   expires: number, headers?: Record<string,string>, now?: Date }} o  headers: extra headers the client must send exactly (signed)
 * @returns {Promise<string>} the presigned URL
 */
export async function presign({ method, url, accessKeyId, secretAccessKey, region = 'auto', service = 's3', expires, headers = {}, now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;
  const h = { host: u.host, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])) };
  const names = Object.keys(h).sort();
  const signedHeaders = names.join(';');
  const q = new URLSearchParams(u.search);
  q.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  q.set('X-Amz-Credential', `${accessKeyId}/${scope}`);
  q.set('X-Amz-Date', amzDate);
  q.set('X-Amz-Expires', String(expires));
  q.set('X-Amz-SignedHeaders', signedHeaders);
  const query = [...q].map(([k, v]) => [uriEnc(k), uriEnc(v)]).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const path = uriEnc(decodeURIComponent(u.pathname), true);
  const canonical = [method, path, query, names.map(n => `${n}:${h[n]}\n`).join(''), signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n');
  return `${u.origin}${path}?${query}&X-Amz-Signature=${hex(await crypto.subtle.sign('HMAC', await signingKey(secretAccessKey, date, region, service), enc.encode(toSign)))}`;
}

#!/usr/bin/env node
// Static checks: JS syntax, JSON validity, i18n key parity, built-HTML sanity. Zero dependencies.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAssembly } from './assembly-validate.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let errors = 0; const fail = m => { errors++; console.error('✗ ' + m); };

// 1. JS syntax
for (const f of [...walk(join(ROOT, 'src/assets/js')), ...walk(join(ROOT, 'scripts')), join(ROOT, 'server.mjs'), ...(existsSync(join(ROOT, 'functions')) ? walk(join(ROOT, 'functions')) : []),...walk(join(ROOT, 'tests')).filter(f => /\.m?js$/.test(f) && !f.includes('/output/'))])
  if (/\.m?js$/.test(f)) try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { fail(`syntax ${f}: ${e.stderr}`); }

// 2. JSON + i18n parity
const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) ? keys(v, p + k + '.') : [p + k + (Array.isArray(v) ? `[${v.length}]` : '')]);
const dicts = {};
for (const l of ['fr', 'en', 'ar']) { try { dicts[l] = new Set(keys(JSON.parse(readFileSync(join(ROOT, `content/i18n/${l}.json`), 'utf8')))); } catch (e) { fail(`i18n ${l}: ${e.message}`); } }
for (const l of ['en', 'ar']) {
  for (const k of dicts.fr) if (!dicts[l].has(k)) fail(`i18n ${l} missing/mismatched: ${k}`);
  for (const k of dicts[l]) if (!dicts.fr.has(k)) fail(`i18n ${l} extra/mismatched: ${k}`);
}
try {
  const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
  for (const e of validateAssembly(site)) fail('site.json ductAssembly: ' + e);
} catch (e) { fail('site.json: ' + e.message); }

// 3. built HTML
const DIST = join(ROOT, 'dist');
if (!existsSync(DIST)) fail('dist/ missing — run npm run build');
else for (const f of walk(DIST).filter(f => f.endsWith('.html'))) {
  const h = readFileSync(f, 'utf8'), rel = f.slice(DIST.length);
  if (rel === '/index.html') continue;
  const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i); if (dup.length) fail(`${rel}: duplicate id ${[...new Set(dup)]}`);
  const h1 = (h.match(/<h1[\s>]/g) || []).length; if (h1 !== 1) fail(`${rel}: ${h1} <h1>`);
  if (!/<html lang="(fr|en|ar)" dir="(ltr|rtl)"/.test(h)) fail(`${rel}: missing lang/dir`);
  for (const m of h.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) fail(`${rel}: img without alt`);
  if (/\sstyle="/.test(h)) fail(`${rel}: inline style attribute (blocked by CSP)`);
  if (/<script(?![^>]*\b(src|type="(application\/ld\+json|application\/json|importmap)"))[^>]*>/.test(h)) fail(`${rel}: inline executable script`);
  for (const m of h.matchAll(/<(input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g)) if (!/type="hidden"/.test(m[0]) && !h.includes(`for="${m[2]}"`)) fail(`${rel}: control #${m[2]} has no label`);
  for (const m of h.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) if (!/rel="[^"]*noopener/.test(m[0])) fail(`${rel}: target=_blank without noopener`);
}
console.log(errors ? `\n${errors} problem(s)` : '✓ lint passed (JS syntax, JSON, i18n parity, HTML sanity)');
process.exit(errors ? 1 : 0);

#!/usr/bin/env node
// LIBALSTAL static site generator — zero dependencies (Node ≥ 20).
// Reads content/*.json, writes dist/. Usage: node scripts/build.mjs  (SITE_URL overrides the domain, default https://www.libalstal.com)
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants as ZLIB } from 'node:zlib';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { icons } from './icons.mjs';
import { industryIcon } from './industry-icons.mjs';
import { validateAssembly } from './assembly-validate.mjs';
import { assemblySvg } from './assembly-svg.mjs';
import { modelProblems } from './assembly-model.mjs';
import { storySvgs } from './story-svg.mjs';
import { socialLinks, missingNetworks, socialDock, socialItems, socialItem, contactIcon } from './social.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SITE_URL = (process.env.SITE_URL || 'https://www.libalstal.com').replace(/\/$/, '');
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const RFQ_ENDPOINT = process.env.RFQ_ENDPOINT || '/api/rfq';
// Where browsers upload drawings with presigned URLs (Cloudflare Pages + R2): the R2 S3 endpoint, allowed in connect-src.
// e.g. RFQ_UPLOAD_ORIGIN=https://<account_id>.r2.cloudflarestorage.com  (without it, uploads to R2 are blocked by the CSP)
const RFQ_UPLOAD_ORIGIN = process.env.RFQ_UPLOAD_ORIGIN ? new URL(process.env.RFQ_UPLOAD_ORIGIN).origin : '';
// Drawing uploads need private storage: R2 on Cloudflare Pages (RFQ_UPLOAD_ORIGIN) or the Node server (RFQ_ATTACHMENTS=1).
// Without it the form has no file field and asks for drawings by e-mail instead (never offer what cannot work).
const RFQ_ATTACHMENTS = !!RFQ_UPLOAD_ORIGIN || process.env.RFQ_ATTACHMENTS === '1';
const THREE_VERSION = '0.170.0';
// Self-hosting: copy three's build/ and examples/jsm/ into src/assets/vendor/three/ and the CDN is no longer used.
// Montserrat: self-hosted if src/assets/fonts/montserrat.css exists (with its .woff2 files), otherwise Google Fonts.
const FONT_LOCAL = existsSync(join(ROOT, 'src/assets/fonts/montserrat.css'));
// Arabic pages also load Cairo (Montserrat has no Arabic letters).
const GOOGLE_FONT_CSS = lang => `https://fonts.googleapis.com/css2?${lang === 'ar' ? 'family=Cairo:wght@400..700&' : ''}family=Montserrat:wght@400..700&display=swap`;
const THREE_LOCAL = existsSync(join(ROOT, 'src/assets/vendor/three/build/three.module.min.js'));
const THREE_BASE = THREE_LOCAL ? '/assets/vendor/three' : `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
const asmErrors = validateAssembly(site);
if (asmErrors.length) { console.error('✗ content/site.json → ductAssembly:\n  ' + asmErrors.join('\n  ')); process.exit(1); }
const LANGS = ['fr', 'en', 'ar'];
const DICT = Object.fromEntries(LANGS.map(l => [l, JSON.parse(readFileSync(join(ROOT, `content/i18n/${l}.json`), 'utf8'))]));
const RFQ_LIMITS = { maxFiles: 5, maxFileMB: 10 };

// ---------- helpers ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const tv = (v, lang) => (v == null ? null : typeof v === 'object' ? (v[lang] ?? v.fr ?? null) : String(v));
const missing = new Map(); // key -> label (fr) for MISSING-INFO.md
function note(path, labelFr) { if (!missing.has(path)) missing.set(path, labelFr); }
const SOCIAL = socialLinks(site.social); // the only source of social profile URLs
const FB = SOCIAL.find(n => n.key === 'facebook')?.url || null;
for (const n of missingNetworks(site.social)) note(`social.${n.key}`, `${n.name} : URL du profil LIBALSTAL (icône inactive tant qu'elle manque)`);
const fmt = (str, vars) => str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
const hash = buf => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const url = (lang, path = '') => `/${lang}/${path ? path.replace(/^\/|\/$/g, '') + '/' : ''}`;

function makeCtx(lang) {
  const D = DICT[lang];
  const ph = (label, kind = 'missing') => site.display?.hideIncomplete ? `<span class="na">${esc(D.meta.onRequest)}</span>` // public site: neutral wording
    : `<span class="ph">[${esc(label)} — ${esc(D.meta[kind])}]</span>`;
  // value or placeholder; path used for MISSING-INFO
  const val = (v, fieldKey, path, kind = 'missing') => {
    const s = tv(v, lang);
    if (s == null || s === '') { note(path, DICT.fr.fields[fieldKey] || fieldKey); return ph(D.fields[fieldKey] || fieldKey, kind); }
    return esc(s);
  };
  const c = site.company;
  const cv = k => val(c[k], k, `company.${k}`);
  const lv = k => val(site.legal[k], k, `legal.${k}`);
  const tel = n => `<a href="tel:${esc(String(n).replace(/[^\d+]/g, ''))}" dir="ltr">${esc(n)}</a>`;
  // all phone numbers as tap-to-call links (+ placeholder if none yet)
  const phones = (sep = '<br>') => { const l = [c.phone, c.phone2].filter(Boolean); return l.length ? l.map(tel).join(sep) : cv('phone'); };
  const wa = () => c.whatsapp ? `<a href="https://wa.me/${esc(String(c.whatsapp).replace(/\D/g, ''))}" rel="noopener" target="_blank" dir="ltr">${esc(c.whatsapp)}</a>` : cv('whatsapp');
  return { lang, D, ph, val, cv, lv, phones, wa, dir: D.meta.dir, arr: D.meta.arrow, colon: lang === 'fr' ? '\u00a0:' : (lang === 'ar' ? ':' : ':') };
}

// ---------- assets (hashed query strings) ----------
const assetVer = {};
function copyAssets() {
  cpSync(join(ROOT, 'src/assets'), join(DIST, 'assets'), { recursive: true });
  if (process.env.INTRO_ASSETS_DIR) cpSync(process.env.INTRO_ASSETS_DIR, join(DIST, INTRO_DIR), { recursive: true });
  const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const p of walk(join(DIST, 'assets'))) assetVer['/' + relative(DIST, p).split('\\').join('/')] = hash(readFileSync(p));
}
const A = p => `${p}?v=${assetVer[p] || 'dev'}`;

// Blender-exported assembly model: used by the 3D view only while it matches site.json (else procedural geometry).
const MODEL_PATHS = { rectangular: '/assets/models/duct-assembly-demo.glb', branches: '/assets/models/duct-assembly-branches.glb' };
const MODEL_URLS = {};
let MODEL_NOTE = 'none';
function checkModel() {
  const notes = [];
  for (const [system, path] of Object.entries(MODEL_PATHS)) {
    const f = join(ROOT, 'src', path);
    if (!existsSync(f)) continue;
    const a = system === 'rectangular' ? site.ductAssembly : site.ductSystems[system];
    const b = readFileSync(f), problems = modelProblems(a, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    if (problems.length) { console.warn(`⚠ ${path} does not match content/site.json:\n  ${problems.join('\n  ')}\n  Procedural geometry used.`); continue; }
    MODEL_URLS[system] = A(path); notes.push(`${system}: ${Math.round(b.length / 1024)} KB GLB`);
  }
  MODEL_NOTE = notes.join(', ') || 'procedural geometry';
}

// Illustrative product renders (scripts/blender-products.py): shown when no product photo has been supplied.
const RENDERS = new Set(site.products.map(p => p.slug).filter(s => ['640', '1280'].every(w => existsSync(join(ROOT, `src/assets/img/products/${s}-${w}.webp`)))));
const renderImg = (slug, { alt = '', sizes, eager = false }) => {
  const at = w => A(`/assets/img/products/${slug}-${w}.webp`);
  return `<img src="${at(640)}" srcset="${at(640)} 640w, ${at(1280)} 1280w" sizes="${sizes}" width="1280" height="960" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
};

// Typical product render per capability family (home page and Savoir-faire page).
const CAP_RENDER = { spiral: 'spiral-round-duct', rect: 'rectangular-duct', sheet: 'custom-assemblies', fittings: 'elbows' };
const ASM_RENDER = ['640', '1280'].every(w => existsSync(join(ROOT, `src/assets/img/products/assembly-${w}.webp`)));
const capRender = id => (RENDERS.has(CAP_RENDER[id]) ? CAP_RENDER[id] : null);

// ---------- import map (inline → CSP hash) ----------
const IMPORT_MAP = JSON.stringify({ imports: { three: `${THREE_BASE}/build/three.module.min.js`, 'three/addons/': `${THREE_BASE}/examples/jsm/` } });
const IMPORT_MAP_HASH = 'sha256-' + createHash('sha256').update(IMPORT_MAP).digest('base64');
// The assembly page also maps its lazily imported modules to hashed URLs: relative imports carry no ?v= and
// /assets/ is cached for a week, so without this a phone could keep stale 3D code after an update.
// three.js keeps its plain URL (immutable vendored r170, shared with the home page hero).
let ASM_IMPORT_MAP_HASH = '';
function asmImportMap() {
  const m = JSON.parse(IMPORT_MAP);
  for (const n of ['viewer', 'geometry', 'assembly', 'units', 'motion', 'glb', 'spangle', 'flow', 'flow-effects', 'fittings']) m.imports[`/assets/js/assembly/${n}.js`] = A(`/assets/js/assembly/${n}.js`);
  const s = JSON.stringify(m);
  ASM_IMPORT_MAP_HASH = 'sha256-' + createHash('sha256').update(s).digest('base64');
  return s;
}

// ---------- welcome intro (content/intro.json + approved renders in src/assets/video/intro/) ----------
// On for a language only when its wording is approved AND every video for it is present: until the renders from
// video-studio/ are reviewed and installed (npm run install-intro there), the homepage is unchanged.
const INTRO = JSON.parse(readFileSync(join(ROOT, 'content/intro.json'), 'utf8'));
const INTRO_DIR = '/assets/video/intro';
// INTRO_ASSETS_DIR: use videos from another folder (the test suite points it at generated fixtures)
const INTRO_SRC = process.env.INTRO_ASSETS_DIR || join(ROOT, 'src', INTRO_DIR);
const introFile = (format, lang, ext) => `${INTRO_DIR}/welcome-${format}-${lang}.${ext}`;
const introOn = lang => INTRO.langs.includes(lang) && !!INTRO.copy[lang]?.approved
  && Object.keys(INTRO.compositions).every(f => ['mp4', 'webm'].every(x => existsSync(join(INTRO_SRC, `welcome-${f}-${lang}.${x}`))));
function introMarkup(ctx) {
  const { lang, D } = ctx;
  const comps = Object.fromEntries(Object.entries(INTRO.compositions).map(([f, c]) => [f, { w: c.width, h: c.height, logo: c.logo, safe: c.safe }]));
  const src = Object.fromEntries(Object.keys(INTRO.compositions).map(f => [f, { mp4: A(introFile(f, lang, 'mp4')), webm: A(introFile(f, lang, 'webm')) }]));
  const data = { timing: INTRO.timing, background: INTRO.background, comps, src, logo: { src: A('/assets/img/logo-960.webp') } };
  return `<div class="intro" id="intro">
  <div class="intro-stage" aria-hidden="true"><video class="intro-video" muted playsinline preload="auto" disablepictureinpicture disableremoteplayback tabindex="-1"></video></div>
  <button type="button" class="intro-skip">${esc(D.intro.skip)}</button>
  <script type="application/json" id="intro-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
</div>
`;
}

// ---------- layout ----------
const NAV = ['products', 'capabilities', 'industries', 'projects', 'quality', 'company'];

function head(ctx, { title, description, path, noindex = false, jsonld = [], extraHead = '' }) {
  const { lang, D } = ctx;
  const canonical = SITE_URL + url(lang, path);
  const alts = LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${SITE_URL + url(l, path)}">`).join('\n')
    + `\n<link rel="alternate" hreflang="x-default" href="${SITE_URL + url('fr', path)}">`;
  const fullTitle = title ? `${title} | LIBALSTAL` : `LIBALSTAL — ${D.meta.descriptor}`;
  const desc = description || D.meta.defaultDescription;
  const ld = jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n');
  return `<!doctype html>
<html lang="${lang}" dir="${ctx.dir}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${canonical}">\n${alts}`}
<meta name="theme-color" content="#171a1d">
<meta name="color-scheme" content="dark light">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LIBALSTAL">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE_URL}/assets/img/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:locale" content="${D.meta.locale}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${A('/assets/img/icon-32.png')}" sizes="32x32" type="image/png">
<link rel="icon" href="${A('/assets/img/icon-192.png')}" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="${A('/assets/img/icon-180.png')}">
<link rel="manifest" href="/site.webmanifest">
${FONT_LOCAL ? `<link rel="stylesheet" href="${A('/assets/fonts/montserrat.css')}">` : `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${GOOGLE_FONT_CSS(lang)}">`}
<link rel="stylesheet" href="${A('/assets/css/site.css')}">
<script src="${A('/assets/js/theme.js')}"></script>
<script src="${A('/assets/js/main.js')}" defer></script>
${extraHead}
${ld}
</head>`;
}

function header(ctx, active, path) {
  const { lang, D } = ctx;
  const links = [...NAV, 'contact'].map(k => `<li${k === 'contact' ? ' class="nav-contact"' : ''}><a href="${url(lang, k)}"${active === k ? ' aria-current="page"' : ''}>${esc(D.nav[k])}</a></li>`).join('');
  const langs = LANGS.map(l => `<li><a href="${url(l, path)}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}<span class="sr"> — ${esc(DICT[l].meta.langName)}</span></a></li>`).join('');
  return `<a class="skip" href="#main">${esc(D.meta.skip)}</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="${url(lang)}"><img src="${A('/assets/img/logo-480.webp')}" width="480" height="145" alt="LIBALSTAL — ${esc(D.nav.home)}"></a>
    <nav id="site-nav" class="site-nav" aria-label="${esc(D.nav.main)}">
      <ul class="nav-links">${links}</ul>
      <ul class="lang" aria-label="${esc(D.nav.language)}">${langs}</ul>
    </nav>
    <div class="tools">
      <button type="button" class="icon-btn theme-btn" data-label-light="${esc(D.nav.themeToLight)}" data-label-dark="${esc(D.nav.themeToDark)}" aria-label="${esc(D.nav.theme)}"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg></button>
      <a class="btn btn-primary hd-cta" href="${url(lang, 'contact')}">${esc(D.nav.cta)}</a>
      <button type="button" class="icon-btn burger" aria-expanded="false" aria-controls="site-nav" data-open="${esc(D.nav.menu)}" data-close="${esc(D.nav.closeMenu)}" aria-label="${esc(D.nav.menu)}"><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path class="l1" d="M3 7h18"/><path class="l2" d="M3 12h18"/><path class="l3" d="M3 17h18"/></svg></button>
    </div>
  </div>
</header>`;
}

function footer(ctx, path) {
  const { lang, D, cv } = ctx;
  const c = site.company;
  const nav = ['products', 'capabilities', 'projects', 'contact'].map(k => `<li><a href="${url(lang, k)}">${esc(D.nav[k])}</a></li>`).join('');
  const langs = LANGS.map(l => `<li><a href="${url(l, path)}" hreflang="${l}" lang="${l}">${esc(DICT[l].meta.langName)}</a></li>`).join('');
  const email = tv(c.email, lang), phone = tv(c.phone, lang);
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <img src="${A('/assets/img/logo-480.webp')}" width="240" height="72" alt="LIBALSTAL" loading="lazy">
        <p class="tagline">${esc(D.meta.tagline)}.</p>
        <address class="foot-contact">
          <div class="foot-contact-row">${contactIcon('address')}<span>${c.mapUrl ? `<a href="${esc(c.mapUrl)}" target="_blank" rel="noopener noreferrer">${cv('address')}<span class="sr"> ${esc(D.footer.newTab)}</span></a>` : cv('address')}</span></div>
          <div class="foot-contact-row">${contactIcon('phone')}<span><span class="sr">${esc(D.fields.phone)}${ctx.colon} </span>${ctx.phones()}</span></div>
          <div class="foot-contact-row">${contactIcon('whatsapp')}<span><span class="sr">${esc(D.fields.whatsapp)}${ctx.colon} </span>${ctx.wa()}</span></div>
          <div class="foot-contact-row">${contactIcon('email')}<span>${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : cv('email')}</span></div>
        </address>
        <nav class="foot-social" aria-label="${esc(D.social.label)}">${socialItems(site.social).map(n => socialItem(n, { ...D.social, newTab: D.footer.newTab }, 'foot-social-btn')).join('')}</nav>
      </div>
      <div><h2 class="foot-h">${esc(D.footer.nav)}</h2><ul>${nav}</ul></div>
      <div><h2 class="foot-h">${esc(D.footer.legal)}</h2><ul><li><a href="${url(lang, 'quality')}">${esc(D.nav.quality)}</a></li><li><a href="${url(lang, 'privacy')}">${esc(D.footer.privacy)}</a></li><li><a href="${url(lang, 'legal')}">${esc(D.footer.legalNotice)}</a></li></ul></div>
      <div><h2 class="foot-h">${esc(D.footer.languages)}</h2><ul>${langs}</ul></div>
    </div>
    <p class="copy">© <span data-copyright-year>${new Date().getFullYear()}</span> LIBALSTAL. ${esc(D.footer.rights)}</p>
  </div>
</footer>`;
}

function crumbs(ctx, trail) { // trail: [[label, path], ...] last = current
  const { lang, D } = ctx;
  const all = [[D.nav.home, ''], ...trail];
  const html = `<nav class="crumbs" aria-label="${esc(D.nav.breadcrumb)}"><ol>${all.map(([l, p], i) =>
    i === all.length - 1 ? `<li><span aria-current="page">${esc(l)}</span></li>` : `<li><a href="${url(lang, p)}">${esc(l)}</a></li>`).join('')}</ol></nav>`;
  const ld = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: all.map(([l, p], i) => ({ '@type': 'ListItem', position: i + 1, name: l, item: SITE_URL + url(lang, p) })) };
  return { html, ld };
}

function orgLd() {
  const c = site.company;
  const o = { '@context': 'https://schema.org', '@type': 'Organization', name: 'LIBALSTAL', url: SITE_URL + '/', logo: SITE_URL + '/assets/img/icon-512.png', sameAs: SOCIAL.map(n => n.url) };
  if (c.legalName) o.legalName = tv(c.legalName, 'fr');
  if (c.email) o.email = c.email;
  if (c.phone) o.telephone = c.phone;
  const cps = [c.phone, c.phone2, c.whatsapp].filter(Boolean).map(t => ({ '@type': 'ContactPoint', telephone: t.replace(/\s/g, ''), contactType: 'sales', availableLanguage: ['fr', 'ar', 'en'],
    ...(c.hoursSpec ? { hoursAvailable: { '@type': 'OpeningHoursSpecification', ...c.hoursSpec } } : {}) }));
  if (cps.length) o.contactPoint = cps;
  if (c.founded) o.foundingDate = String(c.founded);
  if (c.address) o.address = { '@type': 'PostalAddress', streetAddress: tv(c.address, 'fr'), addressLocality: tv(c.city, 'fr') || undefined, addressCountry: tv(c.country, 'fr') || undefined };
  return o;
}

function page(ctx, opts, body) {
  const { active = null, path = '' } = opts;
  return `${head(ctx, opts)}
<body class="page-${opts.bodyClass || 'inner'}">
${opts.beforeHeader || ''}${header(ctx, active, path)}
<main id="main" tabindex="-1">
${body}
</main>
${footer(ctx, path)}
${socialDock({ links: socialItems(site.social, site.company, ctx.D.fields.email), t: { ...ctx.D.social, newTab: ctx.D.footer.newTab } })}
</body>
</html>
`;
}

function write(rel, html) { const p = join(DIST, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, html); }
const sitemap = [];
function emit(lang, path, html, { index = true } = {}) {
  write(join(lang, path, 'index.html'), html);
  if (index && lang === 'fr') sitemap.push(path);
}

// ---------- shared blocks ----------
const pageHead = (ctx, eyebrow, h1, intro, crumbHtml = '') => `<div class="wrap page-head">${crumbHtml}<p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(h1)}</h1>${intro ? `<p class="lead">${esc(intro)}</p>` : ''}</div>`;

function productCard(ctx, p, headingLevel = 3) {
  const { lang, D, arr } = ctx;
  const it = D.productItems[p.slug];
  return `<article class="card" data-cat="${p.cat}">
  <a class="card-link" href="${url(lang, 'products/' + p.slug)}">
    ${RENDERS.has(p.slug) ? `<span class="card-fig card-render">${renderImg(p.slug, { sizes: '(max-width: 600px) 92vw, (max-width: 1100px) 46vw, 320px' })}</span>` : `<span class="card-fig" aria-hidden="true">${icons[p.slug]}</span>`}
    <span class="card-cat">${esc(D.products.cats[p.cat])}</span>
    <h${headingLevel} class="card-h">${esc(it.name)}</h${headingLevel}>
    <span class="card-sum">${esc(it.summary)}</span>
    <span class="card-more">${esc(D.products.details)} <span class="arr" aria-hidden="true">${arr}</span></span>
  </a>
</article>`;
}

function rfqBand(ctx) {
  const { lang, D, arr } = ctx;
  return `<section class="band" aria-labelledby="band-h"><div class="wrap band-in">
  <div><h2 id="band-h">${esc(D.home.bandTitle)}</h2><p>${esc(D.home.bandText)}</p></div>
  <a class="btn btn-primary btn-lg" href="${url(lang, 'contact')}">${esc(D.home.bandCta)} <span class="arr" aria-hidden="true">${arr}</span></a>
</div></section>`;
}

function companyMap(ctx) {
  const src = site.company.mapEmbedUrl;
  if (!src) return '';
  const localized = src.replaceAll('!1sfr!', `!1s${ctx.lang}!`);
  return `<div class="company-map"><iframe src="${esc(localized)}" title="${esc(ctx.D.company.findUs)} — LIBALSTAL" width="600" height="360" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
}

function industriesGrid(ctx) {
  const { D } = ctx;
  if (!site.industriesConfirmed) note('industriesConfirmed', 'Confirmer la liste des secteurs réellement servis');
  return `${site.industriesConfirmed ? '' : `<p class="flag">${esc(D.industries.unconfirmed)}</p>`}
<ul class="ind-grid" role="list">${site.industries.map((k, i) => `<li><div class="ind-card-top">${industryIcon(k)}<span class="ind-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span></div><div class="ind-card-copy"><h3>${esc(D.industries.items[k])}</h3><p>${esc(D.industries.descriptions[k])}</p></div></li>`).join('')}</ul>`;
}

function referencesBlock(ctx, headingId, level = 2) {
  const { lang, D } = ctx, R = D.references;
  if (!site.references?.length) return '';
  const items = site.references.map((r, i) => {
    if (!r.logo) note(`references.${i}.logo`, `Logo officiel — ${tv(r.project, 'fr')}`);
    const logo = r.logo ? `<span class="ref-logo"><img class="ref-logo-light" src="${A('/assets/img/references/' + (r.logo.lightFile || r.logo.file))}" alt="${esc(r.logo.name)}" width="${r.logo.width}" height="${r.logo.height}" loading="lazy" decoding="async"><img class="ref-logo-dark" src="${A('/assets/img/references/' + (r.logo.darkFile || r.logo.file))}" alt="${esc(r.logo.name)}" width="${r.logo.width}" height="${r.logo.height}" loading="lazy" decoding="async"></span>` : '';
    return `<li>${logo}<span class="ref-sector">${esc(D.industries.items[r.sector] || '')}</span><span class="ref-name">${esc(tv(r.project, lang))}</span>${r.org && r.org !== tv(r.project, lang) ? `<span class="ref-org">${esc(r.org)}</span>` : ''}<span class="ref-place">${esc(tv(r.place, lang))}</span></li>`;
  }).join('');
  return `<div class="sh rv"><h${level} id="${headingId}">${esc(R.title)}</h${level}><p>${esc(R.intro)}</p></div>
<ul class="ref-grid rv" role="list">${items}</ul>
<p class="small muted ref-note">${esc(R.note)}</p>`;
}

function publishedProjects() { return site.projects.filter(p => !p.draft); }

function projectsList(ctx) {
  const { lang, D, arr } = ctx;
  const list = publishedProjects();
  if (!list.length) return site.references?.length ? `<p class="muted">${esc(D.projects.emptyRefs)}</p>` // the reference list is the content
    : `<div class="empty"><p><strong>${esc(D.projects.empty)}</strong></p><p>${esc(D.projects.emptyHint)}</p></div>`;
  return `<ul class="proj-grid" role="list">${list.map(p => `<li><a class="proj-card" href="${url(lang, 'projects/' + p.slug)}">
    ${p.images?.[0] ? `<img src="/assets/img/${esc(p.images[0].src)}" alt="${esc(tv(p.images[0].alt, lang) || '')}" loading="lazy" width="800" height="600">` : `<span class="ph-box" aria-hidden="true"></span>`}
    <span class="proj-meta">${esc(tv(p.sector, lang) || '')} ${p.year ? '· ' + esc(p.year) : ''}</span>
    <span class="proj-h">${esc(tv(p.title, lang))}</span><span class="card-more">${esc(D.projects.read)} <span class="arr" aria-hidden="true">${arr}</span></span></a></li>`).join('')}</ul>`;
}

// ---------- pages ----------
function home(ctx) {
  const { lang, D, val, arr } = ctx;
  const H = D.home, S = H.story;
  const hide = !!site.display?.hideIncomplete;
  // val() records every missing value in MISSING-INFO.md even when the block is hidden.
  const factRows = site.keyFacts.map(f => ({ f, html: val(f.value, f.id === 'founded' ? 'founded' : f.id, `keyFacts.${f.id}`) }));
  const shownFacts = hide ? factRows.filter(r => r.f.value != null) : factRows;
  const facts = shownFacts.map(({ f, html }) => `<div class="fact"><dt>${esc(D.keyFacts[f.id])}</dt><dd>${html}</dd></div>`).join('');
  const hv = site.heroVisual;
  // Welcome video in the page's language (English if that language has none): plays once, muted, and holds on the
  // logo; main.js starts it unless reduced motion or data saver is on (then the poster, the final logo frame, stays).
  const videoFiles = l => [`welcome-${l}.webm`, `welcome-${l}-720.mp4`, `welcome-${l}-poster.webp`].every(f => existsSync(join(ROOT, 'src/assets/video', f)));
  const vl = videoFiles(lang) ? lang : 'en';
  const hasVideo = videoFiles(vl);
  if (!hv.photo && !hasVideo) note('heroVisual.photo', 'Photo d\'atelier ou rendu 3D réel pour la page d\'accueil (sinon visuel 3D conceptuel)');
  const visual = hv.photo
    ? `<figure class="hero-art"><img src="/assets/img/${esc(hv.photo)}" alt="${esc(tv(hv.photoAlt, lang) || '')}" width="1200" height="1260" fetchpriority="high"></figure>`
    : hasVideo ? `<figure class="hero-art hero-video" id="hero-art">
  <video class="hero-vid" muted playsinline preload="none" width="1280" height="720" poster="${A(`/assets/video/welcome-${vl}-poster.webp`)}" aria-label="${esc(H.videoAlt)}">
    <source src="${A(`/assets/video/welcome-${vl}.webm`)}" type="video/webm">
    <source src="${A(`/assets/video/welcome-${vl}-720.mp4`)}" type="video/mp4">
  </video>
  <button type="button" class="hero-replay" hidden><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M5 5v5h5M5 10a8 8 0 1 1 1.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ${esc(H.videoReplay)}</button>
</figure>`
    : `<figure class="hero-art" id="hero-art" role="img" aria-label="${esc(H.heroAlt)}">
  <div class="hero-fallback" aria-hidden="true"><img src="${A('/assets/img/mark-640.webp')}" width="640" height="640" alt="" fetchpriority="high"></div>
  <div class="hero-canvas" aria-hidden="true"></div>
  <svg class="hero-marks" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false"><path d="M4 4h6M4 4v6M96 4h-6M96 4v6M4 96h6M4 96v-6M96 96h-6M96 96v-6"/></svg>
  <figcaption class="hero-tag" data-label3d="${esc(H.heroTag)}">${esc(H.heroTagStatic)}</figcaption>
</figure>`;
  // capabilities are families, not steps: no numbering; each shows the render of its typical product
  const caps = site.capabilities.filter(c => c.offered !== false && !(hide && c.offered === null)).map(c => {
    const r = capRender(c.id);
    return `<li${r ? ' class="has-fig"' : ''}>${r ? `<span class="cap-fig">${renderImg(r, { sizes: '(max-width: 600px) 30vw, 200px' })}</span>` : ''}<div><h3>${esc(D.capabilities.items[c.id].title)}</h3><p>${esc(D.capabilities.items[c.id].text)}</p></div><a href="${url(lang, 'capabilities')}#${c.id}" aria-label="${esc(D.capabilities.items[c.id].title)} — ${esc(H.capMore)}"><span class="arr" aria-hidden="true">${arr}</span></a></li>`;
  }).join('');
  const qItems = site.quality.slice(0, 6).filter(q => !hide || q.evidence);
  const qual = qItems.map(q => `<li><span>${esc(D.quality.items[q.id].t)}</span>${q.evidence ? `<a href="${esc(q.evidence)}">${esc(D.quality.evidenceLink)}</a>` : `<em class="badge">${esc(D.quality.evidenceMissing)}</em>`}</li>`).join('');
  const showInd = !hide || site.industriesConfirmed;
  const showProj = !hide || publishedProjects().length > 0;

  const svgs = storySvgs({ plan: S.figPlan, pattern: S.figPattern, formed: S.figFormed });
  const steps = S.steps.map((st, i) => `<li class="st-step" data-step="${i}"><span class="st-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><h3>${esc(st.t)}</h3><p>${esc(st.p)}</p>${i === 3 ? `<p><a class="btn" href="${url(lang, 'assembly')}">${esc(S.cta3d)} <span class="arr" aria-hidden="true">${arr}</span></a></p>` : ''}</li>`).join('');
  const story = `
<section class="story sec" aria-labelledby="story-h"><div class="wrap">
  <div class="sh rv"><div><p class="eyebrow">${esc(S.eyebrow)}</p><h2 id="story-h">${esc(S.title)}</h2></div><p>${esc(S.intro)}</p></div>
  <div class="st-grid">
    <figure class="st-stage" data-active="0">
      <div class="st-figs">
        <div class="st-fig" data-step="0">${svgs.plan}</div>
        <div class="st-fig" data-step="1">${svgs.pattern}</div>
        <div class="st-fig" data-step="2">${svgs.formed}</div>
        <div class="st-fig" data-step="3">${assemblySvg(site.ductAssembly, { title: S.figNetwork, id: 'st-t4', width: 900 })}</div>
      </div>
      <figcaption><span class="st-count" aria-hidden="true" data-template="${esc(S.stepOf)}">${esc(fmt(S.stepOf, { n: 1 }))}</span><span class="st-cap">${esc(S.caption)}</span></figcaption>
      <div class="st-rail" aria-hidden="true"><span></span></div>
    </figure>
    <ol class="st-steps" role="list">${steps}</ol>
  </div>
</div></section>`;

  const body = `
<section class="hero" aria-labelledby="hero-h">
  <div class="hero-grid wrap">
    <div class="hero-text">
      <p class="eyebrow">${esc(H.eyebrow)}</p>
      <h1 id="hero-h">${esc(H.h1a)} <span>${esc(H.h1b)}</span></h1>
      <p class="lead">${esc(H.lead)}</p>
      <div class="acts"><a class="btn btn-primary btn-lg" href="${url(lang, 'contact')}">${esc(H.cta1)} <span class="arr" aria-hidden="true">${arr}</span></a><a class="btn btn-lg" href="${url(lang, 'products')}">${esc(H.cta2)}</a></div>
      ${facts ? `<dl class="facts${shownFacts.length < 3 ? ' facts-inline' : ''}" aria-label="${esc(H.factsLabel)}">${facts}</dl>` : ''}
    </div>
    ${visual}
  </div>
</section>
${story}
<section class="sec" aria-labelledby="cap-h"><div class="wrap">
  <div class="sh rv"><h2 id="cap-h">${esc(H.capTitle)}</h2><p>${esc(H.capIntro)}</p></div>
  <ul class="cap-grid rv" role="list">${caps}</ul>
</div></section>

<section class="sec alt" aria-labelledby="prod-h"><div class="wrap">
  <div class="sh rv"><h2 id="prod-h">${esc(H.prodTitle)}</h2><p>${esc(H.prodIntro)}</p></div>
  <div class="grid rv">${site.products.map(p => productCard(ctx, p)).join('')}</div>
  <p class="more"><a class="btn" href="${url(lang, 'products')}">${esc(H.prodMore)} <span class="arr" aria-hidden="true">${arr}</span></a></p>
</div></section>
${ASM_RENDER ? `
<section class="sec asm-band" aria-labelledby="asm-h"><div class="wrap">
  <figure class="asm-band-fig rv">${renderImg('assembly', { alt: H.asmAlt, sizes: '(max-width: 860px) 92vw, 760px' })}<span class="asm-tag">${esc(D.assembly.demoLabel)}</span></figure>
  <div class="rv"><h2 id="asm-h">${esc(H.asmTitle)}</h2><p class="lead">${esc(H.asmText)}</p><p><a class="btn btn-primary" href="${url(lang, 'assembly')}">${esc(S.cta3d)} <span class="arr" aria-hidden="true">${arr}</span></a></p></div>
</div></section>` : ''}
${qual ? `
<section class="sec" aria-labelledby="q-h"><div class="wrap two">
  <div class="rv"><p class="eyebrow">${esc(H.qualMore)}</p><h2 id="q-h">${esc(H.qualTitle)}</h2><p class="lead">${esc(H.qualIntro)}</p><p><a class="btn" href="${url(lang, 'quality')}">${esc(H.qualMore)} <span class="arr" aria-hidden="true">${arr}</span></a></p></div>
  <ul class="qa rv" role="list">${qual}</ul>
</div></section>` : ''}${showInd ? `
<section class="sec alt" aria-labelledby="ind-h"><div class="wrap">
  <div class="sh rv"><h2 id="ind-h">${esc(H.indTitle)}</h2><p>${esc(D.industries.intro)}</p></div>
  <div class="rv">${industriesGrid(ctx)}</div>
</div></section>` : ''}${site.references?.length ? `
<section class="sec" aria-labelledby="ref-h"><div class="wrap">${referencesBlock(ctx, 'ref-h')}</div></section>` : ''}${showProj ? `
<section class="sec" aria-labelledby="pj-h"><div class="wrap">
  <div class="sh rv"><h2 id="pj-h">${esc(H.projTitle)}</h2><p>${esc(D.projects.intro)}</p></div>
  <div class="rv">${projectsList(ctx)}</div>
</div></section>` : ''}
${rfqBand(ctx)}`;
  const extraHead = `${hv.photo || hasVideo ? '' : `<script type="importmap">${IMPORT_MAP}</script>
<link rel="modulepreload" href="${A('/assets/js/hero3d.js')}">
<script type="module" src="${A('/assets/js/hero3d.js')}"></script>`}
<script defer src="${A('/assets/js/story.js')}"></script>${introOn(lang) ? `
<script src="${A('/assets/js/intro-gate.js')}"></script>
<script defer src="${A('/assets/js/intro.js')}"></script>` : ''}`;
  const beforeHeader = introOn(lang) ? introMarkup(ctx) : '';
  emit(lang, '', page(ctx, { title: '', path: '', bodyClass: 'home', jsonld: [orgLd()], extraHead, beforeHeader }, body));
}

function products(ctx) {
  const { lang, D } = ctx;
  const cr = crumbs(ctx, [[D.nav.products, 'products']]);
  const cats = ['duct', 'fit', 'acc', 'cus'];
  const body = `${pageHead(ctx, D.nav.products, D.products.h1, D.products.intro, cr.html)}
<section class="sec tight"><div class="wrap">
  <div class="filters" role="group" aria-label="${esc(D.products.filterLabel)}">
    <button type="button" class="chip" aria-pressed="true" data-filter="all">${esc(D.products.all)}</button>
    ${cats.map(c => `<button type="button" class="chip" aria-pressed="false" data-filter="${c}">${esc(D.products.cats[c])}</button>`).join('')}
  </div>
  <p class="count" role="status" data-template="${esc(D.products.count)}" data-template-one="${esc(D.products.countOne)}">${esc(fmt(site.products.length === 1 ? D.products.countOne : D.products.count, { n: site.products.length }))}</p>
  <div class="grid" id="product-grid">${site.products.map(p => productCard(ctx, p, 2)).join('')}</div>
  <p class="empty" id="product-empty" hidden>${esc(D.products.empty)}</p>
  <p class="more"><a class="btn" href="${url(lang, 'assembly')}">${esc(D.home.story.cta3d)} <span class="arr" aria-hidden="true">${D.meta.arrow}</span></a></p>
</div></section>
${rfqBand(ctx)}`;
  emit(lang, 'products', page(ctx, { title: D.products.title, description: D.products.intro, path: 'products', active: 'products', jsonld: [cr.ld] }, body));

  for (const p of site.products) {
    const it = D.productItems[p.slug];
    const path = 'products/' + p.slug;
    const c2 = crumbs(ctx, [[D.nav.products, 'products'], [it.name, path]]);
    for (const [k, v] of Object.entries(p.specs)) if (v == null) note(`products.${p.slug}.specs.${k}`, `${DICT.fr.fields[k]} — ${DICT.fr.productItems[p.slug].name}`);
    const specs = Object.entries(p.specs).map(([k, v]) => `<div><dt>${esc(D.fields[k])}</dt><dd>${ctx.val(v, k, `products.${p.slug}.specs.${k}`, 'toProvide')}</dd></div>`).join('');
    if (!p.datasheet) note(`products.${p.slug}.datasheet`, `Fiche technique PDF — ${DICT.fr.productItems[p.slug].name}`);
    if (!p.image) note(`products.${p.slug}.image`, `Photo produit — ${DICT.fr.productItems[p.slug].name}`);
    const related = site.products.filter(o => o.cat === p.cat && o.slug !== p.slug);
    const body = `<div class="wrap page-head">${c2.html}<p class="eyebrow">${esc(D.products.cats[p.cat])}</p><h1>${esc(it.name)}</h1><p class="lead">${esc(it.summary)}</p></div>
<section class="sec tight"><div class="wrap two pd">
  <figure class="drawing">
    ${p.image ? `<img src="/assets/img/${esc(p.image)}" alt="${esc(it.name)}" width="1200" height="900">`
      : RENDERS.has(p.slug) ? `<div class="drawing-render">${renderImg(p.slug, { alt: fmt(D.product.renderAlt, { name: it.name }), sizes: '(max-width: 860px) 92vw, 600px', eager: true })}</div><figcaption class="small muted">${esc(D.product.render)}</figcaption>`
      : `<div class="drawing-fig" aria-hidden="true">${icons[p.slug]}</div><figcaption>${ctx.ph(D.product.imageMissing, 'toProvide')}</figcaption>`}
    <div class="titleblock" aria-hidden="true"><span>LIBALSTAL</span><span>${esc(it.name)}</span><span>${esc(D.products.cats[p.cat])}</span></div>
  </figure>
  <div>
    <h2 class="h3">${esc(D.product.specs)}</h2>
    <dl class="spec">${specs}</dl>
    <p class="small muted">${esc(D.product.specsNote)}</p>
    ${['spiral-round-duct', 'black-steel-ducts'].includes(p.slug) ? `<p><a class="btn" href="${url(lang, 'assembly') + (p.slug === 'black-steel-ducts' ? '?heat=1' : '')}">${esc(D.assembly.title)} <span class="arr" aria-hidden="true">${ctx.arr}</span></a></p>` : ''}
    <h2 class="h3">${esc(D.product.downloads)}</h2>
    <p>${p.datasheet ? `<a class="btn" href="/assets/docs/${esc(p.datasheet)}" download>${esc(D.product.datasheet)}</a>` : site.display?.hideIncomplete ? esc(D.product.datasheetRequest) : ctx.ph(D.product.noDownloads, 'toProvide')}</p>
    <div class="cta-box"><h2 class="h3">${esc(D.product.ctaTitle)}</h2><p>${esc(D.product.ctaText)}</p><a class="btn btn-primary" href="${url(lang, 'contact')}?product=${p.slug}">${esc(D.products.quote)} <span class="arr" aria-hidden="true">${ctx.arr}</span></a></div>
  </div>
</div></section>
${related.length ? `<section class="sec alt" aria-labelledby="rel-h"><div class="wrap"><h2 id="rel-h" class="h3">${esc(D.product.related)}</h2><div class="grid">${related.map(o => productCard(ctx, o, 3)).join('')}</div></div></section>` : ''}`;
    emit(lang, path, page(ctx, { title: it.name, description: it.summary, path, active: 'products', jsonld: [c2.ld] }, body));
  }
}

function capabilities(ctx) {
  const { lang, D, val, ph } = ctx;
  const cr = crumbs(ctx, [[D.nav.capabilities, 'capabilities']]);
  const rows = site.capabilities.map(c => {
    const it = D.capabilities.items[c.id];
    let extra = '';
    if ('range' in c && c.range == null) note(`capabilities.${c.id}.range`, `Gamme — ${DICT.fr.capabilities.items[c.id].title}`);
    if ('range' in c) extra = `<p class="meta"><span>${esc(D.fields.range)}${ctx.colon}</span> ${val(c.range, 'range', `capabilities.${c.id}.range`, 'toConfirm')}</p>`;
    if ('offered' in c) { if (c.offered == null) note(`capabilities.${c.id}.offered`, 'Pose / accompagnement : service proposé oui ou non ?'); extra = c.offered == null ? `<p class="meta">${ph(D.capabilities.offeredUnknown, 'toConfirm')}</p>` : ''; }
    if (c.offered === false) return '';
    const r = capRender(c.id);
    return `<li id="${c.id}"${r ? ' class="has-fig"' : ''}>${r ? `<span class="cap-fig">${renderImg(r, { sizes: '(max-width: 600px) 92vw, 260px' })}</span>` : ''}<div><h2 class="h3">${esc(it.title)}</h2><p>${esc(it.text)}</p>${extra}</div></li>`;
  }).join('');
  if (!site.equipment.length) note('equipment', 'Parc machines (type, marque, capacités)');
  const equip = site.equipment.length
    ? `<ul class="qa" role="list">${site.equipment.map(e => `<li><span>${esc(tv(e.name, lang))}</span><span class="muted">${esc(tv(e.detail, lang) || '')}</span></li>`).join('')}</ul>`
    : `<p>${ph(D.capabilities.equipmentEmpty)}</p>`;
  const body = `${pageHead(ctx, D.nav.capabilities, D.capabilities.h1, D.capabilities.intro, cr.html)}
<section class="sec tight"><div class="wrap"><ul class="caps caps-lg" role="list">${rows}</ul></div></section>
<section class="sec alt" aria-labelledby="why-h"><div class="wrap two">
  <div><h2 id="why-h">${esc(D.capabilities.why.title)}</h2></div>
  <ul class="why-list" role="list">${D.capabilities.why.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
</div></section>
${site.equipment.length || !site.display?.hideIncomplete ? `<section class="sec alt" aria-labelledby="eq-h"><div class="wrap two">
  <div><h2 id="eq-h">${esc(D.capabilities.equipmentTitle)}</h2></div><div>${equip}</div>
</div></section>` : ''}
<section class="sec" aria-labelledby="pr-h"><div class="wrap">
  <div class="sh"><h2 id="pr-h">${esc(D.capabilities.processTitle)}</h2>${site.display?.hideIncomplete ? '' : `<p class="flag">${esc(D.capabilities.processNote)}</p>`}</div>
  <ol class="process">${D.capabilities.process.map((s, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(s.t)}</h3><p>${esc(s.d)}</p></li>`).join('')}</ol>
</div></section>
${rfqBand(ctx)}`;
  note('capabilities.process', 'Valider le déroulé type d\'une commande (page Savoir-faire)');
  emit(lang, 'capabilities', page(ctx, { title: D.capabilities.title, description: D.capabilities.intro, path: 'capabilities', active: 'capabilities', jsonld: [cr.ld] }, body));
}

function industries(ctx) {
  const { lang, D, arr } = ctx;
  const cr = crumbs(ctx, [[D.nav.industries, 'industries']]);
  const body = `${pageHead(ctx, D.nav.industries, D.industries.h1, D.industries.intro, cr.html)}
<section class="sec tight"><div class="wrap">${industriesGrid(ctx)}<p class="more"><a class="btn btn-primary" href="${url(lang, 'contact')}">${esc(D.industries.cta)} <span class="arr" aria-hidden="true">${arr}</span></a></p></div></section>`;
  emit(lang, 'industries', page(ctx, { title: D.industries.title, description: D.industries.intro, path: 'industries', active: 'industries', jsonld: [cr.ld] }, body));
}

function projects(ctx) {
  const { lang, D, val } = ctx;
  const cr = crumbs(ctx, [[D.nav.projects, 'projects']]);
  if (!publishedProjects().length) note('projects', 'Études de cas détaillées (photos, périmètre, matériaux, accord client)');
  const body = `${pageHead(ctx, D.nav.projects, D.projects.h1, D.projects.intro, cr.html)}
${site.references?.length ? `<section class="sec tight" aria-labelledby="ref-h"><div class="wrap">${referencesBlock(ctx, 'ref-h')}</div></section>` : ''}
<section class="sec tight"><div class="wrap">${projectsList(ctx)}</div></section>
${rfqBand(ctx)}`;
  emit(lang, 'projects', page(ctx, { title: D.projects.title, description: D.projects.intro, path: 'projects', active: 'projects', jsonld: [cr.ld] }, body));

  for (const p of site.projects) {
    const path = 'projects/' + p.slug;
    const title = tv(p.title, lang);
    const c2 = crumbs(ctx, [[D.nav.projects, 'projects'], [title, path]]);
    const pv = (k) => p.draft ? ctx.ph(D.fields[k]) : val(p[k], k, `projects.${p.slug}.${k}`);
    const client = p.clientPublic && p.client ? esc(tv(p.client, lang)) : (p.draft ? ctx.ph(D.fields.client) : esc(D.projects.clientPrivate));
    const facts = ['year', 'location', 'sector', 'scope', 'materials', 'quantities'].map(k => `<div><dt>${esc(D.fields[k === 'materials' ? 'material' : k])}</dt><dd>${pv(k)}</dd></div>`).join('');
    const gallery = p.images?.length
      ? `<div class="gallery">${p.images.map(im => `<img src="/assets/img/${esc(im.src)}" alt="${esc(tv(im.alt, lang) || '')}" loading="lazy" width="1200" height="900">`).join('')}</div>`
      : `<div class="gallery">${[1, 2, 3].map(() => `<div class="ph-box"><span>${ctx.ph(D.projects.photosMissing, 'toProvide')}</span></div>`).join('')}</div>`;
    const body = `${p.draft ? `<p class="draft-banner" role="note">${esc(D.projects.draftBanner)}</p>` : ''}
<div class="wrap page-head">${c2.html}<p class="eyebrow">${esc(D.nav.projects)}</p><h1>${esc(title)}</h1></div>
<section class="sec tight"><div class="wrap two">
  <div>
    <h2 class="h3">${esc(D.projects.challenge)}</h2><p>${pv('challenge')}</p>
    <h2 class="h3">${esc(D.projects.solution)}</h2><p>${pv('solution')}</p>
  </div>
  <aside class="factbox" aria-labelledby="pf-h"><h2 id="pf-h" class="h3">${esc(D.projects.facts)}</h2><dl class="spec"><div><dt>${esc(D.fields.client)}</dt><dd>${client}</dd></div>${facts}</dl></aside>
</div></section>
<section class="sec alt" aria-labelledby="g-h"><div class="wrap"><h2 id="g-h" class="h3">${esc(D.projects.gallery)}</h2>${gallery}</div></section>
${rfqBand(ctx)}`;
    emit(lang, path, page(ctx, { title, path, active: 'projects', noindex: !!p.draft, jsonld: p.draft ? [] : [c2.ld] }, body), { index: !p.draft });
  }
}

function quality(ctx) {
  const { lang, D, ph } = ctx;
  const cr = crumbs(ctx, [[D.nav.quality, 'quality']]);
  const rows = site.quality.map(q => {
    if (!q.evidence) note(`quality.${q.id}`, `Justificatif qualité — ${DICT.fr.quality.items[q.id].t}`);
    return `<li><div><h2 class="h3">${esc(D.quality.items[q.id].t)}</h2><p>${esc(D.quality.items[q.id].d)}</p></div>${q.evidence ? `<a class="btn" href="${esc(q.evidence)}">${esc(D.quality.evidenceLink)}</a>` : site.display?.hideIncomplete ? '' : `<em class="badge">${esc(D.quality.evidenceMissing)}</em>`}</li>`;
  }).join('');
  const body = `${pageHead(ctx, D.nav.quality, D.quality.h1, '', cr.html)}
<section class="sec tight"><div class="wrap two">
  <div><p class="display">${esc(D.quality.lead)}</p><p class="lead">${esc(D.quality.intro)}</p></div>
  <ul class="qa qa-lg" role="list">${rows}</ul>
</div></section>
${site.standards?.length ? `<section class="sec alt" aria-labelledby="std-h" id="normes"><div class="wrap two">
  <div><h2 id="std-h">${esc(D.standards.title)}</h2><p class="lead">${esc(D.standards.intro)}</p></div>
  <dl class="std-list">${site.standards.map(k => {
    const logos = { smacna: ['smacna-transparent.svg', 'SMACNA', 896, 487], ashrae: ['ashrae-transparent.svg', 'ASHRAE', 600, 415], dw144: ['besa.png', 'BESA', 345, 201] };
    const logo = logos[k];
    return `<div><dt>${logo ? `<span class="std-logo"><img  src="${A('/assets/img/standards/' + logo[0])}" alt="${logo[1]}" width="${logo[2]}" height="${logo[3]}" loading="lazy" decoding="async"></span>` : ''}<span>${esc(D.standards.items[k].t)}</span></dt><dd>${esc(D.standards.items[k].d)}</dd></div>`;
  }).join('')}</dl>
</div></section>` : ''}
${rfqBand(ctx)}`;
  emit(lang, 'quality', page(ctx, { title: D.quality.title, description: D.quality.intro, path: 'quality', active: 'quality', jsonld: [cr.ld] }, body));
}

function company(ctx) {
  const { lang, D, cv, ph } = ctx;
  const cr = crumbs(ctx, [[D.nav.company, 'company']]);
  const c = site.company;
  const regShown = c.registrationPublic !== false; // the owner chose not to publish the RC (2026-10-24)
  const dl = ['legalName', 'founded', ...(regShown ? ['registration'] : []), 'director', 'address', 'city', 'country', 'phone', 'whatsapp', 'email', 'hours'].map(k => `<div><dt>${esc(D.fields[k])}</dt><dd>${k === 'phone' ? ctx.phones() : k === 'whatsapp' ? ctx.wa() : cv(k)}</dd></div>`).join('');
  const body = `${pageHead(ctx, D.nav.company, D.company.h1, D.company.intro, cr.html)}
<section class="sec tight"><div class="wrap two">
  <div><h2>${esc(D.company.aboutTitle)}</h2><p class="lead">${cv('about')}</p>
    ${c.services?.length ? `<h2 class="h3">${esc(D.services.title)}</h2><p class="services">${c.services.map(k => esc(D.services[k])).join(' · ')}</p>` : ''}
    <h2 class="h3">${esc(D.company.findUs)}</h2><p>${cv('address')}</p><p>${c.mapUrl ? `<a class="btn" href="${esc(c.mapUrl)}" rel="noopener" target="_blank">${esc(D.company.map)}<span class="sr"> ${esc(D.footer.newTab)}</span></a>` : cv('mapUrl')}</p>
    ${companyMap(ctx)}
  </div>
  <aside class="factbox" aria-labelledby="lf-h"><h2 id="lf-h" class="h3">${esc(D.company.factsTitle)}</h2><dl class="spec">${dl}</dl></aside>
</div></section>
${rfqBand(ctx)}`;
  emit(lang, 'company', page(ctx, { title: D.company.title, description: D.company.intro, path: 'company', active: 'company', jsonld: [cr.ld, orgLd()] }, body));
}

function contact(ctx) {
  const { lang, D, cv, arr } = ctx;
  const R = D.rfq;
  const cr = crumbs(ctx, [[D.nav.contact, 'contact']]);
  const c = site.company;
  const req = `<span class="req" aria-hidden="true">*</span>`;
  const opts = site.products.map(p => `<option value="${p.slug}">${esc(D.productItems[p.slug].name)}</option>`).join('') + `<option value="other">${lang === 'fr' ? 'Autre / plusieurs' : lang === 'en' ? 'Other / several' : 'أخرى / عدة منتجات'}</option>`;
  const i18n = { ...R, arrow: arr, back: D.meta.back, ...RFQ_LIMITS, products: Object.fromEntries(site.products.map(p => [p.slug, D.productItems[p.slug].name])) };
  const email = tv(c.email, lang), phone = tv(c.phone, lang);
  // rendered by rfq.js (explicit mode) so a widget failure shows a recovery message instead of an uncaught error
  const ts = TURNSTILE_SITE_KEY ? `<div class="ts-slot" data-sitekey="${esc(TURNSTILE_SITE_KEY)}" data-language="${lang}"></div><p class="ts-error small" role="alert" hidden>${esc(fmt(R.captchaLoadError, { email: tv(c.email, lang) }))}</p>` : '';
  const body = `${pageHead(ctx, D.nav.contact, D.contact.h1, D.contact.intro, cr.html)}
<section class="sec tight"><div class="wrap rfq-layout">
<form id="rfq" class="rfq" action="${esc(RFQ_ENDPOINT)}" method="post" enctype="multipart/form-data" novalidate aria-label="${esc(R.formLabel)}">
  <input type="hidden" name="lang" value="${lang}">
  <ol class="steps" aria-hidden="true">${R.steps.map((s, i) => `<li${i === 0 ? ' class="on"' : ''}><span>${i + 1}</span> ${esc(s)}</li>`).join('')}</ol>
  <p class="sr step-status" aria-live="polite"></p>
  <div class="err-summary" role="alert" tabindex="-1" hidden></div>

  <fieldset class="step is-active" data-step="0">
    <legend>${esc(R.steps[0])}</legend>
    <div class="f2">
      <div class="field"><label for="f-name">${esc(R.name)} ${req}</label><input id="f-name" name="name" required maxlength="120" autocomplete="name" aria-describedby="e-name"><p class="err" id="e-name"></p></div>
      <div class="field"><label for="f-company">${esc(R.company)} ${req}</label><input id="f-company" name="company" required maxlength="160" autocomplete="organization" aria-describedby="e-company"><p class="err" id="e-company"></p></div>
    </div>
    <div class="f2">
      <div class="field"><label for="f-email">${esc(R.email)} ${req}</label><input id="f-email" name="email" type="email" required maxlength="254" autocomplete="email" dir="ltr" aria-describedby="e-email"><p class="err" id="e-email"></p></div>
      <div class="field"><label for="f-phone">${esc(R.phone)}</label><input id="f-phone" name="phone" type="tel" maxlength="40" autocomplete="tel" dir="ltr"></div>
    </div>
    <div class="field"><label for="f-country">${esc(R.country)} ${req}</label><input id="f-country" name="country" required maxlength="120" autocomplete="country-name" aria-describedby="e-country"><p class="err" id="e-country"></p></div>
    <div class="hp" aria-hidden="true"><label for="f-website">${esc(R.honeypot)}</label><input id="f-website" name="website" tabindex="-1" autocomplete="off"></div>
  </fieldset>

  <fieldset class="step" data-step="1">
    <legend>${esc(R.steps[1])}</legend>
    <div class="f2">
      <div class="field"><label for="f-category">${esc(R.category)} ${req}</label><select id="f-category" name="category" required aria-describedby="e-category"><option value="">${esc(R.choose)}</option>${opts}</select><p class="err" id="e-category"></p></div>
      <div class="field"><label for="f-timeline">${esc(R.timeline)}</label><select id="f-timeline" name="timeline">${R.timelines.map((t, i) => `<option value="${i}">${esc(t)}</option>`).join('')}</select></div>
    </div>
    <div class="f2">
      <div class="field"><label for="f-material">${esc(R.material)}</label><input id="f-material" name="material" maxlength="200"></div>
      <div class="field"><label for="f-quantity">${esc(R.quantity)}</label><input id="f-quantity" name="quantity" maxlength="60"></div>
    </div>
    <div class="field"><label for="f-req">${esc(R.requirements)}</label><textarea id="f-req" name="requirements" rows="5" maxlength="5000"></textarea></div>
    ${RFQ_ATTACHMENTS ? `<div class="field"><label for="f-files">${esc(fmt(R.files, { max: RFQ_LIMITS.maxFiles, mb: RFQ_LIMITS.maxFileMB }))}</label><input id="f-files" name="files" type="file" multiple accept=".pdf,.dwg,.dxf,application/pdf" aria-describedby="h-files e-files"><p class="hint" id="h-files">${esc(R.filesHint)}</p><p class="err" id="e-files"></p></div>` : `<p class="hint files-by-email">${esc(fmt(R.filesByEmail, { email: site.company.email }))}</p>`}
  </fieldset>

  <fieldset class="step" data-step="2">
    <legend>${esc(R.review)}</legend>
    <dl class="review" id="rfq-review"></dl>
    <div class="field check"><input id="f-consent" name="consent" type="checkbox" value="yes" required aria-describedby="e-consent"><label for="f-consent">${esc(R.consent).replace(esc(R.privacyLink), `<a href="${url(lang, 'privacy')}">${esc(R.privacyLink)}</a>`)} ${req}</label><p class="err" id="e-consent"></p></div>
    ${ts}
  </fieldset>

  <div class="result" id="rfq-result" tabindex="-1" hidden></div>
  <div class="form-nav">
    <button type="button" class="btn" data-action="back" hidden><span class="arr" aria-hidden="true">${D.meta.back}</span> ${esc(R.back)}</button>
    <button type="button" class="btn btn-primary" data-action="next">${esc(R.next)} <span class="arr" aria-hidden="true">${arr}</span></button>
    <button type="submit" class="btn btn-primary" data-action="submit">${esc(R.submit)}</button>
  </div>
  <script type="application/json" id="rfq-i18n">${JSON.stringify(i18n).replace(/</g, '\\u003c')}</script>
</form>
<aside class="factbox contact-direct" aria-labelledby="cd-h">
  <h2 id="cd-h" class="h3">${esc(D.contact.direct)}</h2>
  <dl class="spec">
    <div><dt>${esc(D.fields.phone)}</dt><dd>${ctx.phones()}</dd></div>
    <div><dt>${esc(D.fields.whatsapp)}</dt><dd>${ctx.wa()}</dd></div>
    <div><dt>${esc(D.fields.email)}</dt><dd>${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : cv('email')}</dd></div>
    <div><dt>${esc(D.fields.address)}</dt><dd>${cv('address')}</dd></div>
    <div><dt>${esc(D.fields.hours)}</dt><dd>${cv('hours')}</dd></div>
  </dl>
  ${companyMap(ctx)}
</aside>
</div></section>`;
  const extraHead = `<script type="module" src="${A('/assets/js/rfq.js')}"></script>${TURNSTILE_SITE_KEY ? '\n<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>' : ''}`;
  emit(lang, 'contact', page(ctx, { title: D.contact.title, description: D.contact.intro, path: 'contact', active: 'contact', jsonld: [cr.ld], extraHead, bodyClass: 'contact' }, body));
}

function legalPages(ctx) {
  const { lang, D, cv, lv } = ctx;
  const regShown = site.company.registrationPublic !== false;
  const vars = { legalName: cv('legalName'), address: cv('address'), phone: ctx.phones(' / '), email: cv('email'), registration: regShown ? cv('registration') : '' };
  for (const [key, path, extra] of [['privacy', 'privacy', `<p class="muted small">${esc(D.privacy.updated)}${ctx.colon} <time datetime="${BUILD_DATE}">${BUILD_DATE}</time></p>`], ['legalNotice', 'legal', '']]) {
    const P = D[key];
    const cr = crumbs(ctx, [[P.title, path]]);
    const body = `${pageHead(ctx, P.title, P.h1, '', cr.html)}
<section class="sec tight"><div class="wrap prose">${extra}${P.sections.map(s => `<h2 class="h3">${esc(s.h)}</h2><p>${fmt(esc(regShown ? s.p : s.p.replace(/\s*[^.:]*[:：]?\s*\{registration\}\./, '')), vars)}</p>`).join('')}</div></section>`;
    emit(lang, path, page(ctx, { title: P.title, path, jsonld: [cr.ld] }, body));
  }
}

// ---------- 3D assembly (development page: noindex, not in nav or sitemap until approved) ----------
const ltr = s => `<span dir="ltr">${s}</span>`; // Western digits and "×" read left to right in Arabic too
const mmS = (w, h) => ltr(`${w} × ${h} mm`);
const mmL = v => ltr(`${v} mm`);

function sectionDrawing(w, h) { // inlet section with dimension lines (decorative: the values are in the table)
  const s = Math.min(120 / w, 72 / h), rw = w * s, rh = h * s, x = (170 - rw) / 2, y = 12;
  return `<svg viewBox="0 0 210 ${Math.round(rh + 52)}" focusable="false" aria-hidden="true" direction="ltr"><rect class="ln" x="${x.toFixed(1)}" y="${y}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}"/>
<g class="dim"><path d="M${x.toFixed(1)} ${(y + rh + 16).toFixed(1)}H${(x + rw).toFixed(1)}M${x.toFixed(1)} ${(y + rh + 12).toFixed(1)}v8M${(x + rw).toFixed(1)} ${(y + rh + 12).toFixed(1)}v8M${(x + rw + 16).toFixed(1)} ${y}V${(y + rh).toFixed(1)}M${(x + rw + 12).toFixed(1)} ${y}h8M${(x + rw + 12).toFixed(1)} ${(y + rh).toFixed(1)}h8"/></g>
<text class="asm-dt" x="${(x + rw / 2).toFixed(1)}" y="${(y + rh + 34).toFixed(1)}" text-anchor="middle">${w}</text><text class="asm-dt" x="${(x + rw + 24).toFixed(1)}" y="${(y + rh / 2 + 4).toFixed(1)}">${h}</text></svg>`;
}

function assembly(ctx, system = 'rectangular') {
  const { lang, D, arr } = ctx;
  const base = D.assembly, alternative = system !== 'rectangular';
  const path = alternative ? 'assembly/' + system : 'assembly';
  const T = { ...base, ...(alternative ? { h1: base.systems[system + 'Title'], intro: base.systems[system + 'Intro'], previewAlt: base.systems[system + 'Title'] } : {}) };
  const a = alternative ? site.ductSystems[system] : site.ductAssembly, st = a.settings;
  const cr = crumbs(ctx, alternative ? [[base.title, 'assembly'], [T.h1, path]] : [[T.title, 'assembly']]);

  const pending = `<span class="ph">${esc(T.pending)}</span>`;
  const row = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  const geoRows = c => {
    const g = c.geometry, G = T.geo;
    switch (c.type) {
      case 'spiral-straight': return row(G.diameter, mmL(g.diameterMm)) + row(G.length, mmL(g.lengthMm)) + row(G.pitch, mmL(g.pitchMm));
      case 'round-straight': return row(G.diameter, mmL(g.diameterMm)) + row(G.length, mmL(g.lengthMm));
      case 'round-elbow': return row(G.diameter, mmL(g.diameterMm)) + row(G.innerRadius, mmL(g.innerRadiusMm)) + row(G.angle, ltr('90°'));
      case 'round-reducer': return row(G.inletDiameter, mmL(g.inletDiameterMm)) + row(G.outletDiameter, mmL(g.outletDiameterMm)) + row(G.length, mmL(g.lengthMm));
      case 'straight': case 'branch': return row(G.section, mmS(g.widthMm, g.heightMm)) + row(G.length, mmL(g.lengthMm));
      case 'elbow90': return row(G.section, mmS(g.widthMm, g.heightMm)) + row(G.innerRadius, mmL(g.innerRadiusMm)) + row(G.angle, ltr('90°'));
      case 'rect-round': return row(G.inlet, mmS(g.inletWidthMm, g.inletHeightMm)) + row(G.outletDiameter, mmL(g.outletDiameterMm)) + row(G.length, mmL(g.lengthMm));
      case 'reducer': return row(G.inlet, mmS(g.inletWidthMm, g.inletHeightMm)) + row(G.outlet, mmS(g.outletWidthMm, g.outletHeightMm)) + row(G.length, mmL(g.lengthMm));
      case 'tee': return row(G.section, mmS(g.widthMm, g.heightMm)) + row(G.length, mmL(g.lengthMm)) + row(G.branch, mmS(g.branchWidthMm, g.branchHeightMm)) + row(G.branchLength, mmL(g.branchLengthMm));
      case 'y': return row(G.section, mmS(g.widthMm, g.heightMm)) + row(G.trunkLength, mmL(g.trunkLengthMm)) + row(G.branch, mmS(g.branchWidthMm, g.heightMm)) + row(G.branchLength, mmL(g.branchLengthMm)) + row(G.branchAngle, ltr((2 * g.branchAngleDeg) + '°'));
      case 'flange': case 'profile-frame': return row(G.section, mmS(g.widthMm, g.heightMm)) + row(G.flangeWidth, mmL(st.flangeWidthMm)) + row(G.flangeDepth, mmL(st.flangeDepthMm));
    }
  };
  const inletOf = c => (c.geometry.diameterMm || c.geometry.inletDiameterMm) ? [c.geometry.diameterMm || c.geometry.inletDiameterMm, c.geometry.diameterMm || c.geometry.inletDiameterMm] : ['reducer', 'rect-round'].includes(c.type) ? [c.geometry.inletWidthMm, c.geometry.inletHeightMm] : [c.geometry.widthMm, c.geometry.heightMm];
  const products = new Map(site.products.map(p => [p.slug, p]));
  const cards = a.components.map(c => {
    const p = products.get(c.productSlug), pname = D.productItems[p.slug].name;
    const specs = Object.entries(p.specs).map(([k, v]) => row(D.fields[k], v == null ? pending : esc(tv(v, lang)))).join('');
    const desc = tv(c.description, lang);
    const heatProduct = products.get('black-steel-ducts');
    const heatSpecs = Object.entries(heatProduct.specs).map(([k, v]) => row(D.fields[k], v == null ? pending : esc(tv(v, lang)))).join('');
    return `<article class="asm-part" id="part-${c.id}" data-part="${c.id}" aria-labelledby="part-${c.id}-h">
  <div class="asm-part-top"><p class="eyebrow">${esc(T.types[c.type])}</p><button type="button" class="icon-btn asm-close" aria-label="${esc(T.close)}"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2"/></svg></button></div>
  <h3 class="asm-part-h" id="part-${c.id}-h" tabindex="-1">${esc(tv(c.name, lang))}</h3>
  <p><em class="badge">${esc(T.demoLabel)}</em></p>
  <h4>${esc(T.geometryTitle)}</h4>
  <div class="asm-dim">${(c.geometry.diameterMm || c.geometry.inletDiameterMm) ? `<svg viewBox="0 0 210 150" aria-hidden="true"><circle class="ln" cx="105" cy="65" r="48"/><path class="dim" d="M57 65h96"/><text class="asm-dt" x="105" y="135" text-anchor="middle">Ø ${inletOf(c)[0]} mm</text></svg>` : sectionDrawing(...inletOf(c))}</div>
  <dl class="spec">${geoRows(c)}</dl>
  <p class="small muted">${esc(T.demoNote)}</p>
  <h4>${esc(T.productTitle)}</h4>
  <div class="asm-product-standard"><dl class="spec">${specs}</dl>
  <p><a href="${url(lang, 'products/' + p.slug)}">${esc(T.productLink)}${ctx.colon} ${esc(pname)}</a></p></div>
  <div class="asm-product-heat" hidden><dl class="spec">${heatSpecs}</dl>
  <p><a href="${url(lang, 'products/black-steel-ducts')}">${esc(T.productLink)}${ctx.colon} ${esc(D.productItems['black-steel-ducts'].name)}</a></p></div>
  <p class="small muted">${esc(D.product.specsNote)}</p>
  <h4>${esc(T.description)}</h4>
  <p>${desc ? esc(desc) : pending}</p>
  <p><a class="btn btn-primary asm-part-quote" data-normal-href="${url(lang, 'contact')}?product=${p.slug}" data-heat-href="${url(lang, 'contact')}?product=black-steel-ducts" href="${url(lang, 'contact')}?product=${p.slug}">${esc(T.cta)} <span class="arr" aria-hidden="true">${arr}</span></a></p>
</article>`;
  }).join('\n');
  const list = a.components.map((c, i) => `<li><button type="button" class="asm-pick" data-part="${c.id}" aria-pressed="false" aria-controls="part-${c.id}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span><strong>${esc(tv(c.name, lang))}</strong><span class="asm-pick-sub">${esc(T.types[c.type])} · ${(c.geometry.diameterMm || c.geometry.inletDiameterMm) ? ltr('Ø ' + inletOf(c)[0] + ' mm') : mmS(...inletOf(c))}</span></span></button></li>`).join('');
  const tool = (cmd, label, path) => `<button type="button" class="icon-btn" data-cmd="${cmd}" aria-label="${esc(label)}"><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  const tools = [
    tool('skip', T.skip, 'M5 5v14l11-7zM19 5v14'),
    tool('left', T.rotateLeft, 'M9 5L4 10l5 5M4 10h10a6 6 0 0 1 0 12h-3'),
    tool('right', T.rotateRight, 'M15 5l5 5-5 5M20 10H10a6 6 0 0 0 0 12h3'),
    tool('in', T.zoomIn, 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M11 8v6M8 11h6'),
    tool('out', T.zoomOut, 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6'),
    tool('reset', T.reset, 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5'),
    tool('explode', T.explode, 'M4 4l6 6m-6 0V4h6M20 4l-6 6m6 0V4h-6M4 20l6-6m-6 0v6h6M20 20l-6-6m6 0v6h-6'),
    tool('reassemble', T.reassemble, 'M4 10l6-6m-6 0h6v6M20 10l-6-6m6 0h-6v6M4 14l6 6m-6 0h6v-6M20 14l-6 6m6 0h-6v-6'),
    tool('replay', T.replay, 'M5 5v5h5M5 10a8 8 0 1 1 1.5 6M11 8l6 4-6 4z'),
  ].join('');
  // client data: geometry and connections only (names and specs are already in the HTML)
  const clientData = { assembly: { id: a.id, settings: st, components: a.components.map(({ id, type, geometry, explode }) => ({ id, type, geometry, explode })), connections: a.connections }, model: MODEL_URLS[system] || null,
    strings: { loading: T.loading, unavailable: T.unavailable, lost: T.lost, saveData: T.saveData, playing: T.playing } };
  const effect = (name, label, path, pressed, attrs = '') => `<button type="button" class="icon-btn asm-effect asm-${name}" aria-label="${esc(label)}" title="${esc(label)}" aria-pressed="${pressed}" ${attrs}><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="22" height="22"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  const body = `${pageHead(ctx, T.eyebrow, T.h1, T.intro, cr.html)}

<section class="sec tight" id="asm" aria-label="${esc(T.title)}"><div class="wrap asm-layout">
  <figure class="asm-view" data-state="preview">
    <div class="asm-effects-controls" role="group" aria-label="${esc(T.effects.label)}">
      ${effect('air', T.effects.air, 'M3 8h12a3 3 0 1 0-3-3M3 12h17M3 16h9a3 3 0 1 1-3 3', true)}
      ${effect('heat', T.systems['high-temperature'], 'M4 18h16M7 14c-4-4 4-4 0-9M12 14c-4-4 4-4 0-9M17 14c-4-4 4-4 0-9', false)}
      ${effect('pause', T.effects.pause, 'M8 5v14M16 5v14', false, `data-play="${esc(T.effects.play)}" data-pause="${esc(T.effects.pause)}"`)}
      ${effect('cutaway', T.effects.cutaway, 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7 5l10 14', true)}
    </div>
    <p class="small muted asm-effects-note">${esc(T.effects.note)}</p>
    <p class="small asm-heat-note" hidden>${esc(T.effects.heatNote)}</p>
    <div class="asm-stage">
      <div class="asm-preview">${assemblySvg(a, { title: T.previewAlt, id: 'asm-svg-t' })}</div>
      <div class="asm-canvas" role="img" aria-label="${esc(T.viewLabel)}"></div>
      <span class="asm-tag">${esc(T.demoLabel)}</span>
    </div>
    <div class="asm-tools" role="toolbar" aria-label="${esc(T.toolbar)}">${tools}</div>
    <figcaption>
      <p class="asm-status" role="status"></p>
      <p class="small muted asm-help">${esc(T.help)}</p>
      <p class="small muted">${esc(T.demoNote)}</p>
    </figcaption>
  </figure>
  <div class="asm-side">
    <section class="asm-panel" aria-labelledby="asm-panel-h"><h2 id="asm-panel-h" class="h3">${esc(T.panelTitle)}</h2><p class="asm-empty">${esc(T.selectPrompt)}</p>
${cards}
    </section>
    <section aria-labelledby="asm-list-h"><h2 id="asm-list-h" class="h3">${esc(T.listTitle)}</h2><ol class="asm-list">${list}</ol></section>
  </div>
</div>
<script type="application/json" id="asm-data">${JSON.stringify(clientData).replace(/</g, '\\u003c')}</script>
</section>
${rfqBand(ctx)}`;
  const extraHead = `<script type="importmap">${asmImportMap()}</script>
<script type="module" src="${A('/assets/js/assembly/boot.js')}"></script>`;
  emit(lang, path, page(ctx, { title: alternative ? T.h1 : T.title, description: T.intro, path, jsonld: [cr.ld], extraHead }, body));
}

function legacyHeatPage(lang) {
  for (const system of ['spiral', 'branches', 'high-temperature']) {
    const target = url(lang, 'assembly') + (system === 'high-temperature' ? '?heat=1' : '');
    write(join(lang, `assembly/${system}/index.html`), `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${target}"><title>LIBALSTAL</title></head><body><h1><a href="${target}">${esc(DICT[lang].assembly.h1)}</a></h1></body></html>`);
  }
}

function notFound(ctx) {
  const { lang, D, arr } = ctx;
  const body = `<section class="sec nf"><div class="wrap"><p class="eyebrow">404</p><h1>${esc(D.notFound.h1)}</h1><p class="lead">${esc(D.notFound.text)}</p>
  <div class="acts"><a class="btn btn-primary" href="${url(lang)}">${esc(D.notFound.home)}</a><a class="btn" href="${url(lang, 'contact')}">${esc(D.notFound.contact)} <span class="arr" aria-hidden="true">${arr}</span></a></div></div></section>`;
  const html = page(ctx, { title: D.notFound.title, path: '', noindex: true }, body);
  write(join(lang, '404.html'), html);
  if (lang === 'fr') write('404.html', html);
}

// ---------- root, SEO files, headers ----------
function rootFiles() {
  write('index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LIBALSTAL</title><meta http-equiv="refresh" content="0; url=/en/"><link rel="canonical" href="${SITE_URL}/en/"><meta name="robots" content="noindex"></head><body><p><a href="/fr/" hreflang="fr" lang="fr">Français</a> · <a href="/en/" hreflang="en" lang="en">English</a> · <a href="/ar/" hreflang="ar" lang="ar">العربية</a></p></body></html>`);
  // RFC 9116: how to report a security problem (contact = the company's public address in site.json)
  const expires = new Date(Date.now() + 365 * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
  write('.well-known/security.txt', `Contact: mailto:${site.company.email}\nExpires: ${expires}\nPreferred-Languages: fr, en, ar\nCanonical: ${SITE_URL}/.well-known/security.txt\n`);
  write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  const urls = sitemap.map(p => `  <url>\n    <loc>${SITE_URL + url('fr', p)}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n${[...LANGS, 'x-default'].map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL + url(l === 'x-default' ? 'fr' : l, p)}"/>`).join('\n')}\n  </url>`);
  const urlsOther = LANGS.slice(1).flatMap(l => sitemap.map(p => `  <url>\n    <loc>${SITE_URL + url(l, p)}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n${[...LANGS, 'x-default'].map(x => `    <xhtml:link rel="alternate" hreflang="${x}" href="${SITE_URL + url(x === 'x-default' ? 'fr' : x, p)}"/>`).join('\n')}\n  </url>`));
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${[...urls, ...urlsOther].join('\n')}\n</urlset>\n`);
  write('site.webmanifest', JSON.stringify({ name: 'LIBALSTAL', short_name: 'LIBALSTAL', start_url: '/fr/', display: 'browser', background_color: '#171a1d', theme_color: '#171a1d', icons: [{ src: '/assets/img/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/assets/img/icon-512.png', sizes: '512x512', type: 'image/png' }] }, null, 2));

  const csp = [
    "default-src 'self'",
    `script-src 'self'${THREE_LOCAL ? '' : ' https://cdn.jsdelivr.net'}${TURNSTILE_SITE_KEY ? ' https://challenges.cloudflare.com' : ''} '${IMPORT_MAP_HASH}'${ASM_IMPORT_MAP_HASH ? ` '${ASM_IMPORT_MAP_HASH}'` : ''}`,
    `style-src 'self'${FONT_LOCAL ? '' : ' https://fonts.googleapis.com'}`,
    "img-src 'self' data: blob:",
    `font-src 'self'${FONT_LOCAL ? '' : ' https://fonts.gstatic.com'}`,
    `connect-src 'self'${RFQ_ENDPOINT.startsWith('http') ? ' ' + new URL(RFQ_ENDPOINT).origin : ''}${RFQ_UPLOAD_ORIGIN ? ' ' + RFQ_UPLOAD_ORIGIN : ''}`,
    `frame-src https://www.google.com ${TURNSTILE_SITE_KEY ? 'https://challenges.cloudflare.com' : ''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${RFQ_ENDPOINT.startsWith('http') ? ' ' + new URL(RFQ_ENDPOINT).origin : ''}`,
    "frame-ancestors 'none'",
  ].join('; ');
  const headers = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
  mkdirSync(join(ROOT, '.build'), { recursive: true });
  writeFileSync(join(ROOT, '.build/headers.json'), JSON.stringify(headers, null, 2));
  // Netlify / Cloudflare Pages formats
  write('_headers', `/*\n${Object.entries({ ...headers, 'Content-Security-Policy': csp + '; upgrade-insecure-requests', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n/assets/*\n  Cache-Control: public, max-age=604800\n`);
  const assemblyRedirects = LANGS.flatMap(l => ['spiral', 'branches', 'high-temperature'].map(k => `${url(l, 'assembly/' + k)}  ${url(l, 'assembly')}${k === 'high-temperature' ? '?heat=1' : ''}  301`)).join('\n');
  write('_redirects', assemblyRedirects + `\n/en/*  /en/404.html  404\n/ar/*  /ar/404.html  404\n/*  /404.html  404\n`);
}

function missingReport() {
  const lines = [...missing.entries()].sort(([a], [b]) => a.localeCompare(b));
  const groups = {};
  for (const [k, v] of lines) { const g = k.split('.')[0]; (groups[g] ||= []).push(`- [ ] ${v}  \n  \`${k}\``); }
  const titles = { company: 'Entreprise & contact', social: 'Réseaux sociaux (URL de profil réelles)', keyFacts: 'Chiffres clés (accueil)', heroVisual: 'Visuel d\'accueil', capabilities: 'Savoir-faire', equipment: 'Équipements', products: 'Produits', industriesConfirmed: 'Secteurs', quality: 'Qualité & justificatifs', projects: 'Réalisations', legal: 'Mentions légales & confidentialité' };
  const md = `# Informations manquantes — LIBALSTAL\n\nGénéré automatiquement par \`npm run build\` le ${BUILD_DATE}. Chaque ligne correspond à un espace réservé visible sur le site.\nRenseignez les valeurs dans \`content/site.json\` (chemin indiqué sous chaque ligne), puis relancez le build : la ligne disparaît.\n\n${Object.entries(groups).map(([g, items]) => `## ${titles[g] || g}\n\n${items.join('\n')}\n`).join('\n')}\n## Configuration (variables d'environnement)\n\n- [ ] Réception des devis : \`RFQ_WEBHOOK_URL\` **ou** \`RESEND_API_KEY\` + \`RFQ_TO_EMAIL\` + \`RFQ_FROM_EMAIL\`\n- [ ] Anti-robot (recommandé) : \`TURNSTILE_SITE_KEY\` (build) + \`TURNSTILE_SECRET_KEY\` (serveur)\n`;
  writeFileSync(join(ROOT, 'MISSING-INFO.md'), md);
  return lines.length;
}

// ---------- precompression ----------
// Every text file ≥ 1 KB gets .br (Brotli q11) and .gz (gzip 9) siblings, served by server.mjs when the browser accepts
// them. Done once at build time: q11 is far too slow to run per request. PRECOMPRESS=0 skips it (faster local builds;
// the server then sends the uncompressed files).
const COMPRESSIBLE = /\.(html|css|js|mjs|json|svg|xml|txt|webmanifest|glb)$/;
function precompress() {
  if (process.env.PRECOMPRESS === '0') return null;
  const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const t = { files: 0, raw: 0, br: 0, gz: 0 };
  for (const f of walk(DIST)) {
    if (!COMPRESSIBLE.test(f)) continue;
    const buf = readFileSync(f);
    if (buf.length < 1024) continue;
    const br = brotliCompressSync(buf, { params: { [ZLIB.BROTLI_PARAM_QUALITY]: 11, [ZLIB.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    const gz = gzipSync(buf, { level: 9 });
    if (br.length < buf.length) writeFileSync(f + '.br', br);
    if (gz.length < buf.length) writeFileSync(f + '.gz', gz);
    t.files++; t.raw += buf.length; t.br += Math.min(br.length, buf.length); t.gz += Math.min(gz.length, buf.length);
  }
  return t;
}

// ---------- run ----------
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
copyAssets();
checkModel();
for (const lang of LANGS) {
  const ctx = makeCtx(lang);
  home(ctx); products(ctx); capabilities(ctx); industries(ctx); projects(ctx); quality(ctx); company(ctx); contact(ctx); legalPages(ctx); assembly(ctx); legacyHeatPage(lang); notFound(ctx);
}
rootFiles();
const n = missingReport();
const pc = precompress();
const count = (d => { let c = 0; const w = p => readdirSync(p).forEach(f => { const q = join(p, f); statSync(q).isDirectory() ? w(q) : f.endsWith('.html') && c++; }); w(d); return c; })(DIST);
console.log(`Built ${count} HTML pages → dist/  (SITE_URL=${SITE_URL})`);
console.log(`${n} missing items listed in MISSING-INFO.md`);
console.log(`Font: Montserrat + Cairo for Arabic (${FONT_LOCAL ? 'self-hosted' : 'Google Fonts'})`);
console.log(`3D assembly model: ${MODEL_NOTE}`);
console.log(`Three.js: ${THREE_LOCAL ? 'self-hosted' : 'CDN ' + THREE_BASE}`);
console.log(`Welcome intro: ${LANGS.map(l => `${l} ${introOn(l) ? 'on' : 'off'}`).join(' · ')}${LANGS.some(introOn) ? '' : '  (no approved renders in src/assets/video/intro/ — see video-studio/README.md)'}`);
console.log(pc ? `Precompressed ${pc.files} files: ${Math.round(pc.raw / 1024)} KB → br ${Math.round(pc.br / 1024)} KB / gzip ${Math.round(pc.gz / 1024)} KB` : 'Precompression skipped (PRECOMPRESS=0)');

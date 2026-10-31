// Unit tests for the photographic homepage opening (scripts/photo-hero.mjs).
// Reads the real content files; asserts structure, copy, image variants and timing contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { photoHero, photoHeroPreload } from '../../scripts/photo-hero.mjs';
import { PHOTO_HERO_TIMING } from '../../src/assets/js/photo-hero-timing.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const readJson = rel => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

const config = readJson('content/photo-hero.json');
const legacy = readJson('content/intro.json');

const LANGS = ['fr', 'en', 'ar'];
const COPY_FIELDS = [
  'eyebrow', 'lead', 'quote', 'products', 'ctaGroupLabel',
  'pause', 'play', 'previous', 'next', 'select', 'retouched', 'loadError',
];
const SLIDE_COPY_FIELDS = ['label', 'caption', 'alt'];

// Minimal asset helper mirroring the builder: appends a cache-busting query.
const asset = path => `${path}?v=test`;

const render = lang => photoHero({ lang, D: {} }, config, asset);

// --- Config shape -----------------------------------------------------------

test('config: enabled, not legacy, three unique slide ids', () => {
  assert.equal(config.enabled, true);
  assert.equal(legacy.enabled, false);
  assert.equal(config.slides.length, 3);
  const ids = config.slides.map(s => s.id);
  assert.equal(new Set(ids).size, 3);
});

test('config: FR/EN/AR copy has two title lines and all copy fields', () => {
  for (const lang of LANGS) {
    const c = config.copy[lang];
    assert.ok(c, `copy.${lang} present`);
    assert.equal(c.titleLines.length, 2, `${lang} titleLines`);
    for (const field of COPY_FIELDS) {
      assert.equal(typeof c[field], 'string', `${lang}.${field} is a string`);
      assert.ok(c[field].length > 0, `${lang}.${field} non-empty`);
    }
  }
});

test('config: three slides translated with observational alt text', () => {
  for (const slide of config.slides) {
    for (const lang of LANGS) {
      const sc = slide.copy[lang];
      assert.ok(sc, `${slide.id}.copy.${lang} present`);
      for (const field of SLIDE_COPY_FIELDS) {
        assert.equal(typeof sc[field], 'string', `${slide.id}.${lang}.${field}`);
        assert.ok(sc[field].length > 0, `${slide.id}.${lang}.${field} non-empty`);
      }
    }
  }
});

// --- Rendered markup --------------------------------------------------------

test('render: one h1, no video, no intro overlay', () => {
  for (const lang of LANGS) {
    const html = render(lang);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${lang} single h1`);
    assert.ok(!/<video\b/i.test(html), `${lang} no video`);
    assert.ok(!/intro-overlay/i.test(html), `${lang} no intro overlay`);
  }
});

test('render: two real CTA links to contact and products', () => {
  for (const lang of LANGS) {
    const html = render(lang);
    assert.ok(html.includes(`href="/${lang}/contact/"`), `${lang} contact link`);
    assert.ok(html.includes(`href="/${lang}/products/"`), `${lang} products link`);
    assert.equal((html.match(/<a[^>]*class="[^"]*\bph-cta\b/g) || []).length, 2, `${lang} two CTA anchors`);
  }
});

test('render: only prev/next arrows, translated, no selectors/pause/counter', () => {
  for (const lang of LANGS) {
    const html = render(lang);
    const c = config.copy[lang];
    assert.ok(!/data-photo-select/.test(html), `${lang} no selectors`);
    assert.ok(!/data-photo-pause/.test(html), `${lang} no pause button`);
    assert.ok(!/ph-counter|data-photo-current/.test(html), `${lang} no counter`);
    const prev = html.match(/<button[^>]*data-photo-prev[^>]*>/g) || [];
    const next = html.match(/<button[^>]*data-photo-next[^>]*>/g) || [];
    assert.equal(prev.length, 1, `${lang} one prev`);
    assert.equal(next.length, 1, `${lang} one next`);
    assert.ok(prev[0].includes(`aria-label="${c.previous}"`), `${lang} prev aria-label`);
    assert.ok(next[0].includes(`aria-label="${c.next}"`), `${lang} next aria-label`);
  }
});

test('render: first image eager with fetchpriority=high', () => {
  for (const lang of LANGS) {
    const html = render(lang);
    const firstImg = html.match(/<img[^>]*fetchpriority="high"[^>]*>/);
    assert.ok(firstImg, `${lang} first image has fetchpriority=high`);
    assert.ok(!/data-src=/.test(firstImg[0]), `${lang} first image has real src`);
  }
});

test('render: other images only data-src until hydrated', () => {
  for (const lang of LANGS) {
    const html = render(lang);
    const lazyImgs = html.match(/<img[^>]*data-photo-img="[^"]*"[^>]*>/g) || [];
    assert.equal(lazyImgs.length, 2, `${lang} two lazy images`);
    for (const img of lazyImgs) {
      assert.ok(/data-src="/.test(img), `${lang} lazy image has data-src`);
      assert.ok(!/\ssrc="/.test(img), `${lang} lazy image has no src`);
    }
  }
});

test('render: data-label, data-caption and data-load-error attributes', () => {
  for (const lang of LANGS) {
    const html = render(lang);
    for (const slide of config.slides) {
      const sc = slide.copy[lang];
      assert.ok(html.includes(`data-label="${sc.label}"`), `${lang}/${slide.id} data-label`);
      assert.ok(html.includes(`data-caption="${sc.caption}"`), `${lang}/${slide.id} data-caption`);
    }
    assert.ok(html.includes(`data-load-error="${config.copy[lang].loadError}"`), `${lang} data-load-error`);
  }
});

test('render: hold/transition data attributes match config', () => {
  const html = render('fr');
  assert.ok(html.includes(`data-hold="${config.holdMs}"`));
  assert.ok(html.includes(`data-transition="${config.transitionMs}"`));
});

test('preload: first image only, desktop and mobile', () => {
  const html = photoHeroPreload(config, asset);
  const links = html.match(/<link\b[^>]*rel="preload"[^>]*>/g) || [];
  assert.equal(links.length, 2);
  assert.ok(links.some(l => l.includes(config.slides[0].image + '-1920.webp')));
  assert.ok(links.some(l => l.includes(config.slides[0].image + '-mobile.webp')));
});

// --- Image files: WebP dimension parser -------------------------------------

// Parse the pixel dimensions from a WebP file buffer (VP8, VP8X, VP8L).
function webpDimensions(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', 'RIFF header');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP', 'WEBP signature');
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    // 4 bytes flags/reserved, then 3-byte little-endian (width-1), 3-byte (height-1).
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width: w, height: h };
  }
  if (chunk === 'VP8 ') {
    // Lossy: frame tag at 20..22, start code 0x9d 0x01 0x2a at 23..25, then 14-bit dims.
    assert.equal(buf[23], 0x9d, 'VP8 start code 1');
    assert.equal(buf[24], 0x01, 'VP8 start code 2');
    assert.equal(buf[25], 0x2a, 'VP8 start code 3');
    const w = (buf[26] | (buf[27] << 8)) & 0x3fff;
    const h = (buf[28] | (buf[29] << 8)) & 0x3fff;
    return { width: w, height: h };
  }
  if (chunk === 'VP8L') {
    // Lossless: signature 0x2f at 20, then 14-bit width-1 and height-1 packed.
    assert.equal(buf[20], 0x2f, 'VP8L signature');
    const bits = buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24);
    const w = 1 + (bits & 0x3fff);
    const h = 1 + ((bits >>> 14) & 0x3fff);
    return { width: w, height: h };
  }
  throw new Error(`Unknown WebP chunk: ${chunk}`);
}

const VARIANTS = [
  { suffix: '-1920', width: 1920, height: 1080 },
  { suffix: '-960', width: 960, height: 540 },
  { suffix: '-mobile', width: 960, height: 1200 },
];

test('images: nine WebP files with expected dimensions', () => {
  for (const slide of config.slides) {
    for (const v of VARIANTS) {
      const rel = `src/assets/img/${slide.image}${v.suffix}.webp`;
      const buf = readFileSync(resolve(root, rel));
      const dims = webpDimensions(buf);
      assert.equal(dims.width, v.width, `${rel} width`);
      assert.equal(dims.height, v.height, `${rel} height`);
    }
  }
});

test('images: master budget 650KB, mobile budget 350KB', () => {
  const MASTER_MAX = 650 * 1024;
  const MOBILE_MAX = 350 * 1024;
  for (const slide of config.slides) {
    const master = readFileSync(resolve(root, `src/assets/img/${slide.image}-1920.webp`));
    const mobile = readFileSync(resolve(root, `src/assets/img/${slide.image}-mobile.webp`));
    assert.ok(master.length <= MASTER_MAX, `${slide.id}-1920 within 650KB (${master.length})`);
    assert.ok(mobile.length <= MOBILE_MAX, `${slide.id}-mobile within 350KB (${mobile.length})`);
  }
});

// --- Timing contract --------------------------------------------------------

test('timing: shared hold/transition match config', () => {
  assert.equal(PHOTO_HERO_TIMING.holdMs, config.holdMs);
  assert.equal(PHOTO_HERO_TIMING.transitionMs, config.transitionMs);
});

test('timing: Blender contract v1 end frames', () => {
  const contract = readJson('brand/blender/photo-hero-motion-v1.json');
  assert.equal(contract.version, 1);
  assert.equal(contract.motion.line1.endFrame, 31);
  assert.equal(contract.motion.line2.endFrame, 34);
});

test('each photo has a distinct localized headline and its own lead', () => {
  for (const lang of LANGS) {
    const headlines = config.slides.map(slide => {
      const copy = slide.copy[lang];
      assert.equal(copy.titleLines.length, 2);
      assert.ok(copy.titleLines.every(line => typeof line === 'string' && line.trim()));
      assert.ok(copy.lead.trim());
      return copy.titleLines.join(' ');
    });
    assert.equal(new Set(headlines).size, 3, `${lang}: three distinct messages`);
  }
});

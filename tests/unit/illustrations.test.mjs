import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const EXPECTED_COUNT = 14;
const LANGS = ['fr', 'en', 'ar'];

// --- WebP dimension parser (VP8, VP8L, VP8X) ---
function parseWebpDimensions(buf) {
  assert.ok(buf.length >= 30, 'WebP too small');
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', 'missing RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP', 'missing WEBP');
  const chunk = buf.toString('ascii', 12, 16);

  if (chunk === 'VP8 ') {
    // Lossy: frame header at offset 20, then 3-byte start code 0x9d 0x01 0x2a
    assert.equal(buf[23], 0x9d, 'VP8 start code');
    assert.equal(buf[24], 0x01, 'VP8 start code');
    assert.equal(buf[25], 0x2a, 'VP8 start code');
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { width: w, height: h };
  }
  if (chunk === 'VP8L') {
    // Lossless: signature 0x2f at offset 20, then 14-bit width-1, 14-bit height-1
    assert.equal(buf[20], 0x2f, 'VP8L signature');
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
    const w = 1 + (((b1 & 0x3f) << 8) | b0);
    const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width: w, height: h };
  }
  if (chunk === 'VP8X') {
    // Extended: canvas width-1 (24-bit LE) at 24, height-1 at 27
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width: w, height: h };
  }
  throw new Error(`Unknown WebP chunk: ${chunk}`);
}

function webpInfo(rel) {
  const abs = join(ROOT, rel);
  assert.ok(existsSync(abs), `missing file: ${rel}`);
  const buf = readFileSync(abs);
  const dims = parseWebpDimensions(buf);
  return { ...dims, bytes: statSync(abs).size };
}

function sha256(rel) {
  const abs = join(ROOT, rel);
  assert.ok(existsSync(abs), `missing file for sha256: ${rel}`);
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

// --- Load data ---
const site = readJson('content/site.json');
const i18n = Object.fromEntries(LANGS.map((l) => [l, readJson(`content/i18n/${l}.json`)]));

// Products live directly under site.products
const allProducts = Array.isArray(site.products) ? site.products : [];
const illustrative = allProducts.filter(
  (p) => typeof p.image === 'string' && p.image.startsWith('illustrative/')
);

// --- Tests ---
test('exactly 14 illustrative products', () => {
  assert.equal(illustrative.length, EXPECTED_COUNT, `found ${illustrative.length}`);
});

test('each illustrative product has master + 640 + 1280 WebP with expected dimensions and byte budget', () => {
  for (const p of illustrative) {
    const slug = p.slug;
    assert.equal(p.image, `illustrative/${slug}.webp`, `image path for ${slug}`);

    const master = webpInfo(`src/assets/img/illustrative/${slug}.webp`);
    assert.deepEqual(
      { width: master.width, height: master.height },
      { width: 1536, height: 1024 },
      `master dims for ${slug}`
    );
    assert.ok(master.bytes < 500 * 1024, `master ${slug} too big: ${master.bytes}`);

    const v640 = webpInfo(`src/assets/img/illustrative/${slug}-640.webp`);
    assert.deepEqual(
      { width: v640.width, height: v640.height },
      { width: 640, height: 427 },
      `640 dims for ${slug}`
    );
    assert.ok(v640.bytes < 180 * 1024, `640 ${slug} too big: ${v640.bytes}`);

    const v1280 = webpInfo(`src/assets/img/illustrative/${slug}-1280.webp`);
    assert.deepEqual(
      { width: v1280.width, height: v1280.height },
      { width: 1280, height: 853 },
      `1280 dims for ${slug}`
    );
    assert.ok(v1280.bytes < 350 * 1024, `1280 ${slug} too big: ${v1280.bytes}`);
  }
});

test('shared caption fields present and nonempty in fr/en/ar for every illustrative product', () => {
  for (const p of illustrative) {
    const slug = p.slug;
    for (const lang of LANGS) {
      const data = i18n[lang];
      const product = data?.product;
      assert.ok(product, `i18n/${lang}.json missing product dict`);

      for (const field of ['illustrativeImage', 'illustrativeAlt', 'illustrativeLabel']) {
        const val = product[field];
        assert.equal(typeof val, 'string', `${lang}.product.${field} must be string`);
        assert.ok(val.trim().length > 0, `${lang}.product.${field} must be nonempty`);
      }

      assert.ok(
        product.illustrativeAlt.includes('{name}'),
        `${lang}.product.illustrativeAlt must include {name}`
      );

      const name = data?.productItems?.[slug]?.name;
      assert.equal(typeof name, 'string', `${lang}.productItems.${slug}.name must be string`);
      assert.ok(name.trim().length > 0, `${lang}.productItems.${slug}.name must be nonempty`);
    }
  }
});

test('FR caption mentions non contractuelle; EN caption mentions illustrative', () => {
  for (const p of illustrative) {
    const slug = p.slug;
    const fr = i18n.fr.product;
    const en = i18n.en.product;

    const frText = `${fr.illustrativeImage} ${fr.illustrativeAlt} ${fr.illustrativeLabel}`;
    assert.ok(
      /non[\s-]?contractuelle/i.test(frText),
      `FR caption must mention "non contractuelle" (slug ${slug})`
    );

    const enText = `${en.illustrativeImage} ${en.illustrativeAlt} ${en.illustrativeLabel}`;
    assert.ok(/illustrative/i.test(enText), `EN caption must mention "illustrative" (slug ${slug})`);
  }
});

test('SOURCES.json provenance: source PNG exists and sha256 matches master', () => {
  const sources = readJson('brand/product-illustrations/SOURCES.json');
  assert.ok(Array.isArray(sources.assets), 'assets must be an array');
  assert.equal(sources.assets.length, EXPECTED_COUNT, `expected ${EXPECTED_COUNT} assets`);

  const bySlug = new Map();
  for (const a of sources.assets) {
    assert.equal(typeof a.slug, 'string', 'asset.slug must be string');
    bySlug.set(a.slug, a);
  }

  for (const p of illustrative) {
    const slug = p.slug;
    const a = bySlug.get(slug);
    assert.ok(a, `SOURCES.json missing slug ${slug}`);
    assert.equal(a.generator, 'OpenAI image generation', `generator for ${slug}`);
    assert.equal(
      a.sourceReference,
      `brand/catalogue-products/${slug}.png`,
      `sourceReference for ${slug}`
    );
    assert.equal(typeof a.prompt, 'string', `prompt for ${slug} must be string`);
    assert.ok(a.prompt.trim().length > 0, `prompt for ${slug} must be nonempty`);

    // Original source PNG must remain in the repo
    const sourceAbs = join(ROOT, a.sourceReference);
    assert.ok(existsSync(sourceAbs), `source PNG missing: ${a.sourceReference}`);

    // Master WebP sha256 must match the recorded field
    assert.equal(typeof a.sha256, 'string', `sha256 for ${slug} must be string`);
    assert.match(a.sha256, /^[0-9a-f]{64}$/, `sha256 for ${slug} must be 64 hex chars`);
    const actual = sha256(`src/assets/img/illustrative/${slug}.webp`);
    assert.equal(actual, a.sha256, `sha256 mismatch for ${slug}`);
  }
});

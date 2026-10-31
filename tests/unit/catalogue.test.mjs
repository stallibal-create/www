import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const siteUrl = new URL('../../content/site.json', import.meta.url);
const site = JSON.parse(readFileSync(siteUrl, 'utf8'));

const i18nLangs = ['fr', 'en', 'ar'];
const i18n = {};
for (const lang of i18nLangs) {
  const url = new URL(`../../content/i18n/${lang}.json`, import.meta.url);
  i18n[lang] = JSON.parse(readFileSync(url, 'utf8'));
}

const requiredSlugs = [
  'acoustic-silencers',
  'flexible-connectors',
  'plenums',
  'access-panels',
  'sand-traps',
  'rectangular-roof-cowls',
  'round-roof-cowls',
  'external-louvres',
  'damper-accessories',
  'smooth-round-duct',
  'stainless-hoods',
  'stainless-tables',
  'stainless-trolleys',
  'stainless-charcoal-grills',
  'smoke-extraction-ducts',
];

const validCats = new Set(['duct', 'fit', 'acc', 'cus', 'inox']);

const products = site.products;
const bySlug = new Map();
for (const p of products) {
  if (!bySlug.has(p.slug)) bySlug.set(p.slug, []);
  bySlug.get(p.slug).push(p);
}

const forbiddenPatterns = [/400\s*°?\s*C/i, /\b4\s*h\b/i, /fire[- ]certified/i, /EN\s*1366/i];

test('each requested product exists exactly once and has a valid cat', () => {
  for (const slug of requiredSlugs) {
    const matches = bySlug.get(slug) || [];
    assert.equal(matches.length, 1, `expected exactly one product for slug "${slug}", found ${matches.length}`);
    const product = matches[0];
    assert.ok(validCats.has(product.cat), `product "${slug}" has invalid cat "${product.cat}"`);
  }
});

test('all i18n dictionaries provide non-empty name and summary for every product, plus catalogueImage', () => {
  for (const lang of i18nLangs) {
    const dict = i18n[lang];
    assert.ok(dict.productItems, `${lang}.json missing productItems`);
    for (const slug of requiredSlugs) {
      const item = dict.productItems[slug];
      assert.ok(item, `${lang}.json productItems missing "${slug}"`);
      assert.equal(typeof item.name, 'string', `${lang}.json "${slug}".name not a string`);
      assert.ok(item.name.trim().length > 0, `${lang}.json "${slug}".name is empty`);
      assert.equal(typeof item.summary, 'string', `${lang}.json "${slug}".summary not a string`);
      assert.ok(item.summary.trim().length > 0, `${lang}.json "${slug}".summary is empty`);
      assert.equal(typeof dict.product.catalogueImage, 'string', `${lang}.json "${slug}".catalogueImage not a string`);
      assert.ok(dict.product.catalogueImage.trim().length > 0, `${lang}.json "${slug}".catalogueImage is empty`);
    }
  }
});

test('product images exist on disk (smoke image null but illustrative renders present)', () => {
  for (const slug of requiredSlugs) {
    const product = bySlug.get(slug)[0];
    if (slug === 'smoke-extraction-ducts') {
      assert.equal(product.image, null, 'smoke-extraction-ducts image should be null');
      for (const size of ['640', '1280']) {
        const url = new URL(`../../src/assets/img/products/smoke-extraction-ducts-${size}.webp`, import.meta.url);
        assert.ok(existsSync(url), `missing illustrative render smoke-extraction-ducts-${size}.webp`);
      }
    } else {
      assert.equal(typeof product.image, 'string', `product "${slug}" image should be a string`);
      const url = new URL(`../../src/assets/img/${product.image}`, import.meta.url);
      assert.ok(existsSync(url), `product "${slug}" image not found: ${product.image}`);
    }
  }
});

test('new product specs.dimensions and standard are null; no unsupported thermal/fire claims', () => {
  for (const slug of requiredSlugs) {
    const product = bySlug.get(slug)[0];
    assert.ok(product.specs, `product "${slug}" missing specs`);
    assert.equal(product.specs.dimensions, null, `product "${slug}" specs.dimensions should be null`);
    assert.equal(product.specs.standard, null, `product "${slug}" specs.standard should be null`);
  }
  for (const lang of i18nLangs) {
    const dict = i18n[lang];
    for (const slug of requiredSlugs) {
      const item = dict.productItems[slug];
      for (const field of ['name', 'summary']) {
        const value = item[field];
        for (const pattern of forbiddenPatterns) {
          assert.ok(
            !pattern.test(value),
            `${lang}.json "${slug}".${field} contains unsupported claim matching ${pattern}: "${value}"`
          );
        }
      }
    }
  }
});

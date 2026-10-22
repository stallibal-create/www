// Unit tests: floating social dock markup (scripts/social.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NETWORKS, socialLinks, missingNetworks, socialDock } from '../../scripts/social.mjs';

const T = { label: 'LIBALSTAL sur les réseaux sociaux', open: 'Afficher', close: 'Masquer', newTab: '(nouvel onglet)' };
const ALL = { facebook: 'https://www.facebook.com/example', instagram: 'https://www.instagram.com/example/', tiktok: 'https://www.tiktok.com/@example' };

test('only real https profile URLs are used, in a fixed order; the rest is reported missing', () => {
  assert.deepEqual(socialLinks({ tiktok: ALL.tiktok, facebook: ALL.facebook }).map(n => n.key), ['facebook', 'tiktok']);
  for (const bad of [null, '', '   ', 'http://www.instagram.com/x', 'instagram.com/x', 'https://x" onmouseover="a', 'À compléter'])
    assert.equal(socialLinks({ instagram: bad }).length, 0, String(bad));
  assert.deepEqual(missingNetworks({ facebook: ALL.facebook }).map(n => n.key), ['instagram', 'tiktok']);
  assert.equal(socialLinks(undefined).length, 0);
});

test('site.json is the single source: Facebook set, Instagram and TikTok left empty (never guessed)', () => {
  const social = JSON.parse(readFileSync(new URL('../../content/site.json', import.meta.url), 'utf8')).social;
  assert.equal(social.facebook, 'https://www.facebook.com/Libalstal/');
  assert.equal(social.instagram, null); assert.equal(social.tiktok, null);
  const build = readFileSync(new URL('../../scripts/build.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(build, /c\.facebook|facebook\.com/, 'no profile URL hard-coded in the generator');
});

test('no configured profile → no dock at all', () => {
  assert.equal(socialDock({ links: [], t: T }), '');
});

test('one link: a single disc, no toggle; safe external link, decorative icon, visible name', () => {
  const h = socialDock({ links: socialLinks({ facebook: ALL.facebook }), t: T });
  assert.match(h, /^<nav class="social-dock" aria-label="LIBALSTAL sur les réseaux sociaux">/);
  assert.doesNotMatch(h, /sd-toggle|is-multi/);
  assert.match(h, /<a class="sd-btn sd-facebook" href="https:\/\/www\.facebook\.com\/example" target="_blank" rel="noopener noreferrer">/);
  assert.match(h, /<svg class="sd-ico" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20">/);
  assert.match(h, /<span class="sd-tip">Facebook<span class="sr"> \(nouvel onglet\)<\/span><\/span>/);
  assert.doesNotMatch(h, /style=/, 'no inline style (CSP: style-src without unsafe-inline)');
});

test('several links: Lucide toggle with state, controls the list; every brand mark present', () => {
  const h = socialDock({ links: socialLinks(ALL), t: T });
  assert.match(h, /class="social-dock is-multi"/);
  assert.match(h, /<button type="button" class="sd-btn sd-toggle" aria-expanded="false" aria-controls="sd-list" data-open="Afficher" data-close="Masquer" aria-label="Afficher">/);
  assert.match(h, /<ul class="sd-list" id="sd-list">/);
  assert.equal((h.match(/class="sd-btn sd-(facebook|instagram|tiktok)"/g) || []).length, 3);
  assert.match(h, /<circle cx="18" cy="5" r="3"\/>/, 'Lucide share-2 geometry');
  assert.match(h, /<path d="M18 6 6 18"\/>/, 'Lucide x geometry');
  assert.match(h, /stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/);
  for (const n of NETWORKS) assert.ok(h.includes(n.d.slice(0, 40)), n.name);
});

test('labels and URLs are escaped', () => {
  const h = socialDock({ links: [{ ...NETWORKS[0], url: 'https://www.facebook.com/a&b' }], t: { ...T, label: 'A "B" <C>' } });
  assert.match(h, /aria-label="A &quot;B&quot; &lt;C&gt;"/); assert.match(h, /href="https:\/\/www\.facebook\.com\/a&amp;b"/);
});

test('brand marks are single-path 24×24 glyphs (Simple Icons), small enough to inline', () => {
  assert.deepEqual(NETWORKS.map(n => n.key), ['facebook', 'instagram', 'tiktok']);
  for (const n of NETWORKS) { assert.match(n.d, /^M[\d.]/); assert.ok(n.d.length < 4000, n.name); }
});

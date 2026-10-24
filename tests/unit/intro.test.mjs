// content/intro.json is shared by the Remotion composition (video-studio/) and the live handoff (intro.js):
// these checks keep the two from drifting apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const intro = JSON.parse(readFileSync(join(ROOT, 'content/intro.json'), 'utf8'));
const css = readFileSync(join(ROOT, 'src/assets/css/site.css'), 'utf8');

test('exactly six seconds: 180 frames at 30 fps, scenes contiguous, handoff inside scene 04', () => {
  assert.equal(intro.fps, 30);
  assert.equal(intro.durationInFrames, 180);
  const T = intro.timing;
  assert.deepEqual([T.scene1[0], T.scene1[1], T.scene2[1], T.scene3[1], T.scene4[1]], [0, 1.5, 3.0, 4.75, 6.0]);
  assert.equal(T.scene2[0], T.scene1[1]); assert.equal(T.scene3[0], T.scene2[1]); assert.equal(T.scene4[0], T.scene3[1]);
  assert.equal(T.handoff, T.scene4[0]);
  for (const k of ['videoFade', 'overlayFade', 'logoFlight', 'heroIn']) {
    assert.ok(T[k][0] >= T.handoff - 1e-9 && T[k][1] <= 6 + 1e-9 && T[k][0] < T[k][1], k);
  }
});

test('logo placement keeps the official proportions and stays inside the safe area', () => {
  const { width, height, content, topDuct } = intro.logo;
  for (const [name, c] of Object.entries(intro.compositions)) {
    const [x, y, w, h] = c.logo;
    assert.ok(Math.abs(w / h - width / height) < 0.005, `${name}: logo aspect`);
    const k = w / width;
    const [sx, sy, sw, sh] = c.safe;
    const box = [x + content[0] * k, y + content[1] * k, x + content[2] * k, y + content[3] * k];
    assert.ok(box[0] >= sx && box[1] >= sy && box[2] <= sx + sw, `${name}: logo artwork inside safe`);
    assert.ok(c.taglineY + c.taglineSize <= sy + sh, `${name}: tagline inside safe`);
    assert.ok(c.textMaxWidth <= sw, `${name}: text width inside safe`);
    assert.ok(sx >= 0 && sy >= 0 && sx + sw <= c.width && sy + sh <= c.height, `${name}: safe inside frame`);
    assert.ok(topDuct.flange[0] < topDuct.body[0] && topDuct.body[2] < topDuct.flange[2], 'top duct: flanges outside the body');
  }
});

test('the ground ends on the homepage hero colour', () => {
  const bg = css.match(/--bg:\s*(#[0-9a-f]{6})/i)[1].toLowerCase();
  const last = intro.background[intro.background.length - 1];
  assert.equal(last[1].toLowerCase(), bg);
  assert.ok(last[0] <= 6);
  for (let i = 1; i < intro.background.length; i++) assert.ok(intro.background[i][0] > intro.background[i - 1][0], 'keys in time order');
});

test('wording: every rendered language is approved; skip label in FR/EN/AR', () => {
  for (const l of intro.langs) assert.equal(intro.copy[l]?.approved, true, l);
  for (const l of ['fr', 'en', 'ar']) {
    const d = JSON.parse(readFileSync(join(ROOT, `content/i18n/${l}.json`), 'utf8'));
    assert.ok(d.intro?.skip, `${l}: intro.skip`);
  }
});

// Unit tests: the first-frame check that separates "WebGL context created" from "something was drawn".
// viewer.js imports three.js only inside createViewer(), so its pure helpers load in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintedFraction, MIN_PAINTED } from '../../src/assets/js/assembly/viewer.js';

const buffer = (n, drawn) => { const b = new Uint8Array(n * 4); for (let i = 0; i < drawn; i++) b[i * 4 + 3] = 255; return b; };

test('a cleared (transparent) frame counts as not rendered', () => {
  assert.equal(paintedFraction(new Uint8Array(400 * 4)), 0);
  assert.ok(paintedFraction(new Uint8Array(400 * 4)) < MIN_PAINTED);
});
test('a frame with drawn geometry passes the threshold', () => {
  const f = paintedFraction(buffer(3000, 900), 1);
  assert.equal(f, 0.3);
  assert.ok(f >= MIN_PAINTED);
});
test('near-invisible alpha (≤ 8) is not counted as drawn', () => {
  const b = new Uint8Array(100 * 4); for (let i = 0; i < 100; i++) b[i * 4 + 3] = 8;
  assert.equal(paintedFraction(b, 1), 0);
});
test('empty buffer is not a success', () => { assert.equal(paintedFraction(new Uint8Array(0)), 0); });

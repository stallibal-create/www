// Unit tests: construction details (geometry.js `details`) and the zinc spangle texture (spangle.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPart, MATERIALS, DETAIL } from '../../src/assets/js/assembly/geometry.js';
import { spangle } from '../../src/assets/js/assembly/spangle.js';
import { vCross, vSub, vDot, vLen } from '../../src/assets/js/assembly/units.js';

const asm = JSON.parse(readFileSync(new URL('../../content/site.json', import.meta.url), 'utf8')).ductAssembly;
const pt = (m, i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];

for (const c of asm.components) {
  test(`${c.id}: detailed mesh is sound (no NaN, unit normals, no degenerate or back-lit triangles, uvs per vertex)`, () => {
    const m = buildPart(c, asm.settings, { details: true });
    assert.equal(m.uvs.length, (m.positions.length / 3) * 2);
    for (const v of [...m.positions, ...m.normals, ...m.uvs]) assert.ok(Number.isFinite(v));
    for (let i = 0; i < m.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]) - 1) < 1e-5);
    let bad = 0, degenerate = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b, d] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]];
      const fn = vCross(vSub(pt(m, b), pt(m, a)), vSub(pt(m, d), pt(m, a)));
      if (vLen(fn) < 1e-6) { degenerate++; continue; }
      if (vDot(fn, [0, 1, 2].map(k => m.normals[a * 3 + k] + m.normals[b * 3 + k] + m.normals[d * 3 + k])) <= 0) bad++;
    }
    assert.equal(degenerate, 0); assert.equal(bad, 0);
    assert.deepEqual(m.groups.map(g => g.material), MATERIALS.filter(k => m.groups.some(g => g.material === k)), 'groups in MATERIALS order');
    if (!c.geometry.diameterMm && !c.geometry.inletDiameterMm) assert.ok(m.groups.some(g => g.material === 'hardware') && m.groups.some(g => g.material === 'gasket'));
  });

  test(`${c.id}: details leave the body, its connectors and the SVG preview untouched`, () => {
    const body = buildPart(c, asm.settings, { keepQuads: true }), det = buildPart(c, asm.settings, { details: true, keepQuads: true });
    assert.deepEqual(det.connectors, body.connectors);
    assert.equal(det.quads.length, body.quads.length, 'detail faces stay out of the SVG preview');
    // only the gasket stands proud of a connection plane, by its thickness; a companion flange's free face (its
    // outlet) carries the corner pieces and nuts
    for (const [name, k] of Object.entries(det.connectors)) {
      let beyond = 0;
      for (let i = 0; i < det.positions.length / 3; i++) beyond = Math.max(beyond, vDot(vSub(pt(det, i), k.o), k.n));
      const allowed = c.type === 'flange' && name === 'outlet' ? DETAIL.cornerPlateMm + DETAIL.nutHeightMm : DETAIL.gasketMm;
      assert.ok(beyond <= allowed + 1e-3, `${c.id}.${name}: ${beyond} mm beyond the connection plane`);
    }
  });
}

test('the detailed assembly stays light enough for phones', () => {
  const tris = asm.components.reduce((s, c) => s + buildPart(c, asm.settings, { segments: 16, details: true }).indices.length / 3, 0);
  assert.ok(tris < 22000, `${tris} triangles`);
});

test('zinc spangle: deterministic, tileable sizes, values in the subtle band the materials expect', () => {
  const a = spangle(64, 6), b = spangle(64, 6);
  assert.deepEqual(a.color, b.color); assert.deepEqual(a.rough, b.rough);
  assert.equal(a.color.length, 64 * 64 * 4);
  let lo = 255, hi = 0, rlo = 255, rhi = 0;
  for (let i = 0; i < a.color.length; i += 4) { lo = Math.min(lo, a.color[i]); hi = Math.max(hi, a.color[i]); rlo = Math.min(rlo, a.rough[i]); rhi = Math.max(rhi, a.rough[i]); }
  assert.ok(lo >= 0.75 * 255 && hi <= 0.96 * 255, `brightness ${lo}–${hi}`);
  assert.ok(rlo >= 0.29 * 255 && rhi <= 0.46 * 255, `roughness ${rlo}–${rhi}`);
});

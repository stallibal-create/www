// Unit tests: parametric part geometry. Run: node --test tests/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPart, connectorsFor, validatePart, GeometryError, PART_TYPES } from '../../src/assets/js/assembly/geometry.js';
import { vSub, vCross, vDot, vLen } from '../../src/assets/js/assembly/units.js';

const S = { sheetMm: 3, flangeWidthMm: 30, flangeDepthMm: 30 };
const T = 3, F = 30, D = 30, OUT = T + F; // sheet and flange stand outside the internal section
const TOL = 1e-3; // mm, float32 storage
const P = {
  'spiral-straight': { diameterMm: 400, lengthMm: 1000, pitchMm: 140 },
  'round-straight': { diameterMm: 400, lengthMm: 700 },
  'round-elbow': { diameterMm: 400, innerRadiusMm: 200 },
  'round-reducer': { inletDiameterMm: 400, outletDiameterMm: 300, lengthMm: 400 },
  'rect-round': { inletWidthMm: 300, inletHeightMm: 300, outletDiameterMm: 250, lengthMm: 450 },
  straight: { widthMm: 400, heightMm: 300, lengthMm: 1000 },
  branch: { widthMm: 250, heightMm: 200, lengthMm: 600 },
  elbow90: { widthMm: 400, heightMm: 300, innerRadiusMm: 150, bendPlane: 'horizontal' },
  elbowV: { widthMm: 400, heightMm: 300, innerRadiusMm: 150, bendPlane: 'vertical' },
  reducer: { inletWidthMm: 400, inletHeightMm: 300, outletWidthMm: 300, outletHeightMm: 200, lengthMm: 400 },
  tee: { widthMm: 400, heightMm: 300, lengthMm: 700, branchWidthMm: 250, branchHeightMm: 200, branchPositionMm: 350, branchLengthMm: 150 },
  flange: { widthMm: 300, heightMm: 200 },
  'profile-frame': { widthMm: 300, heightMm: 200 },
  y: { widthMm: 400, heightMm: 300, trunkLengthMm: 600, branchWidthMm: 250, branchLengthMm: 550, branchAngleDeg: 45 },
};
const part = (type, geometry) => ({ id: 'p', type: type === 'elbowV' ? 'elbow90' : type, geometry: { ...geometry, demo: true } });
const cases = Object.entries(P).map(([k, g]) => [k, part(k, g)]);
const pt = (m, i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
const near = (a, b, tol = TOL) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

test('every part type has a test case', () => {
  for (const t of PART_TYPES) assert.ok(cases.some(([, c]) => c.type === t), t);
});

for (const [name, c] of cases) {
  test(`${name}: mesh integrity (indices in range, triangles, unit normals, no NaN)`, () => {
    const m = buildPart(c, S);
    const nv = m.positions.length / 3;
    assert.equal(m.positions.length, m.normals.length);
    assert.equal(m.indices.length % 3, 0);
    assert.ok(m.indices.length > 0);
    for (const i of m.indices) assert.ok(i >= 0 && i < nv, `index ${i} out of range`);
    for (let i = 0; i < nv; i++) {
      for (let a = 0; a < 3; a++) assert.ok(Number.isFinite(m.positions[i * 3 + a]) && Number.isFinite(m.normals[i * 3 + a]));
      near(Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]), 1, 1e-5);
    }
    // groups cover the whole index buffer, sheet before flange
    const total = m.groups.reduce((s, g) => s + g.count, 0);
    assert.equal(total, m.indices.length);
    assert.equal(m.groups[0].start, 0);
  });

  test(`${name}: winding agrees with normals (faces point the way they are lit)`, () => {
    const m = buildPart(c, S);
    let bad = 0, degenerate = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b, d] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]];
      const fn = vCross(vSub(pt(m, b), pt(m, a)), vSub(pt(m, d), pt(m, a)));
      if (vLen(fn) < 1e-6) { degenerate++; continue; }
      const vn = [0, 1, 2].map(k => m.normals[a * 3 + k] + m.normals[b * 3 + k] + m.normals[d * 3 + k]);
      if (vDot(fn, vn) <= 0) bad++;
    }
    assert.equal(degenerate, 0, 'degenerate triangles');
    assert.equal(bad, 0, 'triangles facing against their normals');
  });

  test(`${name}: connector openings stay open (no face across the internal section)`, () => {
    const m = buildPart(c, S);
    for (const [cn, k] of Object.entries(m.connectors)) {
      // a triangle lying in the connector plane must not cover the centre of the opening
      for (let i = 0; i < m.indices.length; i += 3) {
        const tri = [0, 1, 2].map(j => pt(m, m.indices[i + j]));
        if (!tri.every(p => Math.abs(vDot(vSub(p, k.o), k.n)) < TOL)) continue;
        // barycentric test of the opening centre against this triangle
        const [p0, p1, p2] = tri, v0 = vSub(p1, p0), v1 = vSub(p2, p0), v2 = vSub(k.o, p0);
        const d00 = vDot(v0, v0), d01 = vDot(v0, v1), d11 = vDot(v1, v1), d20 = vDot(v2, v0), d21 = vDot(v2, v1), den = d00 * d11 - d01 * d01;
        const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
        assert.ok(!(v >= 0 && w >= 0 && v + w <= 1), `${name}.${cn}: a face covers the opening`);
      }
      // the ring of material at the connector plane starts at the internal section edge
      const inPlane = [];
      for (let i = 0; i < m.positions.length / 3; i++) { const p = pt(m, i); if (Math.abs(vDot(vSub(p, k.o), k.n)) < TOL) inPlane.push(p); }
      const sideAxis = vCross(k.n, k.u);
      const minHalfW = Math.min(...inPlane.map(p => Math.max(Math.abs(vDot(vSub(p, k.o), sideAxis)) - k.w / 2, Math.abs(vDot(vSub(p, k.o), k.u)) - k.h / 2)));
      if (c.geometry.diameterMm || c.geometry.inletDiameterMm || (c.type === 'rect-round' && cn === 'outlet')) near(Math.min(...inPlane.map(p => Math.hypot(vDot(vSub(p, k.o), sideAxis), vDot(vSub(p, k.o), k.u)) - k.w / 2)), 0);
      else if (!['flange', 'profile-frame'].includes(c.type)) near(minHalfW, 0); // duct rim begins exactly at the internal edge
    }
  });
}

test('faces point out of the metal: a step along the normal leaves the sheet, a step against it enters it', () => {
  // Analytic solid for a straight duct (and its two frame flanges) and for a standalone flange.
  const inside = {
    straight: ([x, y, z]) => {
      const ay = Math.abs(y), az = Math.abs(z), h = 150, w = 200;
      const sheet = x > 0 && x < 1000 && ay < h + T && az < w + T && (ay > h || az > w);
      const fl = ((x > 0 && x < D) || (x > 1000 - D && x < 1000)) && ay < h + OUT && az < w + OUT && (ay > h + T || az > w + T);
      return sheet || fl;
    },
    flange: ([x, y, z]) => { const ay = Math.abs(y), az = Math.abs(z); return x > 0 && x < D && ay < 100 + OUT && az < 150 + OUT && (ay > 100 + T || az > 150 + T); },
  };
  for (const type of ['straight', 'flange']) {
    const m = buildPart(part(type, P[type]), S);
    for (let i = 0; i < m.indices.length; i += 3) {
      const tri = [0, 1, 2].map(j => pt(m, m.indices[i + j]));
      const c = [0, 1, 2].map(a => (tri[0][a] + tri[1][a] + tri[2][a]) / 3);
      const n = vCross(vSub(tri[1], tri[0]), vSub(tri[2], tri[0])), l = vLen(n);
      const step = s => c.map((v, a) => v + (n[a] / l) * s);
      assert.equal(inside[type](step(0.5)), false, `${type}: face at ${c.map(Math.round)} points into the metal`);
      assert.equal(inside[type](step(-0.5)), true, `${type}: face at ${c.map(Math.round)} has no metal behind it`);
    }
  }
});

test('straight: bounding box and connector sections match the parameters', () => {
  const m = buildPart(part('straight', P.straight), S);
  assert.deepEqual(m.bounds.min.map(Math.round), [0, -(150 + OUT), -(200 + OUT)]);
  assert.deepEqual(m.bounds.max.map(Math.round), [1000, 150 + OUT, 200 + OUT]);
  const k = m.connectors;
  assert.deepEqual(k.inlet, { o: [0, 0, 0], n: [-1, 0, 0], u: [0, 1, 0], w: 400, h: 300 });
  assert.deepEqual(k.outlet, { o: [1000, 0, 0], n: [1, 0, 0], u: [0, 1, 0], w: 400, h: 300 });
});

test('elbow90 horizontal: centre-line radius, outlet frame and bounds', () => {
  const m = buildPart(part('elbow90', P.elbow90), S);
  const R = 150 + 200;
  assert.deepEqual(m.connectors.outlet, { o: [R, 0, R], n: [0, 0, 1], u: [0, 1, 0], w: 400, h: 300 });
  near(m.bounds.max[0], R + 200 + OUT); // outer cheek + sheet + flange at the outlet side
  near(m.bounds.min[1], -(150 + OUT));
  near(m.bounds.max[2], R); // nothing beyond the outlet plane
});

test('elbow90 vertical: turns up, height direction follows the bend', () => {
  const m = buildPart(part('elbowV', P.elbowV), S);
  const R = 150 + 150;
  assert.deepEqual(m.connectors.outlet, { o: [R, R, 0], n: [0, 1, 0], u: [-1, 0, 0], w: 400, h: 300 });
  near(m.bounds.max[1], R);
});

test('reducer: inlet and outlet cross-sections', () => {
  const m = buildPart(part('reducer', P.reducer), S);
  assert.equal(m.connectors.inlet.w, 400); assert.equal(m.connectors.inlet.h, 300);
  assert.equal(m.connectors.outlet.w, 300); assert.equal(m.connectors.outlet.h, 200);
  near(m.bounds.max[1], 150 + OUT); near(m.bounds.max[0], 400);
});

test('tee: branch connector position, orientation and section', () => {
  const m = buildPart(part('tee', P.tee), S);
  assert.deepEqual(m.connectors.branch, { o: [350, 0, 200 + 150], n: [0, 0, 1], u: [0, 1, 0], w: 250, h: 200 });
  near(m.bounds.max[2], 350);
});

test('flange: depth from settings, open in the middle', () => {
  const m = buildPart(part('flange', P.flange), S);
  assert.deepEqual(m.connectors.outlet.o, [D, 0, 0]);
  near(m.bounds.max[0], D); near(m.bounds.max[2], 150 + OUT);
});

test('identical parameters give identical meshes (deterministic)', () => {
  for (const [, c] of cases) {
    const a = buildPart(c, S), b = buildPart(c, S);
    assert.deepEqual(a.positions, b.positions); assert.deepEqual(a.indices, b.indices);
  }
});

test('degenerate or invalid parameters are rejected', () => {
  const bad = [
    ['straight', { ...P.straight, lengthMm: 0 }],
    ['straight', { ...P.straight, widthMm: -400 }],
    ['straight', { ...P.straight, heightMm: NaN }],
    ['straight', { ...P.straight, lengthMm: '1000' }],
    ['straight', { ...P.straight, lengthMm: 60 }], // flanges would overlap
    ['straight', { ...P.straight, colour: 'red' }], // unknown parameter
    ['elbow90', { ...P.elbow90, innerRadiusMm: 0 }],
    ['elbow90', { ...P.elbow90, innerRadiusMm: 40 }], // end flanges collide
    ['elbow90', { ...P.elbow90, bendPlane: 'diagonal' }],
    ['reducer', { ...P.reducer, outletWidthMm: 400, outletHeightMm: 300 }],
    ['reducer', { ...P.reducer, lengthMm: 50 }],
    ['tee', { ...P.tee, branchHeightMm: 300 }],
    ['tee', { ...P.tee, branchPositionMm: 100 }],
    ['tee', { ...P.tee, branchWidthMm: 700 }],
    ['tee', { ...P.tee, branchLengthMm: 20 }],
    ['flange', { widthMm: 300 }],
  ];
  for (const [type, g] of bad) {
    const c = part(type, g);
    assert.ok(validatePart(c, S).length > 0, `${type} ${JSON.stringify(g)} should be invalid`);
    assert.throws(() => buildPart(c, S), GeometryError);
    assert.throws(() => connectorsFor(c, S), GeometryError);
  }
  assert.ok(validatePart({ type: 'spiral', geometry: {} }, S).length);
  assert.ok(validatePart(part('straight', P.straight), { ...S, sheetMm: 0 }).length);
  assert.throws(() => buildPart(part('elbow90', P.elbow90), S, { segments: 1 }), GeometryError);
});

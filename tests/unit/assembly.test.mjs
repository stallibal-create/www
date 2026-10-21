// Unit tests: assembly solver, connector alignment, explode / reassemble, data validator. Run: node --test tests/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { solveAssembly, checkConnections, worldConnector, connectionError, explodeOffsets, poseAt, alignTo, AssemblyError } from '../../src/assets/js/assembly/assembly.js';
import { buildPart } from '../../src/assets/js/assembly/geometry.js';
import { applyPoint, m3Mul, m3Transpose, EPS_MM, EPS_DIR, toScene } from '../../src/assets/js/assembly/units.js';
import { validateAssembly } from '../../scripts/assembly-validate.mjs';

const site = JSON.parse(readFileSync(new URL('../../content/site.json', import.meta.url), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));
const asm = () => clone(site.ductAssembly);

test('mm → scene units goes through one function (1 unit = 1 m)', () => {
  assert.equal(toScene(1000), 1); assert.equal(toScene(400), 0.4);
});

test('site.json demo assembly is valid', () => {
  assert.deepEqual(validateAssembly(site), []);
});

test('every connection aligns within tolerance (gap, normals opposite, up vectors equal, same section)', () => {
  const a = asm(), s = solveAssembly(a);
  assert.deepEqual(checkConnections(a, s), []);
  for (const [x, y] of a.connections) {
    const [ia, ca] = x.split('.'), [ib, cb] = y.split('.');
    const e = connectionError(worldConnector(s.parts.get(ia).installed, s.parts.get(ia).local[ca]), worldConnector(s.parts.get(ib).installed, s.parts.get(ib).local[cb]));
    assert.ok(e.gapMm <= EPS_MM && e.normal <= EPS_DIR && e.up <= EPS_DIR && e.dw === 0 && e.dh === 0, `${x} ↔ ${y} ${JSON.stringify(e)}`);
  }
});

test('installed transforms are proper rotations and deterministic', () => {
  const s1 = solveAssembly(asm()), s2 = solveAssembly(asm());
  for (const [id, p] of s1.parts) {
    assert.deepEqual(p.installed, s2.parts.get(id).installed, id);
    const rrt = m3Mul(p.installed.r, m3Transpose(p.installed.r));
    rrt.forEach((v, i) => assert.ok(Math.abs(v - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) < 1e-12, `${id} not orthonormal`));
    const r = p.installed.r, det = r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]);
    assert.ok(Math.abs(det - 1) < 1e-12, `${id} is a reflection`);
  }
});

test('root sits at the origin; the known layout matches hand calculation', () => {
  const s = solveAssembly(asm());
  assert.deepEqual(s.parts.get('duct-1').installed.t, [0, 0, 0]);
  assert.deepEqual(s.parts.get('elbow-1').installed.t, [1000, 0, 0]);
  // elbow: inner radius 150 + half width 200 → outlet at (1350, 0, 350), duct-2 runs along +Z
  assert.deepEqual(s.parts.get('duct-2').installed.t, [1350, 0, 350]);
  // tee branch (local +Z side) points to world −X: branch duct starts 200 + 150 mm from the tee axis
  assert.deepEqual(s.parts.get('branch-1').installed.t, [1000, 0, 1500]);
});

test('mesh vertices at a connection coincide on both parts (connector planes meet flange to flange)', () => {
  const a = asm(), s = solveAssembly(a);
  const comp = new Map(a.components.map(c => [c.id, c]));
  for (const [x, y] of a.connections) {
    const [ia, ca] = x.split('.'), [ib, cb] = y.split('.');
    const A = s.parts.get(ia), B = s.parts.get(ib);
    const wa = worldConnector(A.installed, A.local[ca]);
    const planeVerts = id => { const P = s.parts.get(id), m = buildPart(comp.get(id), a.settings), out = []; for (let i = 0; i < m.positions.length; i += 3) { const w = applyPoint(P.installed, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]); if (Math.abs((w[0] - wa.o[0]) * wa.n[0] + (w[1] - wa.o[1]) * wa.n[1] + (w[2] - wa.o[2]) * wa.n[2]) < 1e-3) out.push(w); } return out; };
    const va = planeVerts(ia), vb = planeVerts(ib);
    assert.ok(va.length && vb.length, `${x}/${y} both parts touch the joint plane`);
    if (comp.get(ib).type !== 'flange' && comp.get(ia).type !== 'flange') {
      const key = p => p.map(v => Math.round(v * 100) / 100).join(',');
      const sa = new Set(va.map(key));
      assert.ok(vb.filter(p => sa.has(key(p))).length >= 8, `${x} ↔ ${y}: rims/flanges should share corner positions`);
    }
  }
});

test('explode → reassemble returns every part exactly home after many cycles', () => {
  const a = asm(), s = solveAssembly(a), off = explodeOffsets(a, s);
  const poses = new Map();
  for (let cycle = 0; cycle < 1000; cycle++) {
    for (const f of [0.13, 0.5, 1, 0.77, 0]) for (const id of s.order) poses.set(id, poseAt(s.parts.get(id).installed, off.get(id), f));
  }
  for (const id of s.order) assert.deepEqual(poses.get(id), { r: [...s.parts.get(id).installed.r], t: [...s.parts.get(id).installed.t] }, id);
});

test('explode moves each part away from its parent along its own axis', () => {
  const a = asm(), s = solveAssembly(a), off = explodeOffsets(a, s);
  assert.deepEqual(off.get('duct-1'), [-250, 0, 0]);  // root backs out of its inlet
  assert.deepEqual(off.get('elbow-1'), [-250 + 150, 0, 0]);
  // a child never moves towards its parent relative to the parent's own offset
  for (const id of s.order.slice(1)) {
    const P = s.parts.get(id), par = off.get(P.parent), me = off.get(id);
    const n = worldConnector(P.installed, P.local[P.via]).n; // points back to the parent
    assert.ok((me[0] - par[0]) * n[0] + (me[1] - par[1]) * n[1] + (me[2] - par[2]) * n[2] <= 0, id);
  }
});

test('alignTo puts a connector face to face with its target', () => {
  const T = alignTo({ o: [5, 0, 0], n: [-1, 0, 0], u: [0, 1, 0], w: 1, h: 1 }, { o: [10, 20, 30], n: [0, 0, 1], u: [0, 1, 0], w: 1, h: 1 });
  assert.deepEqual(applyPoint(T, [5, 0, 0]), [10, 20, 30]);
});

test('solver rejects broken graphs', () => {
  const cases = [
    a => { a.connections.push(['duct-3.outlet', 'branch-1.outlet']); },                       // connector reused
    a => { a.connections = a.connections.filter(([x]) => x !== 'tee-1.branch'); },             // branch-1 disconnected
    a => { a.connections.push(['flange-1.outlet', 'branch-1.outlet']); },                       // loop
    a => { a.connections[0] = ['duct-1.outlet', 'elbow-9.inlet']; },                            // unknown part
    a => { a.connections[0] = ['duct-1.side', 'elbow-1.inlet']; },                              // unknown connector
    a => { a.connections[0] = ['duct-1.outlet', 'duct-1.inlet']; },                             // self
    a => { a.components.find(c => c.id === 'duct-3').geometry.widthMm = 350; },                 // reducer outlet 300 ≠ 350
    a => { a.components.find(c => c.id === 'branch-1').geometry.heightMm = 250; },              // branch section mismatch
  ];
  for (const f of cases) { const a = asm(); f(a); assert.throws(() => solveAssembly(a), AssemblyError, f.toString()); }
});

test('validator rejects bad data', () => {
  const cases = [
    s => { s.ductAssembly.components[1].id = 'duct-1'; },
    s => { delete s.ductAssembly.components[0].name.ar; },
    s => { s.ductAssembly.components[0].geometry.lengthMm = -5; },
    s => { s.ductAssembly.components[0].geometry.demo = false; },
    s => { s.ductAssembly.components[0].productSlug = 'rocket'; },
    s => { s.ductAssembly.components[0].material = 'galvanised'; },                // specs only via products[]
    s => { s.ductAssembly.components[0].type = 'spiral'; },
    s => { s.ductAssembly.components[0].explode = { distanceMm: -1 }; },
    s => { s.ductAssembly.components[0].explode = { distanceMm: 10, direction: [0, 0, 0] }; },
    s => { s.ductAssembly.settings.flangeDepthMm = 0; },
    s => { s.ductAssembly.demo = false; },
    s => { s.ductAssembly.connections.pop(); },
    s => { s.ductAssembly.components.find(c => c.id === 'reducer-1').geometry.outletHeightMm = 210; },
    s => { delete s.ductAssembly; },
  ];
  for (const f of cases) { const s = clone(site); f(s); assert.ok(validateAssembly(s).length > 0, f.toString()); }
});

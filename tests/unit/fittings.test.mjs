import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../src/assets/vendor/three/build/three.module.min.js';
import { buildPart, validatePart } from '../../src/assets/js/assembly/geometry.js';
import { yLayout } from '../../src/assets/js/assembly/fittings.js';
import { sampleAirway } from '../../src/assets/js/assembly/flow.js';
import { modelProblems } from '../../scripts/assembly-model.mjs';

const site = JSON.parse(readFileSync(new URL('../../content/site.json', import.meta.url)));
const asm = site.ductSystems.branches, y = asm.components.find(c => c.type === 'y');
const inside = (poly, p) => {
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[2]) !== (b[1] > p[2]) && p[0] < (b[0]-a[0])*(p[2]-a[1])/(b[1]-a[1])+a[0]) result = !result;
  }
  return result;
};

test('Y: both flow lanes remain inside the airway through the split', () => {
  const outline = yLayout(y.geometry).outline;
  for (const branch of [false, true]) for (let i = 1; i < 100; i++) {
    const f = sampleAirway(y, i / 100, branch);
    for (const offset of [-.29, 0, .29]) {
      const p = f.p.map((v, k) => v + f.side[k] * f.w * offset);
      assert.ok(inside(outline, p), `branch=${branch}, t=${i/100}, offset=${offset}`);
    }
  }
});

test('Y: full detailed mesh has sound triangles and the branch separation matches its angle', () => {
  const m = buildPart(y, asm.settings, { details: true }), a = m.connectors.outlet, b = m.connectors.branch;
  const angle = Math.acos(a.n.reduce((s,v,i) => s + v*b.n[i], 0)) * 180 / Math.PI;
  assert.ok(Math.abs(angle - 2*y.geometry.branchAngleDeg) < 1e-9);
  const p = i => new THREE.Vector3().fromArray(m.positions, 3*i);
  for (let i = 0; i < m.indices.length; i += 3) {
    const [ia, ib, ic] = Array.from(m.indices.slice(i,i+3));
    const normal = p(ib).sub(p(ia)).cross(p(ic).sub(p(ia)));
    assert.ok(normal.length() > 1e-6);
    assert.ok(normal.dot(new THREE.Vector3().fromArray(m.normals,3*ia)) > 0);
  }
  for (const geometry of [{...y.geometry,branchAngleDeg:80},{...y.geometry,trunkLengthMm:50},{...y.geometry,branchLengthMm:30},{...y.geometry,branchWidthMm:600}]) assert.ok(validatePart({...y,geometry},asm.settings).length);
});

test('frame: all four corner pads have open bolt holes with metal alongside', () => {
  const c = site.ductAssembly.components.find(c => c.type === 'profile-frame'), s = site.ductAssembly.settings;
  const m = buildPart(c, s), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(m.positions,3)); geometry.setIndex(new THREE.BufferAttribute(m.indices,1));
  const material = new THREE.MeshBasicMaterial({side:THREE.DoubleSide}), mesh = new THREE.Mesh(geometry,material);
  mesh.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  for (const sy of [-1,1]) for (const sz of [-1,1]) {
    const y = sy*(c.geometry.heightMm/2+s.sheetMm+s.flangeWidthMm/2), z = sz*(c.geometry.widthMm/2+s.sheetMm+s.flangeWidthMm/2);
    ray.set(new THREE.Vector3(-100,y,z),new THREE.Vector3(1,0,0));
    assert.equal(ray.intersectObject(mesh).length,0,'bolt hole is open');
    ray.set(new THREE.Vector3(-100,y+sy*8,z),new THREE.Vector3(1,0,0));
    assert.ok(ray.intersectObject(mesh).length>=2,'plate has front and back faces beside the hole');
  }
  geometry.dispose();material.dispose();
});

test('tee/Y Blender export matches its source geometry', () => {
  const b = readFileSync(new URL('../../src/assets/models/duct-assembly-branches.glb',import.meta.url));
  assert.deepEqual(modelProblems(asm,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),[]);
});

// Unit tests: the Blender-exported assembly GLB, its reader, the build's freshness check, and placement in the
// viewer scene (baked vertices are already installed: the installed transform must not be applied a second time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../src/assets/vendor/three/build/three.module.min.js';
import { readGlb } from '../../src/assets/js/assembly/glb.js';
import { buildScene, applyPose } from '../../src/assets/js/assembly/viewer.js';
import { solveAssembly, explodeOffsets } from '../../src/assets/js/assembly/assembly.js';
import { modelProblems } from '../../scripts/assembly-model.mjs';

const asm = JSON.parse(readFileSync(new URL('../../content/site.json', import.meta.url), 'utf8')).ductAssembly;
const file = readFileSync(new URL('../../src/assets/models/duct-assembly-demo.glb', import.meta.url));
const glb = () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

// Rewrites the GLB's JSON chunk (padded to 4 bytes) and keeps its binary chunk.
function withJson(edit) {
  const b = Buffer.from(glb()), len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString()); edit(json);
  let text = Buffer.from(JSON.stringify(json));
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), ' ')]);
  const head = Buffer.alloc(20), rest = b.subarray(20 + len);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, text, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

const boxes = meshes => new Map([...meshes].map(([id, m]) => [id, new THREE.Box3().setFromObject(m, true)]));
const near = (a, b, tol = 2e-4) => a.min.distanceTo(b.min) <= tol && a.max.distanceTo(b.max) <= tol;

test('the GLB holds exactly the nineteen assembly parts, with the four detail materials and texture coordinates', () => {
  const parts = readGlb(glb());
  assert.deepEqual([...parts.keys()].sort(), asm.components.map(c => c.id).sort());
  for (const [id, prims] of parts) {
    assert.ok(prims.length >= 1, id);
    for (const p of prims) {
      assert.ok([0, 1, 2, 3].includes(p.slot));
      assert.equal(p.positions.length, p.normals.length); assert.equal(p.uvs.length, (p.positions.length / 3) * 2); assert.equal(p.indices.length % 3, 0);
    }
    const c = asm.components.find(c => c.id === id);
    if (!c.geometry.diameterMm && !c.geometry.inletDiameterMm) assert.ok(prims.some(p => p.slot === 2) && prims.some(p => p.slot === 3), `${id}: bolts and gasket exported`);
  }
});

test('the exported model matches site.json; a changed dimension is reported for that part only', () => {
  assert.deepEqual(modelProblems(asm, glb()), []);
  const edited = structuredClone(asm);
  const duct = edited.components.find(c => c.id === 'duct-3');
  duct.geometry.lengthMm += 50;
  const problems = modelProblems(edited, glb());
  assert.ok(problems.some(p => p.startsWith('duct-3:')), problems.join('; '));
  // a detail change that keeps the outline (more elbow segments) is caught by the triangle count
  const sliced = withJson(j => { const m = j.meshes[j.nodes.find(n => n.name === 'elbow-1').mesh]; m.primitives = m.primitives.slice(1); });
  assert.ok(modelProblems(asm, sliced).some(p => p.startsWith('elbow-1:') && /triangles/.test(p)));
});

test('baked parts are placed once: same world bounds as the procedural scene, assembled and exploded', () => {
  const mat = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  const proc = buildScene(THREE, asm, 32, mat), baked = buildScene(THREE, asm, 32, mat, readGlb(glb()));
  for (const m of baked.meshes.values()) assert.ok(m.matrix.equals(new THREE.Matrix4()), `${m.userData.partId} has a transform`);
  const solved = solveAssembly(asm), offsets = explodeOffsets(asm, solved);
  for (const f of [0, 0.5, 1, 0]) {
    applyPose(proc.meshes, solved, offsets, f, proc.root); applyPose(baked.meshes, solved, offsets, f, baked.root);
    const a = boxes(proc.meshes), b = boxes(baked.meshes);
    for (const [id, box] of a) assert.ok(near(box, b.get(id)), `${id} at explode ${f}`);
  }
  for (const m of baked.meshes.values()) assert.ok(m.matrix.equals(new THREE.Matrix4()), 'back to identity after exploding');
});

test('reader rejects files it cannot place safely', () => {
  assert.throws(() => readGlb(new ArrayBuffer(40)), /not a GLB/);
  assert.throws(() => readGlb(withJson(j => { j.nodes[0].translation = [1, 0, 0]; })), /transform/);
  assert.throws(() => readGlb(withJson(j => { j.materials[0].name = 'Other'; })), /unknown material/);
  assert.throws(() => readGlb(withJson(j => { j.nodes[1].name = j.nodes[0].name; })), /duplicate/);
  assert.throws(() => readGlb(withJson(j => { delete j.meshes[0].primitives[0].attributes.TEXCOORD_0; })), /texture coordinates/);
});

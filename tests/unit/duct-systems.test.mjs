import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../src/assets/vendor/three/build/three.module.min.js';
import { solveAssembly, checkConnections, explodeOffsets, poseAt } from '../../src/assets/js/assembly/assembly.js';
import { buildPart } from '../../src/assets/js/assembly/geometry.js';
import { buildScene, homeDistance, HOME_FILL } from '../../src/assets/js/assembly/viewer.js';
import { DEFAULT_VIEW_DIR } from '../../src/assets/js/assembly/assembly.js';
import { vNorm } from '../../src/assets/js/assembly/units.js';
import { assemblySvg } from '../../scripts/assembly-svg.mjs';
import { validateAssembly } from '../../scripts/assembly-validate.mjs';
const site = JSON.parse(readFileSync(new URL('../../content/site.json', import.meta.url)));
for (const [key, a] of Object.entries(site.ductSystems)) {
  test(`${key}: connected circular airway, stable explode/reassemble and bounded mesh budget`, () => {
    assert.deepEqual(validateAssembly({ products: site.products, ductAssembly: a }), []);
    const solved = solveAssembly(a), offsets = explodeOffsets(a, solved);
    assert.deepEqual(checkConnections(a, solved), []);
    let triangles = 0;
    for (const c of a.components) {
      const part = solved.parts.get(c.id);
      for (let i = 0; i < 100; i++) { poseAt(part.installed, offsets.get(c.id), 1); assert.deepEqual(poseAt(part.installed, offsets.get(c.id), 0), part.installed); }
      const m = buildPart(c, a.settings, { segments: 16 });
      triangles += m.indices.length / 3;
      assert.ok(m.positions.every(Number.isFinite));
    }
    assert.ok(triangles < 20000, `${triangles} triangles`);
    const preview = assemblySvg(a, { title: key, id: key });
    assert.ok(!/NaN|Infinity/.test(preview));
    assert.match(preview, /<path/);
  });
  for (const segments of [10, 16]) test(`${key}: camera fits every vertex at ${segments} bend segments`, () => {
    const scene = buildScene(THREE, a, segments, new THREE.MeshBasicMaterial());
    const camera = new THREE.PerspectiveCamera(30, 4/3, .05, 100);
    homeDistance(THREE, camera, scene.meshes, scene.center, new THREE.Vector3(...vNorm(DEFAULT_VIEW_DIR)));
    const p = new THREE.Vector3(); let extent = 0;
    for (const mesh of scene.meshes.values()) {
      const attr = mesh.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) { p.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld).project(camera); extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y)); assert.ok(p.z >= -1 && p.z <= 1); }
    }
    assert.ok(Math.abs(extent - HOME_FILL) < .01, `extent ${extent}`);
    for (const g of scene.geometries) g.dispose();
  });
}

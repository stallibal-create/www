// Unit tests: the viewer's scene, home framing and tap picking, run with the real vendored three.js r170 in Node.
// No WebGL is involved: this checks maths and scene structure, not pixels (those need a real GPU).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../src/assets/vendor/three/build/three.module.min.js';
import { buildScene, homeDistance, HOME_FILL } from '../../src/assets/js/assembly/viewer.js';
import { DEFAULT_VIEW_DIR } from '../../src/assets/js/assembly/assembly.js';
import { vNorm } from '../../src/assets/js/assembly/units.js';

const asm = JSON.parse(readFileSync(new URL('../../content/site.json', import.meta.url), 'utf8')).ductAssembly;
const ASPECT = 4 / 3; // .asm-stage is 4:3 at every width
const setup = segments => {
  const sc = buildScene(THREE, asm, segments, new THREE.MeshBasicMaterial());
  const camera = new THREE.PerspectiveCamera(30, ASPECT, 0.05, 100);
  const dir = new THREE.Vector3(...vNorm(DEFAULT_VIEW_DIR));
  const d = homeDistance(THREE, camera, sc.meshes, sc.center, dir);
  return { ...sc, camera, dir, d };
};
const extent = (meshes, camera, step = 1) => {
  const v = new THREE.Vector3(); let e = 0;
  for (const m of meshes.values()) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).project(camera); e = Math.max(e, Math.abs(v.x), Math.abs(v.y)); if (v.z < -1 || v.z > 1) return Infinity; } }
  return e;
};

for (const [profile, segments] of [['desktop', 16], ['mobile', 10]]) {
  test(`${profile}: all 15 parts are in the scene, each with its own placed mesh`, () => {
    const { meshes, geometries } = setup(segments);
    assert.deepEqual([...meshes.keys()], asm.components.map(c => c.id));
    assert.equal(geometries.length, 15);
    for (const m of meshes.values()) assert.ok(m.geometry.index.count > 0 && m.geometry.groups.length >= 1);
  });
  test(`${profile}: home view shows the whole assembly and fills ${HOME_FILL * 100} % of the frame`, () => {
    const { meshes, camera } = setup(segments);
    const e = extent(meshes, camera);
    assert.ok(Math.abs(e - HOME_FILL) < 0.01, `extent ${e}`);
  });
  test(`${profile}: at the zoom-out limit nothing is clipped from any orbit angle`, () => {
    const { meshes, camera, center, d } = setup(segments);
    for (let az = 0; az < 360; az += 15) for (const el of [-80, -45, 0, 45, 80]) {
      const dir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - el), THREE.MathUtils.degToRad(az));
      camera.position.copy(center).addScaledVector(dir, d * 2.6); camera.near = d / 100; camera.far = d * 30; camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      assert.ok(extent(meshes, camera, 2) <= 1, `clipped at azimuth ${az}°, elevation ${el}°`);
    }
  });
  test(`${profile}: every part can be tapped from the home view`, () => {
    const { meshes, camera, center } = setup(segments);
    const ray = new THREE.Raycaster(), all = [...meshes.values()], v = new THREE.Vector3();
    for (const [id, m] of meshes) {
      const p = m.geometry.attributes.position; let hits = 0;
      for (let i = 0; i < p.count; i += 5) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); v.add(center.clone().sub(v).multiplyScalar(0.02)).project(camera);
        ray.setFromCamera(new THREE.Vector2(v.x, v.y), camera);
        const h = ray.intersectObjects(all, false)[0]; if (h && h.object.userData.partId === id) hits++;
      }
      assert.ok(hits >= 3, `${id}: only ${hits} hit points`);
    }
  });
}

// ---------- v13: exploded framing (the v12 Explode button and intro pushed parts out of the frame) ----------
import { applyPose, explodedDistance, introZoom, EXPLODED_FILL } from '../../src/assets/js/assembly/viewer.js';
import { solveAssembly, explodeOffsets } from '../../src/assets/js/assembly/assembly.js';
import { createMotion, INTRO_DURATION_MS } from '../../src/assets/js/assembly/motion.js';

const motionSetup = () => {
  const s = setup(10);
  const solved = solveAssembly(asm), offsets = explodeOffsets(asm, solved);
  return { ...s, solved, offsets };
};
const place = (camera, center, dir, dist) => { camera.position.copy(center).addScaledVector(dir, dist); camera.lookAt(center); camera.near = dist / 100; camera.far = dist * 30; camera.updateProjectionMatrix(); camera.updateMatrixWorld(); };

test('Explode: every animation frame keeps all 15 parts in the frame, from the home view and from rotated views', () => {
  const m = motionSetup();
  const dirs = [m.dir.clone(), ...[45, 90, 135, 180, 225, 270, 315].map(deg => m.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg)))];
  for (const dir of dirs) {
    const near = m.d, far = Math.max(near, explodedDistance(THREE, m.camera, m, m.solved, m.offsets, dir, 0));
    for (let f = 0; f <= 1.0001; f += 0.05) {
      applyPose(m.meshes, m.solved, m.offsets, f, m.root);
      place(m.camera, m.center, dir, near + (far - near) * f);
      const e = extent(m.meshes, m.camera);
      assert.ok(e <= 1, `part off-frame at factor ${f.toFixed(2)} (extent ${e.toFixed(3)})`);
    }
    assert.ok(Math.abs(extent(m.meshes, m.camera) - EXPLODED_FILL) < 0.01 || far === near, 'fully exploded view is fitted');
  }
  applyPose(m.meshes, m.solved, m.offsets, 0, m.root);
});

test('Intro: every frame (25 ms steps) keeps all 15 parts in the frame', () => {
  const m = motionSetup();
  const zoom = introZoom(THREE, m.camera, m, m.solved, m.offsets, m.dir, m.d);
  const home = m.dir.clone().multiplyScalar(m.d), mo = createMotion();
  mo.playIntro();
  for (let t = 0; t <= INTRO_DURATION_MS; t += 25) {
    const st = t === 0 ? mo.state() : mo.tick(25);
    applyPose(m.meshes, m.solved, m.offsets, st.factor, m.root);
    const off = home.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), st.orbitRad).multiplyScalar(1 + (zoom - 1) * st.factor);
    m.camera.position.copy(m.center).add(off); m.camera.lookAt(m.center); m.camera.updateMatrixWorld();
    const e = extent(m.meshes, m.camera);
    assert.ok(e <= 1, `intro frame at ${t} ms: part off-frame (extent ${e.toFixed(3)})`);
  }
  assert.equal(mo.state().mode, 'idle');
  applyPose(m.meshes, m.solved, m.offsets, 0, m.root);
});

test('applyPose is exact: back to factor 0 restores every installed matrix after many cycles', () => {
  const m = motionSetup();
  const before = [...m.meshes.values()].map(x => [...x.matrix.elements]);
  for (let i = 0; i < 500; i++) applyPose(m.meshes, m.solved, m.offsets, (i * 0.37) % 1, m.root);
  applyPose(m.meshes, m.solved, m.offsets, 0, m.root);
  assert.deepEqual([...m.meshes.values()].map(x => [...x.matrix.elements]), before);
});

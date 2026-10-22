// Conceptual 3D hero: a short duct run (rectangular duct → gored elbow → spiral riser → grille)
// echoing the LIBALSTAL mark. Three.js loads lazily through the page's import map.
// If WebGL, the script, or data-saver block it, the static logo mark stays in place.
//
// v14: galvanised spangle texture + roughness map, raised helical lock seam, corner seams, scroll-linked framing.
// Performance notes (see README): static parts are merged per material (≈10 draw calls instead of ≈60),
// shaders compile before the first frame (compileAsync), the loop runs via setAnimationLoop and stops
// off-screen / in background tabs, pixel ratio is capped at 2, nothing is allocated per frame.
// Append ?debug3d to the URL to log draw calls and triangles.

const art = document.getElementById('hero-art');
const holder = art && art.querySelector('.hero-canvas');

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
const saveData = navigator.connection && (navigator.connection.saveData || /2g/.test(navigator.connection.effectiveType || ''));

if (holder && webglOK() && !saveData) {
  const start = () => init().catch(err => { console.warn('[hero3d] fallback kept:', err && err.message); });
  const idle = window.requestIdleCallback || (cb => setTimeout(cb, 200));
  if (document.readyState === 'complete') idle(start); else addEventListener('load', () => idle(start), { once: true });
}

async function init() {
  const [THREE, { RoomEnvironment }, { mergeGeometries }] = await Promise.all([
    import('three'),
    import('three/addons/environments/RoomEnvironment.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
  ]);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const small = matchMedia('(max-width: 860px)').matches;
  const debug = /[?&]debug3d\b/.test(location.search);

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  holder.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose(); pmrem.dispose();
  scene.environmentIntensity = 0.95;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);

  // ---------- procedural galvanised spangle (v14) ----------
  // Hot-dip galvanising leaves zinc crystals ("spangle"): irregular cells, each with its own sheen and a
  // feathered grain. Jittered-grid Voronoi on a canvas (no asset to download), plus a matching roughness map.
  function spangle(size, cells, seed) {
    let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pts = [];
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push({ x: (i + rnd()) / cells, y: (j + rnd()) / cells, l: 0.8 + rnd() * 0.13, a: rnd() * Math.PI, f: 40 + rnd() * 60 });
    const col = document.createElement('canvas'), rgh = document.createElement('canvas');
    col.width = col.height = rgh.width = rgh.height = size;
    const gc = col.getContext('2d'), gr = rgh.getContext('2d');
    const ic = gc.createImageData(size, size), ir = gr.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, ci = Math.floor(u * cells), cj = Math.floor(v * cells);
      let d1 = 9, d2 = 9, best = null;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells, p = pts[jj * cells + ii];
        const dx = p.x + (ci + di - ii) / cells - u, dy = p.y + (cj + dj - jj) / cells - v, d = dx * dx + dy * dy; // tileable
        if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
      }
      const edge = Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) * cells * 6);       // grain boundary
      const grain = Math.sin((u * Math.cos(best.a) + v * Math.sin(best.a)) * best.f * 6.283) * 0.022;
      const l = Math.max(0, Math.min(1, best.l + grain - (1 - edge) * 0.07));
      const k = (y * size + x) * 4, c = Math.round(l * 255);
      ic.data[k] = c; ic.data[k + 1] = c; ic.data[k + 2] = Math.min(255, c + 4); ic.data[k + 3] = 255;
      const r = Math.round((0.2 + (0.93 - best.l) * 1.6 + (1 - edge) * 0.12) * 255);
      ir.data[k] = r; ir.data[k + 1] = r; ir.data[k + 2] = r; ir.data[k + 3] = 255;
    }
    gc.putImageData(ic, 0, 0); gr.putImageData(ir, 0, 0);
    const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); return t; };
    return { map: mk(col, true), rough: mk(rgh, false) };
  }
  const spg = spangle(small ? 256 : 384, small ? 10 : 14, 1702);
  spg.map.repeat.set(3, 2); spg.rough.repeat.set(3, 2);
  const spgSpiral = { map: spg.map.clone(), rough: spg.rough.clone() };
  spgSpiral.map.repeat.set(5, 2.5); spgSpiral.rough.repeat.set(5, 2.5);
  spgSpiral.map.needsUpdate = spgSpiral.rough.needsUpdate = true;

  // Galvanised sheet: metal with per-crystal roughness; the spiral duct shares the same zinc, tiled tighter.
  const steel = new THREE.MeshPhysicalMaterial({ color: 0xdfe4e8, map: spg.map, roughnessMap: spg.rough, metalness: 1, roughness: 1 });
  const steelSpiral = new THREE.MeshPhysicalMaterial({ color: 0xdfe4e8, map: spgSpiral.map, roughnessMap: spgSpiral.rough, metalness: 1, roughness: 1 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x8b939b, metalness: 1, roughness: 0.42 });
  const inside = new THREE.MeshStandardMaterial({ color: 0x15181b, metalness: 0.6, roughness: 0.7, side: THREE.BackSide });
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x0a63c9, metalness: 0.55, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.25 }); // RAL 5017 powder coat
  const bolt = new THREE.MeshStandardMaterial({ color: 0xeef1f4, metalness: 1, roughness: 0.2 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0d0f, roughness: 1 });

  const run = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = run) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const BOLT = new THREE.SphereGeometry(0.022, 10, 8);

  // ---------- rectangular duct with flanges (along X) ----------
  function rectDuct(len, h, d, x, y) {
    const g = new THREE.Group();
    add(new THREE.BoxGeometry(len, h, d), steel, 0, 0, 0, g);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.07, h + 0.1, d + 0.1), steelDark, s * (len / 2 - 0.035), 0, 0, g);
      for (const [by, bz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(BOLT, bolt, s * (len / 2 + 0.005), by * (h / 2 + 0.02), bz * (d / 2 + 0.02), g);
    }
    for (let i = 1; i < 4; i++) add(new THREE.BoxGeometry(0.018, h + 0.012, d + 0.012), steelDark, -len / 2 + (len / 4) * i, 0, 0, g); // stiffener beads
    for (const [cy, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(new THREE.BoxGeometry(len - 0.14, 0.016, 0.016), steelDark, 0, cy * h / 2, cz * d / 2, g); // Pittsburgh corner seams
    g.position.set(x, y, 0); run.add(g); return g;
  }

  const R = 0.3, bend = 0.62, topY = 1.0, riserX = 1.05;

  rectDuct(2.3, 0.56, 0.62, riserX - bend - 0.2 - 1.15 - 0.12, topY);
  add(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.24, 48, 1, true), steelDark, riserX - bend - 0.12, topY, 0).rotation.z = Math.PI / 2;
  add(new THREE.TorusGeometry(R + 0.02, 0.018, 10, 48), steelDark, riserX - bend - 0.005, topY, 0).rotation.y = Math.PI / 2;

  // segmented (gored) elbow
  const ec = new THREE.Vector3(riserX - bend, topY - bend, 0);
  add(new THREE.TorusGeometry(bend, R, 40, 64, Math.PI / 2), steel, ec.x, ec.y, 0);
  const zAxis = new THREE.Vector3(0, 0, 1), tangent = new THREE.Vector3();
  for (let i = 0; i <= 4; i++) {
    const a = (Math.PI / 2) * (i / 4);
    const seam = add(new THREE.TorusGeometry(R + 0.006, 0.012, 8, 48), steelDark, ec.x + bend * Math.cos(a), ec.y + bend * Math.sin(a), 0);
    seam.quaternion.setFromUnitVectors(zAxis, tangent.set(-Math.sin(a), Math.cos(a), 0));
  }

  // vertical spiral riser + blue band
  const riserTop = ec.y, riserLen = 0.95;
  add(new THREE.CylinderGeometry(R, R, riserLen, 64, 1, true), steelSpiral, riserX, riserTop - riserLen / 2, 0);
  add(new THREE.CylinderGeometry(R - 0.004, R - 0.004, riserLen, 32, 1, true), inside, riserX, riserTop - riserLen / 2, 0);
  add(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.42, 64), blue, riserX, riserTop - riserLen + 0.25, 0);
  { // raised helical lock seam (one continuous helix, as on a real spiral duct)
    const turns = 2.6, pts = [];
    for (let i = 0; i <= 120; i++) { const t = i / 120, a = t * turns * Math.PI * 2; pts.push(new THREE.Vector3(riserX + (R + 0.004) * Math.cos(a), riserTop - t * (riserLen - 0.44), (R + 0.004) * Math.sin(a))); }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), small ? 160 : 260, 0.009, 6, false), steelDark);
  }

  // grille box with louvres
  const gy = riserTop - riserLen - 0.38;
  const box = new THREE.Group(); box.position.set(riserX, gy, 0); run.add(box);
  add(new THREE.BoxGeometry(0.78, 0.76, 0.7), steel, 0, 0, 0, box);
  const bezel = new THREE.Shape(); bezel.moveTo(-0.39, -0.38); bezel.lineTo(0.39, -0.38); bezel.lineTo(0.39, 0.38); bezel.lineTo(-0.39, 0.38); bezel.lineTo(-0.39, -0.38);
  const hole = new THREE.Path(); hole.moveTo(-0.31, -0.3); hole.lineTo(0.31, -0.3); hole.lineTo(0.31, 0.3); hole.lineTo(-0.31, 0.3); hole.lineTo(-0.31, -0.3); bezel.holes.push(hole);
  add(new THREE.ExtrudeGeometry(bezel, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }), steelDark, 0, 0, 0.35, box);
  add(new THREE.PlaneGeometry(0.62, 0.6), black, 0, 0, 0.352, box);
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.6, 0.075, 0.014), steel, 0, 0.25 - i * 0.1, 0.38, box).rotation.x = -0.65;
  for (const [bx, by] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(BOLT, bolt, bx * 0.35, by * 0.34, 0.42, box);

  rectDuct(2.3, 0.5, 0.56, riserX - 0.39 - 1.15 - 0.02, gy - 0.05);

  // blue slanted plate (the mark's spine)
  const spine = new THREE.Shape();
  spine.moveTo(0, -0.22); spine.lineTo(0.34, 0.08); spine.lineTo(0.34, 2.5); spine.lineTo(0, 2.3); spine.lineTo(0, -0.22);
  add(new THREE.ExtrudeGeometry(spine, { depth: 0.62, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 }), blue, -2.57, gy - 0.3, -0.31);

  // ---------- merge static meshes: one draw call per material ----------
  run.updateMatrixWorld(true);
  const byMat = new Map();
  const meshes = [];
  run.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.clearGroups();
    g.applyMatrix4(m.matrixWorld);
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(g);
  }
  for (const m of meshes) m.removeFromParent();
  for (const child of [...run.children]) run.remove(child); // empty helper groups
  const usedGeos = new Set(meshes.map(m => m.geometry));
  usedGeos.forEach(g => g.dispose());
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list, false);
    list.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    run.add(mesh);
  }

  // ---------- air particles leaving the grille ----------
  const N = small ? 40 : 70;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N);
  const spawn = i => {
    pos[i * 3] = riserX + (Math.random() - 0.5) * 0.56; pos[i * 3 + 1] = gy + (Math.random() - 0.5) * 0.56; pos[i * 3 + 2] = 0.42;
    vel[i * 3] = (Math.random() - 0.5) * 0.12; vel[i * 3 + 1] = -0.08 - Math.random() * 0.12; vel[i * 3 + 2] = 0.45 + Math.random() * 0.4;
    life[i] = 0;
  };
  for (let i = 0; i < N; i++) { spawn(i); life[i] = Math.random() * 2.2; for (let k = 0; k < 3; k++) pos[i * 3 + k] += vel[i * 3 + k] * life[i]; }
  const pgeo = new THREE.BufferGeometry(); pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(160,205,255,1)'); r.addColorStop(1, 'rgba(160,205,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const air = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: 0.07, map: dotTex, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x6fb0ff }));
  air.frustumCulled = false; // positions change every frame
  run.add(air);

  // ---------- contact shadow ----------
  const shTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;

  // ---------- centre & lights ----------
  run.remove(air); // keep particles out of the bounds
  const bb = new THREE.Box3().setFromObject(run); const ctr = bb.getCenter(new THREE.Vector3()); const size = bb.getSize(new THREE.Vector3());
  run.add(air);
  run.position.sub(ctr);
  const pivot = new THREE.Group(); pivot.add(run); scene.add(pivot);
  shadow.position.y = -size.y / 2 - 0.25; pivot.add(shadow);

  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x101418, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x2f7dff, 2.4); rim.position.set(-5, 2, -4); scene.add(rim);
  const fill = new THREE.PointLight(0x4d9bff, 6, 8); fill.position.set(-2, -1, 2.5); scene.add(fill);

  const baseYaw = -0.5, basePitch = 0.16;
  pivot.rotation.set(basePitch, baseYaw, 0);

  // ---------- sizing ----------
  let running = false, contextLost = false;
  function resize() {
    const w = holder.clientWidth, h = holder.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const distH = (size.y * 1.3) / 2 / Math.tan(vFov / 2);
    const distW = (size.x * 1.25) / 2 / Math.tan(vFov / 2) / camera.aspect;
    camera.position.set(0, 0.35, Math.max(distH, distW));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (!running) renderer.render(scene, camera);
  }

  // ---------- loop ----------
  let visible = true, last = performance.now(), t = 0;
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  art.addEventListener('pointermove', e => {
    const r = art.getBoundingClientRect();
    target.x = (e.clientX - r.left) / r.width - 0.5; target.y = (e.clientY - r.top) / r.height - 0.5;
  }, { passive: true });
  art.addEventListener('pointerleave', () => { target.x = 0; target.y = 0; });

  // scroll-linked framing: as the hero scrolls away the run turns and settles (one number, read per frame)
  let scrollK = 0;
  const onScroll = () => { const r = art.getBoundingClientRect(); scrollK = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height))); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  let frames = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now; t += dt;
    cur.x += (target.x - cur.x) * 0.05; cur.y += (target.y - cur.y) * 0.05;
    pivot.rotation.y = baseYaw + Math.sin(t * 0.25) * 0.22 + cur.x * 0.35 + scrollK * 0.55;
    pivot.rotation.x = basePitch + cur.y * 0.12 + scrollK * 0.18;
    for (let i = 0; i < N; i++) {
      life[i] += dt;
      if (life[i] > 2.4) spawn(i);
      else { const j = i * 3; pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt; }
    }
    pgeo.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
    if (debug && ++frames % 120 === 0) console.info(`[hero3d] ${renderer.info.render.calls} draw calls, ${renderer.info.render.triangles} triangles, ${renderer.info.memory.textures} textures`);
  }
  function play() { if (running || contextLost || reduce.matches || !visible || document.hidden) return; running = true; last = performance.now(); renderer.setAnimationLoop(frame); }
  function stop() { running = false; renderer.setAnimationLoop(null); }

  air.visible = !reduce.matches;
  reduce.addEventListener('change', () => { air.visible = !reduce.matches; if (reduce.matches) { stop(); pivot.rotation.set(basePitch, baseYaw, 0); renderer.render(scene, camera); } else play(); });

  // compile every program before the first visible frame (no hitch when it fades in)
  resize();
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  if (debug) console.info(`[hero3d] first frame: ${renderer.info.render.calls} draw calls, ${renderer.info.render.triangles} triangles`);

  new IntersectionObserver(es => { visible = es[0].isIntersecting; visible ? play() : stop(); }).observe(art);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : play()));
  new ResizeObserver(resize).observe(holder);

  const tag = art.querySelector('.hero-tag');
  const fallbackLabel = tag && tag.textContent;
  const show3d = () => {
    art.classList.add('is-3d');
    if (tag && tag.dataset.label3d) tag.textContent = tag.dataset.label3d;
  };
  // Mobile GPU resets must reveal the existing static visual, never an empty canvas.
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    stop();
    art.classList.remove('is-3d');
    if (tag) tag.textContent = fallbackLabel;
  });
  renderer.domElement.addEventListener('webglcontextrestored', async () => {
    try {
      await renderer.compileAsync(scene, camera);
      resize();
      renderer.render(scene, camera);
      contextLost = false;
      show3d();
      play();
    } catch (error) {
      console.warn('[hero3d] static fallback kept after GPU reset:', error.message);
    }
  });
  show3d();
  play();
}

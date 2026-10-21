// 3D view of the demo assembly. Loaded on demand by boot.js; three.js itself is imported inside createViewer()
// through the page's import map, so nothing 3D is downloaded before the section approaches the viewport.
//
// Geometry comes from geometry.js and placement from assembly.js (the same code as the SVG preview and the tests).
// Rendering is on demand: a frame is drawn only while the camera moves or something changed; there is no idle loop.
// Quality: two profiles (desktop / mobile) and a pixel ratio adjusted conservatively from measured frame times.
// WebGL context loss (common on Android) shows the static drawing until the context is restored.

import { buildPart, partKey } from './geometry.js';
import { solveAssembly, explodeOffsets, DEFAULT_VIEW_DIR } from './assembly.js';
import { createMotion, smoothstep, INTRO_DURATION_MS, INTRO_ORBIT_RAD, INTRO_EXPLODE_FROM_MS } from './motion.js';
import { toScene, vNorm } from './units.js';

/** @typedef {{ host: HTMLElement, assembly: any, onSelect: (id: string) => void, onLost?: () => void, onRestored?: () => void,
 *  onDiag?: (patch: object) => void, onMotion?: (state: object) => void, debug?: boolean, simulate?: string|null }} ViewerOptions
 *  simulate (development diagnostics only, ?debug3d=1&simulate=…): "init" renderer failure, "blank" empty first frame, "lost" context loss + restore. */
/** @typedef {{ setSelected: (id: string|null) => void, rotate: (deg: number) => void, zoom: (factor: number) => void, reset: () => void, playIntro: () => void, skipIntro: () => void, explode: (immediate?: boolean) => void, reassemble: (immediate?: boolean) => void, interrupt: () => void, destroy: () => void, stats: () => object }} Viewer */

const PROFILES = {
  desktop: { antialias: true, dprMax: 2, segments: 16 },
  mobile: { antialias: false, dprMax: 1.5, segments: 10 },
};
/** A first frame counts as rendered only if at least this share of the sampled pixels was actually drawn. */
export const MIN_PAINTED = 0.01;

/** Share of pixels with visible alpha in an RGBA buffer (the canvas is cleared to transparent), sampling every `stride`-th pixel. */
export function paintedFraction(rgba, stride = 3) {
  let n = 0, hit = 0;
  for (let i = 3; i < rgba.length; i += 4 * stride) { n++; if (rgba[i] > 8) hit++; }
  return n ? hit / n : 0;
}

/** Build the part meshes exactly as shown: one shared BufferGeometry per distinct part (positions in metres),
 *  placed by its solved installed transform. Needs only three.js maths, so it also runs in Node tests.
 *  @param {any} THREE three.js module @param {any} assembly @param {number} segments elbow subdivisions @param {any} material
 *  @returns {{ root: any, meshes: Map<string, any>, geometries: any[], center: any, size: any, radius: number }} */
export function buildScene(THREE, assembly, segments, material) {
  const solved = solveAssembly(assembly);
  const cache = new Map();
  const root = new THREE.Group();
  const meshes = new Map();
  for (const c of assembly.components) {
    const k = partKey(c, assembly.settings, segments);
    let geo = cache.get(k);
    if (!geo) {
      const m = buildPart(c, assembly.settings, { segments });
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions.map(toScene), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
      for (const g of m.groups) geo.addGroup(g.start, g.count, g.material === 'sheet' ? 0 : 1);
      geo.computeBoundingSphere();
      cache.set(k, geo);
    }
    const mesh = new THREE.Mesh(geo, material);
    const { r, t } = solved.parts.get(c.id).installed;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.set(r[0], r[1], r[2], toScene(t[0]), r[3], r[4], r[5], toScene(t[1]), r[6], r[7], r[8], toScene(t[2]), 0, 0, 0, 1);
    mesh.userData.partId = c.id;
    root.add(mesh); meshes.set(c.id, mesh);
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  return { root, meshes, geometries: [...cache.values()], center, size, box, radius: size.length() / 2 };
}

/** Share of the frame the home view fills (largest of width / height). */
export const HOME_FILL = 0.8;

/** Camera distance along `dir` (unit vector from the centre) at which the projected assembly fills `fill` of the
 *  frame. Fitted to the real vertices, not to a bounding sphere (which left the assembly at about half the frame).
 *  Leaves the camera at that position, looking at the centre. */
export function homeDistance(THREE, camera, meshes, center, dir, fill = HOME_FILL) {
  const pts = [], v = new THREE.Vector3();
  for (const m of meshes.values()) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).clone()); }
  const extent = d => {
    camera.position.copy(center).addScaledVector(dir, d); camera.lookAt(center);
    camera.near = d / 100; camera.far = d * 10; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    let e = 0; for (const q of pts) { v.copy(q).project(camera); e = Math.max(e, Math.abs(v.x), Math.abs(v.y)); }
    return e;
  };
  const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
  let d = pts.reduce((r, q) => Math.max(r, q.distanceTo(center)), 0) / Math.sin(Math.min(vf, hf)); // sphere fit: always fully visible
  for (let i = 0; i < 6; i++) d *= extent(d) / fill; // perspective is close to 1/d: converges in a few steps
  extent(d);
  return d;
}

/** Place every part at an explode factor: solved installed transform + offset × factor, written fresh each time
 *  (never accumulated). @param {Map<string, any>} meshes @param {any} solved @param {Map<string, number[]>} offsets */
export function applyPose(meshes, solved, offsets, factor, root) {
  for (const [id, mesh] of meshes) {
    const d = offsets.get(id), t = solved.parts.get(id).installed.t, e = mesh.matrix.elements;
    e[12] = toScene(t[0] + d[0] * factor); e[13] = toScene(t[1] + d[1] * factor); e[14] = toScene(t[2] + d[2] * factor);
    mesh.matrixWorldNeedsUpdate = true;
  }
  root.updateMatrixWorld(true);
}

/** Share of the frame the fully exploded assembly fills (it needs more room than the 80 % home view). */
export const EXPLODED_FILL = 0.85;

/** Camera distance along `dir` at which the FULLY EXPLODED assembly fills `fill` of the frame, measured on the
 *  real exploded vertices. The parts are put back at `restoreFactor` afterwards; `camera` is not moved. */
export function explodedDistance(THREE, camera, sc, solved, offsets, dir, restoreFactor = 0, fill = EXPLODED_FILL) {
  applyPose(sc.meshes, solved, offsets, 1, sc.root);
  const d = homeDistance(THREE, camera.clone(), sc.meshes, sc.center, dir, fill);
  applyPose(sc.meshes, solved, offsets, restoreFactor, sc.root);
  return d;
}

/** Zoom-out ratio for the intro: the largest exploded fit over the camera angles the intro passes through while the
 *  parts are apart, relative to the home distance. */
export function introZoom(THREE, camera, sc, solved, offsets, homeDir, homeDist) {
  let need = homeDist;
  const axis = new THREE.Vector3(0, 1, 0);
  for (let t = INTRO_EXPLODE_FROM_MS; t <= INTRO_DURATION_MS; t += 100) {
    const dir = homeDir.clone().applyAxisAngle(axis, smoothstep(t / INTRO_DURATION_MS) * INTRO_ORBIT_RAD);
    need = Math.max(need, explodedDistance(THREE, camera, sc, solved, offsets, dir, 0));
  }
  return need / homeDist;
}

/** @param {ViewerOptions} opts @returns {Promise<Viewer>} */
export async function createViewer({ host, assembly, onSelect, onLost, onRestored, onDiag = () => {}, onMotion = () => {}, debug = false, simulate = null }) {
  const t0 = performance.now();
  const [THREE, { OrbitControls }, { RoomEnvironment }] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/environments/RoomEnvironment.js'),
  ]);
  const profile = matchMedia('(max-width: 860px), (pointer: coarse)').matches ? PROFILES.mobile : PROFILES.desktop;
  onDiag({ status: `creating renderer (three r${THREE.REVISION}, ${profile === PROFILES.mobile ? 'mobile' : 'desktop'} profile)` });
  if (simulate === 'init') throw new Error('simulated renderer failure (debug)');

  // ---------- renderer ----------
  let shaderFailed = false;
  const shaderErrors = [];
  const renderer = new THREE.WebGLRenderer({ antialias: profile.antialias, alpha: true, powerPreference: 'default' });
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    shaderFailed = true;
    let log = '';
    try { log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].map(s => (s || '').trim()).filter(Boolean).join(' | '); } catch { /* context gone */ }
    shaderErrors.push((log || 'program failed to link (no log)').slice(0, 300));
    onDiag({ shaderErrors: shaderErrors.slice() });
  };
  const dprBase = Math.min(devicePixelRatio || 1, profile.dprMax);
  let dpr = dprBase;
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  const canvas = renderer.domElement;
  const loseExt = simulate === 'lost' ? renderer.getContext().getExtension('WEBGL_lose_context') : null; // must be taken before a loss
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  let envTex = null;
  const makeEnv = () => {
    if (envTex) envTex.dispose();
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    envTex = pmrem.fromScene(room, 0.04).texture;
    room.dispose(); pmrem.dispose();
    scene.environment = envTex;
  };
  makeEnv();
  scene.environmentIntensity = 0.9;
  scene.add(new THREE.HemisphereLight(0xe8ecef, 0x2b2f33, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 6, 4); scene.add(key);

  // ---------- materials: galvanised sheet, darker frame flanges, and their selected variants ----------
  const sheet = new THREE.MeshStandardMaterial({ color: 0xc7ced5, metalness: 0.7, roughness: 0.42 });
  const flange = new THREE.MeshStandardMaterial({ color: 0x8b949d, metalness: 0.65, roughness: 0.5 });
  const pick = m => { const c = m.clone(); c.emissive.set(0x0066cc); c.emissiveIntensity = 0.45; return c; };
  const BASE = [sheet, flange], SELECTED = [pick(sheet), pick(flange)];

  // ---------- parts: one shared BufferGeometry per distinct part, placed by its installed transform ----------
  const sc = buildScene(THREE, assembly, profile.segments, BASE);
  const { root, meshes, geometries, center, size, box } = sc;
  scene.add(root);
  const solved = solveAssembly(assembly);
  const offsets = explodeOffsets(assembly, solved);
  const applyExplode = factor => applyPose(meshes, solved, offsets, factor, root);
  // soft contact shadow under the assembly (one textured quad, no shadow maps)
  const shTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const shadowGeo = new THREE.PlaneGeometry(1, 1), shadowMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(size.x * 1.5, size.z * 1.5, 1);
  shadow.position.set(center.x, box.min.y - 0.01, center.z);
  scene.add(shadow);

  // ---------- camera & controls ----------
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const viewDir = new THREE.Vector3(...vNorm(DEFAULT_VIEW_DIR));
  let homeDist = 1;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false; // keeps the assembly centred; 360° orbit and zoom only
  controls.target.copy(center);
  function home() {
    homeDist = homeDistance(THREE, camera, meshes, center, viewDir);
    // at maxDistance the whole assembly is visible from any orbit angle (beyond the bounding-sphere fit; unit-tested)
    controls.minDistance = homeDist * 0.35; controls.maxDistance = homeDist * 2.6;
    controls.target.copy(center);
    camera.far = homeDist * 30; camera.updateProjectionMatrix();
    controls.update();
  }

  // ---------- deterministic motion (visible-frame clock, interruptible, no GSAP dependency) ----------
  // The camera backs off as the parts separate: its distance is interpolated between the assembled distance and a
  // distance fitted to the real exploded shape (seen from the current direction), so no part leaves the frame.
  const motion = createMotion(onMotion);
  const homeOffset = new THREE.Vector3();
  const orbitAxis = new THREE.Vector3(0, 1, 0);
  let zoomIntro = 1;                 // intro: distance ratio at full separation (fitted along the intro's orbit)
  let span = null;                   // explode / reassemble: { near, far } camera distances
  const viewDirNow = () => camera.position.clone().sub(controls.target).normalize();
  const setDistance = d => { camera.position.copy(controls.target).addScaledVector(viewDirNow(), d); };
  function spanFor(factor) {
    // keep the distance the visitor chose for the assembled view; fit the exploded one from this direction
    const d = camera.position.distanceTo(controls.target);
    const far = Math.max(d, explodedDistance(THREE, camera, sc, solved, offsets, viewDirNow(), factor));
    const near = factor === 0 ? d : (span ? span.near : homeDist);
    return { near: Math.min(near, far), far };
  }
  const distanceAt = f => span.near + (span.far - span.near) * f;
  function settle(state) { // apply an end state: parts and camera exactly where that state puts them
    applyExplode(state.factor);
    if (span) setDistance(distanceAt(state.factor));
  }
  function stopMotion() {
    if (!motion.state().running) return;
    const wasIntro = motion.state().mode === 'intro';
    const s = motion.interrupt(); // intro → assembled; explode / reassemble → finished
    if (wasIntro) { applyExplode(0); setDistance(homeDist); } else settle(s);
    controls.update(); lastFrame = 0; invalidate();
  }
  function updateMotion(dt) {
    const state = motion.tick(dt);
    applyExplode(state.factor);
    if (state.mode === 'intro') {
      camera.position.copy(center).add(homeOffset.clone().applyAxisAngle(orbitAxis, state.orbitRad).multiplyScalar(1 + (zoomIntro - 1) * state.factor));
      camera.lookAt(center);
    } else if (span && (state.mode === 'explode' || state.mode === 'reassemble' || state.mode === 'idle')) setDistance(distanceAt(state.factor));
    return state.running;
  }

  // ---------- render on demand + frame-time based pixel ratio ----------
  let raf = 0, active = true, lost = false, lastFrame = 0, frames = [], disposed = false;
  let rendered = 0, lostCount = 0, restoredCount = 0, painted = null, selectedId = null;
  const draw = () => { renderer.render(scene, camera); rendered++; };
  function invalidate() { if (!raf && active && !lost && !disposed) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    const dt = lastFrame ? Math.min(80, Math.max(0, now - lastFrame)) : 0;
    const animating = motion.state().running ? updateMotion(dt) : false;
    const moving = controls.update();
    draw();
    if (lastFrame && now - lastFrame < 100) adapt(now - lastFrame); else frames = [];
    lastFrame = now;
    if (moving || animating) invalidate();
  }
  function adapt(dt) {
    frames.push(dt);
    if (frames.length < 30) return;
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length; frames = [];
    let next = dpr;
    if (avg > 34 && dpr > 1) next = Math.max(1, dpr - 0.25);              // under ~30 fps: lower resolution
    else if (avg < 18 && dpr < dprBase) next = Math.min(dprBase, dpr + 0.25); // comfortably fast: restore
    if (next !== dpr) { dpr = next; renderer.setPixelRatio(dpr); resize(); }
  }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    invalidate();
  }
  controls.addEventListener('change', invalidate);

  // ---------- selection by click / tap (a drag rotates instead) ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null, selected = null;
  const pointers = new Set(); // a pinch (two fingers) must never select a part
  const onDown = e => { stopMotion(); pointers.add(e.pointerId); down = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId } : null; };
  const onCancel = e => { pointers.delete(e.pointerId); down = null; };
  const onUp = e => {
    pointers.delete(e.pointerId);
    if (!down || e.pointerId !== down.id || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600) { down = null; return; }
    down = null;
    const rc = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...meshes.values()], false)[0];
    if (hit) onSelect(hit.object.userData.partId);
  };
  const onWheel = () => stopMotion();
  canvas.addEventListener('wheel', onWheel, { passive: true });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  // ---------- lifecycle: visibility, resize, context loss ----------
  const setActive = on => { active = on; if (!on && raf) { cancelAnimationFrame(raf); raf = 0; } lastFrame = 0; if (on) invalidate(); };
  const io = new IntersectionObserver(es => { onScreen = es[0].isIntersecting; setActive(onScreen && !document.hidden); }, { rootMargin: '200px 0px' });
  let onScreen = true;
  const onVis = () => setActive(onScreen && !document.hidden);
  const ro = new ResizeObserver(resize);
  const onLostEv = e => {
    e.preventDefault(); lost = true; lostCount++;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    lastFrame = 0;
    onDiag({ contextEvent: `lost at ${Math.round(performance.now())} ms` });
    onLost && onLost();
    if (simulate === 'lost' && loseExt) setTimeout(() => loseExt.restoreContext(), 2000);
  };
  const onRestoredEv = () => {
    lost = false; restoredCount++; makeEnv();
    onDiag({ contextEvent: `restored at ${Math.round(performance.now())} ms` });
    onRestored && onRestored(); invalidate();
  };
  canvas.addEventListener('webglcontextlost', onLostEv);
  canvas.addEventListener('webglcontextrestored', onRestoredEv);

  function destroy() {
    if (disposed) return;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    io.disconnect(); ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('webglcontextlost', onLostEv); canvas.removeEventListener('webglcontextrestored', onRestoredEv);
    controls.dispose();
    for (const g of geometries) g.dispose();
    for (const m of [...BASE, ...SELECTED, shadowMat]) m.dispose();
    shadowGeo.dispose(); shTex.dispose(); if (envTex) envTex.dispose();
    renderer.dispose(); renderer.forceContextLoss();
    canvas.remove();
  }

  // ---------- first frame ----------
  // A WebGL context that initialises is NOT proof of a rendered image (software rasterisers can fail to link
  // shaders and draw nothing). The first frame is read back and must contain drawn pixels.
  resize();
  home();
  try {
    onDiag({ status: 'compiling shaders' });
    await renderer.compileAsync(scene, camera);
    if (shaderFailed) throw new Error('shader compilation or linking failed');
    onDiag({ status: 'checking the first frame' });
    draw();
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const sw = Math.max(1, Math.floor(w / 2)), sh = Math.max(1, Math.floor(h / 2)); // centre half, where the assembly sits
    const px = new Uint8Array(sw * sh * 4);
    gl.readPixels(Math.floor(w / 4), Math.floor(h / 4), sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    painted = simulate === 'blank' ? 0 : paintedFraction(px);
    onDiag({ painted });
    if (shaderFailed) throw new Error('shader compilation or linking failed');
    if (gl.isContextLost()) throw new Error('context lost during the first frame');
    if (painted < MIN_PAINTED) throw new Error(`first frame is empty (${(painted * 100).toFixed(2)} % of sampled pixels drawn)${simulate === 'blank' ? ' — simulated' : ''}`);
  } catch (e) { destroy(); throw e; }
  const initMs = Math.round(performance.now() - t0);
  homeOffset.copy(camera.position).sub(center);
  zoomIntro = introZoom(THREE, camera, sc, solved, offsets, viewDir, homeDist);
  io.observe(host);
  document.addEventListener('visibilitychange', onVis);
  ro.observe(host);

  /** @type {Viewer} */
  const api = {
    setSelected(id) {
      selectedId = id || null;
      if (selected) selected.material = BASE;
      selected = id ? meshes.get(id) || null : null;
      if (selected) selected.material = SELECTED;
      invalidate();
    },
    rotate(deg) {
      stopMotion();
      const off = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
      camera.position.copy(controls.target).add(off); controls.update(); invalidate();
    },
    zoom(factor) {
      stopMotion();
      const off = camera.position.clone().sub(controls.target);
      off.setLength(THREE.MathUtils.clamp(off.length() * factor, controls.minDistance, controls.maxDistance));
      camera.position.copy(controls.target).add(off); controls.update(); invalidate();
    },
    reset() { motion.skip(); span = null; applyExplode(0); home(); homeOffset.copy(camera.position).sub(center); invalidate(); },
    playIntro() { motion.skip(); span = null; applyExplode(0); home(); homeOffset.copy(camera.position).sub(center); motion.playIntro(); lastFrame = 0; invalidate(); },
    skipIntro() { if (motion.state().mode === 'intro') stopMotion(); },
    explode(immediate = false) {
      if (motion.state().mode === 'intro') stopMotion();
      span = spanFor(motion.state().factor);
      settle(motion.explode(immediate)); controls.update(); lastFrame = 0; invalidate();
    },
    reassemble(immediate = false) {
      if (motion.state().mode === 'intro') stopMotion();
      if (!span) span = spanFor(motion.state().factor);
      else span = { near: span.near, far: camera.position.distanceTo(controls.target) }; // keep any zoom made while exploded
      settle(motion.reassemble(immediate)); controls.update(); lastFrame = 0; invalidate();
    },
    interrupt: stopMotion,
    destroy,
    stats: () => ({
      initMs, dpr, profile: profile === PROFILES.mobile ? 'mobile' : 'desktop', frames: rendered, painted, selected: selectedId, motion: motion.state().mode, explodeFactor: motion.state().factor,
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      buffer: [renderer.getContext().drawingBufferWidth, renderer.getContext().drawingBufferHeight], css: [host.clientWidth, host.clientHeight],
      contextLost: lostCount, contextRestored: restoredCount, shaderErrors: shaderErrors.slice(),
    }),
  };
  if (debug) console.info('[assembly3d]', JSON.stringify(api.stats()));
  if (simulate === 'lost' && loseExt) setTimeout(() => loseExt.loseContext(), 2000);
  return api;
}

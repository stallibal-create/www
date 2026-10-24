// LIBALSTAL V3 — interactive emblem viewer (plain JS + three.js r170 + optional GSAP 3). PROTOTYPE, not wired into
// the site yet. Works with any GLB that follows v3/glb-contract.json (the Blender export or the grey-box proxy):
// nothing here is hard-coded per model — parts, pivots, hinge axes and exploded offsets all come from
// node.userData.libalstal (glTF extras), materials are matched by contract name.
//
//   const v = await createEmblemViewer(el, { glbUrl, pathsUrl, gsap, ScrollTrigger });
//   v.explode(1) · v.assemble() · v.setAirflow(true) · v.reset() · v.bindScroll(sectionEl) · v.dispose()
//
// Imports go through the page's import map ('three', 'three/addons/'), like hero3d.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Real-time stand-ins for the contract's material names (the Blender PBR textures replace these later).
const LOOK = {
  galvanised: { color: 0xc4cad0, metalness: 1, roughness: 0.36 },
  galvanised_flange: { color: 0xa9b1b8, metalness: 1, roughness: 0.42 },
  stainless_brushed: { color: 0xd8dce0, metalness: 1, roughness: 0.2 },
  ral5017_coat: { color: 0x005b9f, metalness: 0.15, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 },   // RAL 5017 traffic blue ≈ #005B8C–#00609F
  gasket: { color: 0x1a1a1a, metalness: 0, roughness: 0.85 },
  interior: { color: 0x16191c, metalness: 0.4, roughness: 0.8 },
};

/**
 * @param {HTMLElement} el container (the canvas fills it)
 * @param {{glbUrl:string, pathsUrl?:string, gsap?:any, ScrollTrigger?:any, reducedMotion?:boolean, onReady?:Function}} o
 */
export async function createEmblemViewer(el, o) {
  const reduce = o.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gsap = o.gsap || null;

  // ---------- renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!o.preserveDrawingBuffer });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y';
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture; room.dispose(); pmrem.dispose();
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-1, 2, 3); scene.add(key);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);

  // ---------- model
  const gltf = await new GLTFLoader().loadAsync(o.glbUrl);
  const root = gltf.scene.getObjectByName('LIBALSTAL_emblem') || gltf.scene;
  const pivot = new THREE.Group(); scene.add(pivot);
  const box = new THREE.Box3().setFromObject(root), centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  root.position.sub(centre); pivot.add(root);                       // turntable around the emblem's centre
  const mats = {};
  root.traverse(n => {
    if (!n.isMesh) return;
    const name = n.material?.name, look = LOOK[name];
    if (look) n.material = mats[name] ||= Object.assign(new THREE.MeshPhysicalMaterial({ ...look, side: THREE.DoubleSide }), { name });
    else n.material.side = THREE.DoubleSide;
  });
  const parts = [];
  root.traverse(n => {
    const x = n.userData?.libalstal;
    if (!x) return;
    parts.push({ node: n, part: x.part, dof: x.dof, rest: n.position.clone(), restQ: n.quaternion.clone(),
      explode: new THREE.Vector3(...(x.explode || [0, 0, 0])), axis: x.axis ? new THREE.Vector3(...x.axis) : null });
  });
  const louvres = parts.filter(p => /^louvre_/.test(p.part));

  // ---------- framing
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const home = { az: -0.38, el: 0.16 };
  let dist = 1;
  function frame() {
    const r = size.length() / 2 * 1.3;                                  // bounding sphere, with room for the exploded view
    const hfov = 2 * Math.atan(Math.tan(fov / 2) * camera.aspect);      // fit whichever of width/height is tighter
    dist = r / Math.sin(Math.min(fov, hfov) / 2);
  }
  function placeCamera(az, elv) {
    camera.position.set(Math.sin(az) * Math.cos(elv), Math.sin(elv), Math.cos(az) * Math.cos(elv)).multiplyScalar(dist);
    camera.lookAt(0, 0, 0); controls.target.set(0, 0, 0); controls.update();
  }
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: !reduce, dampingFactor: 0.08, enablePan: false, minPolarAngle: 0.35, maxPolarAngle: 2.3, rotateSpeed: 0.7 });
  function resize() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    frame(); controls.minDistance = dist * 0.5; controls.maxDistance = dist * 1.8;
  }
  resize();
  placeCamera(home.az, home.el);

  // ---------- explode / assemble: one scalar drives every part (0 = assembled logo, 1 = exploded)
  const state = { explode: 0, louvre: 0 };
  function apply() {
    const t = state.explode;
    for (const p of parts) {
      p.node.position.copy(p.rest).addScaledVector(p.explode, t);
      p.node.quaternion.copy(p.restQ);
      if (p.dof === 'hinge' && p.axis && /^elbow_gore_/.test(p.part)) p.node.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(p.axis, t * 0.35));
    }
    for (const p of louvres) p.node.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(p.axis || new THREE.Vector3(1, 0, 0), state.louvre));
  }
  function tweenTo(target, dur, ease = 'power3.inOut') {
    if (reduce || !gsap) { Object.assign(state, target); apply(); return Promise.resolve(); }
    pending++;
    return new Promise(res => gsap.to(state, { ...target, duration: dur, ease, overwrite: true, onUpdate: apply,
      onComplete: res, onInterrupt: res })).finally(() => pending--);
  }
  let pending = 0;

  // ---------- illustrative airflow: dashed tube flowing along the centreline (labelled as such in the UI)
  let flow = null;
  if (o.pathsUrl) {
    try {
      const data = await (await fetch(o.pathsUrl)).json();
      const group = new THREE.Group(); group.visible = false; group.position.copy(centre).negate(); pivot.add(group);
      const uni = { uTime: { value: 0 }, uOpacity: { value: 0 } };
      const mat = new THREE.ShaderMaterial({
        // drawn through the sheet metal (x-ray style): the flow is inside the ducts and would otherwise be hidden
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: uni,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
        fragmentShader: `uniform float uTime, uOpacity; varying vec2 vUv;
          void main(){ float d = fract(vUv.x * 14. - uTime * 1.6); float a = smoothstep(0., .25, d) * (1. - smoothstep(.45, .7, d));
            float edge = 1. - smoothstep(.0, .5, abs(vUv.y - .5)); gl_FragColor = vec4(vec3(.55, .82, 1.), a * uOpacity * (.35 + .65 * edge)); }`,
      });
      for (const pts of Object.values(data.paths || {})) {
        const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), false, 'centripetal');
        const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 200, size.y * 0.03, 10, false), mat); m.renderOrder = 10; group.add(m);
      }
      flow = { group, uni, note: data.note || 'Illustrative airflow — not a CFD simulation.' };
    } catch (e) { console.warn('[emblem-viewer] airflow paths not loaded:', e.message); }
  }
  async function setAirflow(on) {
    if (!flow) return;
    if (on) flow.group.visible = true;
    await tweenTo({ louvre: on ? -0.35 : 0 }, 0.8);
    if (reduce || !gsap) { flow.uni.uOpacity.value = on ? 1 : 0; flow.group.visible = on; return; }
    pending++;
    await new Promise(res => gsap.to(flow.uni.uOpacity, { value: on ? 1 : 0, duration: 0.6, overwrite: true, onComplete: res, onInterrupt: res })).finally(() => pending--);
    if (!on) flow.group.visible = false;
  }

  // ---------- render loop: only while visible and the tab is shown
  const clock = new THREE.Clock();
  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; loop(); }); io.observe(el);
  const onVis = () => loop(); document.addEventListener('visibilitychange', onVis);
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (flow?.group.visible && !reduce) flow.uni.uTime.value += dt;
    controls.update(); renderer.render(scene, camera);
  }
  function loop() { renderer.setAnimationLoop(visible && !document.hidden ? tick : null); }
  const ro = new ResizeObserver(() => { resize(); renderer.render(scene, camera); }); ro.observe(el);
  await renderer.compileAsync(scene, camera); loop();

  // ---------- scroll camera (GSAP ScrollTrigger): orbit + explode as a section scrolls past
  let st = null;
  function bindScroll(trigger, { scrub = 0.6 } = {}) {
    if (!o.ScrollTrigger || !gsap || reduce) return null;
    gsap.registerPlugin(o.ScrollTrigger);
    st = o.ScrollTrigger.create({ trigger, start: 'top top', end: 'bottom bottom', scrub, onUpdate: s => {
      const p = s.progress;
      state.explode = Math.sin(Math.min(1, p * 1.4) * Math.PI) * 0.9; apply();      // explode then re-assemble
      placeCamera(home.az + p * Math.PI * 0.9, home.el + Math.sin(p * Math.PI) * 0.2);
    } });
    return st;
  }

  const api = {
    parts: parts.map(p => p.part), airflowNote: flow?.note || null,
    explode: (v = 1) => tweenTo({ explode: v }, 1.6),
    assemble: () => tweenTo({ explode: 0 }, 1.8, 'power4.inOut'),
    setAirflow,
    async reset() {
      if (flow?.group.visible) await setAirflow(false);
      await tweenTo({ explode: 0, louvre: 0 }, 1);
      placeCamera(home.az, home.el);
    },
    bindScroll,
    renderNow: () => renderer.render(scene, camera),
    idle: () => pending === 0,
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    dispose() {
      renderer.setAnimationLoop(null); io.disconnect(); ro.disconnect(); st?.kill();
      document.removeEventListener('visibilitychange', onVis); controls.dispose();
      scene.traverse(n => { n.geometry?.dispose(); });
      Object.values(mats).forEach(m => m.dispose()); renderer.dispose(); renderer.domElement.remove();
    },
  };
  // Start exploded and assemble on load, unless reduced motion asks for a still logo.
  if (!reduce && gsap) { state.explode = 1; apply(); api.assemble(); }
  o.onReady?.(api);
  return api;
}

// Grey-box ANIMATIC of the v2 transformation: plain shapes posed frame by frame from blender/rig.py's export,
// so the motion reviewed here is exactly the motion the Blender build receives. Not a look-dev or final render.
import * as THREE from 'three';

const q = new URLSearchParams(location.search);
const FMT = q.get('format') || 'desktop';
const RIG = await (await fetch('/rig-frames.json')).json();
const INTRO = await (await fetch('/intro.json')).json();
const C = INTRO.compositions[FMT];
const W = Math.round(C.width / 2), H = Math.round(C.height / 2);   // half resolution: 960×540 / 540×960
const P = RIG.parts;

const host = document.getElementById('stage');
Object.assign(host.style, { width: W + 'px', height: H + 'px' });
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H); renderer.setClearColor(0x0b0d0f);
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xe8ecef, 0x2b2f33, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-4, 6, 8); scene.add(key);
const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 1000);

const grey = new THREE.MeshLambertMaterial({ color: 0xb8bec4 });
const greyDark = new THREE.MeshLambertMaterial({ color: 0x8a9198 });
const blueish = () => new THREE.MeshLambertMaterial({ color: 0xb8bec4 });
const BLUE = new THREE.Color(0x0066cc), GALV = new THREE.Color(0xb8bec4);
const edges = (mesh, c = 0x2b2f33) => { mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), new THREE.LineBasicMaterial({ color: c }))); return mesh; };
const box = (w, h, d, m = grey) => edges(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m));

// ---- rectangular duct run: body + two flange frames, group origin = centre of its outer box
function rectRun(p) {
  const g = new THREE.Group();
  const L = p.x[1] - p.x[0], Ho = p.y[1] - p.y[0], Hb = p.body[1] - p.body[0], D = p.depth, fw = p.flange;
  const cyBody = (p.body[0] + p.body[1]) / 2 - (p.y[0] + p.y[1]) / 2;
  const body = box(L - 2 * fw, Hb, D); body.position.y = cyBody; g.add(body);
  for (const s of [-1, 1]) {
    const f = box(fw, Ho, D + (Ho - Hb), greyDark); f.position.x = s * (L - fw) / 2; g.add(f);
  }
  return g;
}
const topRun = rectRun(P.topRun), bottomRun = rectRun(P.bottomRun);
scene.add(topRun, bottomRun);

// ---- side panel (diagonal cut at its foot) and the wedge below the cut, both RAL 5017 when lit by the flow
function slab(points, thickness, mat) {
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length, cy = points.reduce((a, p) => a + p[1], 0) / points.length;
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x - cx, y - cy)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false }); geo.translate(0, 0, -thickness / 2);
  return edges(new THREE.Mesh(geo, mat));
}
const pan = P.sidePanel, cut = pan.cut;
const panelMat = blueish(), wedgeMat = blueish(), collarMat = blueish();
// the panel's own centre (the rig poses the panel's bounding-box centre)
const panel = new THREE.Group(); scene.add(panel);
{ const pts = [[pan.x[0], pan.y[1]], [pan.x[1], pan.y[1]], [pan.x[1], cut[1][1]], [pan.x[0], cut[0][1]]];
  const m = slab(pts, pan.thickness, panelMat);
  const bcx = (pan.x[0] + pan.x[1]) / 2, bcy = (pan.y[0] + pan.y[1]) / 2, mcx = pts.reduce((a, p) => a + p[0], 0) / 4, mcy = pts.reduce((a, p) => a + p[1], 0) / 4;
  m.position.set(mcx - bcx, mcy - bcy, 0); panel.add(m); }
const wed = P.wedge;
const wedge = new THREE.Group(); scene.add(wedge);
{ const pts = [[wed.x[0], cut[0][1] - 0.08], [wed.x[1], cut[0][1] - 0.08 + (cut[1][1] - cut[0][1]) * (wed.x[1] - wed.x[0]) / (cut[1][0] - cut[0][0])], [wed.x[1], wed.y[0]], [wed.x[0], wed.y[0]]];
  const m = slab(pts, wed.thickness, wedgeMat);
  const bcx = (wed.x[0] + wed.x[1]) / 2, bcy = (wed.y[0] + wed.y[1]) / 2, mcx = pts.reduce((a, p) => a + p[0], 0) / 4, mcy = pts.reduce((a, p) => a + p[1], 0) / 4;
  m.position.set(mcx - bcx, mcy - bcy, 0); wedge.add(m); }

// ---- elbow gores: cylinders along local +X from 0 to L (mitred ends are modelled in Blender)
const gores = RIG.segments.map((L, i) => {
  const geo = new THREE.CylinderGeometry(P.elbow.diameter / 2, P.elbow.diameter / 2, L * 1.04, 32, 1, false);
  geo.rotateZ(-Math.PI / 2); geo.translate(L / 2, 0, 0);
  const m = edges(new THREE.Mesh(geo, i % 2 ? grey : greyDark), 0x40464c); scene.add(m); return m;
});
// ---- collar: cylinder along local +X
const collar = (() => { const r = P.collar.radius, len = P.collar.y[1] - P.collar.y[0];
  const geo = new THREE.CylinderGeometry(r, r, len, 40); geo.rotateZ(-Math.PI / 2);
  const m = edges(new THREE.Mesh(geo, collarMat), 0x40464c); scene.add(m); return m; })();
// ---- grille box with six louvres
const gr = P.grille, grille = new THREE.Group(); scene.add(grille);
const gW = gr.x[1] - gr.x[0], gH = gr.y[1] - gr.y[0];
for (const [w, h, x, y] of [[gW, gr.frame, 0, (gH - gr.frame) / 2], [gW, gr.frame, 0, -(gH - gr.frame) / 2], [gr.frame, gH, -(gW - gr.frame) / 2, 0], [gr.frame, gH, (gW - gr.frame) / 2, 0]]) {
  const b = box(w, h, gr.depth, greyDark); b.position.set(x, y, 0); grille.add(b); }
const back = box(gW - 2 * gr.frame, gH - 2 * gr.frame, 0.05, new THREE.MeshLambertMaterial({ color: 0x1a1d20 })); back.position.z = -gr.depth / 2 + 0.03; grille.add(back);
const louvres = [];
for (let i = 0; i < gr.louvres; i++) {
  const pitch = (gH - 2 * gr.frame) / gr.louvres;
  const l = box(gW - 2 * gr.frame - 0.04, pitch * 0.92, 0.035); l.position.set(0, (gH - 2 * gr.frame) / 2 - pitch * (i + 0.5), gr.depth / 2 - 0.12); grille.add(l); louvres.push(l);
}
// ---- telescopic rails: three nested stages each
const rails = [0, 1].map(() => [0.18, 0.14, 0.1].map((s, k) => { const b = box(s, 1, s, k ? grey : greyDark); scene.add(b); return b; }));

// ---- airflow: streamlines along the centreline, offset inside the duct section
const path = new THREE.CatmullRomCurve3(RIG.airflowPath.map(p => new THREE.Vector3(...p)), false, 'centripetal');
const N = 28, SAMPLES = 400, tail = 0.16;
const pts = path.getSpacedPoints(SAMPLES), frames = path.computeFrenetFrames(SAMPLES, false);
const lines = [];
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2 * 3.1, rr = 0.12 + 0.36 * ((i * 37) % N) / N;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 60), 3));
  const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x4d9bff, transparent: true, opacity: 0.95, depthTest: false }));
  ln.userData = { a, rr, delay: (i * 7 % N) / N * 0.35 }; ln.renderOrder = 10; scene.add(ln); lines.push(ln);
}
function placeLine(ln, head) {
  const arr = ln.geometry.attributes.position.array, { a, rr } = ln.userData;
  for (let k = 0; k < 60; k++) {
    const u = Math.min(1, Math.max(0, head - tail * k / 59)), j = Math.round(u * SAMPLES);
    const n = frames.normals[j], b = frames.binormals[j], p = pts[j];
    const off = n.clone().multiplyScalar(Math.cos(a) * rr).add(b.clone().multiplyScalar(Math.sin(a) * rr));
    arr[3 * k] = p.x + off.x; arr[3 * k + 1] = p.y + off.y; arr[3 * k + 2] = p.z + off.z;
  }
  ln.geometry.attributes.position.needsUpdate = true;
}

// ---- overlays: official artwork (PNG, planning only), welcome line, burn-in
const art = document.getElementById('art'), title = document.getElementById('title'), burn = document.getElementById('burn');
const s = W / C.width;
Object.assign(art.style, { left: C.logo[0] * s + 'px', top: C.logo[1] * s + 'px', width: C.logo[2] * s + 'px', height: C.logo[3] * s + 'px' });
Object.assign(title.style, { top: (C.titleY * s - C.titleSize * s * 0.62) + 'px', fontSize: C.titleSize * s + 'px', letterSpacing: C.titleTracking + 'em' });
const ACTS = [[0, 'I · Ignition'], [1.0, 'II · Transformation'], [2.7, 'III · Airflow'], [3.8, 'IV · Final lock'], [4.7, 'V · Welcome → page']];
const clamp01 = x => Math.max(0, Math.min(1, x));

const setTRS = (o, p) => { o.position.set(...p.pos); o.quaternion.set(...p.quat); };
window.__frame = async n => {
  const F = RIG.formats[FMT][n], t = n / RIG.fps;
  setTRS(topRun, F.topRun); setTRS(bottomRun, F.bottomRun);
  setTRS(panel, F.sidePanel); setTRS(wedge, F.wedge);
  F.gores.forEach((g, i) => setTRS(gores[i], g));
  setTRS(collar, F.collar); setTRS(grille, F.grille);
  louvres.forEach(l => { l.rotation.x = F.louvreAngle; });
  F.rails.forEach((r, i) => { const h = r.y1 - r.y0; rails[i].forEach((b, k) => { const seg = Math.max(0.001, h * 0.4); b.visible = h > 0.02; b.scale.y = seg; b.position.set(r.x, r.y0 + h * (0.2 + 0.3 * k), r.z); }); });
  panelMat.color.copy(GALV).lerp(BLUE, F.blue.sidePanel); wedgeMat.color.copy(GALV).lerp(BLUE, F.blue.wedge); collarMat.color.copy(GALV).lerp(BLUE, F.blue.collar);
  const flowT = t - 2.7, on = t >= 2.7 && t < 4.6;
  lines.forEach(ln => { ln.visible = on; if (on) placeLine(ln, flowT / 0.9 - ln.userData.delay); ln.material.opacity = 0.95 * (1 - clamp01((t - 4.2) / 0.4)); });
  const c = F.camera; camera.position.set(...c.pos); camera.quaternion.set(...c.quat);
  const hf = 2 * Math.atan(c.sensor / 2 / c.focal); camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) * H / W)); camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  // handover to the official artwork under the light pass (4.25–4.55 s); welcome line from 4.3 s
  const hand = clamp01((t - 4.25) / 0.3);
  art.style.opacity = String(hand); art.style.webkitMaskImage = art.style.maskImage = `linear-gradient(100deg, #000 ${hand * 130 - 15}%, transparent ${hand * 130}%)`;
  renderer.domElement.style.opacity = String(1 - clamp01((t - 4.45) / 0.2));
  title.style.opacity = String(clamp01((t - 4.3) / 0.35));
  const act = ACTS.filter(a => t >= a[0]).at(-1)[1];
  burn.textContent = `ANIMATIC · grey box · ${act} · ${t.toFixed(2)} s · f${String(n).padStart(3, '0')}${t >= 2.7 && t < 4.6 ? ' · airflow drawn through the walls (final: section cut-away)' : ''}${t >= 4.8 ? ' · live page handoff (not in video)' : ''}`;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
};
window.__ready = true;

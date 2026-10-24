// LIBALSTAL V3 — PROXY emblem model (plain three.js shapes, grey-box level of detail).
// Built from blender/logo_parts.json in the exact hierarchy, pivots, names, extras and material names of
// v3/glb-contract.json, so the website viewer, the GLB validator and the silhouette check can be developed and
// tested before the Blender model exists. It is NOT the production model and never ships as such.
//
// World: logo units (1 = 100 px of the official PNG) → metres × UNIT (0.1 m per unit). glTF +Y up, front +Z.
import * as THREE from 'three';

export const UNIT = 0.1;

/** Open tube along +X from 0 to L, radius r. A mitred end is cut on the bisector plane of its joint (tilted by
 *  `half` about Z), so the outer (+Y) side of the bend is the longer one: neighbouring gores meet seam to seam. */
function mitredGore(r, L, half, mitreStart, mitreEnd, n = 48) {
  const t = Math.tan(half), pos = [], idx = [];
  for (const end of [0, 1]) for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, y = r * Math.cos(a), z = r * Math.sin(a);
    const x = end ? L + (mitreEnd ? y * t : 0) : (mitreStart ? -y * t : 0);
    pos.push(x, y, z);
  }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, n + i, j, j, n + i, n + j); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const mats = {};
function mat(name, color, metalness, roughness) {
  return (mats[name] ||= Object.assign(new THREE.MeshStandardMaterial({ color, metalness, roughness }), { name }));
}

/** @param {object} parts logo_parts.json → parts  @param {object} rig {segments:number[], jointDeg:number} */
export function buildProxy(parts, rig) {
  const U = v => v * UNIT;
  const M = {
    galv: mat('galvanised', 0xc3c9ce, 1, 0.38), flange: mat('galvanised_flange', 0xaab2b9, 1, 0.45),
    steel: mat('stainless_brushed', 0xd6dade, 1, 0.22), blue: mat('ral5017_coat', 0x0066cc, 0.3, 0.32),
    interior: mat('interior', 0x15181b, 0.4, 0.8),
  };
  const root = new THREE.Group(); root.name = 'LIBALSTAL_emblem';
  const tag = (o, part, dof, explode, axis) => { o.userData.libalstal = { part, dof, explode: explode.map(U), ...(axis ? { axis } : {}) }; return o; };
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(U(w), U(h), U(d)), m); b.position.set(U(x), U(y), U(z)); return b; };

  // ---- rectangular runs: body + flange frames, pivot at the run's centre, front face on z = 0
  function run(name, p, dof, explode) {
    const g = new THREE.Group(); g.name = name;
    const cx = (p.x[0] + p.x[1]) / 2, cy = (p.body[0] + p.body[1]) / 2, D = p.depth;
    g.position.set(U(cx), U(cy), U(-D / 2));
    const L = p.x[1] - p.x[0], Hb = p.body[1] - p.body[0], fw = p.flange, Ho = p.y[1] - p.y[0];
    const yo = (p.y[0] + p.y[1]) / 2 - cy;
    const shell = box(L - 2 * fw, Hb, D, M.galv); shell.name = `${name}_shell`; g.add(shell);
    for (const s of [-1, 1]) {
      const f = box(fw, Ho, D + (Ho - Hb), M.flange, s * (L - fw) / 2, yo, 0); f.name = `${name}_flange_${s < 0 ? 'a' : 'b'}`; g.add(f);
    }
    return tag(g, name, dof, explode, [0, 1, 0]);
  }
  const top = run('top_run', parts.topRun, 'slide', [0, 1.4, 0]);
  const bottom = run('bottom_run', parts.bottomRun, 'fixed', [0, -0.6, 0]);
  root.add(top, bottom);

  // ---- blue panel and wedge: the logo outline extruded backwards; panel hinged on its inner edge
  function slab(name, outline, thick, pivot, dof, explode, axis) {
    const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(U(x - pivot[0]), U(y - pivot[1]))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: U(thick), bevelEnabled: false }); geo.translate(0, 0, -U(thick));
    const g = new THREE.Group(); g.name = name; g.position.set(U(pivot[0]), U(pivot[1]), 0);
    const m = new THREE.Mesh(geo, M.blue); m.name = `${name}_sheet`; g.add(m);
    return tag(g, name, dof, explode, axis);
  }
  const P = parts.sidePanel, Wd = parts.wedge;
  root.add(slab('side_panel', P.outline, P.thickness, [P.x[1], (P.y[0] + P.y[1]) / 2], 'hinge', [-1.6, 0, 0.8], [0, 1, 0]));
  root.add(slab('wedge', Wd.outline, Wd.thickness, [(Wd.x[0] + Wd.x[1]) / 2, (Wd.y[0] + Wd.y[1]) / 2], 'slide', [-1.2, -0.9, 0.6], [-0.8, 0.6, 0]));

  // ---- elbow: four gores chained seam to seam (each one a child of the previous), turning 3 × 30° clockwise
  const e = parts.elbow, r = e.diameter / 2, seg = rig.segments, J = THREE.MathUtils.degToRad(rig.jointDeg);
  let parent = top, at = new THREE.Vector3(U(e.start[0] - (parts.topRun.x[0] + parts.topRun.x[1]) / 2), U(e.start[1] - (parts.topRun.body[0] + parts.topRun.body[1]) / 2), U(parts.topRun.depth / 2 - r));
  // (the round elbow's front sits on z = 0 like the runs; its axis is r behind the front)
  seg.forEach((L, k) => {
    const g = new THREE.Group(); g.name = `elbow_gore_${k + 1}`;
    g.position.copy(at); if (k > 0) g.rotation.z = -J;
    const geo = mitredGore(U(r), U(L), J / 2, k > 0, k < seg.length - 1);
    const m = new THREE.Mesh(geo, M.galv); m.name = `elbow_gore_${k + 1}_sheet`; g.add(m);
    tag(g, `elbow_gore_${k + 1}`, k === 0 ? 'fixed' : 'hinge', k === 0 ? [0.6, 0.3, 0] : [0.35, 0.25, 0], k === 0 ? undefined : [0, 0, 1]);
    parent.add(g); parent = g; at = new THREE.Vector3(U(L), 0, 0);
  });

  // ---- collar (blue sleeve over the elbow outlet), slides along its vertical axis
  const c = parts.collar, cl = c.y[1] - c.y[0];
  const collar = new THREE.Group(); collar.name = 'collar'; collar.position.set(U(c.axisX), U((c.y[0] + c.y[1]) / 2), U(-r));
  const cm = new THREE.Mesh(new THREE.CylinderGeometry(U(c.radius), U(c.radius), U(cl), 48, 1, true), M.blue); cm.name = 'collar_sleeve'; collar.add(cm);
  root.add(tag(collar, 'collar', 'slide', [1.2, 0.4, 0], [0, 1, 0]));

  // ---- grille: housing frame + plenum + six louvres hinged on their long axis
  const G = parts.grille, gw = G.x[1] - G.x[0], gh = G.y[1] - G.y[0], gd = G.depth, fr = G.frame;
  const grille = new THREE.Group(); grille.name = 'grille'; grille.position.set(U((G.x[0] + G.x[1]) / 2), U((G.y[0] + G.y[1]) / 2), U(-gd / 2));
  for (const [w, h, x, y] of [[gw, fr, 0, (gh - fr) / 2], [gw, fr, 0, -(gh - fr) / 2], [fr, gh, -(gw - fr) / 2, 0], [fr, gh, (gw - fr) / 2, 0]]) {
    const b = box(w, h, gd, M.steel, x, y, 0); b.name = `grille_frame_${['top', 'bottom', 'left', 'right'][grille.children.length]}`; grille.add(b);
  }
  const plen = box(gw - 2 * fr, gh - 2 * fr, 0.04, M.interior, 0, 0, -gd / 2 + 0.03); plen.name = 'grille_plenum'; grille.add(plen);
  const pitch = (gh - 2 * fr) / G.louvres;
  for (let i = 0; i < G.louvres; i++) {
    const l = new THREE.Group(); l.name = `louvre_${i + 1}`; l.position.set(0, U((gh - 2 * fr) / 2 - pitch * (i + 0.5)), U(gd / 2 - 0.1));
    l.rotation.x = THREE.MathUtils.degToRad(-28);
    const b = box(gw - 2 * fr - 0.04, pitch * 0.92, 0.035, M.steel); b.name = `louvre_${i + 1}_blade`; l.add(b);
    grille.add(tag(l, `louvre_${i + 1}`, 'hinge', [0, 0, 0.25 + 0.06 * i], [1, 0, 0]));
  }
  root.add(tag(grille, 'grille', 'slide', [1.6, -0.5, 0], [1, 0, 0]));
  return root;
}

/** Illustrative airflow centreline (metres, same space as the model), taken from the built proxy's own transforms:
 *  along the top run on the elbow axis, through every gore, down the collar, out through the grille louvres. */
export function airflowFromProxy(root, parts, rig) {
  root.updateMatrixWorld(true);
  const U = v => v * UNIT, pts = [];
  const g1 = root.getObjectByName('elbow_gore_1');
  const axis0 = new THREE.Vector3().setFromMatrixPosition(g1.matrixWorld);
  pts.push(new THREE.Vector3(U(parts.sidePanel.x[1]), axis0.y, axis0.z));
  rig.segments.forEach((L, k) => {
    const g = root.getObjectByName(`elbow_gore_${k + 1}`);
    for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(U(L) * i / 8, 0, 0).applyMatrix4(g.matrixWorld));
  });
  const end = pts[pts.length - 1], G = parts.grille;
  pts.push(new THREE.Vector3(end.x, U(parts.collar.y[0]), end.z));
  pts.push(new THREE.Vector3(U((G.x[0] + G.x[1]) / 2), U((G.y[0] + G.y[1]) / 2), end.z));
  pts.push(new THREE.Vector3(U((G.x[0] + G.x[1]) / 2), U((G.y[0] + G.y[1]) / 2) - 0.02, 0.09));
  return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1e-5).map(p => [p.x, p.y, p.z].map(v => +v.toFixed(4)));
}

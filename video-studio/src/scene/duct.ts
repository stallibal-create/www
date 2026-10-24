// One galvanised rectangular duct section, built like the real part: four sheet panels with cross-breaks,
// a Pittsburgh lock seam on one corner, a flange frame at each end (TDF-style profile), corner cleats and bolts.
// Units: the body height is 1. Proportions follow the top duct of the official mark (content/intro.json).
import * as THREE from 'three';
import { spangle } from '../../../src/assets/js/assembly/spangle.js';
import { INTRO } from '../lib/layout';

const [bx0, by0, bx1, by1] = INTRO.logo.topDuct.body;
const [fx0, fy0, fx1, fy1] = INTRO.logo.topDuct.flange;
const px = by1 - by0;                                  // logo px per unit

export const DUCT = {
  length: (bx1 - bx0) / px,                            // ≈ 1.655  body between the flanges
  height: 1,
  depth: 0.92,                                         // the mark is seen front-on; a near-square section reads true
  flangeLip: ((fy1 - fy0) - px) / 2 / px,              // ≈ 0.074  how far the frame stands proud of the sheet
  flangeWidth: 0.15,                                   // along the duct axis
  overall: (fx1 - fx0) / px,                           // ≈ 2.02   flange to flange, as in the mark
};

/** The site's spangle pattern, with its contrast pulled toward the mean: under a moving strip light at film
 *  resolution the raw crystals read as a mosaic. `amount` 1 = as on the site, 0 = flat. */
function soften(data: Uint8Array, amount: number) {
  let sum = 0; for (let i = 0; i < data.length; i += 4) sum += data[i];
  const mean = sum / (data.length / 4);
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = Math.round(mean + (data[i + c] - mean) * amount);
  return data;
}

function zincTextures(size: number, cells: number, repeat: [number, number], amount = 0.45) {
  const z = spangle(size, cells, 1702);
  soften(z.color, amount); soften(z.rough, amount);
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, z.size, z.size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 8;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(z.color, true), rough: mk(z.rough, false) };
}

/** Flat panel (a × b) in its local XY plane, facing +Z, with a cross-break: the centre stands `bulge` proud,
 *  so four facets meet on the diagonals — the faint X that stiffens real duct panels. */
function crossBrokenPanel(a: number, b: number, bulge: number) {
  const ha = a / 2, hb = b / 2;
  const c = [0, 0, bulge], p = [[-ha, -hb, 0], [ha, -hb, 0], [ha, hb, 0], [-ha, hb, 0]];
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p0 = p[i], p1 = p[(i + 1) % 4];
    pos.push(...p0, ...p1, ...c);
    uv.push((p0[0] + ha) / a, (p0[1] + hb) / b, (p1[0] + ha) / a, (p1[1] + hb) / b, 0.5, 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function buildDuct() {
  const { length: L, height: H, depth: D, flangeLip: lip, flangeWidth: fw } = DUCT;
  const group = new THREE.Group();
  const zinc = zincTextures(1024, 40, [L * 1.6, 1.6]);   // ~65 crystals per body height: real spangle scale
  const zincFlange = zincTextures(256, 8, [1, 1]);

  const sheet = new THREE.MeshPhysicalMaterial({ color: 0xe1e6ea, map: zinc.map, roughnessMap: zinc.rough, metalness: 1, roughness: 1 });
  const frame = new THREE.MeshPhysicalMaterial({ color: 0xc9d0d6, map: zincFlange.map, roughnessMap: zincFlange.rough, metalness: 1, roughness: 0.95 }); // as rough as the sheet: a smoother frame mirrors the dark studio gaps and reads as black plastic
  const cleat = new THREE.MeshStandardMaterial({ color: 0x7b848c, metalness: 1, roughness: 0.3 });
  const bolt = new THREE.MeshStandardMaterial({ color: 0xf0f3f5, metalness: 1, roughness: 0.18 });
  const inner = new THREE.MeshStandardMaterial({ color: 0x5b636b, metalness: 1, roughness: 0.62, side: THREE.BackSide }); // dim zinc inside

  // body: four panels (front, back, top, bottom), each with its cross-break
  const bulge = 0.012;
  const panels: [number, number, THREE.Euler, THREE.Vector3][] = [
    [L, H, new THREE.Euler(0, 0, 0), new THREE.Vector3(0, 0, D / 2)],                 // front  (+Z)
    [L, H, new THREE.Euler(0, Math.PI, 0), new THREE.Vector3(0, 0, -D / 2)],          // back
    [L, D, new THREE.Euler(-Math.PI / 2, 0, 0), new THREE.Vector3(0, H / 2, 0)],      // top    (+Y)
    [L, D, new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0, -H / 2, 0)],      // bottom
  ];
  for (const [a, b, rot, at] of panels) {
    const m = new THREE.Mesh(crossBrokenPanel(a, b, bulge), sheet);
    m.rotation.copy(rot); m.position.copy(at); group.add(m);
  }
  // dark interior so an open end never shows the back faces
  const shell = new THREE.Mesh(new THREE.BoxGeometry(L * 0.999, H * 0.995, D * 0.995), inner);
  group.add(shell);

  // Pittsburgh lock seam: a folded bead on the top-back corner, the way the panels are actually joined
  const seam = new THREE.Mesh(new THREE.BoxGeometry(L, 0.028, 0.028), frame);
  seam.position.set(0, H / 2 + 0.006, -D / 2 - 0.006);
  group.add(seam);

  // flange frames at both ends: four profile bars around the sheet, standing `lip` proud
  const oh = H + 2 * lip, od = D + 2 * lip;
  for (const s of [-1, 1]) {
    const x = s * (L / 2 + fw / 2 - 0.02);             // frame overlaps the sheet end slightly, as when rolled on
    const bars: [number, number, number, number, number][] = [
      [fw, lip, od, 0, H / 2 + lip / 2], [fw, lip, od, 0, -H / 2 - lip / 2],   // top, bottom (y)
    ];
    for (const [w, h, d, , y] of bars) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frame);
      m.position.set(x, y, 0); group.add(m);
    }
    for (const z of [D / 2 + lip / 2, -D / 2 - lip / 2]) {                       // front, back (z)
      const m = new THREE.Mesh(new THREE.BoxGeometry(fw, H, lip), frame);
      m.position.set(x, 0, z); group.add(m);
    }
    // end face of the frame (the mating face), a thin plate ring
    const ringOuter = new THREE.Shape();
    ringOuter.moveTo(-od / 2, -oh / 2); ringOuter.lineTo(od / 2, -oh / 2); ringOuter.lineTo(od / 2, oh / 2); ringOuter.lineTo(-od / 2, oh / 2); ringOuter.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-D / 2 + 0.01, -H / 2 + 0.01); hole.lineTo(-D / 2 + 0.01, H / 2 - 0.01); hole.lineTo(D / 2 - 0.01, H / 2 - 0.01); hole.lineTo(D / 2 - 0.01, -H / 2 + 0.01); hole.closePath();
    ringOuter.holes.push(hole);
    const ring = new THREE.Mesh(new THREE.ShapeGeometry(ringOuter), frame);
    ring.rotation.y = s * Math.PI / 2;
    ring.position.x = x + s * (fw / 2 + 0.001);
    group.add(ring);

    // corner cleats + bolts at the four corners of each frame, on the mating side
    for (const cy of [-1, 1]) for (const cz of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.62, lip * 1.12, lip * 1.12), cleat);
      c.position.set(x + s * 0.004, cy * (H / 2 + lip * 0.55), cz * (D / 2 + lip * 0.55));
      group.add(c);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 6), bolt);
      b.rotation.z = Math.PI / 2;
      b.position.set(x + s * (fw / 2 + 0.01), cy * (H / 2 + lip * 0.5), cz * (D / 2 + lip * 0.5));
      group.add(b);
    }
  }
  return group;
}

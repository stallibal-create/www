// Parametric rectangular ductwork parts → plain typed arrays (positions, normals, indices) + connector frames.
// Pure ES module (no three.js, no DOM): the 3D viewer, the build (SVG preview) and the unit tests all use it.
//
// Local part frame: flow enters at the origin along +X, +Y is the section's height direction and
// +Z = X × Y its width direction. Section sizes are internal (airway) dimensions in mm; the sheet wall
// and the frame flanges are drawn outside them. These are DEMONSTRATION dimensions, never product specs.
//
// Parts are hollow: inner and outer skins, a visible sheet edge (rim) at each open end, and a frame
// flange at every connection. Each mesh has two material groups: "sheet" and "flange".

import { vAdd, vSub, vScale, vDot, vCross, vNorm } from './units.js';

/** @typedef {import('./units.js').Vec3} Vec3 */
/** @typedef {{ o: Vec3, n: Vec3, u: Vec3, w: number, h: number }} Connector
 *  Connection frame: centre o, outward normal n, height direction u, internal section w × h (mm). */
/** @typedef {{ sheetMm: number, flangeWidthMm: number, flangeDepthMm: number }} Settings Assembly-wide visual parameters (demo). */
/** @typedef {{ id: string, type: string, geometry: Record<string, any> }} Component */
/** @typedef {{ p: Vec3[], n: Vec3, mat: 'sheet'|'flange' }} Quad */
/** @typedef {{ positions: Float32Array, normals: Float32Array, indices: Uint16Array|Uint32Array,
 *  groups: { start: number, count: number, material: 'sheet'|'flange' }[], connectors: Record<string, Connector>,
 *  bounds: { min: Vec3, max: Vec3 }, quads?: Quad[] }} PartMesh */

export class GeometryError extends Error {}

/** Required geometry fields per part type. 'mm' = finite positive number of millimetres; arrays = allowed values. */
export const GEOMETRY_SCHEMA = {
  straight: { widthMm: 'mm', heightMm: 'mm', lengthMm: 'mm' },
  branch: { widthMm: 'mm', heightMm: 'mm', lengthMm: 'mm' },
  elbow90: { widthMm: 'mm', heightMm: 'mm', innerRadiusMm: 'mm', bendPlane: ['horizontal', 'vertical'] },
  reducer: { inletWidthMm: 'mm', inletHeightMm: 'mm', outletWidthMm: 'mm', outletHeightMm: 'mm', lengthMm: 'mm' },
  tee: { widthMm: 'mm', heightMm: 'mm', lengthMm: 'mm', branchWidthMm: 'mm', branchHeightMm: 'mm', branchPositionMm: 'mm', branchLengthMm: 'mm' },
  flange: { widthMm: 'mm', heightMm: 'mm' },
};
export const PART_TYPES = Object.keys(GEOMETRY_SCHEMA);
/** Connector names per part type. */
export const CONNECTORS = { straight: ['inlet', 'outlet'], branch: ['inlet', 'outlet'], elbow90: ['inlet', 'outlet'], reducer: ['inlet', 'outlet'], tee: ['inlet', 'outlet', 'branch'], flange: ['inlet', 'outlet'] };

const isMm = x => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** All problems with a part's parameters (empty array = buildable). @param {Component} c @param {Settings} s @returns {string[]} */
export function validatePart(c, s) {
  const err = [];
  const schema = GEOMETRY_SCHEMA[c && c.type];
  if (!schema) return [`unknown part type "${c && c.type}"`];
  for (const k of ['sheetMm', 'flangeWidthMm', 'flangeDepthMm']) if (!isMm(s && s[k])) err.push(`settings.${k} must be a positive number of mm`);
  const g = c.geometry;
  if (!g || typeof g !== 'object') return [...err, 'geometry missing'];
  for (const [k, kind] of Object.entries(schema)) {
    if (Array.isArray(kind)) { if (!kind.includes(g[k])) err.push(`geometry.${k} must be one of ${kind.join(', ')}`); }
    else if (!isMm(g[k])) err.push(`geometry.${k} must be a positive number of mm`);
  }
  for (const k of Object.keys(g)) if (k !== 'demo' && !(k in schema)) err.push(`geometry.${k} is not a ${c.type} parameter`);
  if (err.length) return err;
  const t = s.sheetMm, F = s.flangeWidthMm, D = s.flangeDepthMm;
  // degenerate shapes
  if ('lengthMm' in schema && g.lengthMm <= 2 * D) err.push(`lengthMm (${g.lengthMm}) must exceed both end flanges (2 × ${D} mm)`);
  if (c.type === 'elbow90' && g.innerRadiusMm < t + F + D) err.push(`innerRadiusMm (${g.innerRadiusMm}) must be at least sheet + flange width + flange depth (${t + F + D} mm) or the end flanges collide`);
  if (c.type === 'reducer' && g.inletWidthMm === g.outletWidthMm && g.inletHeightMm === g.outletHeightMm) err.push('reducer inlet and outlet sections are identical (use a straight duct)');
  if (c.type === 'tee') {
    if (g.branchHeightMm + 2 * t > g.heightMm) err.push(`branch height ${g.branchHeightMm} + walls does not fit the main duct height ${g.heightMm}`);
    if (g.branchPositionMm - g.branchWidthMm / 2 - t < D || g.branchPositionMm + g.branchWidthMm / 2 + t > g.lengthMm - D) err.push('branch opening overlaps an end flange (check branchPositionMm / branchWidthMm / lengthMm)');
    if (g.branchLengthMm < t + F + D) err.push(`branchLengthMm (${g.branchLengthMm}) must be at least ${t + F + D} mm so the branch flange clears the main duct`);
  }
  return err;
}

function assertValid(c, s) {
  const e = validatePart(c, s);
  if (e.length) throw new GeometryError(`${c && c.id ? c.id + ': ' : ''}${e.join('; ')}`);
}

/** Connection frames in the part's local coordinates (mm). @param {Component} c @param {Settings} s @returns {Record<string, Connector>} */
export function connectorsFor(c, s) {
  assertValid(c, s);
  const g = c.geometry;
  const X = [1, 0, 0], NX = [-1, 0, 0], Y = [0, 1, 0];
  switch (c.type) {
    case 'straight': case 'branch':
      return { inlet: { o: [0, 0, 0], n: NX, u: Y, w: g.widthMm, h: g.heightMm }, outlet: { o: [g.lengthMm, 0, 0], n: X, u: Y, w: g.widthMm, h: g.heightMm } };
    case 'reducer':
      return { inlet: { o: [0, 0, 0], n: NX, u: Y, w: g.inletWidthMm, h: g.inletHeightMm }, outlet: { o: [g.lengthMm, 0, 0], n: X, u: Y, w: g.outletWidthMm, h: g.outletHeightMm } };
    case 'elbow90': {
      const inlet = { o: [0, 0, 0], n: NX, u: Y, w: g.widthMm, h: g.heightMm };
      if (g.bendPlane === 'horizontal') { const R = g.innerRadiusMm + g.widthMm / 2; return { inlet, outlet: { o: [R, 0, R], n: [0, 0, 1], u: Y, w: g.widthMm, h: g.heightMm } }; }
      const R = g.innerRadiusMm + g.heightMm / 2;
      return { inlet, outlet: { o: [R, R, 0], n: [0, 1, 0], u: [-1, 0, 0], w: g.widthMm, h: g.heightMm } };
    }
    case 'tee':
      return {
        inlet: { o: [0, 0, 0], n: NX, u: Y, w: g.widthMm, h: g.heightMm },
        outlet: { o: [g.lengthMm, 0, 0], n: X, u: Y, w: g.widthMm, h: g.heightMm },
        branch: { o: [g.branchPositionMm, 0, g.widthMm / 2 + g.branchLengthMm], n: [0, 0, 1], u: Y, w: g.branchWidthMm, h: g.branchHeightMm },
      };
    case 'flange':
      return { inlet: { o: [0, 0, 0], n: NX, u: Y, w: g.widthMm, h: g.heightMm }, outlet: { o: [s.flangeDepthMm, 0, 0], n: X, u: Y, w: g.widthMm, h: g.heightMm } };
  }
  throw new GeometryError(`unknown part type "${c.type}"`);
}

// ---------- mesh building ----------
// Section corners as (sy, sz) going round the rectangle; side i joins corner i and i+1: 0 = +Y, 1 = +Z, 2 = −Y, 3 = −Z.
const CORNERS = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
/** @typedef {{ p: Vec3, x: Vec3, y: Vec3, z: Vec3, w: number, h: number }} Frame */
/** @returns {Frame} */
const frame = (p, x, y, w, h) => ({ p, x, y, z: vCross(x, y), w, h });
const corner = (f, c, grow) => vAdd(f.p, vAdd(vScale(f.y, c[0] * (f.h / 2 + grow)), vScale(f.z, c[1] * (f.w / 2 + grow))));
const sideDir = (f, i) => { const a = CORNERS[i], b = CORNERS[(i + 1) % 4]; return vAdd(vScale(f.y, (a[0] + b[0]) / 2), vScale(f.z, (a[1] + b[1]) / 2)); };

function meshBuilder(keepQuads) {
  const buf = { sheet: { pos: [], nor: [], idx: [] }, flange: { pos: [], nor: [], idx: [] } };
  /** @type {Quad[]} */
  const quads = [];
  /** Quad strip through edges [A_k, B_k]; faces turned to agree with outward(k); normals smoothed along the strip only. */
  function strip(mat, edges, outward) {
    const faceN = e => vNorm(vCross(vSub(e[0][1], e[0][0]), vSub(e[1][0], e[0][0])));
    if (vDot(faceN(edges), outward(0)) < 0) edges = edges.map(([a, b]) => [b, a]);
    const fn = [];
    for (let k = 0; k < edges.length - 1; k++) fn.push(faceN([edges[k], edges[k + 1]]));
    const b = buf[mat], base = b.pos.length / 3;
    edges.forEach(([A, B], k) => {
      const n = vNorm(vAdd(fn[Math.max(0, k - 1)], fn[Math.min(fn.length - 1, k)]));
      b.pos.push(...A, ...B); b.nor.push(...n, ...n);
    });
    for (let k = 0; k < edges.length - 1; k++) {
      const a0 = base + 2 * k, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
      b.idx.push(a0, b0, a1, b0, b1, a1);
      if (keepQuads) quads.push({ p: [edges[k][0], edges[k][1], edges[k + 1][1], edges[k + 1][0]], n: fn[k], mat });
    }
  }
  const quad = (mat, a, b, c, d, out) => strip(mat, [[a, b], [d, c]], () => out);
  return { strip, quad, buf, quads };
}

/** Hollow rectangular tube swept through frames (inner + outer skins, end rims). */
function tube(m, frames, t, { startRim = true, endRim = true, skipSides = [] } = {}) {
  for (let i = 0; i < 4; i++) {
    if (skipSides.includes(i)) continue;
    const a = CORNERS[i], b = CORNERS[(i + 1) % 4];
    m.strip('sheet', frames.map(f => [corner(f, a, t), corner(f, b, t)]), k => sideDir(frames[k], i));
    m.strip('sheet', frames.map(f => [corner(f, a, 0), corner(f, b, 0)]), k => vScale(sideDir(frames[k], i), -1));
  }
  const rim = (f, out) => { for (let i = 0; i < 4; i++) { const a = CORNERS[i], b = CORNERS[(i + 1) % 4]; m.quad('sheet', corner(f, a, 0), corner(f, b, 0), corner(f, b, t), corner(f, a, t), out); } };
  if (startRim) rim(frames[0], vScale(frames[0].x, -1));
  if (endRim) rim(frames.at(-1), frames.at(-1).x);
}

/** Frame flange: rectangular ring of width F around the duct, depth D measured from the connection plane along dirIn. */
function flangeRing(m, f, dirIn, t, F, D, withInnerFace = false) {
  const f1 = { ...f, p: vAdd(f.p, vScale(dirIn, D)) };
  for (let i = 0; i < 4; i++) {
    const a = CORNERS[i], b = CORNERS[(i + 1) % 4];
    m.quad('flange', corner(f, a, t), corner(f, b, t), corner(f, b, t + F), corner(f, a, t + F), vScale(dirIn, -1));   // mating face
    m.quad('flange', corner(f1, a, t), corner(f1, b, t), corner(f1, b, t + F), corner(f1, a, t + F), dirIn);          // back face
    m.quad('flange', corner(f, a, t + F), corner(f, b, t + F), corner(f1, b, t + F), corner(f1, a, t + F), sideDir(f, i));
    if (withInnerFace) m.quad('flange', corner(f, a, t), corner(f, b, t), corner(f1, b, t), corner(f1, a, t), vScale(sideDir(f, i), -1));
  }
}

/** Build a part mesh in local mm coordinates. @param {Component} c @param {Settings} s
 *  @param {{ segments?: number, keepQuads?: boolean }} [opts] segments = elbow subdivisions; keepQuads also returns planar quads (SVG preview). @returns {PartMesh} */
export function buildPart(c, s, { segments = 16, keepQuads = false } = {}) {
  const connectors = connectorsFor(c, s);
  if (!(Number.isInteger(segments) && segments >= 2 && segments <= 128)) throw new GeometryError('segments must be an integer between 2 and 128');
  const g = c.geometry, t = s.sheetMm, F = s.flangeWidthMm, D = s.flangeDepthMm;
  const m = meshBuilder(keepQuads);
  const X = [1, 0, 0], NX = [-1, 0, 0], Y = [0, 1, 0];
  switch (c.type) {
    case 'straight': case 'branch': case 'reducer': {
      const [w0, h0, w1, h1] = c.type === 'reducer' ? [g.inletWidthMm, g.inletHeightMm, g.outletWidthMm, g.outletHeightMm] : [g.widthMm, g.heightMm, g.widthMm, g.heightMm];
      const f0 = frame([0, 0, 0], X, Y, w0, h0), f1 = frame([g.lengthMm, 0, 0], X, Y, w1, h1);
      tube(m, [f0, f1], t);
      flangeRing(m, f0, X, t, F, D); flangeRing(m, f1, NX, t, F, D);
      break;
    }
    case 'elbow90': {
      const frames = [];
      const horizontal = g.bendPlane === 'horizontal';
      const R = g.innerRadiusMm + (horizontal ? g.widthMm : g.heightMm) / 2;
      for (let k = 0; k <= segments; k++) {
        const a = (Math.PI / 2) * (k / segments), c0 = Math.cos(a), s0 = Math.sin(a);
        frames.push(horizontal
          ? frame([R * s0, 0, R - R * c0], [c0, 0, s0], Y, g.widthMm, g.heightMm)     // bend about +Y towards +Z
          : frame([R * s0, R - R * c0, 0], [c0, s0, 0], [-s0, c0, 0], g.widthMm, g.heightMm)); // bend about +Z towards +Y
      }
      // exact end frames (no trig round-off at the connections)
      const out = connectors.outlet;
      frames[segments] = frame(out.o, out.n, out.u, g.widthMm, g.heightMm);
      tube(m, frames, t);
      flangeRing(m, frames[0], X, t, F, D); flangeRing(m, frames[segments], vScale(out.n, -1), t, F, D);
      break;
    }
    case 'tee': {
      const W = g.widthMm, H = g.heightMm, L = g.lengthMm, bw = g.branchWidthMm, bh = g.branchHeightMm, cx = g.branchPositionMm;
      const f0 = frame([0, 0, 0], X, Y, W, H), f1 = frame([L, 0, 0], X, Y, W, H);
      tube(m, [f0, f1], t, { skipSides: [1] }); // the +Z side carries the branch opening
      const x1 = cx - bw / 2, x2 = cx + bw / 2;
      const face = (z, ymax, out) => {
        const r = (xa, xb, ya, yb) => m.quad('sheet', [xa, ya, z], [xb, ya, z], [xb, yb, z], [xa, yb, z], out);
        r(0, x1, -ymax, ymax); r(x2, L, -ymax, ymax); r(x1, x2, -ymax, -bh / 2); r(x1, x2, bh / 2, ymax);
      };
      face(W / 2 + t, H / 2 + t, [0, 0, 1]);
      face(W / 2, H / 2, [0, 0, -1]);
      const b = connectors.branch;
      const c0 = frame([cx, 0, W / 2], [0, 0, 1], Y, bw, bh), c1 = frame(b.o, b.n, b.u, bw, bh);
      tube(m, [c0, c1], t, { startRim: false });
      flangeRing(m, f0, X, t, F, D); flangeRing(m, f1, NX, t, F, D); flangeRing(m, c1, vScale(b.n, -1), t, F, D);
      break;
    }
    case 'flange':
      flangeRing(m, frame([0, 0, 0], X, Y, g.widthMm, g.heightMm), X, t, F, D, true);
      break;
  }
  // ---------- pack: sheet group first, then flange ----------
  const groups = [];
  let nPos = 0, nIdx = 0;
  for (const k of ['sheet', 'flange']) { nPos += m.buf[k].pos.length; nIdx += m.buf[k].idx.length; }
  const positions = new Float32Array(nPos), normals = new Float32Array(nPos);
  const indices = nPos / 3 > 65535 ? new Uint32Array(nIdx) : new Uint16Array(nIdx);
  let pOff = 0, iOff = 0;
  for (const k of ['sheet', 'flange']) {
    const b = m.buf[k], base = pOff / 3;
    positions.set(b.pos, pOff); normals.set(b.nor, pOff);
    for (let i = 0; i < b.idx.length; i++) indices[iOff + i] = b.idx[i] + base;
    if (b.idx.length) groups.push({ start: iOff, count: b.idx.length, material: k });
    pOff += b.pos.length; iOff += b.idx.length;
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], positions[i + a]); max[a] = Math.max(max[a], positions[i + a]); }
  /** @type {PartMesh} */
  const out = { positions, normals, indices, groups, connectors, bounds: { min, max } };
  if (keepQuads) out.quads = m.quads;
  return out;
}

/** Cache key: parts with identical type, geometry and settings share one mesh. */
export const partKey = (c, s, segments) => `${c.type}|${JSON.stringify(c.geometry)}|${s.sheetMm}|${s.flangeWidthMm}|${s.flangeDepthMm}|${segments}`;

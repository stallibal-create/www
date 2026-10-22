// Parametric rectangular ductwork parts → plain typed arrays (positions, normals, indices) + connector frames.
// Pure ES module (no three.js, no DOM): the 3D viewer, the build (SVG preview) and the unit tests all use it.
//
// Local part frame: flow enters at the origin along +X, +Y is the section's height direction and
// +Z = X × Y its width direction. Section sizes are internal (airway) dimensions in mm; the sheet wall
// and the frame flanges are drawn outside them. These are DEMONSTRATION dimensions, never product specs.
//
// Parts are hollow: inner and outer skins, a visible sheet edge (rim) at each open end, and a frame
// flange at every connection. The body has two material groups, "sheet" and "flange". With `details`, construction
// cues are added on top (groups "hardware" and "gasket" too); they never change the body or its connectors.

import { vAdd, vSub, vScale, vDot, vCross, vNorm, vLen } from './units.js';

/** @typedef {import('./units.js').Vec3} Vec3 */
/** @typedef {{ o: Vec3, n: Vec3, u: Vec3, w: number, h: number }} Connector
 *  Connection frame: centre o, outward normal n, height direction u, internal section w × h (mm). */
/** @typedef {{ sheetMm: number, flangeWidthMm: number, flangeDepthMm: number }} Settings Assembly-wide visual parameters (demo). */
/** @typedef {{ id: string, type: string, geometry: Record<string, any> }} Component */
/** @typedef {'sheet'|'flange'|'hardware'|'gasket'} Material */
/** @typedef {{ p: Vec3[], n: Vec3, mat: Material }} Quad */
/** @typedef {{ positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint16Array|Uint32Array,
 *  groups: { start: number, count: number, material: Material }[], connectors: Record<string, Connector>,
 *  bounds: { min: Vec3, max: Vec3 }, quads?: Quad[] }} PartMesh  uvs are in mm (divide by UV_TILE_MM for a texture tile). */

/** Material groups, in buffer order. */
export const MATERIALS = ['sheet', 'flange', 'hardware', 'gasket'];
/** Texture tile size: uv / UV_TILE_MM gives texture coordinates. */
export const UV_TILE_MM = 300;
/** Construction details drawn with `details: true` (visual demonstration only, never specifications):
 *  a corner piece and nut at each flange corner, a gasket at each joint, lock seams along the corners
 *  (two per duct, four on elbows) and cross-breaks on large flat panels. */
export const DETAIL = Object.freeze({
  cornerPlateMm: 2.5, nutAcrossFlatsMm: 13, nutHeightMm: 6.5,
  gasketInsetMm: 4, gasketMm: 0.5, gasketBandMm: 2.5, gasketBandRaiseMm: 0.3,
  seamWidthMm: 9, seamHeightMm: 1.5, crossBreakMinMm: 250, crossBreakRise: 0.012, crossBreakMaxMm: 6, crossBreakLiftMm: 0.2,
});

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
  const buf = Object.fromEntries(MATERIALS.map(k => [k, { pos: [], nor: [], uv: [], idx: [] }]));
  /** @type {Quad[]} */
  const quads = [];
  const mid = ([A, B]) => vScale(vAdd(A, B), 0.5);
  /** Quad strip through edges [A_k, B_k]; faces turned to agree with outward(k); normals smoothed along the strip only.
   *  uv (mm): u runs along the strip, v across it. Detail faces are left out of `quads` (the SVG preview). */
  function strip(mat, edges, outward, detail = false) {
    const faceN = e => vNorm(vCross(vSub(e[0][1], e[0][0]), vSub(e[1][0], e[0][0])));
    if (vDot(faceN(edges), outward(0)) < 0) edges = edges.map(([a, b]) => [b, a]);
    const fn = [];
    for (let k = 0; k < edges.length - 1; k++) fn.push(faceN([edges[k], edges[k + 1]]));
    const b = buf[mat], base = b.pos.length / 3;
    let u = 0;
    edges.forEach(([A, B], k) => {
      if (k) u += vLen(vSub(mid(edges[k]), mid(edges[k - 1])));
      const n = vNorm(vAdd(fn[Math.max(0, k - 1)], fn[Math.min(fn.length - 1, k)]));
      b.pos.push(...A, ...B); b.nor.push(...n, ...n); b.uv.push(u, 0, u, vLen(vSub(B, A)));
    });
    for (let k = 0; k < edges.length - 1; k++) {
      const a0 = base + 2 * k, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
      b.idx.push(a0, b0, a1, b0, b1, a1);
      if (keepQuads && !detail) quads.push({ p: [edges[k][0], edges[k][1], edges[k + 1][1], edges[k + 1][0]], n: fn[k], mat });
    }
  }
  const quad = (mat, a, b, c, d, out, detail = false) => strip(mat, [[a, b], [d, c]], () => out, detail);
  /** Flat triangle turned to face `out` (detail only). uv (mm) from the planar basis [origin, e1, e2], default its first edge. */
  function tri(mat, a, b, c, out, basis) {
    let n = vCross(vSub(b, a), vSub(c, a));
    if (vDot(n, out) < 0) { [b, c] = [c, b]; n = vScale(n, -1); }
    n = vNorm(n);
    const e1 = vNorm(vSub(b, a)), [o, u1, u2] = basis || [a, e1, vCross(n, e1)];
    const B = buf[mat], base = B.pos.length / 3;
    for (const p of [a, b, c]) { const d = vSub(p, o); B.pos.push(...p); B.nor.push(...n); B.uv.push(vDot(d, u1), vDot(d, u2)); }
    B.idx.push(base, base + 1, base + 2);
  }
  /** Flat convex polygon with shared vertices (detail only), turned to face `out`. */
  function poly(mat, pts, out) {
    let n = vCross(vSub(pts[1], pts[0]), vSub(pts[2], pts[0]));
    if (vDot(n, out) < 0) { pts = [...pts].reverse(); n = vScale(n, -1); }
    n = vNorm(n);
    const e1 = vNorm(vSub(pts[1], pts[0])), e2 = vCross(n, e1), B = buf[mat], base = B.pos.length / 3;
    for (const p of pts) { const d = vSub(p, pts[0]); B.pos.push(...p); B.nor.push(...n); B.uv.push(vDot(d, e1), vDot(d, e2)); }
    for (let k = 1; k < pts.length - 1; k++) B.idx.push(base, base + k, base + k + 1);
  }
  return { strip, quad, tri, poly, buf, quads };
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

// ---------- construction details (visual only; see DETAIL) ----------
/** Closed-sided prism (hex nut): `sides` faces of radius r around `axis`, from h0 to h1, with a top cap. */
function prism(m, mat, base, axis, e1, e2, r, sides, h0, h1, rot = 0) {
  const ring = h => Array.from({ length: sides }, (_, k) => {
    const a = rot + (2 * Math.PI * k) / sides;
    return vAdd(vAdd(base, vScale(axis, h)), vAdd(vScale(e1, r * Math.cos(a)), vScale(e2, r * Math.sin(a))));
  });
  const lo = ring(h0), hi = ring(h1), bottom = vAdd(base, vScale(axis, h0));
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    m.quad(mat, lo[k], lo[k1], hi[k1], hi[k], vSub(vScale(vAdd(lo[k], lo[k1]), 0.5), bottom), true);
  }
  m.poly(mat, hi, axis);
}

/** Gasket (mating-face ring + joint line on the outer edge) and, on the back face, a corner piece with its nut
 *  at each corner. f = connection frame, dirIn = into the part. */
function flangeDetails(m, f, dirIn, t, F, D) {
  const P = DETAIL, out = vScale(dirIn, -1);
  const g0 = { ...f, p: vAdd(f.p, vScale(out, P.gasketMm)) }, gb = { ...f, p: vAdd(f.p, vScale(dirIn, P.gasketBandMm)) };
  const gi = t + P.gasketInsetMm, go = t + F - P.gasketInsetMm, gr = t + F + P.gasketBandRaiseMm;
  for (let i = 0; i < 4; i++) {
    const a = CORNERS[i], b = CORNERS[(i + 1) % 4];
    m.quad('gasket', corner(g0, a, gi), corner(g0, b, gi), corner(g0, b, go), corner(g0, a, go), out, true);
    m.quad('gasket', corner(f, a, gr), corner(f, b, gr), corner(gb, b, gr), corner(gb, a, gr), sideDir(f, i), true);
  }
  const back = vAdd(f.p, vScale(dirIn, D)), T = P.cornerPlateMm;
  for (const c of CORNERS) {
    const ey = vScale(f.y, c[0]), ez = vScale(f.z, c[1]);
    const at = (y, z, d) => vAdd(vAdd(back, vScale(dirIn, d)), vAdd(vScale(ey, f.h / 2 + y), vScale(ez, f.w / 2 + z)));
    const [y0, y1, z0, z1] = [t, t + F, t, t + F];
    m.quad('hardware', at(y0, z0, T), at(y1, z0, T), at(y1, z1, T), at(y0, z1, T), dirIn, true);
    m.quad('hardware', at(y0, z0, 0), at(y0, z1, 0), at(y0, z1, T), at(y0, z0, T), vScale(ey, -1), true);
    m.quad('hardware', at(y1, z0, 0), at(y1, z1, 0), at(y1, z1, T), at(y1, z0, T), ey, true);
    m.quad('hardware', at(y0, z0, 0), at(y1, z0, 0), at(y1, z0, T), at(y0, z0, T), vScale(ez, -1), true);
    m.quad('hardware', at(y0, z1, 0), at(y1, z1, 0), at(y1, z1, T), at(y0, z1, T), ez, true);
    const centre = at(t + F / 2, t + F / 2, 0), nut = P.nutAcrossFlatsMm / Math.sqrt(3);
    prism(m, 'hardware', centre, dirIn, ey, ez, nut, 6, T, T + P.nutHeightMm, Math.PI / 6);
  }
}

/** L-shaped lock-seam bead along corner c of the outer skin, swept through `frames`. */
function seam(m, frames, c, t) {
  const W = DETAIL.seamWidthMm, H = DETAIL.seamHeightMm;
  const pts = frames.map(f => {
    const ey = vScale(f.y, c[0]), ez = vScale(f.z, c[1]), pc = corner(f, c, t);
    const at = (y, z) => vAdd(pc, vAdd(vScale(ey, y), vScale(ez, z)));
    return { a0: at(0, -W), a1: at(H, -W), c1: at(H, H), b1: at(-W, H), b0: at(-W, 0), ey, ez };
  });
  m.strip('sheet', pts.map(p => [p.a0, p.a1]), k => vScale(pts[k].ez, -1), true);
  m.strip('sheet', pts.map(p => [p.a1, p.c1]), k => pts[k].ey, true);
  m.strip('sheet', pts.map(p => [p.c1, p.b1]), k => pts[k].ez, true);
  m.strip('sheet', pts.map(p => [p.b1, p.b0]), k => vScale(pts[k].ey, -1), true);
}

/** Cross-break ("diamond") on each large flat outer side of a straight run between the flanges: four facets
 *  rising to the panel centre. Sides in `skip` are left flat. */
function crossBreaks(m, L, w, h, t, D, skip = []) {
  const P = DETAIL, X = [1, 0, 0], Y = [0, 1, 0], len = L - 2 * D;
  const f0 = frame([D, 0, 0], X, Y, w, h), f1 = frame([L - D, 0, 0], X, Y, w, h), g = t + P.crossBreakLiftMm;
  for (let i = 0; i < 4; i++) {
    const across = i % 2 === 0 ? w : h;
    if (skip.includes(i) || across < P.crossBreakMinMm || len < P.crossBreakMinMm) continue;
    const a = CORNERS[i], b = CORNERS[(i + 1) % 4], n = sideDir(f0, i);
    const p00 = corner(f0, a, g), p01 = corner(f0, b, g), p11 = corner(f1, b, g), p10 = corner(f1, a, g);
    const centre = vScale(vAdd(vAdd(p00, p01), vAdd(p11, p10)), 0.25);
    const apex = vAdd(centre, vScale(n, Math.min(P.crossBreakMaxMm, P.crossBreakRise * Math.min(across, len))));
    const basis = [p00, X, vNorm(vSub(p01, p00))];
    for (const [u, v] of [[p00, p10], [p10, p11], [p11, p01], [p01, p00]]) m.tri('sheet', u, v, apex, n, basis);
  }
}

/** Frames along a straight run from x0 to x1, section interpolated between (w0, h0) at 0 and (w1, h1) at L. */
const runFrames = (x0, x1, L, w0, h0, w1, h1) => [x0, x1].map(x => frame([x, 0, 0], [1, 0, 0], [0, 1, 0], w0 + ((w1 - w0) * x) / L, h0 + ((h1 - h0) * x) / L));

/** Elbow frame at bend angle a (0 → inlet, π/2 → outlet). */
function elbowFrame(g, a) {
  const R = g.innerRadiusMm + (g.bendPlane === 'horizontal' ? g.widthMm : g.heightMm) / 2, c0 = Math.cos(a), s0 = Math.sin(a);
  return g.bendPlane === 'horizontal'
    ? frame([R * s0, 0, R - R * c0], [c0, 0, s0], [0, 1, 0], g.widthMm, g.heightMm)     // bend about +Y towards +Z
    : frame([R * s0, R - R * c0, 0], [c0, s0, 0], [-s0, c0, 0], g.widthMm, g.heightMm); // bend about +Z towards +Y
}

/** Build a part mesh in local mm coordinates. @param {Component} c @param {Settings} s
 *  @param {{ segments?: number, keepQuads?: boolean, details?: boolean }} [opts] segments = elbow subdivisions; keepQuads
 *  also returns planar quads (SVG preview); details adds the construction details (DETAIL). @returns {PartMesh} */
export function buildPart(c, s, { segments = 16, keepQuads = false, details = false } = {}) {
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
      if (details) {
        flangeDetails(m, f0, X, t, F, D); flangeDetails(m, f1, NX, t, F, D);
        for (const k of [0, 2]) seam(m, runFrames(D, g.lengthMm - D, g.lengthMm, w0, h0, w1, h1), CORNERS[k], t);
        if (c.type !== 'reducer') crossBreaks(m, g.lengthMm, w0, h0, t, D);
      }
      break;
    }
    case 'elbow90': {
      const frames = [];
      for (let k = 0; k <= segments; k++) frames.push(elbowFrame(g, (Math.PI / 2) * (k / segments)));
      // exact end frames (no trig round-off at the connections)
      const out = connectors.outlet;
      frames[segments] = frame(out.o, out.n, out.u, g.widthMm, g.heightMm);
      tube(m, frames, t);
      flangeRing(m, frames[0], X, t, F, D); flangeRing(m, frames[segments], vScale(out.n, -1), t, F, D);
      if (details) {
        flangeDetails(m, frames[0], X, t, F, D); flangeDetails(m, frames[segments], vScale(out.n, -1), t, F, D);
        // four seams (cheeks to throat and heel), each trimmed where its corner meets the flange back faces
        const R = g.innerRadiusMm + (g.bendPlane === 'horizontal' ? g.widthMm : g.heightMm) / 2;
        for (const cn of CORNERS) {
          const r = g.bendPlane === 'horizontal' ? R - cn[1] * (g.widthMm / 2 + t) : R - cn[0] * (g.heightMm / 2 + t);
          const a0 = Math.asin(Math.min(0.99, D / r)), a1 = Math.PI / 2 - a0, n = Math.max(2, Math.ceil((segments * (a1 - a0)) / (Math.PI / 2)));
          seam(m, Array.from({ length: n + 1 }, (_, k) => elbowFrame(g, a0 + ((a1 - a0) * k) / n)), cn, t);
        }
      }
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
      if (details) {
        flangeDetails(m, f0, X, t, F, D); flangeDetails(m, f1, NX, t, F, D); flangeDetails(m, c1, vScale(b.n, -1), t, F, D);
        for (const k of [0, 2]) seam(m, runFrames(D, L - D, L, W, H, W, H), CORNERS[k], t);
        const s0 = frame(vAdd(c0.p, vScale(c0.x, t)), c0.x, c0.y, bw, bh), s1 = frame(vSub(c1.p, vScale(c1.x, D)), c1.x, c1.y, bw, bh);
        for (const k of [0, 2]) seam(m, [s0, s1], CORNERS[k], t);
        crossBreaks(m, L, W, H, t, D, [1]); // the +Z side carries the branch opening
      }
      break;
    }
    case 'flange': {
      const f0 = frame([0, 0, 0], X, Y, g.widthMm, g.heightMm);
      flangeRing(m, f0, X, t, F, D, true);
      if (details) flangeDetails(m, f0, X, t, F, D);
      break;
    }
  }
  // ---------- pack: sheet group first, then flange ----------
  const groups = [];
  let nPos = 0, nIdx = 0;
  for (const k of MATERIALS) { nPos += m.buf[k].pos.length; nIdx += m.buf[k].idx.length; }
  const positions = new Float32Array(nPos), normals = new Float32Array(nPos), uvs = new Float32Array((nPos / 3) * 2);
  const indices = nPos / 3 > 65535 ? new Uint32Array(nIdx) : new Uint16Array(nIdx);
  let pOff = 0, iOff = 0;
  for (const k of MATERIALS) {
    const b = m.buf[k], base = pOff / 3;
    positions.set(b.pos, pOff); normals.set(b.nor, pOff); uvs.set(b.uv, base * 2);
    for (let i = 0; i < b.idx.length; i++) indices[iOff + i] = b.idx[i] + base;
    if (b.idx.length) groups.push({ start: iOff, count: b.idx.length, material: k });
    pOff += b.pos.length; iOff += b.idx.length;
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], positions[i + a]); max[a] = Math.max(max[a], positions[i + a]); }
  /** @type {PartMesh} */
  const out = { positions, normals, uvs, indices, groups, connectors, bounds: { min, max } };
  if (keepQuads) out.quads = m.quads;
  return out;
}

/** Cache key: parts with identical type, geometry and settings share one mesh. */
export const partKey = (c, s, segments, details = false) => `${c.type}|${JSON.stringify(c.geometry)}|${s.sheetMm}|${s.flangeWidthMm}|${s.flangeDepthMm}|${segments}|${details ? 'd' : ''}`;

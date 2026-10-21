// Engineering units and frame maths shared by the part generator, the assembly solver, the build and the 3D viewer.
// Pure ES module: no DOM, no three.js, so it runs in the browser and under `node --test`.
//
// Coordinate system (whole assembly): right-handed, +Y up. The origin is the centre of the root part's inlet
// and the root part runs along +X. Every engineering dimension is in millimetres; the 3D scene uses metres,
// and toScene() is the only place where that conversion happens.

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {number[]} Mat3 Row-major 3×3 rotation, 9 numbers. */
/** @typedef {{ r: Mat3, t: Vec3 }} Transform Rotation then translation (t in mm). */

export const MM_PER_SCENE_UNIT = 1000;
/** Positional tolerance for connector alignment checks, in mm. */
export const EPS_MM = 1e-6;
/** Angular tolerance (dot-product deviation) for connector orientation checks. */
export const EPS_DIR = 1e-9;

/** @param {number} mm @returns {number} scene units (metres) */
export const toScene = mm => mm / MM_PER_SCENE_UNIT;

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {Vec3} a @param {number} s @returns {Vec3} */
export const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
/** @param {Vec3} a @param {Vec3} b */
export const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {Vec3} a */
export const vLen = a => Math.hypot(a[0], a[1], a[2]);
/** @param {Vec3} a @returns {Vec3} */
export const vNorm = a => { const l = vLen(a); if (!(l > 0)) throw new Error('zero-length vector'); return [a[0] / l, a[1] / l, a[2] / l]; };

// Values this close to zero are snapped so axis-aligned results are exact and deterministic.
const snap = x => (Math.abs(x) < 1e-12 ? 0 : x);

/** Rotation whose columns are the given basis vectors. @param {Vec3} c0 @param {Vec3} c1 @param {Vec3} c2 @returns {Mat3} */
export const m3FromColumns = (c0, c1, c2) => [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
/** @param {Mat3} m @returns {Mat3} */
export const m3Transpose = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
/** @param {Mat3} a @param {Mat3} b @returns {Mat3} */
export function m3Mul(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = snap(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  return o;
}
/** @param {Mat3} m @param {Vec3} v @returns {Vec3} */
export const m3MulV = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

/** @type {Transform} */
export const IDENTITY = Object.freeze({ r: Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]), t: Object.freeze([0, 0, 0]) });
/** @param {Transform} T @param {Vec3} p @returns {Vec3} */
export const applyPoint = (T, p) => vAdd(m3MulV(T.r, p), T.t);
/** @param {Transform} T @param {Vec3} d @returns {Vec3} */
export const applyDir = (T, d) => m3MulV(T.r, d);

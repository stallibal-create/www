// Checks that the exported GLB still matches content/site.json → ductAssembly. A stale model (dimensions edited
// after the last Blender export) would contradict the dimension tables, so the build then leaves it out.
import { buildPart } from '../src/assets/js/assembly/geometry.js';
import { solveAssembly } from '../src/assets/js/assembly/assembly.js';
import { applyPoint, toScene } from '../src/assets/js/assembly/units.js';
import { readGlb } from '../src/assets/js/assembly/glb.js';

/** Elbow subdivisions of the exported model (the desktop 3D view uses the same). */
export const MODEL_SEGMENTS = 16;
/** Largest allowed bounding-box difference per part, in metres (0.1 mm; float32 rounding is far smaller). */
export const MODEL_TOLERANCE_M = 1e-4;

function bounds(points) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  return [...lo, ...hi];
}

/** @param {any} asm site.ductAssembly @param {ArrayBuffer} glb @returns {string[]} problems; empty when the model matches */
export function modelProblems(asm, glb) {
  let parts;
  try { parts = readGlb(glb); } catch (e) { return [e.message]; }
  const solved = solveAssembly(asm), problems = [];
  const ids = new Set(asm.components.map(c => c.id));
  for (const id of parts.keys()) if (!ids.has(id)) problems.push(`${id}: not in the assembly`);
  for (const c of asm.components) {
    const prims = parts.get(c.id);
    if (!prims) { problems.push(`${c.id}: missing from the model`); continue; }
    const m = buildPart(c, asm.settings, { segments: MODEL_SEGMENTS, details: true }), T = solved.parts.get(c.id).installed, want = [];
    for (let i = 0; i < m.positions.length; i += 3) want.push(applyPoint(T, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]).map(toScene));
    const got = [];
    for (const p of prims) for (let i = 0; i < p.positions.length; i += 3) got.push([p.positions[i], p.positions[i + 1], p.positions[i + 2]]);
    const tris = prims.reduce((s, p) => s + p.indices.length / 3, 0);
    if (tris !== m.indices.length / 3) { problems.push(`${c.id}: ${tris} triangles, geometry has ${m.indices.length / 3} (re-export from Blender)`); continue; }
    const a = bounds(want), b = bounds(got);
    const diff = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    if (!(diff <= MODEL_TOLERANCE_M)) problems.push(`${c.id}: differs by ${(diff * 1000).toFixed(1)} mm (re-export from Blender)`);
  }
  return problems;
}

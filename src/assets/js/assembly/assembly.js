// Assembly solver: places every part by aligning its connector with the connector it is joined to.
// Pure ES module (no three.js, no DOM). Installed transforms are computed, never hand-placed, and are
// deterministic: the same data always gives the same numbers. Explode offsets are applied on top of the
// stored installed transform (never accumulated), so any number of explode / reassemble cycles returns home exactly.

import { connectorsFor, CONNECTORS, GeometryError } from './geometry.js';
import { vAdd, vSub, vScale, vDot, vCross, vLen, m3FromColumns, m3Transpose, m3Mul, IDENTITY, applyPoint, applyDir, EPS_MM, EPS_DIR } from './units.js';

/** @typedef {import('./units.js').Vec3} Vec3 */
/** @typedef {import('./units.js').Transform} Transform */
/** @typedef {import('./geometry.js').Connector} Connector */
/** @typedef {import('./geometry.js').Settings} Settings */
/** @typedef {{ id: string, type: string, geometry: Record<string, any>, explode?: { distanceMm: number, direction?: Vec3 } }} AsmComponent */
/** @typedef {{ settings: Settings, components: AsmComponent[], connections: [string, string][] }} Assembly */
/** @typedef {{ id: string, parent: string|null, via: string|null, installed: Transform, local: Record<string, Connector> }} SolvedPart */

export class AssemblyError extends Error {}

/** Default viewing direction (from the assembly centre towards the camera), shared by the static SVG preview
 *  and the 3D view so the canvas replaces the drawing without a jump. @type {Vec3} */
export const DEFAULT_VIEW_DIR = [1, 0.8, 0.62];

/** "duct-1.outlet" → ["duct-1", "outlet"] */
export function parseRef(ref) {
  const m = typeof ref === 'string' && /^([a-z0-9-]+)\.([a-z]+)$/.exec(ref);
  if (!m) throw new AssemblyError(`bad connector reference "${ref}" (expected "part-id.connector")`);
  return [m[1], m[2]];
}

/** World frame of a connector. @param {Transform} T @param {Connector} c @returns {Connector} */
export const worldConnector = (T, c) => ({ o: applyPoint(T, c.o), n: applyDir(T, c.n), u: applyDir(T, c.u), w: c.w, h: c.h });

/** Transform that puts local connector `child` face to face with world connector `target`:
 *  normals opposite, height directions equal, centres coincident. @returns {Transform} */
export function alignTo(child, target) {
  const n = vScale(target.n, -1);
  const from = m3FromColumns(child.n, child.u, vCross(child.n, child.u));
  const to = m3FromColumns(n, target.u, vCross(n, target.u));
  const r = m3Mul(to, m3Transpose(from));
  const t = vSub(target.o, applyDir({ r, t: [0, 0, 0] }, child.o));
  return { r, t };
}

/** How far two joined connectors are from a perfect fit (0 = perfect). */
export function connectionError(a, b) {
  return { gapMm: vLen(vSub(a.o, b.o)), normal: Math.abs(vDot(a.n, b.n) + 1), up: Math.abs(vDot(a.u, b.u) - 1), dw: Math.abs(a.w - b.w), dh: Math.abs(a.h - b.h) };
}

/** Solve the connection graph: the first component is the root (identity), every other part is reached
 *  through exactly one connection (the graph must be a tree). @param {Assembly} asm
 *  @returns {{ parts: Map<string, SolvedPart>, order: string[] }} */
export function solveAssembly(asm) {
  const comps = new Map();
  for (const c of asm.components) {
    if (comps.has(c.id)) throw new AssemblyError(`duplicate part id "${c.id}"`);
    comps.set(c.id, c);
  }
  if (!comps.size) throw new AssemblyError('assembly has no parts');
  const local = new Map();
  for (const c of asm.components) {
    try { local.set(c.id, connectorsFor(c, asm.settings)); } catch (e) { throw e instanceof GeometryError ? new AssemblyError(e.message) : e; }
  }
  const used = new Set();
  const adj = new Map([...comps.keys()].map(k => [k, []]));
  for (const pair of asm.connections || []) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new AssemblyError('each connection must be a pair of connector references');
    const ends = pair.map(parseRef);
    for (const [id, con] of ends) {
      if (!comps.has(id)) throw new AssemblyError(`connection to unknown part "${id}"`);
      if (!CONNECTORS[comps.get(id).type].includes(con)) throw new AssemblyError(`part "${id}" (${comps.get(id).type}) has no connector "${con}"`);
      if (used.has(`${id}.${con}`)) throw new AssemblyError(`connector "${id}.${con}" is used twice`);
      used.add(`${id}.${con}`);
    }
    if (ends[0][0] === ends[1][0]) throw new AssemblyError(`part "${ends[0][0]}" is connected to itself`);
    adj.get(ends[0][0]).push([ends[0][1], ends[1][0], ends[1][1]]);
    adj.get(ends[1][0]).push([ends[1][1], ends[0][0], ends[0][1]]);
  }
  const rootId = asm.components[0].id;
  /** @type {Map<string, SolvedPart>} */
  const parts = new Map([[rootId, { id: rootId, parent: null, via: null, installed: IDENTITY, local: local.get(rootId) }]]);
  const order = [rootId], queue = [rootId], seenEdges = new Set();
  while (queue.length) {
    const pid = queue.shift(), P = parts.get(pid);
    for (const [pc, cid, cc] of adj.get(pid)) {
      const key = [`${pid}.${pc}`, `${cid}.${cc}`].sort().join('|');
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      if (parts.has(cid)) throw new AssemblyError(`connection ${pid}.${pc} ↔ ${cid}.${cc} closes a loop (the assembly must be a tree)`);
      const target = worldConnector(P.installed, P.local[pc]);
      const mine = local.get(cid)[cc];
      if (Math.abs(mine.w - target.w) > EPS_MM || Math.abs(mine.h - target.h) > EPS_MM)
        throw new AssemblyError(`section mismatch at ${pid}.${pc} (${target.w} × ${target.h}) ↔ ${cid}.${cc} (${mine.w} × ${mine.h})`);
      parts.set(cid, { id: cid, parent: pid, via: cc, installed: alignTo(mine, target), local: local.get(cid) });
      order.push(cid); queue.push(cid);
    }
  }
  const lost = [...comps.keys()].filter(k => !parts.has(k));
  if (lost.length) throw new AssemblyError(`not connected to the assembly: ${lost.join(', ')}`);
  return { parts, order };
}

/** Check every declared connection after solving. @returns {string[]} problems (empty = all aligned within tolerance) */
export function checkConnections(asm, solved) {
  const out = [];
  for (const [a, b] of asm.connections || []) {
    const [ia, ca] = parseRef(a), [ib, cb] = parseRef(b);
    const A = solved.parts.get(ia), B = solved.parts.get(ib);
    const e = connectionError(worldConnector(A.installed, A.local[ca]), worldConnector(B.installed, B.local[cb]));
    if (e.gapMm > EPS_MM || e.normal > EPS_DIR || e.up > EPS_DIR || e.dw > EPS_MM || e.dh > EPS_MM) out.push(`${a} ↔ ${b}: ${JSON.stringify(e)}`);
  }
  return out;
}

/** World explode offset per part (mm, at factor 1). Each part moves along its own axis, away from the part it
 *  hangs on (the root moves back out of its inlet), and carries its children with it.
 *  An explicit explode.direction (world vector) overrides the axis. */
export function explodeOffsets(asm, solved) {
  const byId = new Map(asm.components.map(c => [c.id, c]));
  /** @type {Map<string, Vec3>} */
  const off = new Map();
  for (const id of solved.order) {
    const P = solved.parts.get(id), c = byId.get(id), d = (c.explode && c.explode.distanceMm) || 0;
    let dir;
    if (c.explode && c.explode.direction) { const v = c.explode.direction; const l = vLen(v); dir = vScale(v, 1 / l); }
    else if (P.parent === null) dir = applyDir(P.installed, P.local.inlet.n);
    else dir = vScale(applyDir(P.installed, P.local[P.via].n), -1);
    off.set(id, vAdd(P.parent === null ? [0, 0, 0] : off.get(P.parent), vScale(dir, d)));
  }
  return off;
}

/** Pose of a part for an explode factor (0 = installed, 1 = fully exploded). Always derived from the stored installed
 *  transform, so poseAt(…, 0) returns the installed transform exactly, whatever happened before. @returns {Transform} */
export function poseAt(installed, offset, factor) {
  if (factor === 0) return { r: installed.r.slice(), t: installed.t.slice() };
  return { r: installed.r.slice(), t: vAdd(installed.t, vScale(offset, factor)) };
}

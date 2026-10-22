// Reader for the demonstration assembly GLB exported by scripts/blender-scene.py (Blender glTF exporter).
// Pure ES module: no DOM, no three.js, so it runs in the browser and under `node --test`.
//
// The exported vertices are already in their INSTALLED positions (metres, +Y up), so the viewer places these parts
// with the identity transform; applying the solved installed transform again would move every part twice.
// Only what that exporter writes is supported (float positions/normals/uvs, 8/16/32-bit indices, no node transforms);
// anything else throws, and the viewer falls back to the procedural geometry.

/** Material names written by scripts/blender-scene.py → viewer material slot (geometry.js MATERIALS order). */
export const MATERIAL_SLOTS = { 'Galvanised steel — illustrative': 0, 'Connection frames': 1, 'Bolts and corner pieces': 2, 'Gasket': 3 };

const COMPONENTS = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3 };

/** @typedef {{ slot: number, positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint8Array|Uint16Array|Uint32Array }} GlbPrimitive */

/** @param {ArrayBuffer} buf @returns {Map<string, GlbPrimitive[]>} parts by node name */
export function readGlb(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 28 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new Error('unsupported GLB version');
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB: first chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen;
  if (dv.getUint32(binStart + 4, true) !== 0x004e4942) throw new Error('GLB: missing binary chunk');
  const bin = binStart + 8;

  const accessor = (i, type) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], T = COMPONENTS[a.componentType], n = SIZES[a.type];
    if (!T || a.type !== type || a.sparse) throw new Error(`GLB: unsupported accessor ${i}`);
    if (v.byteStride && v.byteStride !== n * T.BYTES_PER_ELEMENT) throw new Error(`GLB: interleaved accessor ${i}`);
    const off = bin + (v.byteOffset || 0) + (a.byteOffset || 0);
    if (off % T.BYTES_PER_ELEMENT) throw new Error(`GLB: misaligned accessor ${i}`);
    return new T(buf.slice(off, off + a.count * n * T.BYTES_PER_ELEMENT));
  };

  const parts = new Map();
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue;
    if (node.matrix || node.translation || node.rotation || node.scale || node.children) throw new Error(`GLB: node ${node.name} has a transform; vertices must already be installed`);
    if (parts.has(node.name)) throw new Error(`GLB: duplicate part ${node.name}`);
    parts.set(node.name, json.meshes[node.mesh].primitives.map(p => {
      if ((p.mode ?? 4) !== 4) throw new Error(`GLB: ${node.name} is not a triangle mesh`);
      const slot = MATERIAL_SLOTS[json.materials?.[p.material]?.name];
      if (slot === undefined) throw new Error(`GLB: ${node.name} uses an unknown material`);
      if (p.attributes.TEXCOORD_0 === undefined) throw new Error(`GLB: ${node.name} has no texture coordinates (re-export from Blender)`);
      return { slot, positions: accessor(p.attributes.POSITION, 'VEC3'), normals: accessor(p.attributes.NORMAL, 'VEC3'), uvs: accessor(p.attributes.TEXCOORD_0, 'VEC2'), indices: accessor(p.indices, 'SCALAR') };
    }));
  }
  return parts;
}

/** One indexed geometry per part with one group per material slot, ready for a BufferGeometry.
 *  @param {GlbPrimitive[]} prims @returns {{ positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array, groups: { start: number, count: number, slot: number }[] }} */
export function mergePrimitives(prims) {
  const nv = prims.reduce((s, p) => s + p.positions.length, 0), ni = prims.reduce((s, p) => s + p.indices.length, 0);
  const positions = new Float32Array(nv), normals = new Float32Array(nv), uvs = new Float32Array((nv / 3) * 2), indices = new Uint32Array(ni), groups = [];
  let v = 0, i = 0;
  for (const p of [...prims].sort((a, b) => a.slot - b.slot)) {
    positions.set(p.positions, v); normals.set(p.normals, v); uvs.set(p.uvs, (v / 3) * 2);
    const base = v / 3;
    for (let k = 0; k < p.indices.length; k++) indices[i + k] = p.indices[k] + base;
    groups.push({ start: i, count: p.indices.length, slot: p.slot });
    v += p.positions.length; i += p.indices.length;
  }
  return { positions, normals, uvs, indices, groups };
}

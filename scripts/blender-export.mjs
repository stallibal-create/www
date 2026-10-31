// Export the demonstration geometry (with construction details) for Blender, preserving solved connections:
// brand/blender/assembly.json (installed vertices in metres, Blender Z-up, normals, uvs in texture tiles, material
// groups) and the zinc spangle textures brand/blender/zinc-spangle.png / zinc-roughness.png used by blender-scene.py.
import fs from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildPart, UV_TILE_MM } from '../src/assets/js/assembly/geometry.js';
import { solveAssembly, checkConnections } from '../src/assets/js/assembly/assembly.js';
import { applyPoint, applyDir } from '../src/assets/js/assembly/units.js';
import { spangle } from '../src/assets/js/assembly/spangle.js';
import { MODEL_SEGMENTS } from './assembly-model.mjs';

const root = new URL('../', import.meta.url);
const site = JSON.parse(fs.readFileSync(new URL('content/site.json', root)));
const system = process.argv.includes('--branches') ? 'branches' : 'rectangular';
const suffix = system === 'branches' ? '-branches' : '';
const asm = system === 'branches' ? site.ductSystems.branches : site.ductAssembly;
const solved = solveAssembly(asm);
const errors = checkConnections(asm, solved);
if (errors.length) throw new Error(errors.join('\n'));
const toBlender = p => [p[0], -p[2], p[1]]; // site +Y up → Blender +Z up (the glTF exporter converts back)
const parts = asm.components.map(c => {
  const m = buildPart(c, asm.settings, { segments: MODEL_SEGMENTS, details: true }), T = solved.parts.get(c.id).installed;
  const vertices = [], normals = [];
  for (let i = 0; i < m.positions.length; i += 3) {
    vertices.push(toBlender(applyPoint(T, [m.positions[i], m.positions[i + 1], m.positions[i + 2]])).map(v => v / 1000));
    normals.push(toBlender(applyDir(T, [m.normals[i], m.normals[i + 1], m.normals[i + 2]])));
  }
  const uvs = [];
  for (let i = 0; i < m.uvs.length; i += 2) uvs.push([m.uvs[i] / UV_TILE_MM, m.uvs[i + 1] / UV_TILE_MM]);
  return { id: c.id, vertices, normals, uvs, indices: Array.from(m.indices), groups: m.groups };
});
const out = new URL('brand/blender/', root);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(new URL(`assembly${suffix}.json`, out), JSON.stringify({ demo: true, parts }));

// Single parts for the product renders (scripts/blender-products.py), in their own frame: the assembly's components.
const single = id => {
  const c = asm.components.find(k => k.id === id), m = buildPart(c, asm.settings, { segments: 32, details: true });
  const vertices = [], normals = [], uvs = [];
  for (let i = 0; i < m.positions.length; i += 3) {
    vertices.push(toBlender([m.positions[i], m.positions[i + 1], m.positions[i + 2]]).map(v => v / 1000));
    normals.push(toBlender([m.normals[i], m.normals[i + 1], m.normals[i + 2]]));
  }
  for (let i = 0; i < m.uvs.length; i += 2) uvs.push([m.uvs[i] / UV_TILE_MM, m.uvs[i + 1] / UV_TILE_MM]);
  return { id, vertices, normals, uvs, indices: Array.from(m.indices), groups: m.groups };
};
fs.writeFileSync(new URL(`products${suffix}.json`, out), JSON.stringify({ demo: true, parts: (system === 'branches' ? asm.components.map(c => c.id) : ['duct-1', 'elbow-1', 'tee-1', 'reducer-1', 'flange-1', 'damper-manual-1', 'damper-motorised-1', 'round-damper-manual-1', 'round-damper-motorised-1']).map(single) }));

// Minimal PNG writer (8-bit RGBA) for the spangle textures.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
function png(size, rgba) {
  const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const zinc = spangle(1024, 26); // same crystals per tile as the 3D view (26 per 300 mm)
fs.writeFileSync(new URL('zinc-spangle.png', out), png(zinc.size, zinc.color));
fs.writeFileSync(new URL('zinc-roughness.png', out), png(zinc.size, zinc.rough));
console.log(`Exported ${parts.length} demo parts with details (${parts.reduce((s, p) => s + p.indices.length / 3, 0)} triangles); all connections verified.`);

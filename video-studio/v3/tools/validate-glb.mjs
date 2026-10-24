#!/usr/bin/env node
// LIBALSTAL V3 — checks a GLB against v3/glb-contract.json (structure, names, hierarchy, pivots, extras, materials,
// budgets). No dependencies. Silhouette accuracy is checked separately: v3/tools/emblem_fit.py.
// Usage: node v3/tools/validate-glb.mjs MODEL.glb [--mobile] [--json]
import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(join(HERE, '..', 'glb-contract.json'), 'utf8'));

export function readGlbJson(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  if (buf.readUInt32LE(4) !== 2) throw new Error('GLB version is not 2');
  const len = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

export function validate(json, { bytes = 0, mobile = false, hasPaths = false } = {}) {
  const errors = [], warnings = [], info = {};
  const nodes = json.nodes || [];
  const byName = new Map();
  nodes.forEach((n, i) => { if (n.name) { if (byName.has(n.name)) errors.push(`duplicate node name "${n.name}"`); byName.set(n.name, i); } });
  const parentOf = new Map();
  nodes.forEach((n, i) => (n.children || []).forEach(c => parentOf.set(c, i)));
  const nameOf = i => nodes[i]?.name;

  const root = byName.get(contract.root);
  if (root === undefined) errors.push(`missing root node "${contract.root}"`);
  for (const p of contract.parts) {
    const i = byName.get(p.name);
    if (i === undefined) { errors.push(`missing part "${p.name}"`); continue; }
    const want = p.parent || contract.root, got = nameOf(parentOf.get(i));
    if (got !== want) errors.push(`"${p.name}" must be a child of "${want}" (is under "${got ?? 'scene root'}")`);
    const n = nodes[i];
    if (n.scale && n.scale.some(s => Math.abs(s - 1) > 1e-4)) errors.push(`"${p.name}" has scale ${JSON.stringify(n.scale)}: apply scale in Blender (pivots must stay true)`);
    if (n.matrix) warnings.push(`"${p.name}" uses a matrix instead of TRS`);
    const x = n.extras?.libalstal;
    if (!x) errors.push(`"${p.name}" has no extras.libalstal (export_extras=True, custom property "libalstal")`);
    else {
      for (const k of contract.extras.required) if (!(k in x)) errors.push(`"${p.name}" extras.libalstal.${k} missing`);
      if (x.dof && x.dof !== p.dof) warnings.push(`"${p.name}" dof "${x.dof}" (contract says "${p.dof}")`);
      if (x.explode && !(Array.isArray(x.explode) && x.explode.length === 3)) errors.push(`"${p.name}" extras.libalstal.explode must be [x,y,z]`);
    }
  }
  const known = new Set([contract.root, ...contract.parts.map(p => p.name)]);
  const extra = nodes.map(n => n.name).filter(nm => nm && !known.has(nm) && !contract.optionalPrefixes.some(pf => nm.startsWith(pf))
    && !contract.parts.some(p => nm.startsWith(p.name + '_')));   // '<part>_*' = that part's own meshes
  if (extra.length) warnings.push(`${extra.length} node(s) outside the contract: ${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ', …' : ''}`);

  const mats = (json.materials || []).map(m => m.name);
  const badMats = mats.filter(m => !contract.materials.allowed.includes(m));
  if (badMats.length) errors.push(`material name(s) not in the contract: ${badMats.join(', ')}`);

  let tris = 0;
  for (const m of json.meshes || []) for (const pr of m.primitives) {
    const a = json.accessors[pr.indices ?? pr.attributes.POSITION];
    tris += Math.floor(a.count / 3);
  }
  const budget = contract.budgets[mobile ? 'mobile' : 'desktop'];
  info.triangles = tris; info.bytes = bytes; info.nodes = nodes.length; info.animations = (json.animations || []).map(a => a.name);
  if (tris > budget.maxTriangles) errors.push(`${tris} triangles > ${budget.maxTriangles} (${mobile ? 'mobile' : 'desktop'} budget)`);
  if (bytes > budget.maxBytes) errors.push(`${bytes} bytes > ${budget.maxBytes}`);
  if (json.extensionsRequired?.length) warnings.push(`required extensions: ${json.extensionsRequired.join(', ')} (the site must ship their decoders)`);
  if (!hasPaths) warnings.push(`no ${contract.airflow.file} next to the GLB`);
  return { ok: errors.length === 0, errors, warnings, info };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node validate-glb.mjs MODEL.glb [--mobile] [--json]'); process.exit(2); }
  const buf = readFileSync(file);
  const hasPaths = existsSync(join(dirname(file), contract.airflow.file));
  const r = validate(readGlbJson(buf), { bytes: statSync(file).size, mobile: process.argv.includes('--mobile'), hasPaths });
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`${r.ok ? '✓' : '✗'} ${file}  ·  ${r.info.triangles} triangles · ${(r.info.bytes / 1024).toFixed(0)} KB · ${r.info.nodes} nodes · animations: ${r.info.animations.length}`);
    for (const e of r.errors) console.log('  ✗ ' + e);
    for (const w of r.warnings) console.log('  ! ' + w);
  }
  process.exit(r.ok ? 0 : 1);
}

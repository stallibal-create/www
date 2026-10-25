// Validates content/site.json → ductAssembly (used by build.mjs and lint.mjs). Zero dependencies.
// Checks: required fields, mm units, positive numbers, unique ids, FR/EN/AR names, known product links,
// buildable geometry, connector references, a connected tree, matching sections and aligned connectors.
// Components may NOT carry specification fields: verified specs live only in products[].specs.
import { validatePart, PART_TYPES } from '../src/assets/js/assembly/geometry.js';
import { solveAssembly, checkConnections, AssemblyError } from '../src/assets/js/assembly/assembly.js';

const LANGS = ['fr', 'en', 'ar'];
const COMPONENT_KEYS = ['id', 'type', 'productSlug', 'name', 'geometry', 'explode', 'description'];
const isMm = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const isText3 = v => v && typeof v === 'object' && LANGS.every(l => typeof v[l] === 'string' && v[l].trim());

/** @param {any} site parsed site.json @returns {string[]} problems (empty = valid) */
export function validateAssembly(site) {
  const err = [];
  if (site?.ductSystems) for (const [key, a] of Object.entries(site.ductSystems)) for (const issue of validateAssembly({ products: site.products, ductAssembly: a })) err.push(`ductSystems.${key}: ${issue}`);
  const a = site && site.ductAssembly;
  if (!a) return ['ductAssembly missing'];
  if (typeof a.id !== 'string' || !a.id) err.push('ductAssembly.id must be a non-empty string');
  if (a.demo !== true) err.push('ductAssembly.demo must be true (demonstration model)');
  const s = a.settings;
  if (!s || typeof s !== 'object') err.push('ductAssembly.settings missing');
  else {
    if (s.demo !== true) err.push('settings.demo must be true');
    for (const k of ['sheetMm', 'flangeWidthMm', 'flangeDepthMm']) if (!isMm(s[k])) err.push(`settings.${k} must be a positive number of mm`);
  }
  if (!Array.isArray(a.components) || !a.components.length) return [...err, 'ductAssembly.components must be a non-empty array'];
  const slugs = new Set((site.products || []).map(p => p.slug));
  const ids = new Set();
  a.components.forEach((c, i) => {
    const at = `components[${i}]${c && c.id ? ` (${c.id})` : ''}`;
    if (!c || typeof c !== 'object') { err.push(`${at} must be an object`); return; }
    for (const k of Object.keys(c)) if (!COMPONENT_KEYS.includes(k)) err.push(`${at}: unexpected field "${k}" (verified specifications belong in products[].specs)`);
    if (typeof c.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id)) err.push(`${at}: id must match [a-z0-9-]+`);
    else if (ids.has(c.id)) err.push(`${at}: duplicate id "${c.id}"`);
    else ids.add(c.id);
    if (!PART_TYPES.includes(c.type)) err.push(`${at}: type must be one of ${PART_TYPES.join(', ')}`);
    if (!slugs.has(c.productSlug)) err.push(`${at}: productSlug "${c.productSlug}" is not a product in products[]`);
    if (!isText3(c.name)) err.push(`${at}: name needs non-empty fr, en and ar`);
    if (c.description !== null && c.description !== undefined && !isText3(c.description) && typeof c.description !== 'string') err.push(`${at}: description must be null, a string or {fr,en,ar}`);
    if (!c.geometry || c.geometry.demo !== true) err.push(`${at}: geometry.demo must be true until the dimensions are verified`);
    if (c.explode !== undefined) {
      if (!c.explode || typeof c.explode !== 'object' || typeof c.explode.distanceMm !== 'number' || !Number.isFinite(c.explode.distanceMm) || c.explode.distanceMm < 0) err.push(`${at}: explode.distanceMm must be a number ≥ 0`);
      else if (c.explode.direction !== undefined && !(Array.isArray(c.explode.direction) && c.explode.direction.length === 3 && c.explode.direction.every(Number.isFinite) && c.explode.direction.some(v => v !== 0))) err.push(`${at}: explode.direction must be a non-zero [x, y, z]`);
    }
    if (PART_TYPES.includes(c.type) && s) for (const e of validatePart(c, s)) err.push(`${at}: ${e}`);
  });
  if (!Array.isArray(a.connections)) err.push('ductAssembly.connections must be an array of [ "part.connector", "part.connector" ] pairs');
  if (err.length) return err;
  try {
    const solved = solveAssembly(a);
    for (const p of checkConnections(a, solved)) err.push(`misaligned connection ${p}`);
  } catch (e) {
    if (e instanceof AssemblyError) err.push(e.message); else throw e;
  }
  return err;
}

// Static technical preview of the demo assembly: an SVG drawn from the SAME parametric geometry and solved
// transforms as the 3D view (no reference image, no WebGL). Deterministic: same data → same bytes.
// Parallel projection along DEFAULT_VIEW_DIR, back faces culled, painter's sort, flat shading in 6 steps.
// Colours come from CSS classes (.s0–.s5 sheet, .f0–.f5 flange) so the drawing follows the site theme rules.
import { buildPart } from '../src/assets/js/assembly/geometry.js';
import { solveAssembly, DEFAULT_VIEW_DIR } from '../src/assets/js/assembly/assembly.js';
import { applyPoint, applyDir, vNorm, vDot, vCross, vScale } from '../src/assets/js/assembly/units.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** @param {any} asm site.ductAssembly @param {{ title: string, id: string, width?: number }} opts @returns {string} inline SVG */
export function assemblySvg(asm, { title, id, width = 1200 }) {
  const solved = solveAssembly(asm);
  const V = vNorm(DEFAULT_VIEW_DIR);
  const right = vNorm([V[2], 0, -V[0]]);
  const up = vCross(right, vScale(V, -1));
  const L = vNorm([0.35, 1, 0.55]);
  const polys = [];
  for (const c of asm.components) {
    const P = solved.parts.get(c.id);
    const m = buildPart(c, asm.settings, { segments: 8, keepQuads: true });
    for (const q of m.quads) {
      const n = applyDir(P.installed, q.n);
      if (vDot(n, V) <= 1e-6) continue; // back face
      const w = q.p.map(p => applyPoint(P.installed, p));
      const depth = w.reduce((s, p) => s + vDot(p, V), 0) / w.length;
      const shade = Math.min(5, Math.max(0, Math.round((0.3 + 0.7 * Math.max(0, vDot(n, L))) * 5)));
      polys.push({ pts: w.map(p => [vDot(p, right), -vDot(p, up)]), depth, cls: (q.mat === 'flange' ? 'f' : 's') + shade });
    }
  }
  polys.sort((a, b) => a.depth - b.depth);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p.pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const pad = Math.round(width * 0.04), k = (width - 2 * pad) / (maxX - minX);
  const ox = pad - minX * k, oy = pad - minY * k, height = Math.round((maxY - minY) * k + 2 * pad);
  const f = v => (Math.round(v * 10) / 10).toString();
  // consecutive polygons with the same class share one <path> (keeps the painter's order, fewer elements)
  let out = '', cur = null, d = '';
  for (const p of polys) {
    const seg = 'M' + p.pts.map(([x, y]) => `${f(x * k + ox)} ${f(y * k + oy)}`).join('L') + 'Z';
    if (p.cls !== cur) { if (cur) out += `<path class="${cur}" d="${d}"/>`; cur = p.cls; d = seg; } else d += seg;
  }
  if (cur) out += `<path class="${cur}" d="${d}"/>`;
  return `<svg class="asm-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="${id}" focusable="false" direction="ltr"><title id="${id}">${esc(title)}</title>${out}</svg>`;
}

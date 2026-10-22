// Galvanised zinc "spangle" as plain pixel data: irregular crystals, each with its own sheen and a feathered grain,
// plus a matching roughness map. Tileable jittered-grid Voronoi. Pure ES module (no DOM, no three.js), so the
// 3D view, the unit tests and the Blender texture export all use the same pattern.

/** @param {number} size texture edge in px @param {number} cells crystals per edge @param {number} seed
 *  @returns {{ size: number, color: Uint8Array, rough: Uint8Array }} RGBA pixel rows, top to bottom */
export function spangle(size, cells, seed = 1702) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push({ x: (i + rnd()) / cells, y: (j + rnd()) / cells, l: 0.84 + rnd() * 0.08, a: rnd() * Math.PI, f: 40 + rnd() * 60 });
  const color = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, ci = Math.floor(u * cells), cj = Math.floor(v * cells);
    let d1 = 9, d2 = 9, best = pts[0];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells, p = pts[jj * cells + ii];
      const dx = p.x + (ci + di - ii) / cells - u, dy = p.y + (cj + dj - jj) / cells - v, d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
    }
    const edge = Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) * cells * 6);
    // kept subtle: metal reflections amplify every difference (wider ranges read as a mosaic, not zinc)
    const grain = Math.sin((u * Math.cos(best.a) + v * Math.sin(best.a)) * best.f * 6.283) * 0.015;
    const l = Math.max(0, Math.min(1, best.l + grain - (1 - edge) * 0.04));
    const k = (y * size + x) * 4, c = Math.round(l * 255);
    color[k] = c; color[k + 1] = c; color[k + 2] = Math.min(255, c + 4); color[k + 3] = 255;
    const r = Math.max(0, Math.min(255, Math.round((0.3 + (0.92 - best.l) * 0.9 + (1 - edge) * 0.05) * 255)));
    rough[k] = r; rough[k + 1] = r; rough[k + 2] = r; rough[k + 3] = 255;
  }
  return { size, color, rough };
}

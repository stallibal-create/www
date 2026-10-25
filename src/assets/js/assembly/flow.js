// Demonstration streamlines, sampled inside the model airway. This is an illustration, not CFD.
import { applyPoint } from './units.js';

export function sampleAirway(c, t, branch = false) {
  t = Math.max(0, Math.min(1, t));
  const g = c.geometry;
  let p, up = [0, 1, 0], side = [0, 0, 1];
  let w = g.diameterMm || g.inletDiameterMm || g.widthMm || g.inletWidthMm;
  let h = g.diameterMm || g.inletDiameterMm || g.heightMm || g.inletHeightMm;
  if (branch) { p = [g.branchPositionMm, 0, t * (g.widthMm / 2 + g.branchLengthMm)]; side = [-1, 0, 0]; w = g.branchWidthMm; h = g.branchHeightMm; }
  else if (c.type === 'elbow90' || c.type === 'round-elbow') {
    const vertical = g.bendPlane === 'vertical', R = g.innerRadiusMm + (vertical ? h : w) / 2, a = t * Math.PI / 2;
    p = vertical ? [R * Math.sin(a), R * (1 - Math.cos(a)), 0] : [R * Math.sin(a), 0, R * (1 - Math.cos(a))];
    up = vertical ? [-Math.sin(a), Math.cos(a), 0] : [0, 1, 0];
    side = vertical ? [0, 0, 1] : [-Math.sin(a), 0, Math.cos(a)];
  } else {
    p = [t * (g.lengthMm || 30), 0, 0];
    if (c.type === 'round-reducer') w = h = g.inletDiameterMm + t * (g.outletDiameterMm - g.inletDiameterMm);
    if (c.type === 'reducer') { w = g.inletWidthMm + t * (g.outletWidthMm - g.inletWidthMm); h = g.inletHeightMm + t * (g.outletHeightMm - g.inletHeightMm); }
  }
  return { p, up, side, w, h };
}

export function airwayPaths(assembly) {
  return assembly.components.flatMap(c => [false, ...(c.type === 'tee' ? [true] : [])].map(branch => ({
    id: c.id, branch, samples: Array.from({ length: 65 }, (_, i) => sampleAirway(c, i / 64, branch)),
  })));
}

// Pure helper used to check that illustration centre-lines meet the actual duct connectors.
export function worldAirwayPoint(c, transform, t, branch = false) { return applyPoint(transform, sampleAirway(c, t, branch).p); }

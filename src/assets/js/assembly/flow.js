// Demonstration streamlines, sampled inside the model airway. This is an illustration, not CFD.
import { yLayout } from './fittings.js';
import { applyPoint } from './units.js';

export function sampleAirway(c, t, branch = false) {
  t = Math.max(0, Math.min(1, t));
  const g = c.geometry;
  let p, up = [0, 1, 0], side = [0, 0, 1];
  let w = g.diameterMm || g.inletDiameterMm || g.widthMm || g.inletWidthMm;
  let h = g.diameterMm || g.inletDiameterMm || g.heightMm || g.inletHeightMm;
  if (c.type === 'y') {
    const k = yLayout(g), end = branch ? k.branch : k.outlet, sign = branch ? -1 : 1;
    // Smooth, illustrative split, shared inlet. A narrowed lane clears the crotch before widening to the outlet.
    const split = .42;
    if (t <= split) { p = [t / split * k.neckX, 0, 0]; w = g.widthMm * (1 - .55 * t / split); }
    else {
      const q = (t - split) / (1 - split), a = g.branchAngleDeg * Math.PI / 180;
      const start = [k.neckX, 0, 0], control = [g.trunkLengthMm, 0, sign * g.branchWidthMm * .7];
      p = start.map((v, i) => (1-q)*(1-q)*v + 2*(1-q)*q*control[i] + q*q*end.o[i]);
      const dx = 2*(1-q)*(control[0]-start[0])+2*q*(end.o[0]-control[0]), dz = 2*(1-q)*control[2]+2*q*(end.o[2]-control[2]), len = Math.hypot(dx,dz);
      side = [-dz/len,0,dx/len]; w = g.widthMm * .45 + q * (g.branchWidthMm - g.widthMm * .45);
      if (q === 1) side = [-sign*Math.sin(a),0,Math.cos(a)];
    }
  }
  else if (branch) { p = [g.branchPositionMm, 0, t * (g.widthMm / 2 + g.branchLengthMm)]; side = [-1, 0, 0]; w = g.branchWidthMm; h = g.branchHeightMm; }
  else if (c.type === 'elbow90' || c.type === 'round-elbow') {
    const vertical = g.bendPlane === 'vertical', R = g.innerRadiusMm + (vertical ? h : w) / 2, a = t * Math.PI / 2;
    p = vertical ? [R * Math.sin(a), R * (1 - Math.cos(a)), 0] : [R * Math.sin(a), 0, R * (1 - Math.cos(a))];
    up = vertical ? [-Math.sin(a), Math.cos(a), 0] : [0, 1, 0];
    side = vertical ? [0, 0, 1] : [-Math.sin(a), 0, Math.cos(a)];
  } else {
    p = [t * (g.lengthMm || 30), 0, 0];
    if (c.type === 'rect-round') { w = g.inletWidthMm + t * (g.outletDiameterMm - g.inletWidthMm); h = g.inletHeightMm + t * (g.outletDiameterMm - g.inletHeightMm); }
    if (c.type === 'round-reducer') w = h = g.inletDiameterMm + t * (g.outletDiameterMm - g.inletDiameterMm);
    if (c.type === 'reducer') { w = g.inletWidthMm + t * (g.outletWidthMm - g.inletWidthMm); h = g.inletHeightMm + t * (g.outletHeightMm - g.inletHeightMm); }
  }
  return { p, up, side, w, h };
}

export function airwayPaths(assembly) {
  return assembly.components.flatMap(c => [false, ...(['tee', 'y'].includes(c.type) ? [true] : [])].map(branch => ({
    id: c.id, branch, samples: Array.from({ length: 65 }, (_, i) => sampleAirway(c, i / 64, branch)),
  })));
}

// Pure helper used to check that illustration centre-lines meet the actual duct connectors.
export function worldAirwayPoint(c, transform, t, branch = false) { return applyPoint(transform, sampleAirway(c, t, branch).p); }

// Illustrative rectangular Y fitting and slide-on profile frame, in millimetres.
// The catalogue supplies profile/corner ranges, not a manufacturing drawing of these shapes.
import { vAdd, vSub, vScale } from './units.js';

const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const area = p => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);

/** Ear clipping for a simple concave outline. No fan across the Y's open crotch. */
export function triangulateOutline(points) {
  const order = points.map((_, i) => i), triangles = [], sign = Math.sign(area(points));
  const inside = (p, a, b, c) => [cross2(a, b, p), cross2(b, c, p), cross2(c, a, p)].every(x => sign * x >= -1e-8);
  while (order.length > 3) {
    const ear = order.findIndex((b, i) => {
      const a = order[(i + order.length - 1) % order.length], c = order[(i + 1) % order.length];
      return sign * cross2(points[a], points[b], points[c]) > 1e-8 && !order.some(k => k !== a && k !== b && k !== c && inside(points[k], points[a], points[b], points[c]));
    });
    if (ear < 0) throw new Error('Cannot triangulate fitting outline');
    triangles.push([order[(ear + order.length - 1) % order.length], order[ear], order[(ear + 1) % order.length]]);
    order.splice(ear, 1);
  }
  triangles.push(order);
  return triangles;
}

/** One inlet and two open outlets; branchAngleDeg is the half-angle of the Y. */
export function yLayout(g) {
  const a = g.branchAngleDeg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const W = g.widthMm, B = g.branchWidthMm, L = g.trunkLengthMm, R = g.branchLengthMm;
  const neckX = L + (W * cs / 2 - B) / sn;
  const endX = L + R * cs, innerZ = R * sn;
  const outline = [[0, -W / 2], [neckX, -W / 2], [endX - B * sn, -innerZ - B * cs], [endX, -innerZ], [L, 0], [endX, innerZ], [endX - B * sn, innerZ + B * cs], [neckX, W / 2], [0, W / 2]];
  const connector = side => ({ o: [endX - B * sn / 2, 0, side * (innerZ + B * cs / 2)], n: [cs, 0, side * sn], u: [0, 1, 0], w: B, h: g.heightMm });
  return { outline, neckX, outlet: connector(1), branch: connector(-1) };
}

// Offset the metal walls while leaving the three cutting/connector planes fixed.
function outerOutline(points, open, t) {
  const sign = Math.sign(area(points));
  const lines = points.map((p, i) => {
    const q = points[(i + 1) % points.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    const n = [sign * dz / len, -sign * dx / len], d = open.has(i) ? 0 : t;
    return { p: [p[0] + d * n[0], p[1] + d * n[1]], v: [dx, dz], n };
  });
  return { normals: lines.map(l => [l.n[0], 0, l.n[1]]), points: lines.map((b, i) => {
    const a = lines[(i + lines.length - 1) % lines.length], den = a.v[0] * b.v[1] - a.v[1] * b.v[0];
    const d = [b.p[0] - a.p[0], b.p[1] - a.p[1]], k = (d[0] * b.v[1] - d[1] * b.v[0]) / den;
    return [a.p[0] + k * a.v[0], a.p[1] + k * a.v[1]];
  }) };
}

export function buildY(m, g, t) {
  const inner = yLayout(g).outline, open = new Set([2, 5, 8]), outer = outerOutline(inner, open, t);
  const at = (p, y) => [p[0], y, p[1]], H = g.heightMm / 2;
  for (const [points, h, innerSkin] of [[inner, H, true], [outer.points, H + t, false]]) {
    for (const side of [-1, 1]) {
      const normal = [0, side * (innerSkin ? -1 : 1), 0];
      for (const ids of triangulateOutline(points)) m.tri('sheet', ...ids.map(i => at(points[i], side * h)), normal, undefined, true);
    }
  }
  for (let i = 0; i < inner.length; i++) {
    const j = (i + 1) % inner.length, n = outer.normals[i];
    if (!open.has(i)) {
      m.quad('sheet', at(inner[i], -H), at(inner[j], -H), at(inner[j], H), at(inner[i], H), vScale(n, -1));
      m.quad('sheet', at(outer.points[i], -H - t), at(outer.points[j], -H - t), at(outer.points[j], H + t), at(outer.points[i], H + t), n);
    } else {
      for (const side of [-1, 1]) m.quad('sheet', at(inner[i], side * H), at(inner[j], side * H), at(outer.points[j], side * (H + t)), at(outer.points[i], side * (H + t)), n);
      for (const k of [i, j]) m.quad('sheet', at(inner[k], -H), at(inner[k], H), at(outer.points[k], H + t), at(outer.points[k], -H - t), n);
    }
  }
}

// Closed thin section swept along a straight rail; each cut end remains hollow.
function profileRail(m, origin, along, radial, axis, length, F, D) {
  const T = 1; // illustrative profile sheet, not a catalogue specification
  const path = [[D, 3], [D * .58, 3], [D * .4, 7], [D * .4, F - 5], [D * .28, F], [0, F], [0, 0]];
  const left = path.map((p, i) => {
    const prev = path[Math.max(0, i - 1)], next = path[Math.min(path.length - 1, i + 1)];
    const dx = next[0] - prev[0], dy = next[1] - prev[1], n = Math.hypot(dx, dy);
    return [p[0] - T * dy / n, p[1] + T * dx / n];
  });
  const section = [...path, ...left.reverse()];
  const at = (p, l) => vAdd(vAdd(origin, vScale(along, l)), vAdd(vScale(axis, p[0]), vScale(radial, p[1])));
  const sign = Math.sign(area(section));
  for (let i = 0; i < section.length; i++) {
    const j = (i + 1) % section.length, a = section[i], b = section[j];
    const n = vAdd(vScale(axis, sign * (b[1] - a[1])), vScale(radial, -sign * (b[0] - a[0])));
    m.quad('flange', at(a, 0), at(b, 0), at(b, length), at(a, length), n);
  }
  for (const l of [0, length]) for (const ids of triangulateOutline(section)) m.tri('flange', ...ids.map(i => at(section[i], l)), vScale(along, l === 0 ? -1 : 1));
}

// Actual perforations: two faces and the walls of an eight-sided hole, rather than painted discs.
function perforatedPlate(m, at, bounds, thickness, normal, holeRadius) {
  const [y0, z0, y1, z1] = bounds, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const angles = [...new Set([0, Math.PI / 2, Math.PI, -Math.PI / 2, ...[[y0,z0],[y1,z0],[y1,z1],[y0,z1]].map(([y,z]) => Math.atan2(z-cz,y-cy))])].sort((a,b)=>a-b);
  const inside = angles.map(a => [cy + holeRadius * Math.cos(a), cz + holeRadius * Math.sin(a)]);
  const outside = angles.map(a => {
    const dy = Math.cos(a), dz = Math.sin(a), k = Math.min(Math.abs(dy) < 1e-9 ? Infinity : ((dy > 0 ? y1 : y0)-cy)/dy, Math.abs(dz) < 1e-9 ? Infinity : ((dz > 0 ? z1 : z0)-cz)/dz);
    return [cy+k*dy,cz+k*dz];
  });
  for (let i=0;i<angles.length;i++) {
    const j=(i+1)%angles.length, A=outside[i], B=outside[j], a=inside[i], b=inside[j];
    for(const h of [0,thickness]) m.quad('hardware',at(...A,h),at(...B,h),at(...b,h),at(...a,h),vScale(normal,h===0?-1:1),true);
    const innerNormal = vSub(at(cy,cz,0),at((a[0]+b[0])/2,(a[1]+b[1])/2,0));
    const outerNormal = vSub(at((A[0]+B[0])/2,(A[1]+B[1])/2,0),at(cy,cz,0));
    m.quad('hardware',at(...a,0),at(...b,0),at(...b,thickness),at(...a,thickness),innerNormal,true);
    m.quad('hardware',at(...A,0),at(...B,0),at(...B,thickness),at(...A,thickness),outerNormal,true);
  }
}

export function buildProfileFrame(m, g, s) {
  const X=[1,0,0],Y=[0,1,0],Z=[0,0,1], F=s.flangeWidthMm,D=s.flangeDepthMm,t=s.sheetMm;
  const hy=g.heightMm/2+t,wz=g.widthMm/2+t;
  for(const sign of [-1,1]) {
    profileRail(m,[0,sign*hy,-wz],Z,[0,sign,0],X,2*wz,F,D);
    profileRail(m,[0,-hy,sign*wz],Y,[0,0,sign],X,2*hy,F,D);
  }
  for(const sy of [-1,1]) for(const sz of [-1,1]) {
    const at=(y,z,x)=>[D*.18+x,sy*(hy+y),sz*(wz+z)], leg=F*1.6;
    // A corner pad and two insertion arms form a true L. Thickness chosen within the owner's 2/3 mm range.
    for(const rect of [[0,0,F,F],[-leg,0,0,F],[0,-leg,F,0]]) perforatedPlate(m,at,rect,2,X,rect[0]===0&&rect[1]===0?4.5:3);
  }
}

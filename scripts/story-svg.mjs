// "Du plan au métal" — build-time drawings for the homepage scroll story (v14).
// One real sheet-metal part, a square-to-round transition, drawn three ways from the SAME geometry:
//   1. plan      — isometric line drawing with fold lines and dimension letters (a, Ø d, h)
//   2. pattern   — its true flat pattern (développé), unfolded triangle by triangle with true lengths
//   3. formed    — the folded part, faceted and flat-shaded (painter's sort, back faces darker)
// Proportions are illustrative (labels are letters, never figures), so nothing here claims a real spec.
// Deterministic: same input → same bytes. Strokes carry pathLength="1" so CSS/JS can "draw" them by scroll.

const N = 16;                        // points on the round end (4 per quadrant)
const A = 1, R = 0.34, H = 0.78;     // square side, circle radius, height (unitless)
const f = v => (Math.round(v * 10) / 10).toString();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- 3D model ----------
const corners = [45, 135, 225, 315].map(d => { const t = d * Math.PI / 180; return [Math.sign(Math.cos(t)) * A / 2, 0, Math.sign(Math.sin(t)) * A / 2]; });
const circle = Array.from({ length: N }, (_, j) => { const t = j * 2 * Math.PI / N; return [R * Math.cos(t), H, R * Math.sin(t)]; });
const P = j => circle[((j % N) + N) % N];
const M = [A / 2, 0, 0]; // seam: middle of the +x side, up to P(0)

/** Triangles in unfolding order: [a, b, c] vertices {id, v}; a-b is the edge shared with the previous triangle. */
function triangles() {
  const C = k => ({ id: 'C' + k, v: corners[k] }), Pj = j => ({ id: 'P' + j, v: P(j) }); // P16 is P0 in space, a new point on the pattern
  const t = [[{ id: 'M', v: M }, Pj(0), C(0)]];
  for (let k = 0; k < 4; k++) {
    for (let j = 4 * k; j < 4 * k + 4; j++) t.push([C(k), Pj(j), Pj(j + 1)]);            // fan of corner k
    if (k < 3) t.push([Pj(4 * k + 4), C(k), C(k + 1)]);                                   // flat side k → k+1
  }
  t.push([Pj(16), C(3), { id: 'M2', v: M }]);                                             // closing half of the seam side
  return t;
}
// note: corners[k] sits at 45°+90°k, so fan k spans circle points 4k…4k+4 (0°+90°k … 90°+90°k).
// The first quarter (0°…90°) belongs to corner 0 (45°): correct.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(...a);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// isometric projection (y up) → 2D
const ISO = ([x, y, z]) => [(x - z) * Math.cos(Math.PI / 6), -y + (x + z) * Math.sin(Math.PI / 6)];
const VIEW = norm([-1, -1, -1]); // direction the isometric viewer looks along (for culling/depth)

function fit(points2d, width, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points2d) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const k = (width - 2 * pad) / (x1 - x0);
  return { k, ox: pad - x0 * k, oy: pad - y0 * k, height: Math.round((y1 - y0) * k + 2 * pad) };
}

// ---------- 1. plan ----------
function planSvg({ id, title }) {
  const W = 640, pad = 92;
  const all = [...corners, ...circle].map(ISO);
  const { k, ox, oy, height } = fit(all, W, pad);
  const p = v => { const [x, y] = ISO(v); return [x * k + ox, y * k + oy]; };
  const L = (a, b, cls) => `<path class="${cls}" pathLength="1" d="M${f(p(a)[0])} ${f(p(a)[1])}L${f(p(b)[0])} ${f(p(b)[1])}"/>`;
  const front = v => dot(norm([v[0], 0, v[2]]), norm([1, 0, 1])) > -0.2; // crude: back half drawn hidden
  let s = '';
  // square outline (back edges hidden), circle, fold lines
  for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4]; s += L(a, b, front([(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2]) ? 'ln o' : 'ln h'); }
  s += `<path class="ln o" pathLength="1" d="${circle.map((c, i) => (i ? 'L' : 'M') + f(p(c)[0]) + ' ' + f(p(c)[1])).join('')}Z"/>`;
  for (let kq = 0; kq < 4; kq++) for (let j = 4 * kq; j <= 4 * kq + 4; j++) s += L(corners[kq], P(j), front(P(j)) && front(corners[kq]) ? 'ln f' : 'ln h');
  s += L(M, P(0), 'ln seam');
  // dimensions (letters only)
  const c0 = p(corners[0]), c3 = p(corners[3]), c2 = p(corners[2]);
  const dimA = (() => { const off = 34, [x1, y1] = c3, [x2, y2] = c0; const nx = (y2 - y1), ny = -(x2 - x1), l = Math.hypot(nx, ny); const dx = nx / l * off, dy = ny / l * off;
    return `<path class="dim" d="M${f(x1)} ${f(y1)}L${f(x1 + dx)} ${f(y1 + dy)}M${f(x2)} ${f(y2)}L${f(x2 + dx)} ${f(y2 + dy)}M${f(x1 + dx * .8)} ${f(y1 + dy * .8)}L${f(x2 + dx * .8)} ${f(y2 + dy * .8)}"/><text class="dt" x="${f((x1 + x2) / 2 + dx * 1.25)}" y="${f((y1 + y2) / 2 + dy * 1.25 + 5)}">a</text>`; })();
  const top = circle.map(c => p(c)); const tx = Math.max(...top.map(q => q[0])), ty = Math.min(...top.map(q => q[1]));
  const dimD = `<text class="dt" x="${f(tx + 18)}" y="${f(ty + 4)}">Ø d</text>`;
  const left = corners.map(p).reduce((m, q) => (q[0] < m[0] ? q : m)); // leftmost base corner
  const hk = H * k, hx = left[0] - 28, yb = left[1], yt = left[1] - hk;
  const dimH = `<path class="dim" d="M${f(left[0] - 6)} ${f(yb)}L${f(hx - 8)} ${f(yb)}M${f(hx)} ${f(yb)}L${f(hx)} ${f(yt)}M${f(hx - 8)} ${f(yt)}L${f(hx + 8)} ${f(yt)}"/><text class="dt" x="${f(hx - 20)}" y="${f((yb + yt) / 2 + 5)}">h</text>`;
  const rimR = top.reduce((m, q) => (q[0] > m[0] ? q : m));
  const dimD2 = `<path class="dim" d="M${f(rimR[0] + 3)} ${f(rimR[1])}L${f(tx + 14)} ${f(ty)}"/>`;
  return `<svg class="st-svg st-plan" viewBox="0 0 ${W} ${height}" role="img" aria-labelledby="${id}" focusable="false" direction="ltr"><title id="${id}">${esc(title)}</title>${s}<g class="dims">${dimA}${dimD2}${dimD}${dimH}</g></svg>`;
}

// ---------- 2. flat pattern (true development) ----------
function develop() {
  const T = triangles();
  const pos = new Map(); // vertex id → 2D
  const d3 = (a, b) => len(sub(a.v, b.v));
  const [m0, p0] = T[0];
  pos.set(m0.id, [0, 0]); pos.set(p0.id, [0, -d3(m0, p0)]);
  const side = (A2, B2, q) => Math.sign((B2[0] - A2[0]) * (q[1] - A2[1]) - (B2[1] - A2[1]) * (q[0] - A2[0]));
  const out = [];
  let prev = null; // previous triangle's 2D vertices by id
  for (const [a, b, c] of T) {
    const A2 = pos.get(a.id), B2 = pos.get(b.id);
    // c by true lengths, on the far side of the shared edge from the previous triangle's third vertex
    const ra = d3(a, c), rb = d3(b, c), dx = B2[0] - A2[0], dy = B2[1] - A2[1], d = Math.hypot(dx, dy);
    const x = (ra * ra - rb * rb + d * d) / (2 * d), h = Math.sqrt(Math.max(0, ra * ra - x * x));
    const ex = dx / d, ey = dy / d, bx = A2[0] + ex * x, by = A2[1] + ey * x;
    const s1 = [bx - ey * h, by + ex * h], s2 = [bx + ey * h, by - ex * h];
    let C2 = s2;
    if (prev) { const third = Object.entries(prev).find(([id]) => id !== a.id && id !== b.id)[1]; C2 = side(A2, B2, s1) === side(A2, B2, third) ? s2 : s1; }
    pos.set(c.id, C2);
    out.push([A2, B2, C2]);
    prev = { [a.id]: A2, [b.id]: B2, [c.id]: C2 };
  }
  return out;
}

function patternSvg({ id, title }) {
  const W = 640, pad = 40;
  const tris = develop();
  const pts = tris.flat();
  const { k, ox, oy, height } = fit(pts, W, pad);
  const q = ([x, y]) => `${f(x * k + ox)} ${f(y * k + oy)}`;
  // outline = boundary edges (edges used by exactly one triangle); folds = interior edges
  const ek = (a, b) => [q(a), q(b)].sort().join('|');
  const count = new Map(), edges = new Map();
  for (const t of tris) for (let i = 0; i < 3; i++) { const a = t[i], b = t[(i + 1) % 3], kk = ek(a, b); count.set(kk, (count.get(kk) || 0) + 1); edges.set(kk, [a, b]); }
  let outline = '', folds = '';
  for (const [kk, [a, b]] of edges) { const seg = `M${q(a)}L${q(b)}`; if (count.get(kk) === 1) outline += seg; else folds += seg; }
  const fill = tris.map(t => `M${t.map(q).join('L')}Z`).join('');
  return `<svg class="st-svg st-pattern" viewBox="0 0 ${W} ${height}" role="img" aria-labelledby="${id}" focusable="false" direction="ltr"><title id="${id}">${esc(title)}</title><path class="sheet" d="${fill}"/><path class="ln f" pathLength="1" d="${folds}"/><path class="ln o" pathLength="1" d="${outline}"/></svg>`;
}

// ---------- 3. formed part (faceted, flat-shaded) ----------
function formedSvg({ id, title }) {
  const W = 640, pad = 70;
  const T = triangles().map(t => t.map(x => x.v));
  const all = [...corners, ...circle].map(ISO);
  const { k, ox, oy, height } = fit(all, W, pad);
  const q = v => { const [x, y] = ISO(v); return `${f(x * k + ox)} ${f(y * k + oy)}`; };
  const Lgt = norm([-0.25, 0.75, 0.9]);
  const centre = [0, H / 2, 0];
  const polys = T.map(tri => {
    let n = norm(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
    const mid = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3];
    if (dot(n, sub(mid, centre)) < 0) n = n.map(x => -x); // outward
    const facing = dot(n, VIEW) < 0;
    const depth = dot(mid, VIEW);
    const shade = Math.max(0, Math.min(5, Math.round((0.1 + 0.9 * Math.max(0, dot(n, Lgt))) * 5)));
    return { tri, depth, cls: facing ? 's' + shade : 'in' };
  }).sort((a, b) => b.depth - a.depth);
  const body = polys.map(p => `<path class="${p.cls}" d="M${p.tri.map(q).join('L')}Z"/>`).join('');
  const rim = `<path class="rim" d="${circle.map((c, i) => (i ? 'L' : 'M') + q(c)).join('')}Z"/>`;
  return `<svg class="st-svg st-formed" viewBox="0 0 ${W} ${height}" role="img" aria-labelledby="${id}" focusable="false" direction="ltr"><title id="${id}">${esc(title)}</title>${body}${rim}</svg>`;
}

export function storySvgs(titles) {
  return {
    plan: planSvg({ id: 'st-t1', title: titles.plan }),
    pattern: patternSvg({ id: 'st-t2', title: titles.pattern }),
    formed: formedSvg({ id: 'st-t3', title: titles.formed }),
  };
}

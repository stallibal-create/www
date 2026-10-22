// Assembly page: part list + information panel (plain HTML, works without WebGL) and the lazily loaded 3D view.
// The 3D code (viewer.js, then three.js) is requested only when the view approaches the viewport. Without WebGL,
// with data saver, or on any error, the static SVG drawing and the full part list stay in place.
// ?debug3d=1 adds a development-only diagnostics panel (English, not translated); &simulate=init|blank|lost
// forces a failure path so the fallback can be checked on a real device.

const root = document.getElementById('asm');
if (root) init();

function init() {
  const data = JSON.parse(document.getElementById('asm-data').textContent);
  const S = data.strings;
  const fig = root.querySelector('.asm-view');
  const host = root.querySelector('.asm-canvas');
  const status = root.querySelector('.asm-status');
  const picks = [...root.querySelectorAll('.asm-pick')];
  const panel = root.querySelector('.asm-panel');
  const empty = panel.querySelector('.asm-empty');
  const cards = new Map([...panel.querySelectorAll('.asm-part')].map(a => [a.dataset.part, a]));
  const pickFor = id => picks.find(b => b.dataset.part === id);
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug3d');
  const simulate = debug ? params.get('simulate') : null;
  const diag = debug ? diagnostics(fig) : null;
  let current = null, viewer = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  // Do not autoplay repeatedly within one browser tab. Storage is optional (e.g. private mode).
  const introKey = 'libalstal-assembly-intro-v12';
  const introSeen = () => { try { return sessionStorage.getItem(introKey) === '1'; } catch { return false; } };
  const rememberIntro = () => { try { sessionStorage.setItem(introKey, '1'); } catch { /* storage restricted */ } };
  const controls = new Map([...root.querySelectorAll('.asm-tools [data-cmd]')].map(b => [b.dataset.cmd, b]));
  if (reducedMotion.matches) controls.get('replay').disabled = true;
  reducedMotion.addEventListener?.('change', () => { controls.get('replay').disabled = reducedMotion.matches; if (reducedMotion.matches && viewer) viewer.skipIntro(); });
  function onMotion(s) {
    fig.dataset.motion = s.mode;
    controls.get('skip').hidden = s.mode !== 'intro';
    if (fig.dataset.state === '3d') { const msg = s.mode === 'intro' ? S.playing : ''; if (status.textContent !== msg) status.textContent = msg; }
    if (diag) diag.set({ motion: `${s.mode} · ${(s.factor * 100).toFixed(0)}%` });
  }

  // ---------- selection (shared by the list and the 3D view) ----------
  function select(id, { focus = true } = {}) {
    current = id;
    for (const b of picks) b.setAttribute('aria-pressed', String(b.dataset.part === id));
    for (const [k, a] of cards) a.classList.toggle('is-on', k === id);
    empty.hidden = !!id;
    if (viewer) { viewer.interrupt(); viewer.setSelected(id); }
    if (diag) diag.set({ selected: id || '—' });
    if (id && focus) cards.get(id).querySelector('.asm-part-h').focus();
  }
  function close() {
    const back = current && pickFor(current);
    select(null);
    if (back) back.focus(); // focus returns to the part's entry in the list
  }
  for (const b of picks) b.addEventListener('click', () => (b.dataset.part === current ? close() : select(b.dataset.part)));
  for (const a of cards.values()) a.querySelector('.asm-close').addEventListener('click', close);
  panel.addEventListener('keydown', e => { if (e.key === 'Escape' && current) { e.preventDefault(); close(); } });

  // ---------- 3D view, loaded on approach ----------
  const setState = (state, msg = '') => { fig.dataset.state = state; status.textContent = msg; if (diag) diag.set({ state }); };
  const saveData = navigator.connection && (navigator.connection.saveData || /(^|-)2g$/.test(navigator.connection.effectiveType || ''));

  root.addEventListener('keydown', e => {
    if (e.key === 'Escape' && viewer && fig.dataset.motion === 'intro') {
      e.preventDefault(); viewer.skipIntro();
    }
  });
  for (const b of controls.values()) b.addEventListener('click', () => {
    if (!viewer) return;
    const c = b.dataset.cmd;
    if (c === 'left') viewer.rotate(-30);
    else if (c === 'right') viewer.rotate(30);
    else if (c === 'in') viewer.zoom(0.8);
    else if (c === 'out') viewer.zoom(1.25);
    else if (c === 'reset') viewer.reset();
    else if (c === 'skip') viewer.skipIntro();
    else if (c === 'explode') viewer.explode(reducedMotion.matches);
    else if (c === 'reassemble') viewer.reassemble(reducedMotion.matches);
    else if (c === 'replay' && !reducedMotion.matches) { rememberIntro(); viewer.playIntro(); }
  });

  const io = new IntersectionObserver(es => {
    if (!es[0].isIntersecting) return;
    io.disconnect();
    // checked only now: even the WebGL probe context is not created before the view is near
    if (saveData) { setState('fallback', S.saveData); if (diag) diag.set({ status: 'not started: data saver' }); return; }
    const gl = webgl2();
    if (diag) diag.set({ webgl: gl ? `WebGL 2 available — ${gl}` : 'WebGL 2 NOT available' });
    if (!gl && simulate !== 'init') { setState('fallback', S.unavailable); if (diag) diag.set({ status: 'not started: no WebGL 2' }); return; }
    setState('loading', S.loading);
    if (diag) diag.set({ status: 'loading modules' });
    import('./viewer.js')
      .then(m => m.createViewer({
        host, assembly: data.assembly, modelUrl: data.model, debug, simulate,
        onSelect: id => select(id),
        onLost: () => setState('lost', S.lost),
        onRestored: () => setState('3d'),
        onDiag: p => diag && diag.set(p),
        onMotion,
      }))
      .then(v => {
        viewer = v; setState('3d'); if (current) v.setSelected(current);
        onMotion({ mode: 'idle', factor: 0 });
        if (!current && !reducedMotion.matches && !introSeen()) { rememberIntro(); v.playIntro(); }
        if (diag) { diag.set({ status: `rendered — first frame verified (${v.stats().initMs} ms)` }); diag.poll(v); }
      })
      .catch(err => {
        console.warn('[assembly3d] static drawing kept:', err && err.message);
        setState('fallback', S.unavailable);
        if (diag) diag.set({ status: `FAILED: ${err && err.message} — SVG drawing kept` });
      });
  }, { rootMargin: '300px 0px' });
  io.observe(fig);
}

/** @returns {string|null} renderer description when a WebGL 2 context can be created, else null */
function webgl2() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const desc = `${gl.getParameter(gl.VERSION)} · ${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`;
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); // free the probe context
    return desc;
  } catch { return null; }
}

// ---------- development diagnostics (?debug3d=1) ----------
function diagnostics(after) {
  const ROWS = [['state', 'View state'], ['webgl', 'WebGL availability'], ['status', 'Renderer'], ['geometry', 'Geometry source'], ['painted', 'First frame (drawn pixels)'],
    ['shaderErrors', 'Shader compile / link errors'], ['frames', 'Frames rendered'], ['draw', 'Draw calls / triangles'],
    ['selected', 'Selected component'], ['motion', 'Motion state'], ['resolution', 'Rendering resolution'], ['context', 'Context loss / restore'], ['contextEvent', 'Last context event'], ['camera', 'Camera (distance / home, elevation)']];
  const box = document.createElement('section');
  box.className = 'asm-diag';
  box.setAttribute('aria-label', '3D diagnostics (development only)');
  const h = document.createElement('h2'); h.className = 'h3'; h.textContent = '3D diagnostics — development only'; box.append(h);
  const dl = document.createElement('dl'); box.append(dl);
  const cells = {};
  for (const [k, label] of ROWS) {
    const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    row.dataset.key = k; dt.textContent = label; dd.textContent = k === 'selected' ? '—' : k === 'shaderErrors' ? 'none' : '…';
    row.append(dt, dd); dl.append(row); cells[k] = dd;
  }
  after.after(box);
  const fmt = (k, v) => k === 'painted' ? (v == null ? '…' : `${(v * 100).toFixed(1)} % of sampled centre pixels`) : k === 'shaderErrors' ? (v.length ? v.join(' ‖ ') : 'none') : String(v);
  const set = patch => { for (const [k, v] of Object.entries(patch)) if (cells[k]) cells[k].textContent = fmt(k, v); };
  const poll = v => {
    const tick = () => {
      const s = v.stats();
      set({ frames: s.frames, draw: `${s.calls} / ${s.triangles}`, resolution: `${s.buffer[0]} × ${s.buffer[1]} px buffer (${s.css[0]} × ${s.css[1]} CSS px, pixel ratio ${s.dpr}, ${s.profile} profile)`,
        context: `${s.contextLost} lost / ${s.contextRestored} restored`, camera: `${s.camera.distance.toFixed(3)} m / ${s.camera.homeDistance.toFixed(3)} m, ${(s.camera.elevation * 180 / Math.PI).toFixed(1)}°`, selected: s.selected || '—', shaderErrors: s.shaderErrors, painted: s.painted });
    };
    tick(); setInterval(tick, 250);
  };
  set({ context: '0 lost / 0 restored', contextEvent: '—', frames: 0 });
  return { set, poll };
}

// Small, deterministic motion timeline. Pure ES module: no DOM, Three.js or timer dependencies.
// The renderer supplies elapsed visible-frame time; hidden pages do not advance the animation.
// Every pose is evaluated from its immutable installed transform plus a scalar explode offset.
export const INTRO_DURATION_MS = 5600;
export const PART_DURATION_MS = 950;
export const INTRO_ORBIT_RAD = 0.76;
/** The intro keeps the parts installed until this time, then separates them. */
export const INTRO_EXPLODE_FROM_MS = 1700;
const clamp = n => Math.min(1, Math.max(0, n));
export const smoothstep = t => { const x = clamp(t); return x * x * (3 - 2 * x); };

/** @returns {{mode:'idle'|'intro'|'explode'|'reassemble',factor:number,orbitRad:number,running:boolean}} */
export function createMotion(onState = () => {}) {
  let mode = 'idle', factor = 0, orbitRad = 0, elapsed = 0, from = 0;
  const snapshot = () => ({ mode, factor, orbitRad, running: mode !== 'idle' });
  const change = next => { mode = next; onState(snapshot()); };
  const stop = () => { factor = 0; orbitRad = 0; elapsed = 0; change('idle'); return snapshot(); };
  return {
    state: snapshot,
    playIntro() { factor = 0; orbitRad = 0; elapsed = 0; change('intro'); return snapshot(); },
    explode(immediate = false) {
      if (immediate) { factor = 1; orbitRad = 0; elapsed = 0; change('idle'); return snapshot(); }
      from = factor; elapsed = 0; orbitRad = 0; change('explode'); return snapshot();
    },
    reassemble(immediate = false) {
      if (immediate) return stop();
      from = factor; elapsed = 0; orbitRad = 0; change('reassemble'); return snapshot();
    },
    // On user input never leave a half-exploded mesh: the intro returns to the installed assembly; an explode or
    // reassemble the visitor asked for jumps to its end instead of being undone.
    interrupt() {
      if (mode === 'explode') { factor = 1; orbitRad = 0; elapsed = 0; change('idle'); return snapshot(); }
      return stop();
    },
    skip: stop,
    /** Advance the timeline; caller is responsible for scheduling frames and applying the resulting pose. */
    tick(dtMs) {
      if (mode === 'idle') return snapshot();
      elapsed += Math.max(0, Number.isFinite(dtMs) ? dtMs : 0);
      if (mode === 'intro') {
        orbitRad = smoothstep(elapsed / INTRO_DURATION_MS) * INTRO_ORBIT_RAD;
        if (elapsed < INTRO_EXPLODE_FROM_MS) factor = 0;
        else if (elapsed < 3400) factor = smoothstep((elapsed - INTRO_EXPLODE_FROM_MS) / 1700);
        else if (elapsed < 3850) factor = 1;
        else factor = 1 - smoothstep((elapsed - 3850) / 1750);
        if (elapsed >= INTRO_DURATION_MS) { factor = 0; change('idle'); }
      } else {
        const to = mode === 'explode' ? 1 : 0;
        factor = from + (to - from) * smoothstep(elapsed / PART_DURATION_MS);
        if (elapsed >= PART_DURATION_MS) { factor = to; change('idle'); }
      }
      return snapshot();
    },
  };
}

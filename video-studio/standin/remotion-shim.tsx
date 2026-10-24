// STAND-IN for the parts of the `remotion` API this project uses — for previewing the composition where the
// Remotion packages can't be installed (the sandbox this intro was written in). It is NOT Remotion: no
// bundler, no concurrency, no audio. Frames are driven by window.__frame(n) from standin/render-standin.mjs.
// Semantics follow the Remotion docs for: interpolate (clamp/extend), Easing.bezier/in/out/inOut/quad,
// useCurrentFrame, useVideoConfig, AbsoluteFill, Img, staticFile, delayRender/continueRender.
import React, { createContext, useContext } from 'react';

type Config = { fps: number; width: number; height: number; durationInFrames: number; id: string };
export const FrameContext = createContext(0);
export const ConfigContext = createContext<Config>({ fps: 30, width: 1920, height: 1080, durationInFrames: 180, id: 'preview' });
export const useCurrentFrame = () => useContext(FrameContext);
export const useVideoConfig = () => useContext(ConfigContext);

// ---- delayRender ----
const pending = new Set<number>(); let next = 1;
export const delayRender = (_label?: string) => { const h = next++; pending.add(h); return h; };
export const continueRender = (h: number) => { pending.delete(h); };
(globalThis as any).__pendingRenders = () => pending.size;

export const staticFile = (p: string) => '/' + p.replace(/^\//, '');

// ---- easing (cubic-bezier solver as in CSS / Remotion) ----
type Ease = (t: number) => number;
function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-7) break; if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1; if (Math.abs(sx(t) - x) > 1e-5) { t = x; for (let i = 0; i < 40; i++) { const v = sx(t); if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
    return sy(t);
  };
}
export const Easing = {
  linear: (t: number) => t,
  quad: (t: number) => t * t,
  cubic: (t: number) => t * t * t,
  bezier,
  in: (e: Ease) => e,
  out: (e: Ease) => (t: number) => 1 - e(1 - t),
  inOut: (e: Ease) => (t: number) => (t < 0.5 ? e(t * 2) / 2 : 1 - e((1 - t) * 2) / 2),
};

type Opts = { extrapolateLeft?: 'clamp' | 'extend'; extrapolateRight?: 'clamp' | 'extend'; easing?: Ease };
export function interpolate(input: number, inR: readonly number[], outR: readonly number[], o: Opts = {}): number {
  let i = 1; while (i < inR.length - 1 && input > inR[i]) i++;
  const a = inR[i - 1], b = inR[i];
  let u = (input - a) / (b - a);
  if (u < 0 && o.extrapolateLeft === 'clamp') u = 0;
  if (u > 1 && o.extrapolateRight === 'clamp') u = 1;
  if (o.easing && u >= 0 && u <= 1) u = o.easing(u);
  return outR[i - 1] + (outR[i] - outR[i - 1]) * u;
}

export const AbsoluteFill = ({ style, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...rest} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', ...style }}>{children}</div>
);

export const Img = (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
  // like Remotion's <Img>: the frame isn't captured until the image has decoded
  const ref = React.useRef<HTMLImageElement>(null);
  React.useLayoutEffect(() => {
    const img = ref.current; if (!img || (img.complete && img.naturalWidth)) return;
    const h = delayRender('img'); const done = () => continueRender(h);
    img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true });
  }, [props.src]);
  return <img ref={ref} {...props} />;
};

// Root-level APIs: only used for registration in src/Root.tsx; the preview entry renders <Welcome> directly.
export const Composition = (_p: any) => null;
export const Folder = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const registerRoot = (_c: any) => {};

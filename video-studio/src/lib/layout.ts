// Shared layout & timing, read from the site's content/intro.json so the video and the live page handoff can't drift.
import intro from '../../../content/intro.json';

export type Format = 'desktop' | 'mobile';
export type Lang = 'fr' | 'en' | 'ar';
export type Rect = readonly [number, number, number, number]; // x, y, w, h

export const INTRO = intro;
export const FPS = intro.fps;
export const DURATION = intro.durationInFrames;
export const T = intro.timing;

export const comp = (format: Format) => intro.compositions[format];

/** seconds → frame number (fractional allowed) */
export const f = (seconds: number) => seconds * FPS;

/** Logo rect on the composition, and the mark's top duct body projected into composition pixels. */
export function logoGeometry(format: Format) {
  const c = comp(format);
  const [lx, ly, lw, lh] = c.logo;
  const k = lw / intro.logo.width;
  const [bx0, by0, bx1, by1] = intro.logo.topDuct.body;
  const [fx0, fy0, fx1, fy1] = intro.logo.topDuct.flange;
  return {
    rect: [lx, ly, lw, lh] as Rect,
    scale: k,
    ductBody: [lx + bx0 * k, ly + by0 * k, (bx1 - bx0) * k, (by1 - by0) * k] as Rect,
    ductFlange: [lx + fx0 * k, ly + fy0 * k, (fx1 - fx0) * k, (fy1 - fy0) * k] as Rect,
  };
}

/** Background colour at time t (s), linear in sRGB between the keys of intro.json → identical curve in the page overlay. */
export function backgroundAt(t: number): string {
  const keys = intro.background as [number, string][];
  const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, c1] = keys[i];
    if (t <= t1) {
      const [t0, c0] = keys[i - 1];
      const u = (t - t0) / (t1 - t0);
      const a = hex(c0), b = hex(c1);
      return '#' + a.map((v, j) => Math.round(v + (b[j] - v) * u).toString(16).padStart(2, '0')).join('');
    }
  }
  return keys[keys.length - 1][1];
}

export const copyFor = (lang: Lang) => intro.copy[lang];

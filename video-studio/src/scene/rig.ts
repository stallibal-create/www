// Camera and light choreography as pure functions of time, so every frame is reproducible on its own
// (Remotion renders frames in any order, in several tabs).
import { Easing, interpolate } from 'remotion';
import { DUCT } from './duct';
import { comp, logoGeometry, type Format } from '../lib/layout';

export const FOV = 18; // vertical, degrees — long-lens product look, little distortion
const SWEEP_SIGN = 1;  // three.js environmentRotation direction relative to camera yaw (checked on rendered frames)

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const settle = Easing.bezier(0.65, 0, 0.25, 1);  // mechanical: decisive start, long precise settle
const glide = Easing.bezier(0.33, 0, 0.2, 1);

const deg = (d: number) => (d * Math.PI) / 180;

/** Distance at which the duct body (height 1) projects to `px` composition pixels. */
function distanceForHeight(px: number, compH: number) {
  return (DUCT.height * compH) / (2 * px * Math.tan(deg(FOV / 2)));
}
/** Distance at which the duct body length fills `frac` of the frame width. */
function distanceForWidth(frac: number, compW: number, compH: number) {
  return DUCT.length / (frac * 2 * Math.tan(deg(FOV / 2)) * (compW / compH));
}

export type Pose = {
  yaw: number; pitch: number; distance: number;
  /** where the duct centre lands on the frame (composition px) */
  centerX: number; centerY: number;
};

export function poseAt(t: number, format: Format): Pose {
  const c = comp(format);
  const g = logoGeometry(format);
  const [bx, by, bw, bh] = g.ductBody;
  const near = distanceForWidth(format === 'desktop' ? 0.44 : 0.64, c.width, c.height);
  const far = distanceForHeight(bh, c.height);
  // scene 01: slow dolly in on a 3/4 view. scene 02: pull back and square up onto the mark's top duct.
  const dolly = interpolate(t, [0, 1.5], [near * 1.1, near], { ...clamp, easing: glide });
  const k = interpolate(t, [1.45, 2.45], [0, 1], { ...clamp, easing: settle });
  const distance = Math.exp(Math.log(dolly) + (Math.log(far) - Math.log(dolly)) * k); // perceptually even zoom
  return {
    yaw: deg(interpolate(t, [0, 1.5, 2.45], [-36, -29, -4], { ...clamp, easing: settle })),
    pitch: deg(interpolate(t, [0, 1.5, 2.45], [13, 11, 3], { ...clamp, easing: settle })),
    distance,
    centerX: c.width / 2 + (bx + bw / 2 - c.width / 2) * k,
    centerY: c.height / 2 + (by + bh / 2 - c.height / 2) * k,
  };
}

/** Light: the studio wakes up from black, then the strip light sweeps across the metal.
 *  On a flat panel facing the camera, the strip is mirrored when its azimuth equals −yaw; the sweep is
 *  expressed relative to that, so the band crosses the front face whatever the camera does meanwhile,
 *  then rests on it as the part settles onto the mark (bright, like the painted duct it hands over to). */
export function lightAt(t: number, format: Format) {
  const { yaw } = poseAt(t, format);
  const sweep = deg(interpolate(t, [0, 1.3, 2.05, 2.45], [-34, -14, 11, 0], { ...clamp, easing: Easing.bezier(0.45, 0, 0.35, 1) }));
  return {
    envIntensity: interpolate(t, [0, 0.15, 1.2], [0, 0.12, 1], { ...clamp, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
    envRotation: SWEEP_SIGN * (-yaw + sweep),
    exposure: interpolate(t, [0, 1.2], [0.95, 1.05], clamp),
    /** the 3D part hands over to the painted mark once it sits exactly on it */
    opacity: Math.min(
      interpolate(t, [0.05, 0.75], [0, 1], { ...clamp, easing: Easing.bezier(0.4, 0, 0.6, 1) }), // emerges, never a black cut-out
      interpolate(t, [2.4, 2.8], [1, 0], { ...clamp, easing: Easing.inOut(Easing.quad) }),
    ),
  };
}

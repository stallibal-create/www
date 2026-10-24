// Deep charcoal ground. The flat colour follows content/intro.json → the page overlay uses the same curve,
// so the edges of the video and the page never differ. A soft studio lift sits behind the part and is gone
// before the handoff, leaving a flat field that equals the homepage hero colour at the end.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { backgroundAt, logoGeometry, type Format } from '../lib/layout';

export const Backdrop = ({ format }: { format: Format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const [lx, ly, lw, lh] = logoGeometry(format).rect;
  const lift = interpolate(t, [0, 1.2, 3.2, 4.5], [0, 1, 0.55, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: backgroundAt(t) }}>
      <AbsoluteFill
        style={{
          opacity: lift,
          background: `radial-gradient(ellipse ${lw * 0.9}px ${lh * 1.6}px at ${lx + lw / 2}px ${ly + lh / 2}px, rgba(127,140,153,.10), rgba(127,140,153,0) 70%)`,
        }}
      />
    </AbsoluteFill>
  );
};

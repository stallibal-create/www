// Scene 02 → 03: the official mark (brand/logo-source.png, untouched pixels) is revealed outward from its own
// top duct — exactly where the 3D part has just come to rest — while the travelling light glances across it once.
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { INTRO, logoGeometry, type Format } from '../lib/layout';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const LogoReveal = ({ format }: { format: Format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const g = logoGeometry(format);
  const [lx, ly, lw, lh] = g.rect;
  const [bx, by, bw, bh] = g.ductBody;
  const cx = bx + bw / 2 - lx, cy = by + bh / 2 - ly;          // reveal origin, in logo-box px
  const far = Math.hypot(Math.max(cx, lw - cx), Math.max(cy, lh - cy));
  const radius = interpolate(t, [2.2, 2.95], [0, far + 140], { ...clamp, easing: Easing.bezier(0.55, 0, 0.2, 1) });
  const feather = 140;
  const mask = `radial-gradient(circle at ${cx}px ${cy}px, #000 ${Math.max(0, radius - feather)}px, transparent ${radius}px)`;
  const src = staticFile(INTRO.logo.file);
  // one restrained glint, masked to the artwork itself
  const sheenX = interpolate(t, [2.5, 3.5], [-0.35, 1.35], { ...clamp, easing: Easing.bezier(0.4, 0, 0.2, 1) });
  const sheenOpacity = interpolate(t, [2.5, 2.8, 3.3, 3.5], [0, 0.3, 0.3, 0], clamp);

  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: lx, top: ly, width: lw, height: lh, WebkitMaskImage: mask, maskImage: mask }}>
        <Img src={src} style={{ width: lw, height: lh, display: 'block' }} />
        <div
          style={{
            position: 'absolute', inset: 0, opacity: sheenOpacity, mixBlendMode: 'screen',
            background: `linear-gradient(105deg, transparent ${(sheenX - 0.12) * 100}%, rgba(255,255,255,.85) ${sheenX * 100}%, transparent ${(sheenX + 0.12) * 100}%)`,
            WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

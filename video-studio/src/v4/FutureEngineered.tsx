// "THE FUTURE OF AIR IS ENGINEERED" — LIBALSTAL V4.1 cinematic welcome, 8 s (240 frames @ 30 fps), 1920×1080.
//
//   0.00–6.00  BLENDER  the real mechanical animation, frame for frame (public/v41-frames/0000–0179.png,
//              Cycles renders of v4.1-claude/libalstal-v4.1.blend). Its last 0.75 s already sits on the exact
//              framing of the official logo, so the hand-off below is a true match, not a morph.
//   5.45–6.20  IDENTITY  the studio dissolves to the site's ground colour while the official emblem (the
//              untouched brand/logo-source.png) takes the place of the 3D one — same pixels, same position.
//   5.90–6.60  the official wordmark is wiped in from the emblem outwards; one restrained glint 6.7–7.3.
//   6.50–7.40  BIENVENUE CHEZ LIBALSTAL (letter-spacing settles) and a fine blue rule.
//   7.40–8.00  hold — the live homepage takes over from this frame (no blank frame, no cut).
// Remotion only composes: no effect here changes or hides the Blender animation.
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import '../lib/fonts';
import { FONT_ARABIC, FONT_LATIN } from '../lib/fonts';
import { INTRO, comp, copyFor, type Lang } from '../lib/layout';

export const V41_FRAMES = 180;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const settle = Easing.bezier(0.16, 1, 0.3, 1);
const GROUND = (INTRO.background as [number, string][]).slice(-1)[0][1];
const EMBLEM_SPLIT = 660 / 2076;             // emblem / wordmark boundary in the official PNG (x, as a fraction)

export const FutureEngineered = ({ lang = 'fr' }: { lang?: Lang }) => {
  const rtl = lang === 'ar';
  const title = copyFor(lang).title;
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const c = comp('desktop');
  const [lx, ly, lw, lh] = c.logo;
  const blenderFrame = Math.min(frame, V41_FRAMES - 1);

  const identity = interpolate(t, [5.45, 6.2], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const wipe = interpolate(t, [5.9, 6.6], [0, 1], { ...clamp, easing: Easing.bezier(0.55, 0, 0.2, 1) });
  const sheenX = interpolate(t, [6.7, 7.3], [-0.3, 1.3], { ...clamp, easing: Easing.bezier(0.4, 0, 0.2, 1) });
  const sheen = interpolate(t, [6.7, 6.85, 7.15, 7.3], [0, 0.28, 0.28, 0], clamp);
  const titleIn = interpolate(t, [6.5, 7.1], [0, 1], { ...clamp, easing: settle });
  // Arabic is never letter-spaced (it would break the joins): it fades and settles instead
  const tracking = rtl ? 0 : interpolate(t, [6.5, 7.4], [c.titleTracking + 0.3, c.titleTracking], { ...clamp, easing: settle });
  const rule = interpolate(t, [6.85, 7.4], [0, 1], { ...clamp, easing: settle });
  const push = interpolate(t, [6.0, 8.0], [1, 1.012], clamp);           // one slow breath on the final composition
  const src = staticFile(INTRO.logo.file);
  const splitPx = lw * EMBLEM_SPLIT;
  const edge = splitPx - 120 + (lw - splitPx + 240) * wipe;            // feathered edge travels from the emblem to the end
  const wordMask = `linear-gradient(90deg, #000 ${edge - 120}px, transparent ${edge}px)`;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: `${lx + splitPx / 2}px ${ly + lh / 2}px` }}>
        {/* 1 · the Blender animation, 1280×720 Cycles frames scaled to the composition */}
        <Img src={staticFile(`v41-frames/${String(blenderFrame).padStart(4, '0')}.png`)}
             style={{ position: 'absolute', inset: 0, width, height, objectFit: 'cover' }} />
        {/* 2 · the studio gives way to the site's ground colour */}
        <AbsoluteFill style={{ backgroundColor: GROUND, opacity: identity }} />
        {/* 3 · official emblem, crossfading onto the 3D emblem it is aligned with */}
        <div style={{ position: 'absolute', left: lx, top: ly, width: lw, height: lh, opacity: identity,
                      clipPath: `inset(0 ${lw - splitPx}px 0 0)` }}>
          <Img src={src} style={{ width: lw, height: lh, display: 'block' }} />
        </div>
        {/* 4 · official wordmark, wiped in from the emblem outwards */}
        <div style={{ position: 'absolute', left: lx, top: ly, width: lw, height: lh,
                      clipPath: `inset(0 0 0 ${splitPx}px)`, WebkitMaskImage: wordMask, maskImage: wordMask, opacity: wipe > 0 ? 1 : 0 }}>
          <Img src={src} style={{ width: lw, height: lh, display: 'block' }} />
        </div>
        {/* 5 · a single glint across the artwork, masked to its own pixels */}
        <div style={{ position: 'absolute', left: lx, top: ly, width: lw, height: lh, opacity: sheen, mixBlendMode: 'screen',
                      background: `linear-gradient(105deg, transparent ${(sheenX - 0.1) * 100}%, rgba(255,255,255,.85) ${sheenX * 100}%, transparent ${(sheenX + 0.1) * 100}%)`,
                      WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' }} />
        {/* 6 · welcome line + rule */}
        <div style={{ position: 'absolute', left: 0, width, top: c.titleY, translate: `0 ${-c.titleSize * 0.62}px`,
                      textAlign: 'center', whiteSpace: 'nowrap', fontFamily: `"${rtl ? FONT_ARABIC : FONT_LATIN}", sans-serif`, fontWeight: rtl ? 700 : 600, direction: rtl ? 'rtl' : 'ltr',
                      fontSize: rtl ? c.titleSize * 1.15 : c.titleSize, lineHeight: 1.2, color: '#E8ECEF', opacity: titleIn,
                      letterSpacing: `${tracking}em`, paddingInlineStart: `${tracking}em` }}>
          {title}
        </div>
        <div style={{ position: 'absolute', top: c.ruleY, left: width / 2 - 70 * rule, width: 140 * rule, height: 2,
                      background: '#1E5BA8', opacity: rule }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

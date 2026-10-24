// Scene 03: "BIENVENUE CHEZ LIBALSTAL", a fine RAL 5017 rule, then the tagline in RAL 7001.
// Letter-spacing closes in from wide to set, with opacity — no glow, no bounce. Scene 04 dissolves it.
// Arabic is never letter-spaced (it would break the joins): it fades and settles instead.
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT_ARABIC, FONT_LATIN } from '../lib/fonts';
import { comp, copyFor, type Format, type Lang } from '../lib/layout';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);

/** Largest font size ≤ `size` whose tracked line fits `maxWidth`. Measured with the loaded font. */
function fitSize(text: string, family: string, weight: number, size: number, trackingEm: number, maxWidth: number) {
  if (typeof document === 'undefined') return size;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return size;
  for (let s = size; s > 8; s -= 0.5) {
    ctx.font = `${weight} ${s}px "${family}"`;
    const w = ctx.measureText(text).width + trackingEm * s * text.length;
    if (w <= maxWidth) return s;
  }
  return 8;
}

export const WelcomeText = ({ format, lang }: { format: Format; lang: Lang }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const c = comp(format);
  const copy = copyFor(lang);
  const rtl = lang === 'ar';
  const family = rtl ? FONT_ARABIC : FONT_LATIN;
  const titleTrack = rtl ? 0 : c.titleTracking;
  const tagTrack = rtl ? 0 : c.taglineTracking;
  const titleSize = fitSize(copy.title, family, 600, rtl ? c.titleSize * 1.15 : c.titleSize, titleTrack, c.textMaxWidth);
  const tagSize = fitSize(copy.tagline, family, 500, rtl ? c.taglineSize * 1.2 : c.taglineSize, tagTrack, c.textMaxWidth);

  const dissolve = interpolate(t, [4.75, 5.1], [1, 0], { ...clamp, easing: Easing.in(Easing.quad) });
  const drift = interpolate(t, [4.75, 5.1], [0, 0.04], clamp);  // a breath of extra spacing as it dissolves

  const line = (y: number, size: number): React.CSSProperties => ({
    position: 'absolute', left: 0, width, top: y, translate: `0 ${-size * 0.62}px`,
    textAlign: 'center', whiteSpace: 'nowrap', lineHeight: 1.2, fontFamily: `"${family}", sans-serif`,
    direction: rtl ? 'rtl' : 'ltr', fontKerning: 'normal', textRendering: 'geometricPrecision',
  });

  const titleIn = interpolate(t, [3.05, 3.65], [0, 1], { ...clamp, easing: ease });
  const titleTracking = rtl ? 0 : interpolate(t, [3.05, 4.0], [titleTrack + 0.28, titleTrack], { ...clamp, easing: ease }) + drift;
  const tagIn = interpolate(t, [3.7, 4.3], [0, 1], { ...clamp, easing: ease });
  const tagTracking = rtl ? 0 : interpolate(t, [3.7, 4.45], [tagTrack + 0.24, tagTrack], { ...clamp, easing: ease }) + drift;

  return (
    <AbsoluteFill style={{ opacity: dissolve }}>
      <div
        style={{
          ...line(c.titleY, titleSize), fontSize: titleSize, fontWeight: 600, color: '#E8ECEF',
          letterSpacing: `${titleTracking}em`, paddingInlineStart: `${titleTracking}em`, // keeps tracked text optically centred
          opacity: titleIn, translate: `0 ${-titleSize * 0.62 + (rtl ? (1 - titleIn) * 10 : 0)}px`,
        }}
      >
        {copy.title}
      </div>
      <div
        style={{
          position: 'absolute', top: c.ruleY, left: width / 2 - 36, width: 72, height: format === 'desktop' ? 1.5 : 2.5,
          background: '#0066CC',
          scale: `${interpolate(t, [3.5, 4.1], [0, 1], { ...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1) })} 1`,
        }}
      />
      <div
        style={{
          ...line(c.taglineY, tagSize), fontSize: tagSize, fontWeight: 500, color: '#9aa6b2',
          letterSpacing: `${tagTracking}em`, paddingInlineStart: `${tagTracking}em`, opacity: tagIn,
        }}
      >
        {copy.tagline}
      </div>
    </AbsoluteFill>
  );
};

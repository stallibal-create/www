import React from 'react';
import {
  AbsoluteFill,
  Img,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
  staticFile,
} from 'remotion';
import config from '../../../content/photo-hero.json';
import { PHOTO_HERO_TIMING } from '../../../src/assets/js/photo-hero-timing.js';

type Lang = 'fr' | 'en' | 'ar';

export type PhotoHeroProps = {
  lang: Lang;
  mobile: boolean;
  theme?: 'dark' | 'light';
};

type SlideCopy = {
  label: string;
  caption: string;
  alt: string;
  titleLines: [string, string];
  lead: string;
};

type Slide = {
  id: string;
  image: string;
  copy: Record<Lang, SlideCopy>;
};

type CopyBlock = {
  eyebrow: string;
  titleLines: [string, string];
  lead: string;
  quote: string;
  products: string;
  pause: string;
  play: string;
  previous: string;
  next: string;
  select: string;
  retouched: string;
};

type PhotoHeroConfig = {
  copy: Record<Lang, CopyBlock>;
  slides: Slide[];
  enabled: boolean;
};

const typedConfig = config as unknown as PhotoHeroConfig;

const SLIDE_COUNT = typedConfig.slides.length;
const SLIDE_MS = PHOTO_HERO_TIMING.holdMs;
const CROSSFADE_MS = PHOTO_HERO_TIMING.transitionMs;

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

const FONT_STACK = 'Arial, Helvetica, "Helvetica Neue", sans-serif';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Deterministic slide selection from frame.
function slideState(frame: number, fps: number) {
  const slideFrames = (SLIDE_MS / 1000) * fps;
  const fadeFrames = (CROSSFADE_MS / 1000) * fps;
  const total = slideFrames * SLIDE_COUNT;

  const f = frame % total;
  const index = Math.min(SLIDE_COUNT - 1, Math.floor(f / slideFrames));
  const local = f - index * slideFrames;

  // Fade-in of current slide. Frame 0 first slide is always fully visible.
  const fadeIn =
    index === 0 ? 1 : clamp01(local / fadeFrames);

  return { index, local, fadeIn };
}

// Each photo: opacity 0 before its start, fade-in 0->1 over CROSSFADE_MS
// after start, then holds 1 through its end. Prior layers remain visible
// behind the incoming one (no fade-out to black).
function slideOpacity(
  slideIndex: number,
  state: ReturnType<typeof slideState>,
): number {
  if (slideIndex < state.index) {
    // Prior layers stay fully visible behind the incoming one.
    return 1;
  }
  if (slideIndex === state.index) {
    return state.fadeIn;
  }
  return 0;
}

function imagePath(image: string, mobile: boolean): string {
  const base = image.replace(/^photo-hero\//, '');
  const suffix = mobile ? '-mobile' : '-1920';
  return staticFile(`photo-hero/${base}${suffix}.webp`);
}

export const PhotoHero: React.FC<PhotoHeroProps> = ({ lang, mobile, theme = 'dark' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const isRtl = lang === 'ar';
  const isLight = theme === 'light';

  const palette = isLight
    ? {
        ink: '#142231',
        muted: '#374d62',
        panel: '#eef2f5',
        eyebrow: '#0052a3',
        caption: '#374d62',
        secondaryBorder: 'rgba(20,34,49,0.6)',
        secondaryBg: '#ffffff',
        selectorInactive: 'rgba(20,34,49,0.25)',
      }
    : {
        ink: '#f4f5f7',
        muted: '#c9ccd2',
        panel: '#0b0c0e',
        eyebrow: '#8fb4ff',
        caption: '#d0d9e1',
        secondaryBorder: 'rgba(255,255,255,0.6)',
        secondaryBg: 'transparent',
        selectorInactive: 'rgba(255,255,255,0.25)',
      };
  const PRIMARY = '#0066cc';

  const state = slideState(frame, fps);

  const copy = {
    ...typedConfig.copy[lang],
    ...typedConfig.slides[state.index].copy[lang],
  };

  // Title entrance: 1s, line 2 staggered 100ms.
  const titleFrames = (PHOTO_HERO_TIMING.titleDurationMs / 1000) * fps;
  const staggerFrames = (PHOTO_HERO_TIMING.titleStaggerMs / 1000) * fps;

  const line1Progress = interpolate(state.local, [0, titleFrames], [0, 1], {
    easing: EASE,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const line2Progress = interpolate(
    state.local,
    [staggerFrames, titleFrames + staggerFrames],
    [0, 1],
    {
      easing: EASE,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    },
  );

  const line1Y = (1 - line1Progress) * 40;
  const line2Y = (1 - line2Progress) * 40;

  // Subtle per-slide text shift on transition.
  const slideShift = (1 - state.fadeIn) * 12;

  // Mobile uses physical 1080x1920 frame; sizes chosen for that scale.
  const titleSize = mobile ? (isRtl ? 100 : 112) : 104;
  const titleLineHeight = isRtl ? 1.35 : 1.05;

  const currentSlide = typedConfig.slides[state.index];
  const currentCopy = currentSlide.copy[lang];

  const textAlign = isRtl ? 'right' : 'left';
  const dir = isRtl ? 'rtl' : 'ltr';

  const headline = (
    <div
      style={{
        fontFamily: FONT_STACK,
        fontWeight: 700,
        fontSize: titleSize,
        lineHeight: titleLineHeight,
        letterSpacing: isRtl ? 0 : '-0.01em',
        color: palette.ink,
        textAlign,
        direction: dir,
        transform: `translateY(${slideShift}px)`,
        whiteSpace: 'normal',
      }}
    >
      <div
        style={{
          transform: `translateY(${line1Y}px)`,
          opacity: line1Progress,
          whiteSpace: 'nowrap',
        }}
      >
        {copy.titleLines[0]}
      </div>
      <div
        style={{
          transform: `translateY(${line2Y}px)`,
          opacity: line2Progress,
          whiteSpace: 'nowrap',
        }}
      >
        {copy.titleLines[1]}
      </div>
    </div>
  );

  const eyebrow = (
    <div
      style={{
        fontFamily: FONT_STACK,
        fontSize: mobile ? 26 : 16,
        letterSpacing: isRtl ? 0 : '0.18em',
        textTransform: isRtl ? 'none' : 'uppercase',
        color: palette.eyebrow,
        marginBottom: mobile ? 24 : 22,
        textAlign,
        direction: dir,
      }}
    >
      {copy.eyebrow}
    </div>
  );

  const lead = (
    <div
      style={{
        fontFamily: FONT_STACK,
        fontSize: mobile ? 36 : 26,
        lineHeight: isRtl ? 1.35 : 1.5,
        color: palette.muted,
        marginTop: mobile ? 28 : 28,
        maxWidth: mobile ? '100%' : 620,
        textAlign,
        direction: dir,
      }}
    >
      {copy.lead}
    </div>
  );

  const caption = (
    <div
      style={{
        fontFamily: FONT_STACK,
        fontSize: mobile ? 26 : 14,
        letterSpacing: isRtl ? 0 : '0.08em',
        textTransform: isRtl ? 'none' : 'uppercase',
        color: palette.caption,
        marginTop: mobile ? 20 : 10,
        textAlign,
        direction: dir,
      }}
    >
      <div>
        {currentCopy.label}
      </div>
      <div
        style={{
          fontSize: mobile ? 20 : 11,
          letterSpacing: isRtl ? 0 : '0.06em',
          opacity: 0.7,
          marginTop: mobile ? 8 : 4,
        }}
      >
        {copy.retouched}
      </div>
    </div>
  );

  // CTA plates: actual button labels from config (quote / products).
  const ctaRow = (
    <div
      style={{
        display: 'flex',
        gap: mobile ? 24 : 16,
        marginTop: mobile ? 40 : 36,
        flexDirection: isRtl ? 'row-reverse' : 'row',
      }}
    >
      <div
        style={{
          fontFamily: FONT_STACK,
          fontSize: mobile ? 40 : 20,
          fontWeight: 600,
          color: '#ffffff',
          backgroundColor: PRIMARY,
          padding: mobile ? '20px 40px' : '14px 26px',
          borderRadius: 4,
          textAlign: 'center',
          direction: dir,
        }}
      >
        {copy.quote}
      </div>
      <div
        style={{
          fontFamily: FONT_STACK,
          fontSize: mobile ? 40 : 20,
          fontWeight: 600,
          color: palette.ink,
          backgroundColor: palette.secondaryBg,
          border: `2px solid ${palette.secondaryBorder}`,
          padding: mobile ? '20px 40px' : '14px 26px',
          borderRadius: 4,
          textAlign: 'center',
          direction: dir,
        }}
      >
        {copy.products}
      </div>
    </div>
  );

  const selectors = (
    <div
      style={{
        display: 'flex',
        gap: 10,
        marginTop: mobile ? 32 : 32,
        flexDirection: isRtl ? 'row-reverse' : 'row',
      }}
    >
      <svg width={48} height={48} viewBox="0 0 48 48" style={{ transform: isRtl ? 'scaleX(-1)' : undefined }}>
        <path d="M30 12 L18 24 L30 36" fill="none" stroke={palette.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg width={48} height={48} viewBox="0 0 48 48" style={{ transform: isRtl ? 'scaleX(-1)' : undefined }}>
        <path d="M18 12 L30 24 L18 36" fill="none" stroke={palette.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );

  const indexLine = (
    <div
      style={{
        width: 2,
        height: mobile ? 56 : 64,
        backgroundColor: PRIMARY,
        marginBottom: mobile ? 24 : 24,
        marginLeft: isRtl ? 'auto' : 0,
        marginRight: isRtl ? 0 : 'auto',
      }}
    />
  );

  const logo = (
    <Img
      src={staticFile('photo-hero/logo-source.png')}
      style={{
        position: 'absolute',
        top: mobile ? 72 : 48,
        left: isRtl ? undefined : mobile ? 72 : 120,
        right: isRtl ? (mobile ? 72 : 120) : undefined,
        height: mobile ? 70 : 36,
        width: 'auto',
        objectFit: 'contain',
      }}
    />
  );

  const gradientOverlay = (
    <AbsoluteFill
      style={{
        background: mobile
          ? isLight
            ? 'linear-gradient(to bottom, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.88) 25%, rgba(255,255,255,0.88) 75%, rgba(255,255,255,0.4) 100%)'
            : 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.86) 25%, rgba(0,0,0,0.86) 75%, rgba(0,0,0,0.4) 100%)'
          : isLight
            ? isRtl
              ? 'linear-gradient(to left, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.9) 38%, rgba(255,255,255,0) 62%), linear-gradient(to top, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 40%)'
              : 'linear-gradient(to right, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.9) 38%, rgba(255,255,255,0) 62%), linear-gradient(to top, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 40%)'
            : isRtl
              ? 'linear-gradient(to left, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 38%, rgba(0,0,0,0) 62%), linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 40%)'
              : 'linear-gradient(to right, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 38%, rgba(0,0,0,0) 62%), linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 40%)',
        pointerEvents: 'none',
      }}
    />
  );

  // Layers in DOM order matching photos order; prior layers stay visible
  // behind incoming ones (no fade-out to black).
  const slidesLayer = (
    <AbsoluteFill>
      {typedConfig.slides.map((s, i) => {
        const opacity = slideOpacity(i, state);
        if (opacity <= 0) return null;
        return (
          <AbsoluteFill key={s.id} style={{ opacity }}>
            <Img
              src={imagePath(s.image, mobile)}
              alt={s.copy[lang].alt}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center right',
              }}
            />
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );

  if (mobile) {
    // 1080x1920 physical frame. Full-bleed photo with text overlay.
    return (
      <AbsoluteFill style={{ backgroundColor: palette.panel }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 1080,
            height: 1920,
            overflow: 'hidden',
          }}
        >
          {slidesLayer}
          {gradientOverlay}
        </div>
        {logo}
        <div
          style={{
            position: 'absolute',
            top: 400,
            left: 0,
            width: 1080,
            height: 1450,
            backgroundColor: 'transparent',
            padding: '72px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          {indexLine}
          {eyebrow}
          {headline}
          {lead}
          {ctaRow}
          {caption}
          {selectors}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: palette.panel }}>
      {slidesLayer}
      {gradientOverlay}
      {logo}
      <div
        style={{
          position: 'absolute',
          top: 390,
          left: isRtl ? undefined : 120,
          right: isRtl ? 120 : undefined,
          width: 760,
          display: 'flex',
          flexDirection: 'column',
          alignItems: isRtl ? 'flex-end' : 'flex-start',
        }}
      >
        {indexLine}
        {eyebrow}
        {headline}
        {lead}
        {ctaRow}
        {caption}
        {selectors}
      </div>
    </AbsoluteFill>
  );
};

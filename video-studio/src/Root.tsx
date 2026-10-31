import { PhotoHero } from './photohero/PhotoHero';
import { Composition, Folder } from 'remotion';
import { Welcome } from './Welcome';
import { FutureEngineered } from './v4/FutureEngineered';

// Durations and sizes mirror content/intro.json (fps 30, 180 frames; 1920×1080 and 1080×1920).
// Render other languages with --props='{"format":"desktop","lang":"en"}' once their wording is approved.
export const RemotionRoot = () => (
  <>
  <Folder name="Welcome">
    <Composition
      id="WelcomeDesktop"
      component={Welcome}
      durationInFrames={180}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ format: 'desktop', lang: 'fr' }}
    />
    <Composition
      id="WelcomeMobile"
      component={Welcome}
      durationInFrames={180}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ format: 'mobile', lang: 'fr' }}
    />
  </Folder>
  <Folder name="V4">
    {/* 8 s cinematic: Blender V4.1 frames (public/v41-frames) + official logo reveal */}
    <Composition id="FutureEngineered" component={FutureEngineered} durationInFrames={240} fps={30} width={1920} height={1080} />
  </Folder>
  <Folder name="PhotoOpening">
  <Composition id="PhotoOpeningFR" component={PhotoHero} durationInFrames={630} fps={30} width={1920} height={1080} defaultProps={{ lang: 'fr', mobile: false }} />
  <Composition id="PhotoOpeningEN" component={PhotoHero} durationInFrames={630} fps={30} width={1920} height={1080} defaultProps={{ lang: 'en', mobile: false }} />
  <Composition id="PhotoOpeningAR" component={PhotoHero} durationInFrames={630} fps={30} width={1920} height={1080} defaultProps={{ lang: 'ar', mobile: false }} />
  <Composition id="PhotoOpeningMobileFR" component={PhotoHero} durationInFrames={630} fps={30} width={1080} height={1920} defaultProps={{ lang: 'fr', mobile: true }} />
  <Composition id="PhotoOpeningMobileEN" component={PhotoHero} durationInFrames={630} fps={30} width={1080} height={1920} defaultProps={{ lang: 'en', mobile: true }} />
  <Composition id="PhotoOpeningMobileAR" component={PhotoHero} durationInFrames={630} fps={30} width={1080} height={1920} defaultProps={{ lang: 'ar', mobile: true }} />
<Composition
  id="PhotoOpeningLightFR"
  component={PhotoHero}
  durationInFrames={630}
  fps={30}
  width={1920}
  height={1080}
  defaultProps={{ lang: 'fr', mobile: false, theme: 'light' }}
/>
<Composition
  id="PhotoOpeningLightEN"
  component={PhotoHero}
  durationInFrames={630}
  fps={30}
  width={1920}
  height={1080}
  defaultProps={{ lang: 'en', mobile: false, theme: 'light' }}
/>
<Composition
  id="PhotoOpeningLightAR"
  component={PhotoHero}
  durationInFrames={630}
  fps={30}
  width={1920}
  height={1080}
  defaultProps={{ lang: 'ar', mobile: false, theme: 'light' }}
/>
<Composition
  id="PhotoOpeningMobileLightFR"
  component={PhotoHero}
  durationInFrames={630}
  fps={30}
  width={1080}
  height={1920}
  defaultProps={{ lang: 'fr', mobile: true, theme: 'light' }}
/>
<Composition
  id="PhotoOpeningMobileLightEN"
  component={PhotoHero}
  durationInFrames={630}
  fps={30}
  width={1080}
  height={1920}
  defaultProps={{ lang: 'en', mobile: true, theme: 'light' }}
/>
<Composition
  id="PhotoOpeningMobileLightAR"
  component={PhotoHero}
  durationInFrames={630}
  fps={30}
  width={1080}
  height={1920}
  defaultProps={{ lang: 'ar', mobile: true, theme: 'light' }}
/>
</Folder>
  </>
);

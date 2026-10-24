// "Précision en mouvement" — the 6-second LIBALSTAL welcome (180 frames @ 30 fps).
//   01  0.00–1.50  Engineered from darkness   the duct section emerges under studio light, slow dolly
//   02  1.50–3.00  The reveal                 light travels across the metal; the part squares up onto the
//                                             mark's top duct and the official logo opens out from it
//   03  3.00–4.75  Welcome                    BIENVENUE CHEZ LIBALSTAL · L'EXCELLENCE PREND FORME
//   04  4.75–6.00  Handoff                    text dissolves, ground lifts to the hero colour. The page takes
//                                             over here (live DOM): see src/assets/js/intro.js in the site.
import { AbsoluteFill } from 'remotion';
import './lib/fonts';
import { Backdrop } from './components/Backdrop';
import { LogoReveal } from './components/LogoReveal';
import { WelcomeText } from './components/WelcomeText';
import { DuctScene } from './scene/DuctScene';
import type { Format, Lang } from './lib/layout';

export type WelcomeProps = { readonly format: Format; readonly lang: Lang };

export const Welcome = ({ format, lang }: WelcomeProps) => (
  <AbsoluteFill style={{ overflow: 'hidden' }}>
    <Backdrop format={format} />
    <DuctScene format={format} />
    <LogoReveal format={format} />
    <WelcomeText format={format} lang={lang} />
  </AbsoluteFill>
);

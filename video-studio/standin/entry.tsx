// Preview entry: mounts the real <Welcome> composition and lets the driver step frames.
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ConfigContext, FrameContext } from 'remotion';
import { Welcome } from '../src/Welcome';
import intro from '../../content/intro.json';

const q = new URLSearchParams(location.search);
const format = (q.get('format') || 'desktop') as 'desktop' | 'mobile';
const lang = (q.get('lang') || 'fr') as 'fr' | 'en' | 'ar';
const c = intro.compositions[format];
const cfg = { fps: intro.fps, width: c.width, height: c.height, durationInFrames: intro.durationInFrames, id: c.id };

const host = document.getElementById('root')!;
Object.assign(host.style, { position: 'relative', width: c.width + 'px', height: c.height + 'px', overflow: 'hidden' });
const root = createRoot(host);
const draw = (frame: number) => flushSync(() => root.render(
  <ConfigContext.Provider value={cfg}><FrameContext.Provider value={frame}><Welcome format={format} lang={lang} /></FrameContext.Provider></ConfigContext.Provider>,
));
(window as any).__frame = async (n: number) => {
  draw(n);
  for (let i = 0; i < 400 && (window as any).__pendingRenders() > 0; i++) await new Promise(r => setTimeout(r, 25));
  await document.fonts.ready;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
};
draw(0);

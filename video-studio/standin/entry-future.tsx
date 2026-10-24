// Stand-in entry for the V4 composition: mounts the real <FutureEngineered> and lets the driver step frames.
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ConfigContext, FrameContext } from 'remotion';
import { FutureEngineered } from '../src/v4/FutureEngineered';

const cfg = { fps: 30, width: 1920, height: 1080, durationInFrames: 240, id: 'FutureEngineered' };
const host = document.getElementById('root')!;
Object.assign(host.style, { position: 'relative', width: '1920px', height: '1080px', overflow: 'hidden' });
const root = createRoot(host);
const draw = (frame: number) => flushSync(() => root.render(
  <ConfigContext.Provider value={cfg}><FrameContext.Provider value={frame}><FutureEngineered lang={(new URLSearchParams(location.search).get('lang') || 'fr') as any} /></FrameContext.Provider></ConfigContext.Provider>,
));
(window as any).__frame = async (n: number) => {
  draw(n);
  for (let i = 0; i < 400 && (window as any).__pendingRenders() > 0; i++) await new Promise(r => setTimeout(r, 25));
  await document.fonts.ready;
  await Promise.all([...document.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
};
draw(0);

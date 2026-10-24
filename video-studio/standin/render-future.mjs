// STAND-IN RENDER of the Remotion composition "FutureEngineered" (src/v4/FutureEngineered.tsx), for where the
// Remotion packages can't be installed: bundles the real composition code with esbuild (remotion -> standin shim),
// steps all 240 frames in headless Chromium, encodes with ffmpeg. The Remotion render of the same composition is:
//   npx remotion render FutureEngineered out/libalstal-v4.1-8s.mp4
// Usage: node standin/render-future.mjs [--frames=0,180,239] [--no-video]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = process.env.NODE_TOOLS || join(HERE, 'node_modules');
const req = createRequire(join(TOOLS, 'noop.js'));
const esbuild = req('esbuild'); const { chromium } = req('playwright');
const args = process.argv.slice(2); const flag = n => args.find(a => a.startsWith(`--${n}`));
const lang = flag('lang')?.split('=')[1] || 'fr';
const only = flag('frames')?.split('=')[1]?.split(',').map(Number);
const BUILD = join(HERE, 'standin/.build-future'); mkdirSync(BUILD, { recursive: true });
await esbuild.build({ entryPoints: [join(HERE, 'standin/entry-future.tsx')], bundle: true, format: 'esm', outfile: join(BUILD, 'bundle.js'),
  jsx: 'automatic', target: 'chrome120', logLevel: 'warning', nodePaths: [TOOLS],
  alias: { remotion: join(HERE, 'standin/remotion-shim.tsx'), '@remotion/fonts': join(HERE, 'standin/fonts-shim.ts') },
  define: { 'process.env.NODE_ENV': '"production"' } });
writeFileSync(join(BUILD, 'index.html'), '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style><div id="root"></div><script type="module" src="/bundle.js"></script>');
execFileSync(process.execPath, [join(HERE, 'scripts/sync-assets.mjs')], { stdio: 'inherit' });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const file = [join(BUILD, p === '/' ? 'index.html' : p), join(HERE, 'public', p)].find(f => existsSync(f) && !f.endsWith('/'));
  if (!file) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); rs.end(readFileSync(file));
});
await new Promise(r => server.listen(4396, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:4396/?lang=${lang}`); await page.waitForFunction(() => typeof window.__frame === 'function');
const OUT = join(HERE, 'out/v4'); const dir = join(OUT, 'frames'); if (!only) rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const frames = only || [...Array(240).keys()]; const t0 = Date.now();
for (const n of frames) {
  await page.evaluate(n => window.__frame(n), n);
  await page.screenshot({ path: join(dir, `${String(n).padStart(4, '0')}.png`), clip: { x: 0, y: 0, width: 1920, height: 1080 } });
}
console.log(`${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s${errors.length ? ' — page errors: ' + errors.join(' | ') : ''}`);
await browser.close(); server.close();
if (!flag('no-video') && !only) {
  const ff = a => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
  const input = ['-framerate', '30', '-i', join(dir, '%04d.png')];
  const color = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  const vf = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p'];
  ff([...input, ...vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'film', ...color, '-movflags', '+faststart', '-an', join(OUT, `libalstal-v4.1-8s-${lang}-master.mp4`)]);
  ff([...input, ...vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', ...color, '-movflags', '+faststart', '-an', join(OUT, `libalstal-v4.1-8s-${lang}-web-1080p.mp4`)]);
  ff([...input, '-vf', 'scale=1280:-2:flags=lanczos,format=yuv420p', '-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', join(OUT, `libalstal-v4.1-8s-${lang}-web-720p.webm`)]);
  ff(['-i', join(dir, '0225.png'), '-q:v', '3', join(OUT, `libalstal-v4.1-8s-${lang}-poster.jpg`)]);
  console.log(`→ out/v4/libalstal-v4.1-8s-${lang}-{master.mp4, web-1080p.mp4, web-720p.webm, poster.jpg}`);
}

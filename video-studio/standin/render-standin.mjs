// STAND-IN RENDERER — previews the real composition code where Remotion can't be installed.
// Bundles src/ with esbuild (the `remotion` and `@remotion/fonts` imports are mapped to standin/*-shim),
// steps every frame in headless Chromium (Playwright), captures PNGs and encodes them with ffmpeg.
// Output goes to out/standin/ and is labelled as a preview: the deliverable render is `npm run render`.
//
// Needs: esbuild, react, react-dom, playwright (+ Chromium), ffmpeg. Set NODE_TOOLS to a node_modules folder
// that has them if they aren't installed here.
// Usage: node standin/render-standin.mjs [desktop|mobile|all] [lang] [--frames=0,45,90] [--no-video]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(HERE, '..');
const TOOLS = process.env.NODE_TOOLS || join(HERE, 'node_modules');
const req = createRequire(join(TOOLS, 'noop.js'));
const esbuild = req('esbuild');
const { chromium } = req('playwright');

const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const flag = n => args.find(a => a.startsWith(`--${n}`));
const formats = !pos[0] || pos[0] === 'all' ? ['desktop', 'mobile'] : [pos[0]];
const lang = pos[1] || 'fr';
const only = flag('frames')?.split('=')[1]?.split(',').map(Number);
const encode = !flag('no-video') && !only;
const intro = JSON.parse(readFileSync(join(SITE, 'content/intro.json'), 'utf8'));

// 1 · bundle
const BUILD = join(HERE, 'standin/.build');
mkdirSync(BUILD, { recursive: true });
const THREE = join(SITE, 'src/assets/vendor/three/build/three.module.min.js'); // the site's own r170 copy
await esbuild.build({
  entryPoints: [join(HERE, 'standin/entry.tsx')], bundle: true, format: 'esm', outfile: join(BUILD, 'bundle.js'),
  jsx: 'automatic', target: 'chrome120', logLevel: 'warning', nodePaths: [TOOLS],
  alias: { remotion: join(HERE, 'standin/remotion-shim.tsx'), '@remotion/fonts': join(HERE, 'standin/fonts-shim.ts'), three: THREE },
  define: { 'process.env.NODE_ENV': '"production"' },
});
writeFileSync(join(BUILD, 'index.html'), '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style><div id="root"></div><script type="module" src="/bundle.js"></script>');
execFileSync(process.execPath, [join(HERE, 'scripts/sync-assets.mjs')], { stdio: 'inherit' });

// 2 · serve bundle + public/
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const file = [join(BUILD, p === '/' ? 'index.html' : p), join(HERE, 'public', p)].find(f => existsSync(f) && !f.endsWith('/'));
  if (!file) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); rs.end(readFileSync(file));
});
await new Promise(r => server.listen(4391, '127.0.0.1', r));

// 3 · step frames
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--font-render-hinting=none'] });
const OUT = join(HERE, 'out/standin');
for (const format of formats) {
  const c = intro.compositions[format];
  const page = await browser.newPage({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:4391/?format=${format}&lang=${lang}`);
  await page.waitForFunction(() => typeof window.__frame === 'function');
  const dir = join(OUT, `frames-${format}-${lang}`);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const frames = only || [...Array(intro.durationInFrames).keys()];
  const t0 = Date.now();
  for (const n of frames) {
    await page.evaluate(n => window.__frame(n), n);
    await page.screenshot({ path: join(dir, `${String(n).padStart(4, '0')}.png`), clip: { x: 0, y: 0, width: c.width, height: c.height } });
  }
  console.log(`${format}/${lang}: ${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s${errors.length ? ' — page errors: ' + errors.join(' | ') : ''}`);
  await page.close();

  // 4 · encode like scripts/render.mjs does (same codecs and settings, from lossless frames)
  if (encode) {
    const base = join(OUT, `welcome-${format}-${lang}`);
    const ff = a => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
    const input = ['-framerate', String(intro.fps), '-i', join(dir, '%04d.png')];
    const color = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
    ff([...input, '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', ...color, '-movflags', '+faststart', '-an', `${base}.mp4`]);
    ff([...input, '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libvpx-vp9', '-crf', '31', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', ...color, '-an', `${base}.webm`]);
    const poster = join(dir, `${String(Math.round(4.4 * intro.fps)).padStart(4, '0')}.png`);
    ff(['-i', poster, '-q:v', '3', `${base}-poster.jpg`]);
    ff(['-i', poster, '-c:v', 'libwebp', '-quality', '82', `${base}-poster.webp`]);
    console.log(`  → out/standin/welcome-${format}-${lang}.{mp4,webm} + posters`);
  }
}
await browser.close(); server.close();

// Renders the grey-box animatic (half resolution) from blender/rig.py's frame export, in headless Chromium.
// Usage: python3 blender/rig.py --export animatic/.build/rig-frames.json && node animatic/render-animatic.mjs [desktop|mobile|all]
// Needs playwright + Chromium and ffmpeg (NODE_TOOLS = a node_modules folder that has playwright).
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '../..');
const req = createRequire(join(process.env.NODE_TOOLS || join(HERE, '../node_modules'), 'noop.js'));
const { chromium } = req('playwright');
const BUILD = join(HERE, '.build');
mkdirSync(BUILD, { recursive: true });
const rigFile = join(BUILD, 'rig-frames.json');
execFileSync('python3', [join(HERE, '../blender/rig.py'), '--export', rigFile], { stdio: 'inherit' });

const files = {
  '/': join(HERE, 'index.html'), '/animatic.js': join(HERE, 'animatic.js'), '/rig-frames.json': rigFile,
  '/intro.json': join(SITE, 'content/intro.json'), '/logo.png': join(SITE, 'brand/logo-source.png'),
  '/three.module.min.js': join(SITE, 'src/assets/vendor/three/build/three.module.min.js'),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((rq, rs) => {
  const f = files[new URL(rq.url, 'http://x').pathname];
  if (!f || !existsSync(f)) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); rs.end(readFileSync(f));
});
await new Promise(r => server.listen(4392, '127.0.0.1', r));

const which = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['desktop', 'mobile'];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const intro = JSON.parse(readFileSync(join(SITE, 'content/intro.json'), 'utf8'));
for (const fmt of which) {
  const c = intro.compositions[fmt], w = c.width / 2, h = c.height / 2;
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:4392/?format=${fmt}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  const dir = join(BUILD, `frames-${fmt}`); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  for (let n = 0; n < intro.durationInFrames; n++) {
    await page.evaluate(n => window.__frame(n), n);
    await page.screenshot({ path: join(dir, `${String(n).padStart(4, '0')}.png`) });
  }
  const out = join(HERE, `animatic-${fmt}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(intro.fps), '-i', join(dir, '%04d.png'), '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  console.log(`${fmt}: ${out}${errs.length ? '  page errors: ' + errs.join(' | ') : ''}`);
  await page.close();
}
await browser.close(); server.close();

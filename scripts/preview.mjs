#!/usr/bin/env node
// Builds a self-contained, relative-path copy of dist/ for previewing on a static host
// that has no server (e.g. a shared preview link). CSS/JS are inlined; links become relative.
// The RFQ form has no endpoint there and reports "not sent" — by design.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, cpSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = process.argv[2] || join(ROOT, 'preview');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(DIST, 'assets/img'), join(OUT, 'assets/img'), { recursive: true });

const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const css = readFileSync(join(DIST, 'assets/css/site.css'), 'utf8');
const js = n => readFileSync(join(DIST, 'assets/js', n), 'utf8').replace(/<\/script/gi, '<\\/script');
const files = [];

// The 3D assembly modules become one inline module for the preview host (inline + CDN scripts only).
// Concatenated in dependency order: relative imports removed, `export` dropped, the lazy viewer import
// pointed at the inlined createViewer. three.js stays a lazy import through the (CDN) import map.
const ASM = ['units', 'geometry', 'assembly', 'motion', 'viewer', 'boot'];
const asmBundle = (() => {
  let src = ASM.map(n => readFileSync(join(DIST, 'assets/js/assembly', n + '.js'), 'utf8')
    .replace(/^import [^\n]* from '\.\/[^']+';\n/gm, '')
    .replace(/^export (?=(async function|function|const|class) )/gm, '')).join('\n');
  src = src.replace("import('./viewer.js')", 'Promise.resolve({ createViewer })');
  // ({import('./x.js').T} in JSDoc is a type, not code)
  if (/from '\.\/|[^{]import\('\.\//.test(src)) throw new Error('preview: unresolved relative import in the assembly bundle');
  const tmp = join(ROOT, '.build/asm-preview-check.mjs');
  mkdirSync(dirname(tmp), { recursive: true }); writeFileSync(tmp, src);
  execFileSync(process.execPath, ['--check', tmp]); // duplicate top-level names would fail here
  return src.replace(/<\/script/gi, '<\\/script');
})();

for (const f of walk(DIST).filter(f => f.endsWith('.html') && f !== join(DIST, 'index.html') && f !== join(DIST, '404.html'))) {
  const rel = relative(DIST, f).split('\\').join('/');
  const depth = rel.split('/').length - 1;
  const up = depth ? '../'.repeat(depth) : './';
  let h = readFileSync(f, 'utf8');
  h = h.replace(/<link rel="stylesheet" href="\/assets\/css\/site\.css[^"]*">/, () => `<style>${css}</style>`)
    .replace(/<script src="\/assets\/js\/theme\.js[^"]*"><\/script>/, () => `<script>${js('theme.js')}</script>`)
    .replace(/<script src="\/assets\/js\/main\.js[^"]*" defer><\/script>\n?/, '')
    .replace(/<link rel="modulepreload"[^>]*>\n?/, '')
    .replace(/<script type="module" src="\/assets\/js\/(hero3d|rfq)\.js[^"]*"><\/script>/, (_, n) => `<script type="module">${js(n + '.js')}</script>`)
    .replace(/<script type="module" src="\/assets\/js\/assembly\/boot\.js[^"]*"><\/script>/, () => `<script type="module">${asmBundle}</script>`)
    .replace(/<link rel="manifest"[^>]*>\n?/, '')
    // preview hosts only allow CDN scripts: point the import map at jsDelivr (same r170 files)
    .replace(/"\/assets\/vendor\/three\//g, '"https://cdn.jsdelivr.net/npm/three@0.170.0/')
    .replace('</body>', () => `<script>${js('main.js')}</script>\n</body>`)
    // internal links → relative files
    .replace(/(href|src)="\/([^"]*)"/g, (m, attr, p) => {
      if (p.startsWith('api/')) return m;
      let [path, rest = ''] = p.split(/(?=[?#])/);
      path = path.replace(/\?v=.*$/, '');
      if (path === '' || path.endsWith('/')) path += 'index.html';
      return `${attr}="${up}${path}${rest.replace(/^\?v=[^#]*/, '')}"`;
    });
  mkdirSync(dirname(join(OUT, rel)), { recursive: true });
  writeFileSync(join(OUT, rel), h);
  files.push(rel);
}
cpSync(join(ROOT, 'brand/preview-hub.html'), join(OUT, 'index.html')); // landing page for the preview link
console.log(`Preview: ${files.length} pages → ${OUT}`);

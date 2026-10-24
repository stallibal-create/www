#!/usr/bin/env node
// Builds v3/proxy/out/libalstal-emblem-proxy.glb (+ airflow-paths.json) in headless Chromium with three.js r170's
// GLTFExporter. PROXY ONLY: grey-box shapes in the contract's structure, for testing the site before Blender is back.
// Needs: playwright (+ Chromium), python3. NODE_TOOLS = a node_modules folder with playwright if not resolvable.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO = join(HERE, '..', '..');
const SITE = join(STUDIO, '..');
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const req = createRequire(join(process.env.NODE_TOOLS || join(STUDIO, 'node_modules'), 'noop.js'));
const { chromium } = req('playwright');

// rig data (gore segments, joint angle), from the same Python rig the Blender build uses
const rig = JSON.parse(execFileSync('python3', ['-c', `
import json, sys; sys.path.insert(0, ${JSON.stringify(join(STUDIO, 'blender'))}); import rig, math
print(json.dumps({'segments': rig.SEG, 'jointDeg': math.degrees(rig.JOINT)}))`]).toString());
const parts = JSON.parse(readFileSync(join(STUDIO, 'blender', 'logo_parts.json'), 'utf8')).parts;

const files = {
  '/three.module.min.js': join(SITE, 'src/assets/vendor/three/build/three.module.min.js'),
  '/GLTFExporter.js': join(HERE, 'vendor/GLTFExporter.js'),
  '/proxy-model.js': join(HERE, 'proxy-model.js'),
};
const page0 = `<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/three.module.min.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFExporter } from '/GLTFExporter.js';
import { buildProxy, airflowFromProxy } from '/proxy-model.js';
window.__build = async (parts, rig) => {
  const scene = new THREE.Scene(), root = buildProxy(parts, rig); scene.add(root); scene.updateMatrixWorld(true);
  const ab = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true, trs: true });
  let s = ''; const u8 = new Uint8Array(ab); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return { glb: btoa(s), airflow: airflowFromProxy(root, parts, rig) };
};
window.__ready = true;
</script>`;
const server = createServer((rq, rs) => {
  const p = new URL(rq.url, 'http://x').pathname;
  if (p === '/') { rs.writeHead(200, { 'content-type': 'text/html' }); return rs.end(page0); }
  const f = files[p];
  if (!f || !existsSync(f)) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'content-type': extname(f) === '.js' ? 'text/javascript' : 'application/octet-stream' }); rs.end(readFileSync(f));
});
await new Promise(r => server.listen(4393, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:4393/');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => { throw new Error('builder page failed: ' + errs.join(' | ')); });
const { glb: b64, airflow } = await page.evaluate(([p, r]) => window.__build(p, r), [parts, { segments: rig.segments, jointDeg: rig.jointDeg }]);
await browser.close(); server.close();

writeFileSync(join(OUT, 'libalstal-emblem-proxy.glb'), Buffer.from(b64, 'base64'));
writeFileSync(join(OUT, 'airflow-paths.json'), JSON.stringify({
  note: 'Illustrative airflow centrelines (metres, glTF axes, +Y up). Not a validated CFD simulation.',
  paths: { main: airflow },
}, null, 1));
console.log(`✓ ${join(OUT, 'libalstal-emblem-proxy.glb')} (${Math.round(Buffer.from(b64, 'base64').length / 1024)} KB)${errs.length ? '  page errors: ' + errs.join(' | ') : ''}`);

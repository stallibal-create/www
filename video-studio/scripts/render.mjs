// Renders the welcome intro for every format × approved language in content/intro.json:
//   out/welcome-<format>-<lang>.mp4   H.264, yuv420p, faststart  (Safari / iOS / everything)
//   out/welcome-<format>-<lang>.webm  VP9                         (smaller, Chrome / Firefox / Android)
//   out/welcome-<format>-<lang>-poster.jpg|webp  still at 4.4 s   (logo + message, for sharing / docs)
// Usage: npm run render                 all formats, all languages listed in intro.json "langs"
//        npm run render -- desktop fr   one format / language
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const intro = JSON.parse(readFileSync(join(HERE, '../content/intro.json'), 'utf8'));
const [onlyFormat, onlyLang] = process.argv.slice(2);
const formats = Object.keys(intro.compositions).filter(f => !onlyFormat || f === onlyFormat);
const langs = intro.langs.filter(l => !onlyLang || l === onlyLang);
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (cmd, args) => { console.log(`\n$ ${cmd} ${args.join(' ')}`); execFileSync(cmd, args, { stdio: 'inherit', cwd: HERE }); };
const kb = p => `${Math.round(statSync(p).size / 1024)} KB`;
const POSTER_FRAME = Math.round(4.4 * intro.fps);

for (const lang of langs) {
  if (!intro.copy[lang]?.approved) { console.warn(`! ${lang}: wording not marked approved in content/intro.json — skipped`); continue; }
  for (const format of formats) {
    const id = intro.compositions[format].id;
    const base = join(OUT, `welcome-${format}-${lang}`);
    const props = JSON.stringify({ format, lang });
    run(npx, ['remotion', 'render', 'src/index.ts', id, `${base}.raw.mp4`, `--props=${props}`, '--codec=h264', '--crf=19', '--x264-preset=slow', '--color-space=bt709']);
    // move the index to the front so playback starts before the whole file has arrived
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${base}.raw.mp4`, '-c', 'copy', '-movflags', '+faststart', `${base}.mp4`]);
    run(npx, ['remotion', 'render', 'src/index.ts', id, `${base}.webm`, `--props=${props}`, '--codec=vp9', '--crf=31']);
    run(npx, ['remotion', 'still', 'src/index.ts', id, `${base}-poster.jpg`, `--props=${props}`, `--frame=${POSTER_FRAME}`, '--image-format=jpeg', '--jpeg-quality=88']);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${base}-poster.jpg`, '-c:v', 'libwebp', '-quality', '82', `${base}-poster.webp`]);
    renameSync(`${base}.raw.mp4`, join(OUT, `.welcome-${format}-${lang}.raw.mp4`));
    console.log(`✓ ${format}/${lang}: mp4 ${kb(`${base}.mp4`)} · webm ${kb(`${base}.webm`)} · poster ${kb(`${base}-poster.webp`)}`);
  }
}
console.log('\nReview the files in out/, then: npm run install-intro');

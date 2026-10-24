// Copies approved renders into the website: src/assets/video/intro/. The site build turns the intro on for a
// language only when both of its videos (desktop + mobile, mp4 + webm) are present there.
// Usage: npm run install-intro                  from out/ (Remotion renders)
//        npm run install-intro -- out/standin   from another folder (e.g. a preview, for local testing only)
//        npm run install-intro -- --remove      take the intro off the site again
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(HERE, '..');
const DEST = join(SITE, 'src/assets/video/intro');
const intro = JSON.parse(readFileSync(join(SITE, 'content/intro.json'), 'utf8'));
const arg = process.argv[2];

if (arg === '--remove') { rmSync(DEST, { recursive: true, force: true }); console.log('✓ intro removed from the site (rebuild to apply)'); process.exit(0); }
const FROM = resolve(HERE, arg || 'out');
const files = lang => Object.keys(intro.compositions).flatMap(f => [`welcome-${f}-${lang}.mp4`, `welcome-${f}-${lang}.webm`, `welcome-${f}-${lang}-poster.webp`]);

mkdirSync(DEST, { recursive: true });
let installed = 0;
for (const lang of intro.langs) {
  const need = files(lang);
  const missing = need.filter(n => !existsSync(join(FROM, n)));
  if (missing.length) { console.warn(`! ${lang}: missing ${missing.join(', ')} in ${FROM} — not installed`); continue; }
  for (const n of need) copyFileSync(join(FROM, n), join(DEST, n));
  installed++; console.log(`✓ ${lang}: ${need.length} files → src/assets/video/intro/`);
}
if (!installed) process.exit(1);
console.log('\nNext: from the site folder, npm run build && npm test');

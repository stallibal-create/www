// Copies the official logo from brand/ into public/ so the video uses the exact same file as the site.
// (Run automatically by `npm run studio` / `npm run render`.)
import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(HERE, '..');
const intro = JSON.parse(readFileSync(join(SITE, 'content/intro.json'), 'utf8'));
const src = join(SITE, 'brand', intro.logo.file);
if (!existsSync(src)) { console.error(`Official logo not found: ${src}`); process.exit(1); }
mkdirSync(join(HERE, 'public'), { recursive: true });
copyFileSync(src, join(HERE, 'public', intro.logo.file));
console.log(`✓ public/${intro.logo.file} ← brand/${intro.logo.file}`);

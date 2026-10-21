# LIBALSTAL — website

Production website for **LIBALSTAL — Fabrication métallique & systèmes de gaines de ventilation** ("L'air en mouvement").
French (primary), English and Arabic (full RTL). Dark graphite theme by default, light theme toggle.

- **Zero runtime dependencies.** A small Node generator builds static HTML from one content file; a small Node server serves it and receives quote requests.
- **3D hero** with Three.js (r170): a conceptual duct run (rectangular duct → segmented elbow → spiral riser → grille) echoing the logo. It loads lazily after the page, never blocks content, and falls back to the static logo mark if WebGL or the CDN is unavailable, if the visitor uses data-saver mode, or if the visitor asks for reduced motion (shown as a still frame).
- **Quote request (RFQ)** in three steps with a review, real server-side validation, rate limiting, a honeypot field, optional Cloudflare Turnstile, PDF/DWG/DXF type and size checks (including file-signature sniffing), private storage and a notification by webhook or email. If the notification channel isn't configured, the form says plainly that nothing was sent. **It never shows a fake success.**

> Why not Next.js? The brief asked for Next.js, but the environment it was built in had no access to the npm registry. Rather than ship untested code, the site was built with plain HTML/CSS/JS and Node's standard library, so every check below actually ran. Content, structure, URLs and the RFQ contract are framework-neutral, so a later move to Next.js would be a straightforward port.

---

## 3D assembly — cinematic milestone (v12, fixed in v13)

The separate, still-unlisted `/fr/assembly/`, `/en/assembly/`, `/ar/assembly/` pages contain a lazy-loaded 3D model, a static SVG fallback, selectable product sheets and a short optional cinematic introduction. On supported WebGL devices, the camera orbits around the finished ducts, parts separate and return to their installed positions. Use Skip, Explode, Reassemble or Replay. The timeline never loads on unrelated pages.

**v13 fixes (on top of v12):**
- **Exploded framing:** the camera now backs off as the parts separate. The exploded distance is fitted to the real exploded shape from the current viewing direction (Explode) or along the intro's orbit (intro). v12 left the end ducts and the flange outside the frame.
- **Interrupting:** touching the view during an Explode or Reassemble now finishes that animation instead of undoing it. The intro still returns to the installed assembly.
- **Screen readers:** the status line only announces the intro.
- **Tests:** they check every frame of the intro, and of Explode from 8 viewing directions, to confirm all 8 parts stay in the frame.

Engineering geometry and all demonstration dimensions remain labelled as provisional; real product specifications are read from `content/site.json`. See [V12-REPORT.md](V12-REPORT.md) for implementation details, test results and Android acceptance checks. WebGL animation has not been visually verified in this build environment.

## Quick start

Requirements: **Node.js ≥ 20** (tested on 22). Nothing to install.

```bash
npm run build          # content/*.json → dist/   (also writes MISSING-INFO.md)
npm start              # serves dist/ + /api/rfq on http://localhost:3000
npm run dev            # build + start
npm run lint           # JS syntax, JSON, FR/EN/AR key parity, HTML sanity checks
npm test               # end-to-end tests (needs Playwright + Chromium, see "Tests")
```

## Project structure

```
content/site.json          ← ALL company facts (null = placeholder shown on the site)
content/i18n/{fr,en,ar}.json  page copy and UI strings (same keys in all three)
scripts/build.mjs          static generator (pages, sitemap, robots, headers, MISSING-INFO.md)
scripts/icons.mjs          technical line drawings per product family
scripts/lint.mjs           static checks
src/assets/css/site.css    design tokens (RAL 5017/7001/7016/9006) + components, RTL via logical properties
src/assets/js/             theme.js (pre-paint), main.js (menu/theme/filter/reveal), rfq.js (form), hero3d.js (Three.js)
src/assets/img/            logo, icons, OG image (generated from the supplied transparent logo)
server.mjs                 production server: static files + security headers + POST /api/rfq
tests/run.mjs              Playwright end-to-end suite
brand/                     source logo files and the original design preview (not deployed)
MISSING-INFO.md            auto-generated checklist of every placeholder still on the site
```

### Pages (× fr / en / ar)

Home · Products (filterable) · 8 product detail pages · Capabilities · Industries · Projects (+ case-study template) · Engineering & Quality · Company · Contact/RFQ · Privacy · Legal notice · 404.
URLs: `/fr/…`, `/en/…`, `/ar/…` with the same slugs in each language (`/fr/products/elbows/`). `/` redirects by `Accept-Language` (fallback French).

## Editing content

Everything factual lives in **`content/site.json`**. Rules:

- `null` → the site shows a clearly marked placeholder (e.g. `[Téléphone — à compléter]`) and the item is listed in `MISSING-INFO.md`.
- A plain string applies to all languages: `"phone": "+213 …"`.
- A per-language object when the text differs: `"about": { "fr": "…", "en": "…", "ar": "…" }`.
- Then run `npm run build`. The placeholder and its checklist line disappear.

Common tasks:

| To… | Do this |
|---|---|
| Replace the 3D hero with a real photo | Put `workshop-hero.webp` (≈1200×1260) in `src/assets/img/`, set `heroVisual.photo` and `heroVisual.photoAlt` |
| Add a product photo / datasheet | `products[].image` (in `src/assets/img/`), `products[].datasheet` (PDF in `src/assets/docs/`) |
| Publish a project | Copy the `modele` entry, give it a new `slug`, set `"draft": false`, fill the fields, add `images: [{ "src": "x.webp", "alt": {…} }]`. Set `clientPublic: true` **only** with the client's written permission |
| Confirm the industries list | Edit `industries`, then set `industriesConfirmed: true` (removes the "indicative list" flag) |
| Hide the installation service | `capabilities[id=install].offered: false` |
| Add equipment | `equipment: [{ "name": "…", "detail": "…" }]` |
| Link quality evidence | `quality[].evidence: "/assets/docs/certificat-xyz.pdf"` |

Page copy (headings, intros, form labels) is in `content/i18n/*.json`. Keep the three files' keys identical; `npm run lint` fails otherwise.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `SITE_URL` | build | Site domain, default `https://www.libalstal.com`. Used for canonical, hreflang, sitemap, Open Graph. Override only for a staging domain. |
| `TURNSTILE_SITE_KEY` | build | Enables Cloudflare Turnstile on the form (recommended) |
| `RFQ_ENDPOINT` | build | Only if the RFQ API is hosted on another origin (default `/api/rfq`) |
| `PORT`, `HOST` | server | Default `3000`, `0.0.0.0` |
| `NODE_ENV=production` | server | Adds HSTS and `upgrade-insecure-requests` |
| `TRUST_PROXY=1` | server | Use `X-Forwarded-For` for rate limiting (only behind your own reverse proxy) |
| `RFQ_WEBHOOK_URL` | server | **Option A.** Each request is POSTed as JSON (fields, file list, storage path, text summary). Works with Make, Zapier, n8n or your own endpoint |
| `RFQ_WEBHOOK_TOKEN` | server | Sent as `Authorization: Bearer …` to the webhook |
| `RESEND_API_KEY`, `RFQ_TO_EMAIL`, `RFQ_FROM_EMAIL` | server | **Option B.** Email via resend.com (verified sender domain needed). Drawings are attached when the total is ≤ 15 MB |
| `TURNSTILE_SECRET_KEY` | server | Verifies Turnstile tokens (set together with `TURNSTILE_SITE_KEY`) |
| `RFQ_STORAGE_DIR` | server | Private storage outside the web root (default `./storage/rfq`) |
| `RFQ_RATE_MAX` | server | Requests per IP per 15 min (default 5) |
| `RFQ_ALLOWED_ORIGINS` | server | Extra allowed `Origin`s if the form is posted cross-origin |

Without option A or B, `/api/rfq` answers `503 not_configured` and stores nothing. `GET /healthz` reports `rfq: ready | not_configured`.

## Deploying

**Recommended: one small Node server (VPS, or any host that runs Node).**

```bash
TURNSTILE_SITE_KEY=… npm run build      # domain defaults to https://www.libalstal.com
NODE_ENV=production PORT=3000 TRUST_PROXY=1 RFQ_WEBHOOK_URL=… TURNSTILE_SECRET_KEY=… node server.mjs
```

Run it under systemd or pm2, behind nginx or Caddy for TLS (proxy `/` to `127.0.0.1:3000`, set `client_max_body_size 60m`). Back up `RFQ_STORAGE_DIR`; it holds customers' drawings.

**Static hosting (Netlify / Cloudflare Pages) is possible** for the pages: `dist/` already includes `_headers` and `_redirects`. The quote form, however, needs `/api/rfq`. Either host `server.mjs` somewhere and build with `RFQ_ENDPOINT=https://api.example.dz/api/rfq` (and set `RFQ_ALLOWED_ORIGINS` on that server), or port `handleRfq` to the platform's functions. Until then the form fails honestly.

### Font: Montserrat

Montserrat (weights 400–700) loads from Google Fonts by default; the CSP allows `fonts.googleapis.com` / `fonts.gstatic.com`, and a metric-matched Arial fallback limits layout shift while it loads. To self-host (no third-party request): download the Montserrat `.woff2` files (e.g. via google-webfonts-helper), put them in `src/assets/fonts/` with a `montserrat.css` containing the `@font-face` rules, and rebuild. The build switches to the local file and drops Google from the CSP. Montserrat has no Arabic letters, so Arabic pages also load **Cairo** (400–700) for Arabic text; Latin words and digits stay in Montserrat. When self-hosting, include Cairo's Arabic `.woff2` and its `@font-face` rules in the same `montserrat.css`.

### Three.js: CDN or self-hosted

Three.js r170 is **self-hosted** in `src/assets/vendor/three/` (official build files from github.com/mrdoob/three.js, tag `r170`, MIT licence included): no third-party request, and the CSP allows scripts from the site itself only. Delete that folder and the build falls back to jsDelivr automatically.

The hero follows the three.js performance guidance: static parts are merged per material (9 draw calls, ≈13.6k triangles), shaders compile before the first frame (`compileAsync`), the loop uses `setAnimationLoop` and stops off-screen or in background tabs, nothing is allocated per frame. Brushed steel uses `MeshPhysicalMaterial` anisotropy and the blue parts a clearcoat (powder-coat look). Add `?debug3d` to the home URL to log draw calls; the test suite fails if they exceed 12.

### 3D ductwork assembly (development page)

`/fr/assembly/`, `/en/assembly/`, `/ar/assembly/`: an interactive demonstration assembly (rotate, zoom, select a part, read its sheet). The pages are `noindex` and are kept out of the menu and the sitemap until the owner approves them. This is **not** access control: anyone with the URL can open them.

- **Data:** `content/site.json → ductAssembly`. All geometry is demo geometry (`demo: true`), always shown under the "Modèle de démonstration" label. Parts link to `products[]` through `productSlug`. The product's verified `specs` are the only source of specifications, and a `null` value shows "Spécification à confirmer". Components may not carry specification fields; the validator rejects them.
- **Coordinates:** millimetres, right-handed, +Y up. The origin is the centre of the first part's inlet. `toScene()` in `units.js` is the single mm → metre conversion.
- **Connections:** each part type defines connector frames (inlet / outlet / branch: position, outward normal, up vector, section). `connections` declares the graph, which must be a tree. Parts are placed by aligning connectors, never by hand.
- **Code** (`src/assets/js/assembly/`):
  - Pure modules, shared by the browser, the build and the unit tests: `units.js`, `geometry.js` (parametric hollow parts with sheet edges and frame flanges), `assembly.js` (solver, explode offsets).
  - `viewer.js`: three.js scene, OrbitControls, picking, render on demand, context loss.
  - `boot.js`: the part list and sheet, and lazy loading.
- **Checks:**
  - `scripts/assembly-validate.mjs` runs in `build` and `lint`: fields, units, ids, three languages, product links, buildable geometry, connected tree, matching sections, connector alignment.
  - `npm run test:unit` runs the `node:test` suite.
- **Static preview:** `scripts/assembly-svg.mjs` draws the assembly as an SVG at build time from the same geometry and transforms, using a fixed view direction. It is inlined in the page and replaced by the canvas when WebGL works.
- **Loading:**
  - `boot.js` (≈1.5 KB gzip) is the only script the page loads up front.
  - `viewer.js` and three.js (≈155 KB with Brotli, ≈190 KB gzip) are requested only when the view comes within 300 px of the viewport, and only if WebGL 2 is available and data saver is off.
  - No other page loads any of it.
- **Diagnostics (development):** `?debug3d=1` adds a panel. It shows WebGL availability, renderer status, shader errors, frames, draw calls and triangles, the selected part, resolution, and context loss and restore. `&simulate=init|blank|lost` forces a failure path. A created WebGL context is not treated as success: the first frame is read back and must contain drawn pixels, or the SVG drawing stays.
- **Caching:** the assembly page's import map points the lazily imported modules at hashed URLs, so a 7-day asset cache never serves stale 3D code.
- **Upgrading Three.js:** it stays on the vendored r170 (`OrbitControls.js` copied unchanged from the npm tarball three@0.170.0, integrity checked). Upgrade three.js and its addons together.

## Compression

`npm run build` writes a `.br` (Brotli quality 11) and a `.gz` (gzip level 9) copy of every text file of 1 KB or more in `dist/`.
- **Serving:** `server.mjs` sends the best copy the browser accepts (`Accept-Encoding`, Brotli first). It adds `Content-Encoding` and `Vary: Accept-Encoding` and keeps every security header.
- **Not compressed:** images, 404 pages, and `/api/rfq` responses.
- **Stale copies:** a copy older than its source file is ignored.
- **Why precompress:** Brotli quality 11 is far too slow to run per request.
- **Build cost:** about 15–20 s more per build on a phone, and roughly 800 KB more disk.
- **Faster local builds:** `PRECOMPRESS=0 npm run build` skips it, and the server then sends uncompressed files.
- **Static hosts:** Netlify and Cloudflare Pages compress on their own and simply ignore the extra files.

| Download (same origin) | uncompressed | Brotli |
|---|---|---|
| Assembly page before 3D | 104.6 KB | 33.6 KB |
| 3D chunk (three.js + viewer) | 751.1 KB | 155.4 KB |
| Home page incl. 3D header | 845.1 KB | 222.6 KB |
| Contact / quote form | 75.8 KB | 30.7 KB |

## Security

- Strict CSP: no inline scripts except the hashed import map, no inline styles, `frame-ancestors 'none'`. Also `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, `X-Frame-Options`, and HSTS in production.
- RFQ: multipart only, 60 MB body cap enforced while streaming, ≤ 5 files × 10 MB, extension **and** signature checks (`%PDF-`, `AC1xxx`, DXF section header), sanitised file names, storage dirs `0700` / files `0600` outside `dist/`, same-origin check, per-IP rate limit, honeypot, optional Turnstile, generic error messages to the client (details only in server logs).
- No secrets in the client bundle; all credentials are environment variables. No dependencies to audit.

## Performance

No framework JS. CSS ≈ 26 KB (≈ 6 KB gzipped). JS ≈ 11 KB per page, plus a 13 KB hero script on the home page, before compression. The hero's static image is ≈ 47 KB WebP. Three.js (≈ 170 KB gzipped, self-hosted) loads only after the page `load` event, during idle time, and only on the home page. It pauses when off-screen or in a background tab, caps the pixel ratio at 2, and is skipped on data-saver connections. Images have explicit dimensions (no layout shift). Hashed asset URLs (`?v=`) allow long caching.

## Tests

`npm test` builds the site, starts three server instances (not configured / configured with a mock webhook / low rate limit) and runs 28 end-to-end checks with Playwright + Chromium:

- every page returns 200 with security headers; no dead internal links; only declared external links; root language redirect; localised 404; path-traversal refusal; sitemap with hreflang; no draft pages indexed; canonical and JSON-LD present; no `Product` schema without real data
- RFQ API: not-configured → 503 with nothing stored; validation, honeypot, wrong type, spoofed PDF, too many files → 400; valid → stored (`0600`), webhook received, reference returned; storage not web-accessible; rate limit → 429; cross-origin → 403
- UI: navigation, language switch keeps the page, theme persists, mobile menu (Escape and focus return), product filter (+ URL state), product → pre-filled quote, hero 3D or fallback, reduced motion
- RFQ form: required / email / file-type errors with focus management, review step, consent, honest failure when not configured, success with reference when configured (no resubmit), Arabic end to end
- all 57 language pages at 390 / 768 / 1440 px: no horizontal overflow, no JS errors; screenshots in `tests/output/`
- accessibility: text contrast (WCAG 1.4.3) in dark and light, FR and AR; target size ≥ 24 px (2.5.8); accessible names; skip link; visible focus on the first 25 tab stops
- 3D assembly:
  - noindex, kept out of the sitemap and the menu, demo and pending labels in three languages
  - lazy loading: no 3D download on other pages or before the view approaches
  - modules, import map and CSP load without violations
  - keyboard selection and focus return
  - renders in 3D, or keeps the drawing and says why
  - WebGL disabled: drawing, list and part sheets still work
  - Arabic on a phone: right-to-left layout, Western digits, no overflow

WebGL errors raised by the test browser itself (no GPU, broken software rasteriser) are counted separately and reported at the end of the run, not treated as site errors. If they appear, 3D rendering was **not** verified in that run. `npm run test:unit` covers the geometry, the solver and the validator without a browser.

Playwright isn't a dependency. Install it (`npm i -D playwright && npx playwright install chromium`) or point `PLAYWRIGHT_MODULE` at an existing install.

**Not run in the build environment:** Lighthouse and axe-core (the npm registry was unreachable). The contrast, target-size, naming, landmark and focus checks above were written in-house instead. Run Lighthouse and axe once on the deployed site. The 3D scene is rendered in the tests with software WebGL (SwiftShader); check it once on real phones after deploying.

## Assumptions

- Same English slugs in all three languages (simpler hreflang; translated slugs can be added later).
- Dark theme is the default whatever the OS setting (brand choice), with a persistent toggle.
- The product families, capability families, industries list and the 4-step order flow are **descriptive categories, not claims**. Each one that implies a fact (ranges, equipment, process, industries) is visibly flagged "to be confirmed" until the owner validates it.
- The privacy and legal texts are templates with placeholders. Have them reviewed for the applicable law before publishing.
- The hero 3D is labelled "conceptual visual" on the page and in the legal notice.

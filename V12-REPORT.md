# LIBALSTAL v12 — Milestone 2: Cinematic ductwork assembly

Source: `libalstal-site-v11.zip`. This is a source-code upgrade, not a public deployment.

## Delivered

- New `src/assets/js/assembly/motion.js`: a dependency-free, deterministic motion controller with cubic easing, interruption, replay, and explicit frame-time input.
- Optional ~5.6-second cinematic sequence after the first successfully verified WebGL frame: show the assembled installation, orbit the camera, separate the components, briefly hold, then reassemble.
- Exact transform restoration: every frame uses the existing connector-solved installed transforms plus `explodeOffsets`, without accumulating deltas.
- Additional 3D controls: Skip, Explode, Reassemble and Replay alongside the existing rotation, zoom and reset commands. Skip is first in keyboard tab order; Escape also interrupts the cinematic intro.
- Canvas pointer and wheel input interrupts the motion, so visitors immediately regain control. Selecting a part from the accessible HTML list also interrupts it.
- Auto-intro is skipped for `prefers-reduced-motion`, and only offered once per browser tab (session storage when available). Manual exploded/reassembled state changes are instantaneous under reduced motion; Replay is disabled.
- Animation uses the existing on-demand renderer; it requests frames only while active, and pauses while the section/tab is hidden or WebGL is lost. The camera briefly widens for separation based on the assembly's computed explode offsets.
- Accessible controls and status messages in French, English and Arabic; styling respects the existing UI, including RTL. The SVG fallback and quote flow are unchanged.
- The separate preview-copy builder and CSP-hashed production import map both include the new module.

## Scope deliberately NOT changed

- No new npm dependencies, no React, no Vite, no GSAP.
- No new materials, dimensions, product specs, standards or fire-rating claims.
- No changes to the homepage, existing 3D header, quote form or Node server.
- No free 3D component dragging (planned for Milestone 3).
- Development-only assembly pages remain `noindex`, out of the main navigation and sitemap.

## Verification in this environment

| Check | Result |
|---|---|
| `node scripts/build.mjs` | Passed — 65 pages, 83 pre-existing missing-info items |
| `node scripts/lint.mjs` | Passed |
| `node --test tests/unit/*.test.mjs` | Passed — 63/63 (9 new motion tests) |
| `node scripts/preview.mjs` | Passed — 63 preview pages; inline assembly module parses |
| Browser suite `node tests/run.mjs` | Not run — Node `playwright` package not installed in this environment |
| GPU scene / animation / tap selection | Not visually verified; must be tested in Android Chrome |

Production assets are precompressed by the existing build. The new motion module is about 1 KB gzip. Browser transfer-size and frame-rate numbers must be verified from a real browser/network session.

## Real-device acceptance procedure

1. Build and run: `npm run build && npm start`.
2. Open `/fr/assembly/?debug3d=1` on your phone using the host and port exposed by your server.
3. Verify the eight parts actually render, then watch automatic orbit, separation and exact reassembly. Skip must immediately restore all parts.
4. Try Explode, Reassemble, Replay, rotate, zoom and Reset. Dragging or touching the canvas should interrupt the intro without leaving a half-exploded part.
5. Enable Android's reduced-motion accessibility setting and reload: no automatic intro; Replay disabled; Explode/Reassemble instantaneous.
6. Switch apps and return, rotate the phone, and test Arabic `/ar/assembly/?debug3d=1`.
7. Confirm the static drawing, parts list and quote links still work when WebGL is unavailable.

If the 3D canvas fails, the page keeps the SVG and part list. Record diagnostics and browser details; do not infer visual success from unit tests.

## Sources

- [Three.js WebGLRenderer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)

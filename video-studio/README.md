# LIBALSTAL Video Studio — welcome intro

Remotion project for the homepage welcome intro, **"Précision en mouvement"** (6 s, 180 frames @ 30 fps).
Storyboard and timing: [STORYBOARD.md](STORYBOARD.md). Layout, timing and wording: `../content/intro.json`
(shared with the website, so the live handoff always matches the footage).

The website itself is unchanged until you install approved renders (step 3).

## Requirements

- Node.js ≥ 20 (tested with 22), npm
- ffmpeg on the PATH (used to move the MP4 index to the front and to make the WebP poster)
- A machine where headless Chrome can do WebGL. `remotion.config.ts` uses the `angle` renderer. On a Linux
  server without a GPU, switch it to `swangle` (software; slower but fine for 180 frames).

## 1 · Install and preview

```bash
cd video-studio
npm install
npm run studio          # opens Remotion Studio: WelcomeDesktop and WelcomeMobile, scrub frame by frame
```

## 2 · Render

```bash
npm run render                  # every format × every language listed in intro.json "langs" (French today)
npm run render -- desktop fr    # just one
```

Output in `out/`, per format and language:

| File | Use |
|---|---|
| `welcome-desktop-fr.mp4`, `welcome-mobile-fr.mp4` | H.264, yuv420p, faststart. Safari, iOS, everything |
| `welcome-desktop-fr.webm`, `welcome-mobile-fr.webm` | VP9, about half the size. Chrome, Firefox, Android |
| `welcome-*-fr-poster.jpg / .webp` | Still at 4.4 s (logo + message), for sharing, docs, social |

Watch them full screen before installing. Acceptance points from the brief:
exactly 6 s, the logo is the untouched official file, no jump at the end.

## 3 · Install into the site (your approval step)

```bash
npm run install-intro           # copies out/ → ../src/assets/video/intro/
cd ..
npm run build                   # prints "Welcome intro: fr on · en off · ar off"
npm test
```

To take it off again: `npm run install-intro -- --remove`, then rebuild.

The build switches the intro on for a language only when its wording is approved in `intro.json` **and** both
of its videos (desktop + mobile, MP4 + WebM) are present. Commit the files in `src/assets/video/intro/` with
the site; Cloudflare Pages serves them with byte ranges, which Safari needs.

## Other languages

English and Arabic wording is proposed in `../content/intro.json` with `"approved": false`. When it's approved,
set `approved: true`, add the code to `"langs"`, then render and install. EN/AR homepages show no intro until then.

## How it's built

```
src/
  Root.tsx              compositions WelcomeDesktop (1920×1080) and WelcomeMobile (1080×1920)
  Welcome.tsx           layer stack: Backdrop → DuctScene → LogoReveal → WelcomeText
  scene/duct.ts         the galvanised duct section (three.js), proportions from the mark's top duct;
                        zinc spangle from the site's own generator (src/assets/js/assembly/spangle.js)
  scene/studio.ts       studio light baked into an environment map (top box, front wall, fill, rim, strip)
  scene/rig.ts          camera + light as pure functions of time (frames render in any order)
  scene/DuctScene.tsx   renders one WebGL frame per Remotion frame, synchronously
  components/           Backdrop (flat ground = page overlay colour), LogoReveal, WelcomeText
  lib/layout.ts         reads content/intro.json; logo/duct geometry; background curve
  lib/fonts.ts          Montserrat + Cairo from public/fonts (SIL OFL, licences included)
scripts/                sync-assets (official logo → public/), render, install-to-site
standin/                stand-in renderer (see below). Not part of the deliverable path
```

Plain three.js is used rather than `@remotion/three` / React Three Fiber: one object, imperative camera,
fewer packages. Nothing animates on its own: every value comes from `useCurrentFrame()`.

The site side is `../src/assets/js/intro-gate.js` (pre-paint decision), `../src/assets/js/intro.js`
(playback, skip, handoff), the "welcome intro" block at the end of `../src/assets/css/site.css`, and
`introMarkup()` in `../scripts/build.mjs`.

## Stand-in preview (`standin/`) and what was verified where

This project was written in a sandbox where the npm registry was blocked, so **Remotion itself has not been
installed or run yet**. To check the visuals anyway, `standin/render-standin.mjs` bundles the same `src/`
code with esbuild, maps the few `remotion` / `@remotion/fonts` calls it uses to a small stand-in
(`standin/remotion-shim.tsx`), steps all 180 frames in headless Chromium and encodes them with the same
codec settings. Its output is a **preview** (`out/standin/`), not the deliverable. The deliverable is
`npm run render`. If the two ever differ, Remotion is the reference.

Not verified in that sandbox: `npm install`, `remotion studio`, `remotion render`, TypeScript type-checking
against the real Remotion types, and playback on real Safari/iOS/Android hardware.

## v2 — "The machine becomes the identity" (in progress)

Plan, storyboard, rig hierarchy and sound cue sheet: the Claude doc *LIBALSTAL — Transformation Protocol v2*.

```
blender/logo_parts.json   final position of every emblem part (measured on the PNG for planning; replace with the SVG)
blender/rig.py            the mechanism as pure functions of time (no bpy): parts, rails, gores, louvres, camera, airflow
blender/build_scene.py    Blender 4.2 build: geometry, materials, light, keys every frame from rig.py, renders
animatic/                 grey-box animatic of the same rig (three.js in Chromium), for motion review only
```

```bash
python3 blender/rig.py --export animatic/.build/rig-frames.json   # check the rig
node animatic/render-animatic.mjs all                             # grey-box animatic, 960x540 + 540x960
blender --background --factory-startup --python blender/build_scene.py -- --format desktop --mode animatic
blender --background --factory-startup --python blender/build_scene.py -- --format desktop --mode lookdev --frames 15,45,75,105,135,174
blender --background --factory-startup --python blender/build_scene.py -- --format desktop --mode master
```

Status: `rig.py` and the animatic have run; `build_scene.py` has not run yet (no Blender in the environment it was written in).

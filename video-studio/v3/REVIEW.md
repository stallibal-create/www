# LIBALSTAL V3 — review and status (Blender paused)

Written while the Mac is unattended. No Blender call, no macOS change and no file on the Mac was touched for
anything below; everything was built and checked in the cloud workspace.

## 1. Two prototypes exist — who made what

| File (on the Mac) | Made by | Notes |
|---|---|---|
| `libalstal-v14/scripts/blender-airflow-prototype.py` | ChatGPT / Codex session | Workbench grey-box, saves the next free `vN` |
| `libalstal-v14/brand/blender/airflow-prototype-v1.blend`, `-v2.blend` | Codex (script above) | not opened, not modified |
| `visual/airflow-prototype/v1/`, `v2/` (stills, frames, GLB 52 nodes, `airflow-paths-v2.json`) | Codex | GLB copied here read-only for scoring |
| `v3-claude/tools/diag.py` | Claude | read-only diagnostic, never completed (Blender froze on a macOS privacy prompt) |
| `www/video-studio/blender/rig.py`, `build_scene.py` (repo) | Claude (V2) | `build_scene.py` has never been run in Blender |

## 2. Codex prototype v2 — against the official emblem

Scored with `tools/emblem_fit.py glb … --map tools/map-codex-v2.json` (report: `reports/codex-v2-glb-fit.json`,
overlay `reports/codex-v2-glb-overlay.png`).

- Emblem IoU **0.561** (gate 0.88); collar 0.053, wedge 0.116; aspect 1.04 vs the official 1.32.
- The top duct is **round**; on the logo it is a rectangular run with flange frames.
- The elbow has **5 gores**, and a vertical riser has been added. Neither matches the artwork.
- No pivots, extras or contract names. The site cannot drive its parts without hard-coding.
- **Verdict:** useful as a lighting and airflow idea, not as the V3 base. Keep it, don't build on it.

## 3. Claude `build_scene.py` (V2) — what must change for V3

Correct already:
- The gore mitres turn the right way. The bisect planes are at ±15° about Z, so the outer (+Y) side of each joint is the longer one. The 0.6 overshoot covers the 0.22 cut.
- The run and flange proportions come from `logo_parts.json`, which is now refitted (§4).

To change before the V3 build:
1. **Names and hierarchy follow `glb-contract.json`.**
   - Today each run is about 30 loose objects ("Top run front", "… cleat", "… bolt"…) under an Empty.
   - In V3 the part node must be the Empty, named `top_run` etc.
   - Its meshes get `top_run_*` names, joined per material: fewer draw calls on the web.
   - Bolts and cleats can stay separate as `fastener_*`.
2. **Gores chain.** `elbow_gore_1` sits under `top_run`, and each next gore under the previous one. Origins are on the seams (the hinge pivots).
3. **Custom property `libalstal`** on every part: `{part, dof, explode, axis}`. Export with `export_extras=True`, `export_apply=True` for modifiers. Apply object scale.
4. **Materials named as in the contract.** Today: "Galvanised steel", "Brushed stainless", a reveal mix. Contract: `galvanised`, `galvanised_flange`, `stainless_brushed`, `ral5017_coat`, `gasket`, `interior`.
5. **The emission and "reveal" shaders are video-only.** They stay out of the web export, in their own collection excluded from the GLB.
6. **Front view sits in the contract's `logoFrame`.** 1 PNG px = 1 mm, origin at the PNG's top-left. That way `emblem_fit.py --register contract` checks it with no fitting.
7. **Save to a new file.** Use `~/Desktop/libalstal/v3-claude/libalstal-v3.blend`, never over V2 or Codex files. Same rule for every output folder.

## 4. Geometry — refitted to the official PNG (planning, no Blender)

`blender/logo_parts.json` is now measured from the vector guide **clipped to the official PNG's alpha**. The guide's
shapes are only used where the official artwork also has ink.

| part | plan IoU | proxy GLB IoU (contract frame) | gate |
|---|---|---|---|
| top run | 0.896 | 0.895 | 0.85 |
| bottom run | 0.879 | 0.885 | 0.85 |
| side panel | 0.978 | 0.981 | 0.85 |
| wedge | 0.892 | 0.892 | 0.75 |
| elbow (4 gores) | 0.905 | 0.902 | 0.80 |
| collar | 0.932 | 0.932 | 0.80 |
| grille (6 louvres) | 0.938 | 0.938 | 0.85 |
| **emblem** | **0.937** | **0.936** | 0.88 |

The remaining gap is mostly anti-aliased edges and the small corner radii of the artwork. The logo itself is not
changed; the wordmark is never modelled.

## 5. Tools added (all Blender-free)

- `truth/emblem-parts.png/.json` — per-part truth masks from the official PNG.
- `tools/emblem_fit.py plan | glb` — silhouette gate.
  - `--register contract` for V3 exports.
  - `--register bbox` for models in another frame.
- `glb-contract.json` + `tools/validate-glb.mjs` — names, hierarchy, scale, extras, materials, budgets (desktop 150k tris / 4 MB, mobile 60k / 2 MB), `airflow-paths.json`.
- `proxy/` — a grey-box GLB in the exact contract structure (720 triangles, 58 KB).
  - It passes the validator and every silhouette gate.
  - Its airflow centreline is taken from its own node transforms.
  - **It is a stand-in for testing; it never ships as the model.**
- `viewer/` — the interactive prototype (§6).

## 6. Interactive viewer (option B), plain JS + three.js r170 + GSAP 3.15

`viewer/emblem-viewer.js` loads any contract GLB and reads everything from the extras. Its controls:
- orbit (drag)
- assemble / exploded view (one GSAP-driven scalar)
- airflow on/off: an x-ray dashed flow, with the louvres opening, captioned "pas une simulation CFD"
- reset
- `bindScroll()`: a ScrollTrigger camera that explodes and re-assembles as a section scrolls

It also handles reduced motion (no tweens, still logo), renders only while on screen with the tab visible, and frees
the GPU on `dispose()`.

`viewer/test-viewer.mjs` runs it headless (desktop 1280×800, mobile 390×844, reduced motion). It drives every
control, fails on any page error and saves screenshots to `reports/viewer-*.png`. All 15 checks pass with the
proxy: 24 draw calls.

**Not wired into the live site.** It needs your approval and the real model first.

## 7. Blockers and open points

1. **Blender MCP.**
   - Every call to the "Blender" server times out, the background `_for_cli` variants included. The "blender" duplicate entry fails with "Connection closed".
   - Blender is frozen behind a macOS privacy prompt.
   - Needs you at the Mac: answer or dismiss the prompt. Then I run the read-only `diag.py` and reconcile the two MCP entries (nothing gets deleted without your OK).
2. **No push access** to `stallibal-create/www`. Work is delivered as patches (`git am`).
3. **The Desktop `libalstal-v14` copy is ahead of GitHub** (Codex changes). Patches are made against GitHub `main`, so apply them to a clean clone first, or tell me which copy is the source of truth.
4. **Next with Blender.**
   - Build `libalstal-v3.blend` from the contract.
   - Validate the export with `validate-glb.mjs` and `emblem_fit.py --register contract`.
   - One Cycles benchmark frame, then the 4 stills (front, ¾ hero, transformation close-up, airflow) for your approval before any animation render.

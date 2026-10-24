# LIBALSTAL V3 — photoreal emblem + interactive 3D (work in progress)

V1 (Remotion intro) and V2 (transformation animatic) are untouched. Status, review and blockers: [REVIEW.md](REVIEW.md).

```
glb-contract.json        what the Blender export must contain (names, pivots, extras, materials, budgets, logoFrame)
truth/                   per-part masks of the official PNG emblem (the scoring truth)
tools/emblem_fit.py      silhouette gate     python3 v3/tools/emblem_fit.py glb M.glb --map v3/tools/map-contract.json --register contract
tools/validate-glb.mjs   structure gate      node v3/tools/validate-glb.mjs M.glb [--mobile]
proxy/                   grey-box stand-in GLB in the contract structure (testing only, never shipped)
                         NODE_TOOLS=…/node_modules node v3/proxy/build-proxy.mjs
viewer/                  interactive prototype (three r170 + GSAP 3.15, plain JS)
                         serve the repo root, open /video-studio/v3/viewer/   (?glb=/path/model.glb to swap the model)
                         NODE_TOOLS=…/node_modules node v3/viewer/test-viewer.mjs
reports/                 latest scores, overlays and viewer screenshots
```

Overlay colours: grey = model and logo agree, red = logo ink the model misses, blue = model where the logo is empty.

# LIBALSTAL — "Précision en mouvement" · storyboard & timing

6.00 s · 180 frames @ 30 fps · 1920×1080 (desktop) and 1080×1920 (phones) · silent.
Every number below lives in `../content/intro.json`; the video and the page read the same file.

| # | Time (s) | Frames | Picture | Motion & light | Owner |
|---|---|---|---|---|---|
| 01 · Engineered from darkness | 0.00–1.50 | 0–44 | One galvanised rectangular duct section: spangle zinc sheet, cross-broken panels, Pittsburgh lock seam, flange frames with corner cleats and bolts. Deep charcoal ground `#0b0d0f`. | The part fades up from the ground (never a black cut-out). The studio light wakes from 0 to full by 1.2 s. Slow 3/4 dolly in, 36°→29° yaw, 18° lens. | Video |
| 02 · The reveal | 1.50–3.00 | 45–89 | The part squares up and settles exactly onto the top duct of the official mark (proportions measured on `brand/logo-source.png`). The mark opens outward from that duct. | A narrow strip light travels across the front face (expressed relative to the camera so it always crosses the metal), then rests on it. Pull-back on a log curve (even perceived speed), 1.45→2.45 s. 3D fades 2.40→2.80 s while the radial reveal (2.20→2.95 s) uncovers the painted mark. One restrained glint crosses the logo, 2.5→3.5 s, 30 % max. | Video |
| 03 · Welcome | 3.00–4.75 | 90–142 | Logo centred, untouched. **BIENVENUE CHEZ LIBALSTAL** (Montserrat 600, `#E8ECEF`), a 72 px RAL 5017 rule, **L’EXCELLENCE PREND FORME** (Montserrat 500, RAL 7001 tone). | Title tracking closes from +0.28 em to set with opacity, 3.05→4.0 s, ease `cubic-bezier(.16,1,.3,1)`. Rule draws from the centre 3.5→4.1 s. Tagline follows 3.7→4.45 s. No glow, no particles, no camera move. | Video |
| 04 · Handoff | 4.75–6.00 | 143–179 | Text dissolves (4.75→5.10 s). The ground lifts toward the hero colour `#16191c`. | **Live in the page:** at 4.75 s a real `<img>` of the logo replaces the video's logo pixel-for-pixel. The footage fades (4.75→5.10). The logo glides into the header logo's exact position first (4.95→5.80, `cubic-bezier(.65,0,.35,1)`), over a ground that is still dark. Then the overlay lifts (5.10→5.95, same curve) onto the already-mounted homepage. The hero settles 16 px with a light stagger (from 5.3 s). At 5.95 s the overlay is removed and the 3D hero starts. | Page (`src/assets/js/intro.js`) |

## Why the handoff is live, not baked

A video can't know where the header logo is on a given screen, or the visitor's theme, language and
window shape. So the footage ends on a still logo over a flat ground. The page computes where that logo is on
screen (same placement maths as the video), puts the real logo image exactly there, and moves *that* into the
header. There's no seam to see: same pixels, same place, same ground colour, then real DOM from there on.

## Screen shapes

The page picks the portrait footage when the window is taller than wide, otherwise the landscape one.
It scales like `object-fit: cover` but never crops the safe rectangle (`safe` in intro.json, which holds the
logo and both lines of text). Where the screen is extreme, the margins are the same flat ground colour.

## Languages

French is approved and rendered. English and Arabic wording is proposed in `intro.json` (`approved: false`).
Those pages show no intro until it's approved, added to `langs` and rendered. Arabic is never letter-spaced
(it would break the letter joins), so it fades in instead.

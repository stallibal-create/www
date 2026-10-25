// Technical line drawings for product families (decorative, aria-hidden).
// Styled by CSS: .lt (light stroke), .ac (accent), .dim (dimension lines).
const svg = inner => `<svg viewBox="0 0 160 96" focusable="false">${inner}</svg>`;
const dimH = (x1, x2, y) => `<g class="dim"><path d="M${x1} ${y}H${x2}M${x1} ${y - 4}v8M${x2} ${y - 4}v8"/></g>`;
const dimV = (x, y1, y2) => `<g class="dim"><path d="M${x} ${y1}V${y2}M${x - 4} ${y1}h8M${x - 4} ${y2}h8"/></g>`;

export const icons = {
  'spiral-round-duct': svg(`
    <path class="ln" d="M24 26H128M24 70H128"/>
    <ellipse class="ln" cx="24" cy="48" rx="8" ry="22"/>
    <ellipse class="ln" cx="128" cy="48" rx="8" ry="22"/>
    <path class="lt" d="M38 26l-10 44M58 26l-10 44M78 26l-10 44M98 26l-10 44M118 26l-10 44"/>
    <ellipse class="ac" cx="128" cy="48" rx="4" ry="12"/>
    ${dimH(24, 128, 84)}`),
  'rectangular-duct': svg(`
    <path class="ln" d="M20 34h92v36H20zM20 34l18-14h92l-18 14M112 70l18-14V20"/>
    <path class="lt" d="M44 34v36M68 34v36M92 34v36"/>
    <path class="ac" d="M112 34l18-14"/>
    ${dimH(20, 112, 84)}${dimV(144, 20, 56)}`),
  elbows: svg(`
    <path class="ln" d="M18 30h40a42 42 0 0 1 42 42v8M18 62h40a10 10 0 0 1 10 10v8"/>
    <path class="lt" d="M58 30v32M80 38l-17 28M95 55l-26 13"/>
    <path class="ln" d="M68 80h32"/>
    <path class="ac" d="M18 30v32"/>
    ${dimH(18, 58, 16)}`),
  'reducers-transitions': svg(`
    <ellipse class="ln" cx="30" cy="48" rx="8" ry="28"/>
    <path class="ln" d="M30 20H62L98 34H130M30 76H62L98 62H130"/>
    <ellipse class="ln" cx="130" cy="48" rx="6" ry="14"/>
    <path class="lt" d="M62 20v56M98 34v28"/>
    <ellipse class="ac" cx="130" cy="48" rx="2.5" ry="7"/>
    ${dimV(146, 34, 62)}${dimV(14, 20, 76)}`),
  'tees-branches': svg(`
    <path class="ln" d="M14 50H146M14 78H146"/>
    <ellipse class="ln" cx="14" cy="64" rx="5" ry="14"/>
    <ellipse class="ln" cx="146" cy="64" rx="5" ry="14"/>
    <path class="ln" d="M66 50V16M94 50V16"/>
    <ellipse class="ac" cx="80" cy="16" rx="14" ry="5"/>
    <path class="lt" d="M66 50q14 8 28 0"/>`),
  'flanges-connectors': svg(`
    <circle class="ln" cx="80" cy="48" r="38"/>
    <circle class="ln" cx="80" cy="48" r="24"/>
    ${[0, 45, 90, 135, 180, 225, 270, 315].map(a => { const r = 31, x = 80 + r * Math.cos(a * Math.PI / 180), y = 48 + r * Math.sin(a * Math.PI / 180); return `<circle class="ac" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"/>`; }).join('')}
    <path class="lt" d="M80 4v8M80 84v8M36 48h8M116 48h8"/>`),
  'grilles-dampers': svg(`
    <rect class="ln" x="42" y="10" width="76" height="76" rx="2"/>
    <rect class="lt" x="50" y="18" width="60" height="60"/>
    <path class="ln" d="M52 26l56 6M52 38l56 6M52 50l56 6M52 62l56 6"/>
    <circle class="ac" cx="46" cy="14" r="1.8"/><circle class="ac" cx="114" cy="14" r="1.8"/><circle class="ac" cx="46" cy="82" r="1.8"/><circle class="ac" cx="114" cy="82" r="1.8"/>
    ${dimH(42, 118, 92)}`),
  'custom-assemblies': svg(`
    <path class="ln" d="M16 70h40l14-34h48l14 18h12"/>
    <path class="lt" d="M16 76h40l14-34h48l14 18h12"/>
    <path class="ac" d="M56 70l14-34"/>
    <path class="dim" d="M70 36a14 14 0 0 1 10 10"/>
    ${dimH(16, 56, 88)}${dimV(150, 36, 70)}`),
};
// material variants of the duct families share the rectangular duct drawing
for (const k of ['stainless-ducts', 'aluminium-ducts', 'black-steel-ducts']) icons[k] = icons['rectangular-duct'];

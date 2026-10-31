// LIBALSTAL — photographic homepage opening (no video, no React on the site).
// photoHero(ctx, config, asset) returns the complete <section> markup. It reads no filesystem:
// the builder passes content/photo-hero.json (config) and its A() hashing helper (asset).
// Motion timing is authored in Blender and exported to src/assets/js/photo-hero-timing.js;
// Remotion previews the same choreography. The website animates with native DOM/CSS only.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pad2 = n => String(n).padStart(2, '0');

// Image variants: desktop 1920×1080, mobile 960×1200. `image` is the base path without size suffix.
const imgSet = (asset, base) => ({
  mobile: asset(`/assets/img/${base}-mobile.webp`),
  w960: asset(`/assets/img/${base}-960.webp`),
  w1920: asset(`/assets/img/${base}-1920.webp`),
});

// First slide: eager, fetchpriority=high, <picture> with a mobile source (960×1200) and a desktop srcset.
function firstPicture(asset, base, alt) {
  const s = imgSet(asset, base);
  return `<picture class="ph-pic">
  <source media="(max-width: 600px)" srcset="${esc(s.mobile)}" width="960" height="1200">
  <img src="${esc(s.w1920)}" srcset="${esc(s.w960)} 960w, ${esc(s.w1920)} 1920w" sizes="100vw" width="1920" height="1080" alt="${esc(alt)}" fetchpriority="high" decoding="async">
</picture>`;
}

// Other slides: no src until the module hydrates them (idle or on manual selection).
function lazyPicture(asset, base, alt, id) {
  const s = imgSet(asset, base);
  return `<picture class="ph-pic">
  <source media="(max-width: 600px)" data-srcset="${esc(s.mobile)}" width="960" height="1200">
  <img data-src="${esc(s.w1920)}" data-srcset="${esc(s.w960)} 960w, ${esc(s.w1920)} 1920w" sizes="100vw" width="1920" height="1080" alt="${esc(alt)}" loading="lazy" decoding="async" data-photo-img="${esc(id)}">
</picture>`;
}

// Optional helper for the builder's <head>: preload the first image only.
export function photoHeroPreload(config, asset) {
  if (!config?.enabled || !config.slides?.length) return '';
  const s = imgSet(asset, config.slides[0].image);
  return `<link rel="preload" as="image" media="(min-width: 601px)" href="${esc(s.w1920)}" imagesrcset="${esc(s.w960)} 960w, ${esc(s.w1920)} 1920w" imagesizes="100vw" fetchpriority="high">\n<link rel="preload" as="image" media="(max-width: 600px)" href="${esc(s.mobile)}" fetchpriority="high">`;
}

// Screen-reader-only instructions for stopping autoplay without a visible pause control.
const SR_INSTRUCTIONS = {
  fr: 'Le diaporama avance automatiquement. Appuyez sur Échap pour arrêter le défilement automatique. Utilisez les boutons précédent et suivant pour changer de photo.',
  en: 'The slideshow advances automatically. Press Escape to stop automatic advance. Use the previous and next buttons to change the photo.',
  ar: 'تتقدم الشرائح تلقائيًا. اضغط على مفتاح Escape لإيقاف التقدم التلقائي. استخدم زري السابق والتالي لتغيير الصورة.',
};

export function photoHero(ctx, config, asset) {
  if (!config?.enabled || !Array.isArray(config.slides) || !config.slides.length) return '';
  const { lang } = ctx;
  const C = config.copy[lang] || config.copy.fr;
  const slides = config.slides;
  const total = slides.length;
  const first = slides[0];
  const firstCopy = first.copy[lang] || first.copy.fr;

  // Whole <h1> is one accessible heading; each visual line is a span (never rasterised, Arabic shaping preserved).
  const titleLines = (firstCopy.titleLines || C.titleLines || []).map((line, i) =>
    `<span class="ph-line" data-line="${i}"><span class="ph-line-in">${esc(line)}</span></span>`).join('');

  // Slides: first is current and visible; others are hidden until JS (or manual selection) reveals them.
  const slideMarkup = slides.map((s, i) => {
    const sc = s.copy[lang] || s.copy.fr;
    const isFirst = i === 0;
    const pic = isFirst ? firstPicture(asset, s.image, sc.alt) : lazyPicture(asset, s.image, sc.alt, s.id);
    const tl = sc.titleLines || [];
    return `<figure class="ph-slide${isFirst ? ' is-current' : ''}" data-photo-id="${esc(s.id)}" data-index="${i}" data-caption="${esc(sc.caption)}" data-label="${esc(sc.label)}" data-title-first="${esc(tl[0] || '')}" data-title-second="${esc(tl[1] || '')}" data-lead="${esc(sc.lead || '')}"${isFirst ? '' : ' hidden'} role="group" aria-roledescription="slide" aria-label="${esc(pad2(i + 1))} / ${esc(pad2(total))}">
  ${pic}
</figure>`;
  }).join('\n');

  const dataAttrs = `data-hold="${esc(config.holdMs)}" data-transition="${esc(config.transitionMs)}" data-fps="${esc(config.fps)}" data-load-error="${esc(C.loadError)}"`;

  // CTA group: real links, translated. Quote → contact page, Products → products page.
  const ctaGroup = `<div class="ph-cta-group" role="group" aria-label="${esc(C.ctaGroupLabel)}">
          <a href="/${esc(lang)}/contact/" class="btn btn-primary ph-cta">${esc(C.quote)}</a>
          <a href="/${esc(lang)}/products/" class="btn btn-secondary ph-cta">${esc(C.products)}</a>
        </div>`;

  const srInstructions = SR_INSTRUCTIONS[lang] || SR_INSTRUCTIONS.fr;

  return `<section class="photo-hero" id="photo-hero" aria-labelledby="ph-title" aria-describedby="ph-help" ${dataAttrs}>
  <div class="ph-stage">
    <div class="ph-media" aria-hidden="false">
${slideMarkup}
    </div>
    <div class="ph-scrim" aria-hidden="true"></div>
    <div class="ph-inner">
      <div class="ph-copy">
        <p class="ph-eyebrow">${esc(C.eyebrow)}</p>
        <h1 class="ph-title" id="ph-title">${titleLines}</h1>
        <span class="ph-rule" aria-hidden="true"></span>
        <p class="ph-lead">${esc(firstCopy.lead || C.lead)}</p>
        ${ctaGroup}
        <div class="ph-controls">
          <div class="ph-buttons" role="group" aria-label="${esc(C.select)}">
            <button type="button" class="ph-btn ph-prev" data-photo-prev aria-label="${esc(C.previous)}" hidden>
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button type="button" class="ph-btn ph-next" data-photo-next aria-label="${esc(C.next)}" hidden>
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
        <div class="ph-caption" aria-live="off">
          <span class="ph-cap-label">${esc(firstCopy.label)}</span>
          <span class="ph-cap-src">${esc(C.retouched)}</span>
        </div>
      </div>
      <p class="ph-status sr" role="status" aria-live="polite" data-photo-status></p>
      <p class="ph-sr-help sr" id="ph-help" data-photo-help>${esc(srInstructions)}</p>
    </div>
  </div>
</section>
`;
}

// Reviewed progressive-enhancement runtime. The initial HTML remains useful without JavaScript.
import { PHOTO_HERO_TIMING as timing } from './photo-hero-timing.js';
const root = document.querySelector('#photo-hero');
if (root) {
  const slides = [...root.querySelectorAll('.ph-slide')];
  const previous = root.querySelector('[data-photo-prev]');
  const next = root.querySelector('[data-photo-next]');
  const status = root.querySelector('[data-photo-status]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection;
  const isStatic = () => reduce.matches || !!connection?.saveData;
  const hold = Number(root.dataset.hold) || timing.holdMs;
  const fade = Number(root.dataset.transition) || timing.transitionMs;
  let current = 0, requested = 0, generation = 0, clock, settle;
  let stopped = false, hovered = false, focused = false, onscreen = true;
  const autoAllowed = () => !isStatic() && !stopped && !hovered && !focused && onscreen && !document.hidden;
  const stop = () => { clearTimeout(clock); clock = undefined; };
  function schedule() {
    stop();
    if (autoAllowed()) clock = setTimeout(async () => {
      await show((current + 1) % slides.length, false);
      schedule();
    }, hold);
  }
  function announce(text) { status.textContent = text; }
  function sync() {
    root.dataset.current = slides[current].dataset.photoId;
    const lineEls = root.querySelectorAll('.ph-title .ph-line-in');
    const firstLine = slides[current].dataset.titleFirst || '';
    const secondLine = slides[current].dataset.titleSecond || '';
    if (lineEls[0]) lineEls[0].textContent = firstLine;
    if (lineEls[1]) lineEls[1].textContent = secondLine;
    const leadEl = root.querySelector('.ph-lead');
    if (leadEl) leadEl.textContent = slides[current].dataset.lead || '';
    root.classList.toggle('is-static', isStatic());
    root.classList.toggle('is-stopped', stopped);
  }
  async function load(slide) {
    const image = slide.querySelector('img');
    image.loading = 'eager';
    slide.querySelectorAll('source[data-srcset]').forEach(source => {
      source.srcset = source.dataset.srcset;
      delete source.dataset.srcset;
    });
    if (image.dataset.srcset) { image.srcset = image.dataset.srcset; delete image.dataset.srcset; }
    if (image.dataset.src) { image.src = image.dataset.src; delete image.dataset.src; }
    try {
      await Promise.race([
        image.decode(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Image timeout')), 12000)),
      ]);
      return image.naturalWidth > 0;
    } catch { return false; }
  }
  async function show(number, manual = true) {
    stop();
    requested = (number + slides.length) % slides.length;
    const ticket = ++generation, targetIndex = requested;
    if (targetIndex === current) {
      root.dataset.state = settle ? 'transiting' : 'idle';
      schedule();
      return;
    }
    root.dataset.state = 'loading';
    const target = slides[targetIndex];
    const ready = await load(target);
    if (ticket !== generation) return;
    if (!ready || (!manual && !autoAllowed())) {
      requested = current;
      root.dataset.state = 'idle';
      if (!ready && manual) announce(root.dataset.loadError);
      schedule();
      return;
    }
    target.hidden = false;
    target.classList.remove('is-leaving');
    if (!isStatic()) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (ticket !== generation) return;
    clearTimeout(settle);
    const outgoing = slides[current];
    outgoing.classList.add('is-leaving');
    outgoing.classList.remove('is-current');
    target.classList.add('is-current');
    current = targetIndex;
    sync();
    root.classList.remove('is-entering', 'is-copy-entering');
    void root.offsetWidth;
    if (!isStatic()) {
      root.classList.add('is-copy-entering');
      clearTimeout(root._copyTimer);
      root._copyTimer = setTimeout(() => root.classList.remove('is-copy-entering'), 1600);
    }
    root.dataset.copyCycle = String((Number(root.dataset.copyCycle) || 0) + 1);
    root.dataset.state = isStatic() ? 'idle' : 'transiting';
    const finish = () => {
      slides.forEach((slide, i) => {
        slide.hidden = i !== current;
        slide.classList.remove('is-leaving');
        slide.classList.toggle('is-current', i === current);
      });
      settle = undefined;
      root.dataset.state = 'idle';
    };
    if (isStatic()) finish();
    else settle = setTimeout(finish, fade + 40);
    if (manual) announce(`${current + 1} / ${slides.length} — ${target.dataset.label}`);
    schedule();
  }
  [previous, next].forEach(button => { button.hidden = false; });
  previous.addEventListener('click', () => show(requested - 1));
  next.addEventListener('click', () => show(requested + 1));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!stopped) {
        stopped = true;
        sync();
        schedule();
        announce(({fr:'Diaporama arrêté.',en:'Autoplay stopped.',ar:'تم إيقاف العرض التلقائي.'})[document.documentElement.lang] || 'Autoplay stopped.');
      }
      return;
    }
    if (!event.target.closest('.ph-controls')) return;
    const backwards = document.documentElement.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const forwards = backwards === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === backwards) { event.preventDefault(); show(requested - 1); }
    else if (event.key === forwards) { event.preventDefault(); show(requested + 1); }
    else if (event.key === 'Home') { event.preventDefault(); show(0); }
    else if (event.key === 'End') { event.preventDefault(); show(slides.length - 1); }
  });
  root.addEventListener('pointerenter', () => { hovered = true; schedule(); });
  root.addEventListener('pointerleave', () => { hovered = false; schedule(); });
  root.addEventListener('focusin', () => { focused = true; schedule(); });
  root.addEventListener('focusout', event => {
    if (!root.contains(event.relatedTarget)) { focused = false; schedule(); }
  });
  document.addEventListener('visibilitychange', schedule);
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    onscreen = entries[0].isIntersecting;
    schedule();
  }, { threshold: 0.1 }) : null;
  observer?.observe(root);
  const preferences = () => {
    root.classList.remove('is-entering');
    root.classList.remove('is-copy-entering');
    sync();
    schedule();
  };
  reduce.addEventListener('change', preferences);
  connection?.addEventListener?.('change', preferences);
  root.dataset.state = 'idle';
  sync();
  if (!isStatic()) {
    root.classList.add('is-entering');
    setTimeout(() => root.classList.remove('is-entering'), 2000);
    const idle = window.requestIdleCallback || (callback => setTimeout(callback, 1200));
    idle(() => { if (!isStatic() && onscreen && !document.hidden) load(slides[1]); });
  }
  schedule();
  addEventListener('pagehide', () => { stop(); clearTimeout(settle); observer?.disconnect(); }, { once: true });
}

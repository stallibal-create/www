// "Du plan au métal" homepage story (v14). Progressive enhancement only:
// without this script every drawing is shown in a 2×2 grid next to the steps (readable, printable).
// With it, one sticky stage shows the step in view; its lines draw in, and a rail shows progress.
// No library, no per-frame work when idle: an IntersectionObserver picks the step, scroll updates one CSS variable.
(function () {
  'use strict';
  var story = document.querySelector('.story');
  if (!story || !('IntersectionObserver' in window)) return;
  var stage = story.querySelector('.st-stage');
  var figs = Array.prototype.slice.call(story.querySelectorAll('.st-fig'));
  var steps = Array.prototype.slice.call(story.querySelectorAll('.st-step'));
  var count = story.querySelector('.st-count');
  var list = story.querySelector('.st-steps');
  if (!stage || !figs.length || !steps.length) return;

  story.classList.add('is-live');
  var active = -1;
  function show(i) {
    if (i === active) return;
    active = i;
    stage.setAttribute('data-active', String(i));
    figs.forEach(function (f) { f.classList.toggle('on', +f.dataset.step === i); });
    steps.forEach(function (s) { s.classList.toggle('on', +s.dataset.step === i); });
    if (count) count.textContent = count.dataset.template.replace('{n}', i + 1);
  }
  // a step is "current" when it crosses the middle band of the viewport
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) show(+e.target.dataset.step); });
  }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
  steps.forEach(function (s) { io.observe(s); });
  // first frame: draw step 1 once the stage is on screen (so the drawing animation is seen)
  var seen = new IntersectionObserver(function (es) {
    if (es[0].isIntersecting) { if (active < 0) show(0); seen.disconnect(); }
  }, { threshold: 0.25 });
  seen.observe(stage);

  // progress rail: 0 → 1 while the step list scrolls through the viewport
  var ticking = false;
  function rail() {
    ticking = false;
    var r = list.getBoundingClientRect(), vh = window.innerHeight || 1;
    var p = Math.min(1, Math.max(0, (vh * 0.5 - r.top) / Math.max(1, r.height)));
    stage.style.setProperty('--p', p.toFixed(3));
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(rail); } }, { passive: true });
  rail();
})();

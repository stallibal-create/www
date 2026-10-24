// Welcome intro — pre-paint decision (loaded synchronously in <head> on home pages that have an intro).
// Plays once per tab session. Never for reduced motion or data saver. Marked as seen before it starts, so a
// refresh (even mid-intro) shows the homepage directly. Without JavaScript nothing happens at all.
(function () {
  var d = document.documentElement;
  try {
    if (sessionStorage.getItem('libalstal-intro')) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = navigator.connection;
    if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
    sessionStorage.setItem('libalstal-intro', '1');
    d.classList.add('intro-on');
  } catch (e) { /* storage blocked → no intro */ }
})();

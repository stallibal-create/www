// Runs before first paint: mark JS available, apply saved theme (dark is the brand default).
(function () {
  var d = document.documentElement;
  d.classList.add('js');
  try {
    var t = localStorage.getItem('libalstal-theme');
    if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable: keep default */ }
})();

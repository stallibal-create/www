// Site-wide behaviour: mobile menu, theme toggle, reveal-on-scroll, product filter.
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = document.documentElement;

  // ----- mobile menu -----
  var burger = $('.burger'), nav = $('#site-nav');
  if (burger && nav) {
    var setOpen = function (open, focusBack) {
      nav.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? burger.dataset.close : burger.dataset.open);
      if (open) { var first = $('a', nav); if (first) first.focus(); }
      else if (focusBack) burger.focus();
    };
    burger.addEventListener('click', function () { setOpen(burger.getAttribute('aria-expanded') !== 'true'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) setOpen(false, true);
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    window.matchMedia('(min-width: 1061px)').addEventListener('change', function (m) { if (m.matches) setOpen(false); });
  }

  // ----- theme toggle -----
  var tb = $('.theme-btn');
  if (tb) {
    var label = function () {
      var dark = root.getAttribute('data-theme') !== 'light';
      tb.setAttribute('aria-label', dark ? tb.dataset.labelLight : tb.dataset.labelDark);
      tb.setAttribute('aria-pressed', String(!dark));
      var m = $('meta[name="theme-color"]'); if (m) m.setAttribute('content', dark ? '#16191c' : '#E8ECEF');
    };
    label();
    tb.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('libalstal-theme', next); } catch (e) { /* ignore */ }
      label();
      document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
    });
  }

  // ----- reveal -----
  var rv = $$('.rv');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    rv.forEach(function (x) { io.observe(x); });
  } else rv.forEach(function (x) { x.classList.add('in'); });

  // ----- product filter (state kept in URL hash: #cat=duct) -----
  var grid = $('#product-grid');
  if (grid) {
    var chips = $$('.chip'), cards = $$('.card', grid), empty = $('#product-empty'), count = $('.count');
    var apply = function (f, push) {
      var n = 0;
      chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.filter === f)); });
      cards.forEach(function (c) { var show = f === 'all' || c.dataset.cat === f; c.hidden = !show; if (show) n++; });
      empty.hidden = n > 0;
      if (count) count.textContent = count.dataset.template.replace('{n}', n);
      if (push) history.replaceState(null, '', f === 'all' ? location.pathname : '#cat=' + f);
    };
    chips.forEach(function (c) { c.addEventListener('click', function () { apply(c.dataset.filter, true); }); });
    var m = /cat=(\w+)/.exec(location.hash);
    if (m && chips.some(function (c) { return c.dataset.filter === m[1]; })) apply(m[1], false);
  }
})();

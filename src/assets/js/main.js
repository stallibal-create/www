// Site-wide behaviour: mobile menu, theme toggle, social dock, reveal-on-scroll, product filter.
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = document.documentElement;

  // Refresh the footer year on visits and when a background tab is reopened.
  function updateCopyrightYear() {
    var year = String(new Date().getFullYear());
    $$('[data-copyright-year]').forEach(function (el) { el.textContent = year; });
  }
  updateCopyrightYear();
  window.addEventListener('pageshow', updateCopyrightYear);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) updateCopyrightYear();
  });

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

  // ----- header: scrolled state + reading progress hairline (one CSS variable, rAF-throttled) -----
  var hdr = $('.site-header');
  if (hdr) {
    var pending = false;
    var onScroll = function () {
      pending = false;
      var y = window.scrollY || 0, max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      hdr.classList.toggle('is-scrolled', y > 8);
      hdr.style.setProperty('--scroll', Math.min(1, y / max).toFixed(4));
    };
    window.addEventListener('scroll', function () { if (!pending) { pending = true; requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();
  }

  // ----- social dock: phone toggle (several links) + out of the way while typing -----
  var dock = $('.social-dock');
  if (dock) {
    var toggle = $('.sd-toggle', dock), narrow = window.matchMedia('(max-width: 760px), (max-height: 420px)');
    var setDock = function (open, focusBack) {
      dock.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? toggle.dataset.close : toggle.dataset.open);
      if (!open && focusBack) toggle.focus();
    };
    if (toggle) {
      dock.classList.add('is-ready');
      toggle.addEventListener('click', function () { setDock(toggle.getAttribute('aria-expanded') !== 'true'); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dock.classList.contains('is-open')) setDock(false, true); });
      document.addEventListener('click', function (e) { if (dock.classList.contains('is-open') && !dock.contains(e.target)) setDock(false); });
    }
    var typing = function (e) { return e.target.matches && e.target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select'); };
    document.addEventListener('focusin', function (e) { if (narrow.matches && typing(e)) dock.classList.add('is-typing'); });
    document.addEventListener('focusout', function (e) { if (typing(e)) dock.classList.remove('is-typing'); });
  }

  // ----- welcome video: plays once (muted) unless reduced motion or data saver; the poster is the final logo frame -----
  var vid = $('.hero-vid');
  if (vid) {
    var replay = $('.hero-replay');
    var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      (navigator.connection && (navigator.connection.saveData || /(^|-)2g$/.test(navigator.connection.effectiveType || '')));
    var start = function () { vid.currentTime = 0; var r = vid.play(); if (r && r.catch) r.catch(function () { replay.hidden = false; }); };
    vid.addEventListener('ended', function () { replay.hidden = false; });
    replay.addEventListener('click', function () { replay.hidden = true; start(); });
    // after the page's load event: a fetching video would otherwise hold back "load" (the logo poster shows meanwhile)
    // while the full-screen intro plays (intro-gate.js sets .intro-on), the hero video waits for its end
    var whenLoaded = function () { if (document.readyState === 'complete') start(); else window.addEventListener('load', start); };
    if (still) replay.hidden = false;
    else if (document.documentElement.classList.contains('intro-on')) window.addEventListener('libalstal:introend', whenLoaded, { once: true });
    else whenLoaded();
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
      if (count) count.textContent = (n === 1 ? count.dataset.templateOne : count.dataset.template).replace('{n}', n);
      if (push) history.replaceState(null, '', f === 'all' ? location.pathname : '#cat=' + f);
    };
    chips.forEach(function (c) { c.addEventListener('click', function () { apply(c.dataset.filter, true); }); });
    var m = /cat=(\w+)/.exec(location.hash);
    if (m && chips.some(function (c) { return c.dataset.filter === m[1]; })) apply(m[1], false);
  }
})();

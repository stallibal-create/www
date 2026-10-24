// Welcome intro controller ("Précision en mouvement").
// The homepage is already mounted under a lightweight overlay. The overlay plays the pre-rendered footage
// (Remotion, video-studio/), then hands over live: at 4.75 s a real <img> of the logo replaces the video's logo
// pixel-for-pixel, the footage fades, the ground lifts to the hero colour and the logo glides into the header
// while the hero settles in. Timing and layout come from content/intro.json (same file the video was made from).
//
// Never blocks: skip button from frame 0, Escape / scroll / tabbing into the page also end it, any loading
// problem (error, blocked autoplay, slow start, stall) reveals the homepage at once, and a CSS failsafe hides
// the overlay after 10 s even if this script never runs. intro-gate.js decides whether it plays at all.
(function () {
  'use strict';
  var root = document.documentElement;
  if (!root.classList.contains('intro-on')) return;
  var el = document.getElementById('intro');
  var dataEl = document.getElementById('intro-data');
  var cfg;
  try { cfg = JSON.parse(dataEl.textContent); } catch (e) { cfg = null; }

  var phase = 'boot'; // boot → play → handoff → done
  var video = el && el.querySelector('video');
  var skipBtn = el && el.querySelector('.intro-skip');
  var brand = document.querySelector('.site-header .brand img');
  var timers = [];
  var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };

  // ---------- helpers ----------
  var clamp01 = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  var span = function (t, ab) { return clamp01((t - ab[0]) / (ab[1] - ab[0])); };
  function bezier(x1, y1, x2, y2) { // cubic-bezier(x1,y1,x2,y2) like CSS
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) { var e = ((ax * t + bx) * t + cx) * t - x, d = (3 * ax * t + 2 * bx) * t + cx; if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break; t -= e / d; }
      return ((ay * t + by) * t + cy) * t;
    };
  }
  var easeInOut = bezier(0.65, 0, 0.35, 1), easeIn = bezier(0.55, 0, 1, 0.45);
  function hex(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function bgAt(t) { // same curve as the video's ground (video-studio/src/lib/layout.ts → backgroundAt)
    var k = cfg.background;
    if (t <= k[0][0]) return hex(k[0][1]);
    for (var i = 1; i < k.length; i++) if (t <= k[i][0]) {
      var u = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]), a = hex(k[i - 1][1]), b = hex(k[i][1]);
      return a.map(function (v, j) { return Math.round(v + (b[j] - v) * u); });
    }
    return hex(k[k.length - 1][1]);
  }

  // ---------- end (any reason) ----------
  function cleanup() {
    timers.forEach(clearTimeout);
    if (el && el.contains(document.activeElement)) document.activeElement.blur();
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (flyer && flyer.parentNode) flyer.parentNode.removeChild(flyer);
    if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* ignore */ } }
    removeListeners();
    window.dispatchEvent(new CustomEvent('libalstal:introend'));
    // keep the reveal classes until the hero's last staggered transition has finished, then leave no trace
    setTimeout(function () { root.classList.remove('intro-on', 'intro-reveal', 'intro-landed', 'intro-quick'); }, 1100);
  }
  function finish(reason) {
    if (phase === 'done') return;
    var instant = reason === 'complete' || reason === 'pagehide';
    phase = 'done';
    root.setAttribute('data-intro-end', reason); // for diagnostics and tests
    root.classList.add('intro-reveal', 'intro-landed');
    if (instant) return cleanup();
    root.classList.add('intro-quick');
    el.classList.add('is-leaving'); // short opacity fade (CSS)
    setTimeout(cleanup, 260);
  }

  if (!cfg || !el || !video || !brand) { root.classList.remove('intro-on'); if (el) el.remove(); return; }

  // ---------- layout: video placed like object-fit: cover, but never cropping the safe area ----------
  var format = window.innerWidth / window.innerHeight < 1 ? 'mobile' : 'desktop';
  var comp = cfg.comps[format];
  var box = { s: 1, x: 0, y: 0 };
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight, sf = comp.safe;
    var s = Math.min(Math.max(vw / comp.w, vh / comp.h), vw / sf[2], vh / sf[3]);
    var fx = sf[0] + sf[2] / 2, fy = sf[1] + sf[3] / 2;
    var place = function (view, size, focus) { // keep the focus centred, the frame covering, or centre it if smaller
      var len = size * s;
      if (len <= view) return (view - len) / 2;
      return Math.min(0, Math.max(view - len, view / 2 - focus * s));
    };
    box = { s: s, x: place(vw, comp.w, fx), y: place(vh, comp.h, fy) };
    video.style.width = comp.w * s + 'px';
    video.style.height = comp.h * s + 'px';
    video.style.transform = 'translate(' + box.x + 'px,' + box.y + 'px)';
  }
  var map = function (r) { return { x: box.x + r[0] * box.s, y: box.y + r[1] * box.s, w: r[2] * box.s, h: r[3] * box.s }; };
  layout();

  // ---------- source ----------
  var src = cfg.src[format];
  video.src = video.canPlayType('video/webm; codecs="vp9"') === 'probably' ? src.webm : src.mp4;
  video.muted = true; video.defaultMuted = true; video.playsInline = true;
  var logo = new Image(); logo.decoding = 'async'; logo.src = cfg.logo.src; // decoded before the handoff needs it

  // ---------- playback ----------
  var started = false, stall = 0;
  function play() {
    phase = 'play';
    var p = video.play();
    if (p && p.catch) p.catch(function () { finish('blocked'); });
  }
  video.addEventListener('error', function () { finish('error'); });
  video.addEventListener('playing', function () { started = true; clearTimeout(stall); });
  video.addEventListener('waiting', function () { if (started && phase === 'play') { clearTimeout(stall); stall = setTimeout(function () { finish('stall'); }, 1500); timers.push(stall); } });
  video.addEventListener('ended', function () { if (phase === 'play') handoff(); });
  later(function () { if (!started) finish('slow'); }, 2500);

  // ---------- handoff ----------
  var flyer = null, from = null, to = null, clock0 = 0, t0 = 0;
  function handoff() {
    phase = 'handoff';
    // The handoff always runs its full course from 4.75 s on its own clock, even if a busy main thread noticed
    // the moment late (the footage holds a still logo from 3 s on, so nothing is lost by starting from there).
    t0 = cfg.timing.handoff;
    clock0 = performance.now();
    from = map(comp.logo);
    var b = brand.getBoundingClientRect();
    to = { x: b.left, y: b.top, w: b.width, h: b.height };
    flyer = logo;
    flyer.className = 'intro-logo';
    flyer.alt = '';
    flyer.setAttribute('aria-hidden', 'true');
    flyer.style.left = from.x + 'px'; flyer.style.top = from.y + 'px';
    flyer.style.width = from.w + 'px'; flyer.style.height = from.h + 'px';
    el.appendChild(flyer);
    el.classList.add('is-handoff'); // the skip control bows out: the page is arriving anyway
  }
  function tick() {
    if (phase === 'done') return;
    var T = cfg.timing;
    var t = phase === 'handoff' ? t0 + (performance.now() - clock0) / 1000 : video.currentTime || 0;
    if (phase === 'play' && t >= T.handoff) { handoff(); t = t0; }
    if (phase === 'handoff') {
      video.style.opacity = String(1 - easeIn(span(t, T.videoFade)));
      var p = easeInOut(span(t, T.logoFlight));
      var sx = (from.w + (to.w - from.w) * p) / from.w;
      flyer.style.transform = 'translate(' + (to.x - from.x) * p + 'px,' + (to.y - from.y) * p + 'px) scale(' + sx + ')';
      if (t >= T.heroIn[0]) root.classList.add('intro-reveal');
      var c = bgAt(t), a = 1 - easeInOut(span(t, T.overlayFade)); // stays dark while the logo crosses the hero text
      el.style.backgroundColor = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
      if (t >= Math.max(T.logoFlight[1], T.overlayFade[1])) return finish('complete');
    } else {
      var g = bgAt(t);
      el.style.backgroundColor = 'rgb(' + g[0] + ',' + g[1] + ',' + g[2] + ')';
    }
    requestAnimationFrame(tick);
  }

  // ---------- leaving early ----------
  var skip = function () { finish('skip'); };
  var scrollKeys = { ' ': 1, PageDown: 1, PageUp: 1, ArrowDown: 1, ArrowUp: 1, End: 1, Home: 1 };
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); skip(); }
    else if (scrollKeys[e.key] && e.target !== skipBtn) skip();
  }
  function onFocus(e) { if (!el.contains(e.target)) skip(); } // tabbing into the page: let it go, focus stays where it landed
  function onPageHide() { finish('pagehide'); }
  function onResize() { if (phase !== 'handoff') layout(); }
  function removeListeners() {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocus);
    window.removeEventListener('wheel', skip);
    window.removeEventListener('touchmove', skip);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('resize', onResize);
  }
  skipBtn.addEventListener('click', skip);
  document.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocus);
  window.addEventListener('wheel', skip, { passive: true });
  window.addEventListener('touchmove', skip, { passive: true });
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('resize', onResize);

  play();
  requestAnimationFrame(tick);
})();

/* RHOBEAR shared shell behavior — local-first, no dependencies. */
(function () {
  var dropdowns = Array.prototype.slice.call(
    document.querySelectorAll('.nav-dropdown')
  );
  if (!dropdowns.length) return;

  function closeAll(except) {
    dropdowns.forEach(function (dd) {
      if (dd !== except) dd.classList.remove('open');
    });
  }

  dropdowns.forEach(function (dd) {
    var tab = dd.querySelector('.nav-tab[aria-haspopup]');
    if (!tab) return;
    // A tab with nested pages opens its panel on click instead of navigating.
    tab.addEventListener('click', function (e) {
      e.preventDefault();
      var isOpen = dd.classList.contains('open');
      closeAll(dd);
      dd.classList.toggle('open', !isOpen);
    });
  });

  // Click outside closes any open dropdown.
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-dropdown')) closeAll(null);
  });

  // Escape closes any open dropdown.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') closeAll(null);
  });
})();


/* =====================================================================
   ★ Pixel-dust — the product's current sky, seated behind the page.
   Jet-black with fine pixel specks: slow organic drift, whole-field
   rotation, and a mouse ripple. No suns, no planets, no glow.
   Vanilla port of rhobear-plans PixelDust (itself from the app hub's
   constellation.jsx). Self-contained 2D canvas, no deps. Pauses when
   hidden; renders a still frame for prefers-reduced-motion.
   ===================================================================== */
(function () {
  if (document.getElementById('rho-stars')) return;
  var canvas = document.createElement('canvas');
  canvas.id = 'rho-stars';
  canvas.setAttribute('aria-hidden', 'true');
  var mount = function () {
    (document.body || document.documentElement).insertBefore(canvas, document.body.firstChild);
    start();
  };
  if (!document.body) { document.addEventListener('DOMContentLoaded', mount); } else { mount(); }

  var TAU = Math.PI * 2;
  var DENSITY_DIV = 6000;   // ~345 specks on 1920×1080
  var FPS_CAP = 48, DPR_CAP = 1.5;
  var FIELD_OMEGA = 0.006;  // rad/s — whole-field slow rotation
  var RIPPLE = 130, RIPPLE2 = RIPPLE * RIPPLE;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeParticles(W, H) {
    var count = Math.max(60, Math.min(560, Math.round((W * H) / DENSITY_DIV)));
    var out = [];
    for (var i = 0; i < count; i++) {
      var colored = Math.random() < 0.08;   // ~8% faintly tinted, rest near-white
      var ax = Math.random() * W, ay = Math.random() * H;
      out.push({
        ax: ax, ay: ay, x: ax, y: ay, vx: 0, vy: 0,
        phx: Math.random() * TAU, phy: Math.random() * TAU,
        fx: rand(0.04, 0.13), fy: rand(0.03, 0.11),
        amx: rand(18, 44), amy: rand(14, 36),
        wx: rand(-1.6, 1.6), wy: rand(-1.3, 1.3),
        r: rand(0.35, 1.0), baseA: rand(0.32, 0.78),
        tw: Math.random() * TAU, twv: rand(0.5, 1.1),
        colored: colored, hue: Math.random() * 360,
        hueDrift: colored ? rand(-1.5, 1.5) : 0,
        sat: colored ? rand(14, 30) : 0, lum: rand(86, 96)
      });
    }
    return out;
  }

  function start() {
    var ctx = canvas.getContext('2d');
    if (!ctx) { canvas.style.display = 'none'; return; }
    var rmQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    function reduceMotion() { return !!(rmQuery && rmQuery.matches); }

    var W = 0, H = 0, dpr = 1, particles = [];
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(W * dpr));
      canvas.height = Math.max(1, Math.floor(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = makeParticles(W, H);
      if (reduceMotion()) drawStill();
    }
    window.addEventListener('resize', resize);

    var mouse = { x: -9999, y: -9999, active: false };
    function onMove(e) { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; }
    function onLeave() { mouse.active = false; mouse.x = mouse.y = -9999; }
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);

    var origin = performance.now(), lastT = origin, last = 0, paused = false, raf = 0;

    function step(now) {
      var dt = Math.min(0.05, (now - lastT) / 1000) || 0.016;
      lastT = now;
      var t = (now - origin) / 1000;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      var cx = W / 2, cy = H / 2;
      var cosw = Math.cos(FIELD_OMEGA * dt), sinw = Math.sin(FIELD_OMEGA * dt);
      var M = 40;
      for (var i = 0; i < particles.length; i++) {
        var st = particles[i];
        st.ax += st.wx * dt; st.ay += st.wy * dt;
        var ox = st.ax - cx, oy = st.ay - cy;
        st.ax = cx + ox * cosw - oy * sinw;
        st.ay = cy + ox * sinw + oy * cosw;
        if (st.ax < -M) st.ax += W + 2 * M; else if (st.ax > W + M) st.ax -= W + 2 * M;
        if (st.ay < -M) st.ay += H + 2 * M; else if (st.ay > H + M) st.ay -= H + 2 * M;
        var homeX = st.ax + Math.sin(t * TAU * st.fx + st.phx) * st.amx;
        var homeY = st.ay + Math.cos(t * TAU * st.fy + st.phy) * st.amy;
        var wake = 0;
        if (mouse.active) {
          var dx = st.x - mouse.x, dy = st.y - mouse.y, d2 = dx * dx + dy * dy;
          if (d2 < RIPPLE2 && d2 > 0.01) {
            var d = Math.sqrt(d2), force = 1 - d / RIPPLE, f = force * force * 2.0;
            st.vx += (dx / d) * f; st.vy += (dy / d) * f; wake = force;
          }
        }
        st.vx += (homeX - st.x) * 0.012; st.vy += (homeY - st.y) * 0.012;
        st.vx *= 0.9; st.vy *= 0.9; st.x += st.vx; st.y += st.vy;
        st.tw += st.twv * dt;
        var twinkle = 0.72 + 0.28 * Math.sin(st.tw);
        if (st.colored) { st.hue += st.hueDrift * dt; if (st.hue < 0) st.hue += 360; else if (st.hue >= 360) st.hue -= 360; }
        var a = st.baseA * twinkle * (1 + wake * 1.25); if (a > 1) a = 1;
        var rad = st.r * (1 + wake * 0.4);
        ctx.fillStyle = 'hsla(' + st.hue.toFixed(0) + ',' + st.sat.toFixed(0) + '%,' + st.lum.toFixed(0) + '%,' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(st.x, st.y, rad, 0, TAU); ctx.fill();
      }
    }

    function drawStill() {
      var now = performance.now(), t = (now - origin) / 1000;
      for (var i = 0; i < particles.length; i++) {
        var st = particles[i];
        st.x = st.ax + Math.sin(t * TAU * st.fx + st.phx) * st.amx;
        st.y = st.ay + Math.cos(t * TAU * st.fy + st.phy) * st.amy;
        st.vx = st.vy = 0;
      }
      step(now);
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (paused || reduceMotion()) return;
      if (now - last < 1000 / FPS_CAP) return;
      last = now; lastT = now - 16; step(now);
    }

    resize();
    // The first resize can land before the viewport has laid out (at defer-time
    // window.innerWidth can read 0), leaving the buffer 0×0 and the sky invisible
    // until something fires a resize. Re-measure after first paint and after full
    // load so the starfield reliably appears on EVERY page, not just the front page.
    requestAnimationFrame(resize);
    window.addEventListener('load', resize);
    if (reduceMotion()) drawStill();
    else raf = requestAnimationFrame(frame);

    document.addEventListener('visibilitychange', function () {
      paused = document.hidden;
      if (!paused) { last = 0; lastT = performance.now(); }
    });
    if (rmQuery && rmQuery.addEventListener) {
      rmQuery.addEventListener('change', function () { if (reduceMotion()) drawStill(); });
    }
  }
})();

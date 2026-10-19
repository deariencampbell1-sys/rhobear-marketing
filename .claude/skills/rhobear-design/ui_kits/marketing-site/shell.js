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

/* =====================================================================
   RHOBEAR live chat stream — shared by the greeter and the Try Demo.
   One SSE parser, one contract: POST {message} to the public brain and
   stream data: {chunk, source, safety_category, done, suggest_lead}.
   ===================================================================== */
(function () {
  if (window.RHOBEARChat && window.RHOBEARChat.stream) return;

  var CHAT_URL = 'https://chat.rhobear.ai/chat';

  function noop() {}

  function stream(message, hooks) {
    if (message && typeof message === 'object') {
      hooks = message;
      message = hooks.message;
    }
    hooks = hooks || {};
    message = (message || '').toString();

    var onChunk = hooks.onChunk || noop;
    var onMeta = hooks.onMeta || noop;
    var onDone = hooks.onDone || noop;
    var onError = hooks.onError || noop;
    var endpoint = hooks.endpoint || CHAT_URL;
    var controller = window.AbortController ? new AbortController() : null;
    var state = {
      text: '',
      source: '',
      safety_category: '',
      done: false,
      low_confidence: false,
      suggest_lead: false
    };

    function applyMeta(data) {
      if (!data) return;
      if (data.source) state.source = data.source;
      if (data.safety_category) state.safety_category = data.safety_category;
      if (typeof data.low_confidence !== 'undefined') state.low_confidence = !!data.low_confidence;
      if (typeof data.suggest_lead !== 'undefined') state.suggest_lead = !!data.suggest_lead;
      onMeta(data, state);
    }

    function handleRaw(raw) {
      raw.split('\n').forEach(function (line) {
        line = line.trim();
        if (!line || line.indexOf('data:') !== 0) return;
        var payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          state.done = true;
          onDone({ done: true }, state);
          return;
        }
        var data;
        try {
          data = JSON.parse(payload);
        } catch (e) { return; }
        if (data && data.error) throw new Error(data.error);
        applyMeta(data);
        if (data.chunk) {
          state.text += data.chunk;
          onChunk(data.chunk, data, state);
        }
        if (data.done) {
          state.done = true;
          onDone(data, state);
        }
      });
    }

    var body = { message: message };
    if (hooks.operator) body.operator = hooks.operator;
    if (hooks.body && typeof hooks.body === 'object') {
      Object.keys(hooks.body).forEach(function (key) { body[key] = hooks.body[key]; });
    }

    var fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    };
    if (controller) fetchOpts.signal = controller.signal;

    var promise = fetch(endpoint, fetchOpts).then(function (res) {
      if (!res.ok) throw new Error('Chat request failed');
      if (!res.body || !window.TextDecoder) return res.text().then(handleRaw);
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            buf += decoder.decode();
            handleRaw(buf);
            return;
          }
          buf += decoder.decode(r.value, { stream: true });
          var parts = buf.split('\n');
          buf = parts.pop();
          parts.forEach(handleRaw);
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      onError(err, state);
      throw err;
    });

    return {
      promise: promise,
      abort: function () { if (controller) controller.abort(); },
      state: state
    };
  }

  window.RHOBEARChat = { stream: stream, chatUrl: CHAT_URL };
})();

/* =====================================================================
   RHOBEAR curious greeter — light, local-first, no dependencies.
   Injects its own DOM, pauses proactive timers when hidden, and keeps the
   FAQ / Try Demo pages clear for their first-party chat surfaces.
   ===================================================================== */
(function () {
  if (document.getElementById('rho-greeter')) return;
  if (/\/(?:faq|try)(?:\.html)?(?:$|[?#])/i.test(window.location.pathname)) return;

  var LEAD_URL = 'https://chat.rhobear.ai/lead';
  var DISMISS_KEY = 'rho_greeter_dismissed';
  var DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
  var NUDGE_MS = 12000;
  var NUDGE_SCROLL = 0.4;
  var lines = [
    'What would you build first?',
    'Curious what you\'d spin up?',
    'Want a 30-sec tour of what it does?',
    'What are you trying to get off the ground?'
  ];
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root, launcher, nudge, nudgeText, nudgeClose, panel, closeBtn, form, input, transcript, typing, leadBox;
  var open = false, nudged = false, dismissed = false, streaming = false, visibleMs = 0, lastTick = Date.now();
  var nudgeLine = 0, nudgeRotate = null, checkTimeInterval = null;
  var scrollTicking = false;
  var focusBefore = null;

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function isDismissed() {
    try {
      var then = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      return then && Date.now() - then < DISMISS_MS;
    } catch (e) { return false; }
  }

  function setDismissed() {
    dismissed = true;
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {}
  }

  function make(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  }

  function mount() {
    dismissed = isDismissed();
    root = make('div', 'rho-greeter', '');
    root.id = 'rho-greeter';
    root.setAttribute('data-reduce-motion', reduce ? 'true' : 'false');

    nudge = make('div', 'rho-greeter-nudge', '');
    nudge.setAttribute('role', 'status');
    nudge.setAttribute('aria-live', 'polite');
    nudgeText = make('button', 'rho-greeter-nudge-text', lines[Math.floor(Math.random() * lines.length)]);
    nudgeText.type = 'button';
    nudgeText.setAttribute('aria-label', 'Open RHOBEAR greeter');
    nudgeClose = make('button', 'rho-greeter-nudge-close', '×');
    nudgeClose.type = 'button';
    nudgeClose.setAttribute('aria-label', 'Dismiss greeter nudge for 7 days');
    nudge.appendChild(nudgeText);
    nudge.appendChild(nudgeClose);

    launcher = make('button', 'rho-greeter-launcher', '');
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Open RHOBEAR greeter');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.innerHTML = '<span aria-hidden="true">?</span><strong>Ask</strong>';

    panel = make('section', 'rho-greeter-panel', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'rho-greeter-title');
    panel.setAttribute('tabindex', '-1');
    panel.innerHTML = [
      '<div class="rho-greeter-head">',
      '  <div><p class="rho-greeter-kicker">RHOBEAR guide</p><h2 id="rho-greeter-title">What are you trying to build?</h2></div>',
      '  <button type="button" class="rho-greeter-close" aria-label="Close RHOBEAR greeter">×</button>',
      '</div>',
      '<div class="rho-greeter-transcript" aria-live="polite"></div>',
      '<div class="rho-greeter-typing" hidden><span></span><span></span><span></span><em>Thinking…</em></div>',
      '<form class="rho-greeter-form">',
      '  <label class="rho-greeter-label" for="rho-greeter-input">Ask a curious question</label>',
      '  <div class="rho-greeter-inputrow"><textarea id="rho-greeter-input" rows="2" maxlength="1200" placeholder="Tell me what you want to spin up…"></textarea><button type="submit">Send</button></div>',
      '</form>',
      '<a class="rho-greeter-cta" href="spaces.html">→ Spin it up</a>'
    ].join('');

    root.appendChild(nudge);
    root.appendChild(launcher);
    root.appendChild(panel);
    document.body.appendChild(root);

    closeBtn = panel.querySelector('.rho-greeter-close');
    form = panel.querySelector('.rho-greeter-form');
    input = panel.querySelector('#rho-greeter-input');
    transcript = panel.querySelector('.rho-greeter-transcript');
    typing = panel.querySelector('.rho-greeter-typing');

    addMessage('bot', 'I can give a quick tour, sketch a use case, or help you think through what RHOBEAR could automate first.');

    launcher.addEventListener('click', openPanel);
    nudgeText.addEventListener('click', openPanel);
    nudgeClose.addEventListener('click', function () { setDismissed(); clearProactive(); hideNudge(); });
    closeBtn.addEventListener('click', closePanel);
    form.addEventListener('submit', sendMessage);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage(e);
      }
    });
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', function () { lastTick = Date.now(); });
    if (!dismissed) {
      window.addEventListener('scroll', checkScroll, { passive: true });
      checkTimeInterval = setInterval(checkTime, 500);
      checkScroll();
    }
  }

  function clearProactive() {
    if (checkTimeInterval) { clearInterval(checkTimeInterval); checkTimeInterval = null; }
    window.removeEventListener('scroll', checkScroll);
  }

  function showNudge() {
    if (nudged || dismissed || open) return;
    nudged = true;
    clearProactive();
    nudgeLine = Math.floor(Math.random() * lines.length);
    nudgeText.textContent = lines[nudgeLine];
    root.classList.add('nudge-on');
    nudgeRotate = setInterval(function () {
      if (document.hidden || open || !root.classList.contains('nudge-on')) return;
      nudgeLine = (nudgeLine + 1) % lines.length;
      nudgeText.textContent = lines[nudgeLine];
    }, 4200);
  }

  function hideNudge() {
    root.classList.remove('nudge-on');
    if (nudgeRotate) { clearInterval(nudgeRotate); nudgeRotate = null; }
  }

  function checkTime() {
    var now = Date.now();
    if (!document.hidden) visibleMs += now - lastTick;
    lastTick = now;
    if (visibleMs >= NUDGE_MS) showNudge();
  }

  function checkScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(function () {
      scrollTicking = false;
      if (document.hidden) return;
      var doc = document.documentElement;
      var max = Math.max(1, doc.scrollHeight - window.innerHeight);
      if ((window.scrollY || doc.scrollTop || 0) / max >= NUDGE_SCROLL) showNudge();
    });
  }

  function openPanel() {
    if (open) return;
    focusBefore = document.activeElement;
    open = true;
    hideNudge();
    clearProactive();
    root.classList.add('open');
    launcher.setAttribute('aria-expanded', 'true');
    setTimeout(function () { input.focus(); }, 30);
  }

  function closePanel() {
    if (!open) return;
    open = false;
    root.classList.remove('open');
    launcher.setAttribute('aria-expanded', 'false');
    if (focusBefore && focusBefore.focus) focusBefore.focus();
  }

  function onKeydown(e) {
    if (!open) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closePanel(); return; }
    if (e.key !== 'Tab') return;
    var items = panel.querySelectorAll('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])');
    items = Array.prototype.slice.call(items).filter(function (el) {
      return (el.offsetWidth > 0 || el.offsetHeight > 0) && el.getAttribute('tabindex') !== '-1';
    });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    var active = document.activeElement;
    if (!panel.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function addMessage(who, text) {
    var msg = make('div', 'rho-greeter-msg ' + who, '');
    msg.textContent = text;
    transcript.appendChild(msg);
    transcript.scrollTop = transcript.scrollHeight;
    return msg;
  }

  function setTyping(on) { typing.hidden = !on; }

  function sendMessage(e) {
    e.preventDefault();
    if (streaming) return;
    var message = input.value.trim();
    if (!message) return;
    input.value = '';
    addMessage('user', message);
    streamAnswer(message);
  }

  function streamAnswer(message) {
    streaming = true;
    setTyping(true);
    var botMsg = addMessage('bot', '');
    var acc = '';

    var request = window.RHOBEARChat.stream(message, {
      onChunk: function (chunk) {
        acc += chunk;
        botMsg.textContent += chunk;
        transcript.scrollTop = transcript.scrollHeight;
      },
      onDone: function (data) {
        if (data && data.suggest_lead) showLead(message);
      }
    });

    request.promise.catch(function (err) {
      var msg = err && err.message ? err.message : 'Connection lost';
      if (!acc) {
        botMsg.textContent = msg;
      } else {
        botMsg.textContent += '\n\n[Error: ' + msg + ']';
      }
    }).then(function () {
      streaming = false;
      setTyping(false);
      transcript.scrollTop = transcript.scrollHeight;
    });
  }

  function showLead(message) {
    if (leadBox) return;
    leadBox = make('form', 'rho-greeter-lead', '');
    leadBox.innerHTML = '<label>Want the quick-start when it\'s ready? Drop an email <span>(optional)</span></label><div><input type="email" placeholder="you@example.com" aria-label="Email for quick-start update"><button type="submit">Send</button></div><p class="rho-greeter-lead-ok" hidden>Thanks — saved.</p><p class="rho-greeter-lead-err" hidden>Couldn\'t reach us. Try again in a moment.</p>';
    transcript.appendChild(leadBox);
    transcript.scrollTop = transcript.scrollHeight;
    var emailInput = leadBox.querySelector('input');
    var submitBtn = leadBox.querySelector('button');
    var okMsg = leadBox.querySelector('.rho-greeter-lead-ok');
    var errMsg = leadBox.querySelector('.rho-greeter-lead-err');
    leadBox.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = emailInput.value.trim();
      if (!email) return;
      submitBtn.disabled = true;
      emailInput.disabled = true;
      okMsg.hidden = true;
      errMsg.hidden = true;
      fetch(LEAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, message: message })
      }).then(function (res) {
        if (!res.ok) throw new Error('Lead request failed');
        okMsg.hidden = false;
      }).catch(function () {
        errMsg.hidden = false;
        submitBtn.disabled = false;
        emailInput.disabled = false;
      });
    });
  }

  ready(mount);
})();

/* ===== HAND-TO-HAND RELAY BAND — injected above the footer on every page.
   The product line hands off to the next; app.html ships its own richer relay,
   so skip when one already exists. ===== */
(function(){
  function inject(){
    if (document.querySelector('.relay-next')) return;
    var foot = document.querySelector('footer.site-footer') || document.querySelector('footer');
    var main = document.querySelector('main');
    if (!foot && !main) return;
    var band = document.createElement('section');
    band.className = 'relay-band';
    band.innerHTML =
      '<div class="rb-label">One workflow · it hands off</div>' +
      '<div class="relay-next">' +
        '<a href="app.html">Build it · Hub</a>' +
        '<span class="arw">→</span><a href="designs.html">Shape it · Designs</a>' +
        '<span class="arw">→</span><a href="capturd.html">Capture it · Captur\'d</a>' +
        '<span class="arw">→</span><a href="https://reviews.rhobear.ai/">Keep it clean · Reviews</a>' +
        '<span class="arw">→</span><a href="plans.html">Take it to market · Blueprints</a>' +
        '<span class="arw">→</span><a href="sales.html">It sells itself · Frontman</a>' +
      '</div>';
    if (foot && foot.parentNode) foot.parentNode.insertBefore(band, foot);
    else main.appendChild(band);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();

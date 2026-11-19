# Rewrites the homepage's words in place (head meta, nav, rail, beat cards, phone slides, connect section,
# footer, scene-click map). Run once from the site root: python3 _src/words.py
import re

p = 'index.html'
s = open(p).read()

MCP = 'https://api.rhobear.ai/mcp'
TITLE = 'RHOBEAR — one connector for the AI you already use'
DESC = ('The RHOBEAR MCP connector puts Forge, Search, Teams and Designs inside ChatGPT and any app that speaks MCP. '
        'Sign in once with your RHOBEAR account; every tool shows its price before it runs.')


def between(start, end, new):
    global s
    i = s.index(start)
    j = s.index(end, i)
    s = s[:i] + new + s[j:]


# ---- head ----
s = re.sub(r'<title>.*?</title>', f'<title>{TITLE}</title>', s, count=1)
s = re.sub(r'(<meta name="description" content=")[^"]*', r'\g<1>' + DESC, s, count=1)
s = re.sub(r'(<meta property="og:title" content=")[^"]*', r'\g<1>' + TITLE, s, count=1)
s = re.sub(r'(<meta property="og:description" content=")[^"]*', r'\g<1>' + DESC, s, count=1)
s = re.sub(r'(<meta name="twitter:title" content=")[^"]*', r'\g<1>' + TITLE, s, count=1)
s = re.sub(r'(<meta name="twitter:description" content=")[^"]*', r'\g<1>' + DESC, s, count=1)
s = s.replace('"description": "Build it, ship it, sell it — one connected workflow of local-first developer tools.",',
              '"description": "' + DESC + '",')
s = s.replace('<link rel="preload" href="/mobile/mobile-hub.webp" as="image" type="image/webp" media="(max-width: 768px)" />',
              '<link rel="preload" href="/beats/00-hero.webp?v=2" as="image" type="image/webp" media="(max-width: 768px)" />')

wordmark = re.search(r'<div class="wordmark">.*?</div>', s, re.S).group(0)


def mark(name):
    return f'<img class="card-mark" src="/assets/front/marks/{name}.webp" alt="" width="40" height="40" />'


def shot(name, alt):
    return f'<img class="card-shot" src="/assets/front/shots/{name}.webp" alt="{alt}" width="150" loading="lazy" />'


# ---- nav ----
between('  <!-- top nav -->', '  <!-- elevation rail -->', f'''  <!-- top nav -->
  <nav id="nav">
    {wordmark}
    <div class="links">
      <a href="#connect">HOW IT WORKS</a><a href="/testing-grounds.html">TESTING GROUNDS</a><a href="https://builds.rhobear.ai">BUILDS</a><a href="https://forge.rhobear.ai">FORGE</a>
    </div>
    <a class="cta-pill" href="#connect">Connect →</a>
  </nav>

''')

# ---- rail ----
RAIL = [('hero', 'Summit'), ('hub', 'Connect'), ('workbench', 'Builds'), ('designs', 'Designs'), ('capturd', 'Forge'),
        ('reviews', 'Reviews'), ('plans', 'Teams'), ('sales', 'Search'), ('pricing', 'Pricing'), ('cta', 'Valley')]
rail = '\n'.join(f'    <div class="rail-dot" data-beat="{b}"><span>{n}</span></div>' for b, n in RAIL)
between('  <!-- elevation rail -->', '  <!-- fixed beat cards -->', f'''  <!-- elevation rail -->
  <aside id="rail" aria-hidden="true">
{rail}
  </aside>

''')

# ---- beat cards (one message per beat; ids are the plate ids in plates-*.js) ----
CARDS = [
    ('hero', f'''    <section class="beat-card card-hero active" data-card="hero">
      <div class="eyebrow">THE RHOBEAR MCP CONNECTOR</div>
      <h1>Bring RHOBEAR<br/>into the AI<br/>you already use.</h1>
      <p class="lead">One connector puts RHOBEAR's engines inside ChatGPT and any app that speaks MCP. Sign in once with your RHOBEAR account, and your assistant can make printable 3D models with Forge, search with the source attached, run a team Blueprint and keep a site's styles clean, all on one account, with the price shown before anything runs.</p>
      <div class="hero-ctas">
        <a class="btn-primary" href="#connect">Connect RHOBEAR →</a>
        <a class="btn-ghost" href="/testing-grounds.html">Open the testing grounds →</a>
      </div>
      <div class="pills">
        <span class="pill">One sign-in</span>
        <span class="pill">Any MCP app</span>
        <span class="pill">Price before it runs</span>
        <span class="pill">Your own account</span>
      </div>
      <div class="scroll-hint">scroll to descend ↓</div>
    </section>'''),
    ('hub', f'''    <section class="beat-card has-shot" data-card="hub">
      <div class="card-top"><span class="step">01</span><span class="label">Connect · one address</span></div>
      <h2>Plug it in once</h2>
      <p>Add the RHOBEAR address as a connector in your AI app. It opens the RHOBEAR sign-in, you allow it once, and every tool runs as you, on your account. Then just ask: “@forge, make a wall mount for this board.”</p>
      <div class="mcp-url"><code>{MCP}</code><button type="button" class="copy" data-copy="{MCP}">Copy</button></div>
      {shot('connect', 'The RHOBEAR MCPs listed inside a Builds chat: @blueprints, @forge, @search, @vision')}
      <a class="card-cta" href="#connect">How to connect →</a>
    </section>'''),
    ('workbench', f'''    <section class="beat-card has-shot" data-card="workbench">
      <div class="card-top">{mark('builds')}<span class="step">02</span><span class="label">RHOBEAR Builds · your account</span></div>
      <h2>Your work, your devices, one Rho</h2>
      <p>Builds is home for your RHOBEAR account: the app on your phone and computer, a private shell for your work, one memory, and one usage bank that the connector draws from.</p>
      {shot('builds', 'A Builds chat with Rho on the phone')}
      <a class="card-cta" href="https://builds.rhobear.ai">Open Builds →</a>
    </section>'''),
    ('designs', f'''    <section class="beat-card has-shot" data-card="designs">
      <div class="card-top">{mark('designs')}<span class="step">03</span><span class="label">RHOBEAR Designs · its own app</span></div>
      <h2>Shape it, and keep it clean</h2>
      <p>Designs is its own app, no RHOBEAR sign-in needed in front of it. Through the connector it guards the site you made with it: it checks an install against your design's never-list and proposes a clean-up of your styles from your own design tokens. Nothing is rewritten until you approve it.</p>
      {shot('designs', 'Designs reading a site in a Builds chat')}
    </section>'''),
    ('capturd', f'''    <section class="beat-card has-shot" data-card="capturd">
      <div class="card-top">{mark('forge')}<span class="step">04</span><span class="label">RHOBEAR Forge · 3D you can hold</span></div>
      <h2>Say it. Hold it.</h2>
      <p>Describe it or show a picture, and Forge makes a printable 3D model at the height you ask for. Reshape or resize it in plain words, then split a painted model into single-colour pieces and printer plates.</p>
      {shot('forge', 'Forge building a figure on a round base, ready to print')}
      <a class="card-cta" href="https://forge.rhobear.ai">Open Forge →</a>
    </section>'''),
    ('reviews', f'''    <section class="beat-card" data-card="reviews">
      <div class="card-top">{mark('reviews')}<span class="step">05</span><span class="label">RHOBEAR Reviews</span></div>
      <h2>Check it. Review it. Merge it with proof.</h2>
      <p>Verifier checks the code, Apollo reviews the change, and Zeus fixes and merges, each verdict tied to the exact commit it read. Reviews lives in the Builds app, on the web, and in the app stores.</p>
    </section>'''),
    ('plans', f'''    <section class="beat-card has-shot" data-card="plans">
      <div class="card-top">{mark('teams')}<span class="step">06</span><span class="label">RHOBEAR Teams · Blueprints</span></div>
      <h2>Plan it as a team</h2>
      <p>A Blueprint lays the work out as steps and lanes. Change it in words, approve it, and Teams runs the approved lanes. Cancel, and it stops cleanly at the next safe step.</p>
      {shot('teams', 'A Blueprint running three lanes in Builds')}
    </section>'''),
    ('sales', f'''    <section class="beat-card has-shot" data-card="sales">
      <div class="card-top">{mark('search')}<span class="step">07</span><span class="label">RHOBEAR Search</span></div>
      <h2>Find it, with the source</h2>
      <p>Ranked passages from your decisions, handoffs, code, GitHub and the web, each with its source attached, and a plain answer to why a result ranked where it did.</p>
      {shot('search', 'The Search connector settings in Builds')}
    </section>'''),
    ('pricing', '''    <section class="beat-card card-pricing" data-card="pricing">
      <div class="card-top"><span class="step">08</span><span class="label">Price first · no games</span></div>
      <h2>The connector comes<br/>with a RHOBEAR plan.</h2>
      <p>Tool use draws from your plan's included credit, then from top-ups. Every tool tells your app what it costs before it runs, and a call that fails is refunded.</p>
      <div class="tiers">
        <div class="tier"><b>Free</b><i>$0</i><s>Builds on your own devices. No hosted tools.</s></div>
        <div class="tier"><b>Shell</b><i>$23.99 / month</i><s>Includes $14.40 of usage. 1.5 GB RAM, 0.8 CPU, 15 GB disk.</s></div>
        <div class="tier"><b>Shell Plus</b><i>$50.99 / month</i><s>Includes $39.60 of usage. 4 GB RAM, 2 CPU, 40 GB disk.</s></div>
        <div class="tier"><b>Space</b><i>$69.99 / month</i><s>Includes $39.60 of usage. A whole server: 8 GB RAM, 4 CPU.</s></div>
        <div class="tier"><b>Top-up</b><i>$9.99</i><s>Adds $9.00 of usage to any plan.</s></div>
      </div>
      <p class="fine-print">Monthly. US only, 18+.</p>
    </section>'''),
    ('cta', '''    <section class="beat-card card-final" data-card="cta">
      <div class="eyebrow">START HERE</div>
      <h2>Connect once.<br/>The rest are right there.</h2>
      <p class="lead">One sign-in, every engine, inside the AI app you already use.</p>
      <div class="hero-ctas">
        <a class="btn-primary" href="#connect">Connect RHOBEAR →</a>
        <a class="btn-ghost" href="/testing-grounds.html">Try it in the testing grounds →</a>
      </div>
      <div class="chain">
        <span>Builds</span><i>·</i><span>Designs</span><i>·</i><span>Forge</span><i>·</i><span>Reviews</span><i>·</i><span>Teams</span><i>·</i><span>Search</span>
      </div>
    </section>'''),
]
cards = '\n\n'.join(c for _, c in CARDS)
between('  <!-- fixed beat cards -->', '  <!-- the mountain', f'''  <!-- fixed beat cards: one message per beat -->
  <div id="cards" aria-live="polite">

{cards}
  </div>

''')

# ---- phone: every beat as a slide (same clean plates, the card under the picture) ----
PLATES = ['00-hero', '01-hub', '02-workbench', '03-designs', '04-capturd', '05-reviews', '06-plans', '07-sales', '08-pricing', '09-cta']
FOCUS = ['32%', '40%', '30%', '25%', '47%', '50%', '35%', '40%', '50%', '42%']  # the bear's x in each plate
slides = []
for i, ((bid, card), plate, fx) in enumerate(zip(CARDS, PLATES, FOCUS)):
    body = card.replace(f'<section class="beat-card', '<div class="m-card').replace('</section>', '</div>')
    body = body.replace(' active"', '"').replace(f' data-card="{bid}"', '')
    body = body.replace('<h1>', '<h2>').replace('</h1>', '</h2>')
    loading = 'fetchpriority="high"' if i == 0 else 'loading="lazy"'
    slides.append(f'''    <section class="m-slide" data-slide="{bid}">
      <img src="/beats/{plate}.webp?v=2" alt="" {loading} style="object-position:{fx} 50%" />
  {body}
    </section>''')
between('  <!-- mobile', '  <!-- Rho', '  <!-- phone: every beat is a slide in the page itself (no inner scroll box, no snap) -->\n'
        '  <div id="mobile-journey">\n' + '\n'.join(slides) + '\n  </div>\n\n')

# ---- connect section (replaces the old Rho section) ----
between('  <!-- Rho', '  <!-- footer -->', f'''  <!-- connect: how to add the connector -->
  <section id="connect">
    <div class="connect-grid">
      <div class="reveal">
        <div class="eyebrow">CONNECT RHOBEAR</div>
        <h2>Three steps,<br/>then just ask.</h2>
        <ol class="steps">
          <li><b>Add the address.</b> In your AI app, add a custom MCP connector and paste <code>{MCP}</code>.</li>
          <li><b>Sign in and allow.</b> The RHOBEAR sign-in opens. Allow the app once; it acts as you, on your account, and you can remove it any time.</li>
          <li><b>Ask by name.</b> “@forge, make a wall mount for this board.” Your app sees each tool, whether it is on for your plan, and its price before it runs.</li>
        </ol>
        <div class="mcp-url"><code>{MCP}</code><button type="button" class="copy" data-copy="{MCP}">Copy</button></div>
        <p class="note">Works with ChatGPT and any app that speaks MCP over OAuth. Needs an active RHOBEAR plan.</p>
        <div class="hero-ctas">
          <a class="btn-primary" href="/testing-grounds.html">Try it in the testing grounds →</a>
          <a class="btn-ghost" href="https://builds.rhobear.ai">Get a plan in Builds →</a>
        </div>
      </div>
      <div class="reveal">
        <img class="connect-shot" src="/assets/front/shots/connectors.webp" alt="The RHOBEAR connectors in Builds, each with what it does and what it costs" loading="lazy" />
      </div>
    </div>
  </section>

''')

# ---- footer ----
between('  <!-- footer -->', '  <!-- Make the descent', f'''  <!-- footer -->
  <footer id="footer">
    <div class="cols">
      <div class="reveal">
        {wordmark}
        <p>One connector for the AI you already use. RHOBEAR is made by Sun Sponge LLC.</p>
      </div>
      <div class="reveal">
        <h4>The connector</h4>
        <ul>
          <li><a href="#connect">How to connect</a></li>
          <li><a href="/testing-grounds.html">Testing grounds</a></li>
        </ul>
      </div>
      <div class="reveal">
        <h4>The family</h4>
        <ul>
          <li><a href="https://builds.rhobear.ai">RHOBEAR Builds</a></li>
          <li><a href="https://forge.rhobear.ai">RHOBEAR Forge</a></li>
          <li><a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a></li>
        </ul>
      </div>
    </div>
    <div class="rb-connect"><a href="https://github.com/rhobear-ai" rel="noopener">GitHub</a><a href="https://x.com/rhobearai" rel="noopener">X</a><a href="https://instagram.com/rhobear.ai" rel="noopener">Instagram</a></div>
  </footer>

''')

# ---- scene click: only beats with a real page ----
s = re.sub(r"var MAP = \{.*?\};", """var MAP = {
      workbench: 'https://builds.rhobear.ai', capturd: 'https://forge.rhobear.ai'
    };""", s, count=1, flags=re.S)

# ---- copy buttons ----
s = s.replace('</body>', '''  <script>
  document.querySelectorAll('button.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); };
      if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, function () {});
    });
  });
  </script>
</body>''', 1)

open(p, 'w').write(s)
print('words written')

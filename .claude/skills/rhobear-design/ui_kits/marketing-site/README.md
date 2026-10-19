# Marketing site — UI kit and current page set

The public site is static HTML assembled from this folder by
`.github/workflows/pages.yml`. No build step, no framework, no server: every page opens cold on a
double-click.

## Pages that are the site (NORTH_STAR §1, 2026-10-19)

| File | What it says |
|---|---|
| `index.html` | Your own AI workspace in the cloud, and a remote control for it |
| `spaces.html` | The three ways to buy: Starter $19/mo, Own Space $29/mo, Own it (one-time, price not set) |
| `mcp.html` | The RHOBEAR MCP: Blueprints, images and 3D from any harness. Account-only |
| `blueprints.html` | Blueprints as a feature of the harness and the MCP, not a separate app |
| `download.html` | What ships (iPhone, iPad, Android, Mac, `rho` on Mac + Linux), and that nothing is downloadable yet |
| `privacy.html` | Privacy policy for Spaces |
| `terms.html` | Terms of service for Spaces |
| `aup.html` | Acceptable use policy |

`shell.css` + `shell.js` (deep-space chassis, live starfield, nav, footer, Rho greeter) and
`../../colors_and_type.css` (tokens) are shared by all eight. Edit page bodies only; a change to
`shell.css` should be the smallest fix that helps every page, and named in the change note.

**Vendor names are plain text** (Pi, Claude Code, Codex, OpenClaw, Hermes). No vendor logos, no
invented progress, no prices that the app does not show.

**Credit is shown as credits and tokens, never as its dollar cost.** The included allowance at
our cost ($9 Starter, $11 Own Space) is internal and must never appear on a page.

## Older pages

`app.html`, `plans.html`, `designs.html`, `capturd.html`, `reviews.html`, `sales.html`, `rho.html`,
`lab.html`, `workbench.html`, `story.html`, `faq.html`, `crew.html`, `ease-of-use.html`,
`closer.html`, `learn.html`, `academy.html`, `plans-use.html` and `book-*.html` describe the
pre-North-Star product line. They still deploy (other products in the family, e.g. Reviews, are
still real) but nothing on the new site links to them, and `sitemap.xml` no longer lists them.
Do not link them from the eight pages above. Retiring or archiving them is an owner/integrator
decision, not a page edit.

## The gate

```bash
node scripts/check-site.cjs          # assemble like pages.yml, then check links + copy rules
node scripts/shoot-site.cjs          # same, plus screenshots at 390 px and 1440 px
```

`check-site.cjs` reproduces the `pages.yml` assembly in `.site-build/`, then asserts: every page
self-describes (title, description, canonical, nav, footer legal links, balanced tags), every
local `href`/`src`/CSS `url()` resolves, no `../../` survives the flatten, the copy rules above
hold, and the sitemap is exactly the pages we sell. Exit code 1 on any failure. `--keep` leaves
`.site-build/` on disk for inspection.

Playwright is not a dependency of this repo; `shoot-site.cjs` finds a cached Chromium or uses
`PLAYWRIGHT_PATH` / `CHROME_PATH`. Screenshots land in `screenshots/` (gitignored) as
`<page>-390.png` and `<page>-1440.png`.

## Components in here

- **Shell** (`shell.css`) — top nav, sticky prev/next, footer, dark-glass cards.
- **Relay band** — the hand-to-hand rail above the footer. `shell.js` injects the old one unless
  a page already contains `.relay-next`; the eight pages carry their own.
- **Card patterns** — `card-paper.stitched feature-card`, `card-grid.cols-2/.cols-3`.
- **Tier table** — `.tiers` in `spaces.html`: a four-column grid that stacks into labelled cards
  below 860 px, keeping the plan names and prices visible.
- **Approval card** — the Blueprints gate: lanes, paths, worktree, model, integrator, cost.

## Notes

- No webfonts from a CDN. Nacelle is self-hosted in `../../assets/fonts/`.
- All character images get `image-rendering: pixelated`; the brand mark is the constellation bear
  (`../../assets/rhobear-logo.png`) and is never redrawn.
- Animations are gated on `prefers-reduced-motion: no-preference`.

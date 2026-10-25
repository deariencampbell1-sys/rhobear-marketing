# rhobear-marketing

The front-door source for **rhobear.ai** (lane L9): a TypeScript + React + Vite static site that prerenders every
canonical route to real HTML, hydrates only the screens that need live state, and keeps one kit adapter so
`@rhobear/family-kit` can drop in later without a second visual system.

- **Route table:** `src/app/routes.ts` — the single source of truth for pages, prerender output and `sitemap.xml`.
- **Kit adapter:** `src/kit/` — the only place primitives come from; see `src/kit/README.md` for the 1.0.0 swap.
- **Content:** `src/data/` — typed content model; `loadContent()` returns the composed data (not `null`). Pages still
  render the W0-01 placeholder until Wave 1 wires them.

The old site source, the `rhobear-design` and `rhobear-hatch` agent skills, the brand icons, stills, previews and the
deploy workflow were deleted on 2026-10-24 (lane L0). Do not recover them from git history or copy from `gh-pages`.
The only reference for how RHOBEAR looks is **rhobear-north-star** (boards, marks, `docs/north-star/FONTS.md`).

## Build

```sh
npm ci
npm test          # route table, prerender output, no-JS content, a11y shell, kit
npm run build     # tsc --noEmit -> vite build -> scripts/prerender.mjs -> dist/
```

`dist/` contains one `index.html` per canonical route plus `404.html`, `sitemap.xml` and `robots.txt`. Every page is
readable with JavaScript disabled. Run `npm run build` first; `npm run dev` then serves `dist/` locally at
`http://127.0.0.1:4173` (it exits with an error if `dist/index.html` is missing).

The site currently online is still served from the `gh-pages` branch; cutover is a later wave and only after the owner
sees the site. `PRIVACY.md` is the privacy policy.

# rhobear-marketing

The front-door source for **rhobear.ai** (lane L9): a TypeScript + React + Vite static site that prerenders every
canonical route to real HTML, hydrates only the screens that need live state, and keeps one kit adapter so
`@rhobear/family-kit` can drop in later without a second visual system.

- **Route table:** `src/app/routes.ts` — the single source of truth for pages, prerender output and `sitemap.xml`.
- **Kit adapter:** `src/kit/` — the only place primitives come from; see `src/kit/README.md` for the 1.0.0 swap.
- **Content:** `src/data/` — typed content model; `loadContent()` returns `null` today and pages fall back to honest
  placeholder copy until real content exists.

## Build

```sh
npm ci
npm test          # route table, prerender output, no-JS content, a11y shell, kit
npm run build     # tsc --noEmit -> vite build -> scripts/prerender.mjs -> dist/
```

`dist/` contains one `index.html` per canonical route plus `404.html`, `sitemap.xml` and `robots.txt`. Every page is
readable with JavaScript disabled. `npm run dev` serves `dist/` locally.

The site currently online is still served from the `gh-pages` branch; cutover is a later wave and only after the owner
sees the site. `PRIVACY.md` is the privacy policy.
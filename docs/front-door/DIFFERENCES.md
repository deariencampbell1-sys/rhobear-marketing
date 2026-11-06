# rhobear.ai vs the L9 board: differences (Worker (frontdoor), 2026-11-06)

How shot: `npm run build`, served from `dist/` on 127.0.0.1:4499, headless Chromium at 1440×900 and 390×844, full
page, after network idle and `document.fonts.ready`. Each board frame is `board.html#<screen>` at the same viewport
in `rhobear-north-star` 67d3be23 (`docs/north-star/lanes/L9-front-door/board.html`). Every shot passed a blank check
(ImageMagick standard deviation 0.06 to 0.19) and logged no console errors.

| Page | Route | Board frame |
|---|---|---|
| Home | `/` | `home-arrive` |
| Builds | `/builds` | `product-builds` |
| Forge | `/forge` | `product-forge` |
| Herald | `/herald` | `product-herald` |
| Reviews | `/reviews` | `product-reviews` |
| Regent | `/regent` | `product-regent` |
| Engines | `/engines` | `engines-index` |
| Plans and prices | `/plans` | `plans` |
| Get the app | `/get` | `get` |
| Account | `/account` | `manage` |

## Fixed in this PR

1. **Every page rendered in browser defaults: white page, Times, blue links** (the 11-02 "blank" pages). The site
   held back all styling until `@rhobear/family-kit` 1.0.0; the kit is at 1.0.0. The site now uses the kit's
   tokens, fonts (byte-identical to the board's), motion, buttons and rows, placed the way the board draws its
   frames (`src/kit/site.css`, copy record `src/kit/family-kit/SOURCE.md`). Test: `routes.test.ts`, "every page
   is dressed in the family-kit look".

## Still different (listed, not fixed: content or structure, not small)

All pages:
- **Header mark.** The board's bar reads `RHOBEAR` in Rokkitt; the site's header link reads `rhobear.ai`. Which
  word goes there is a content call, so it is left as is.
- **Two footers.** The skeleton footer (Privacy, Terms) and the shared footer (product links) both render. The
  board draws one footer.
- **Proof media.** The board draws a poster with Play, chapter chips and a progress bar on Home, the five product
  pages and Engines. The site shows the honest pending state "Recording in review" because no approved recording
  package exists. That is correct until a package exists (board: "Show only accepted footage").

Per page:
- **Home:** the family index is stacked text with a button each; the board's frame shows one heading, a lede, and
  the Explore products / Watch real work pair. Both buttons match.
- **Builds, Forge, Herald, Reviews, Regent:** the board's frame actions (for example "Watch Builds" / "See plans")
  are on the site as kit buttons; the board's media block is missing (see Proof media).
- **Engines:** the board's primary is "Choose a real demo" plus "How MCP access works"; the site gives each engine
  an "Open proof shell" primary. Seven primaries on one page break the board's one-primary rule.
- **Plans and prices:** the board draws Shell / Shell Plus / Space as three plan cards (`.plangrid`); the site lists
  them as plain text lines. Prices match `RHOBEAR-SPACES.md` (Shell $23.99, Shell Plus $50.99, Space $69.99) and the
  included credit matches the board ($14.40, $39.60). The site repeats each plan's note twice in two wordings (`offers.ts` `notes` and
  `planCopy`), for example "Local only: pocket models, the harness and Verifier…" then "local only; pocket models +
  harness + Verifier…".
- **Get the app:** platform names render as raw ids (`windows`, `macos`, `ios`) in lower case; the board writes
  "Windows". The board's frame has one detected-device default with "Other platforms"; the site lists every platform
  for every product.
- **Account:** the site shows the signed-out shell ("Sign in to see your account"); the board frame `manage` is the
  signed-in Manage view. That needs a session to shoot.

Board artifacts, not site bugs: on the phone board the sticky Previous / Next bar sits over the frame in a full-page
shot.

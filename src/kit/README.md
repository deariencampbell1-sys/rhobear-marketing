# src/kit — the kit adapter

One visual system for the front door. Screens import primitives from `src/kit`
only. No colour, font, spacing scale, radius, shadow or motion value lives in a
page: `src/kit/tokens.ts` is a comment-only placeholder until L3 ships
`@rhobear/family-kit` 1.0.0 (package home `rhobear-north-star/packages/family-kit`,
surfaces `/tokens`, `/fonts`, `/marks`, `/motion`, `/react`, `/native`, `/graph`).
Browser defaults are the honest placeholder until then.

## What is here

| Export | Source | Notes |
| --- | --- | --- |
| `Button` | `buttons.tsx` | `variant: 'primary' \| 'secondary' \| 'quiet'`, `<button type="button">` by default, `as="a"` + `href`, 44×44 min hit region, 2 px accent focus outline |
| `InfoRow`, `InfoList` | `rows.tsx` | plain `label · value` rows with a hairline divider — no box, no fill, no per-row radius |
| `RadioList`, `SwitchRow`, `Chip` | `rows.tsx` | the only row shapes that look like controls, because they are choices |
| `Sheet`, `Progress`, `LiveRegion` | `overlays.tsx` | dialog shell (aria-modal, focus trap, focus restore, Escape); `Progress` renders nothing without a determinate numeric value; `LiveRegion` is polite |
| `useMotion()` | `motion.ts` | the kit motion names only (`press`, `appear`, `disclose`, `sheet`, `toggle`, `working`, `push`, `pop`, `toast`, `nudge`, `quantity`), resolving `prefers-reduced-motion` to the reduced behaviour |

The four row primitives exist so Wave 1 screens never draw a bubble: an
information row is never a control, and a control row is never information.

## Swapping to @rhobear/family-kit 1.0.0

1. **One dependency:** add `@rhobear/family-kit@1.0.0` to `package.json`.
2. **One import path:** point `src/kit/index.ts` at the kit — re-export
   `Button`, `InfoRow`, `InfoList`, `RadioList`, `SwitchRow`, `Chip`, `Sheet`,
   `Progress`, `LiveRegion`, `useMotion` from `@rhobear/family-kit/react` and
   the tokens from `@rhobear/family-kit/tokens`.
3. **One place to delete:** remove `src/kit/buttons.tsx`, `rows.tsx`,
   `overlays.tsx`, `motion.ts` and `tokens.ts` (everything except `index.ts`
   and this README).

Nothing else changes: every screen already imports from `src/kit`, so the
adapter keeps the API stable across the swap.
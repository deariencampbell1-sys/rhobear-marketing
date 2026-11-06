# family-kit copy

Verbatim copies from `@rhobear/family-kit` 1.0.0, built from
`deariencampbell1-sys/rhobear-north-star` at `67d3be23d5eb3e7dc4aad0c20e1726f78c4b5b19`
(`packages/family-kit`, `npm run build`). The package is private and unpublished, so its README says an
outside consumer copies the built files and pins the commit; this is that copy.

| File here | Kit source |
|---|---|
| `tokens.css` | `dist/tokens/tokens.css` |
| `motion.css` | `dist/motion/motion.css` |
| `controls.css` | `dist/react/controls.css` |
| `rows.css` | `dist/react/rows.css` |
| `fonts.css` | `dist/fonts/fonts.css`, only the Rokkitt, Lato and Droid Sans Mono faces and the role stacks, `src` rewritten to `/fonts/` |
| `public/fonts/**` | `assets/fonts/{rokkitt,lato,droidsansmono}` with their licence files (OFL, Apache 2.0) |

The font files are byte-identical to the ones the L9 board loads (`docs/north-star/lanes/L3-kit/assets/fonts`).
Never edit these files. To update: rebuild the kit at a newer commit, re-copy, and change the SHA above.

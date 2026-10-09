# Vendored CSS

This directory holds vendored stylesheets that are imported directly by
`client/src/index.css` and processed by Vite / PostCSS.

## `skillum-ds.css`

- **Source**: `@skillum/ui-kit` (`/c/Repositories/ENGINERING_HANDBOOK/ui-kit/css/university-rt.css`
  — upstream still carries the kit's original file name; only the vendored copies
  here were renamed to `skillum-ds.css`). Upstream builds it from
  `handbook/design-system/tokens/components/*.css` via `ui-kit/scripts/build-css.mjs`,
  so a fix belongs in those sources, never in the bundle.
- **Why vendored**: the upstream bundle exposes the file under `./css/...`
  but the package `exports` map does not declare that subpath, so Vite's
  modern subpath resolver rejects `@import '@skillum/ui-kit/css/...'`
  with `Missing "./css/skillum-ds.css" specifier`.
- **Local patch (line 16-17)**: the upstream file closes the tokens comment
  block twice in a row, leaving `density: .ou--compact | .ou--normal | .ou--spacious`
  as bare top-level text. Tailwind's PostCSS pipeline then tries to parse it
  as a selector and crashes (`Expected a pseudo-class or pseudo-element.`).
  The patch merges the orphaned line into the preceding comment block.
  All other content is byte-identical to the source.
- **Sync procedure**: re-copy from the upstream path above whenever the DS
  bundle is regenerated, then re-apply the comment-merge patch.

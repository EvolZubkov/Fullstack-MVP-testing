# Vendored CSS

This directory holds vendored stylesheets that are imported directly by
`client/src/index.css` and processed by Vite / PostCSS.

## `university-rt.css`

- **Source**: `@universityrt/ui-kit` (`/c/Repositories/ENGINERING_HANDBOOK/ui-kit/css/university-rt.css`).
- **Why vendored**: the upstream bundle exposes the file under `./css/...`
  but the package `exports` map does not declare that subpath, so Vite's
  modern subpath resolver rejects `@import '@universityrt/ui-kit/css/...'`
  with `Missing "./css/university-rt.css" specifier`.
- **Local patch (line 16-17)**: the upstream file closes the tokens comment
  block twice in a row, leaving `density: .ou--compact | .ou--normal | .ou--spacious`
  as bare top-level text. Tailwind's PostCSS pipeline then tries to parse it
  as a selector and crashes (`Expected a pseudo-class or pseudo-element.`).
  The patch merges the orphaned line into the preceding comment block.
  All other content is byte-identical to the source.
- **Sync procedure**: re-copy from the upstream path above whenever the DS
  bundle is regenerated, then re-apply the comment-merge patch.

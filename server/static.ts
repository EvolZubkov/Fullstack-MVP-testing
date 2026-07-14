import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Cache policy for the SPA — fixes «another user still sees the old UI after a
  // deploy». Without it Express serves everything as `Cache-Control: public,
  // max-age=0` (no explicit `no-cache`), so a stale `index.html` in a browser or a
  // shared proxy keeps pointing clients at the PREVIOUS hashed asset bundles.
  //   - Vite hashed assets under `assets/` are content-addressed → cache forever.
  //   - `index.html` (and other unhashed root files) MUST revalidate every load.
  //     `no-cache` = "revalidate before use" (304 via ETag when unchanged), NOT
  //     "never cache" — so a deploy is picked up on the next navigation.
  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        const underAssets = path.relative(distPath, filePath).split(path.sep)[0] === "assets";
        res.setHeader(
          "Cache-Control",
          underAssets ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    }),
  );

  // SPA fallback → index.html, always revalidated so a new deploy loads immediately.
  app.use("/{*splat}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

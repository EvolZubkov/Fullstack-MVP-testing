/**
 * @module scripts/check/editor-conformance/static-server
 * @description Serves the repository over HTTP so a wireframe can be rendered as it was drawn.
 *
 * Why this exists. The wireframes reference their stylesheets by absolute path
 * (`/docs/wireframes/ds/skillum-ds.css`), so opening one over `file://` renders it
 * unstyled — and every measurement then comes out wrong in a way that looks like a real
 * finding. Twenty lines on `node:http` remove that trap without adding a dependency.
 *
 * Binds to 127.0.0.1 and refuses paths that escape the repository: this exists to be started
 * and stopped by a checker, not to be a file server anyone can reach.
 */

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// `resolve` strips the trailing separator that `fileURLToPath` leaves on a directory URL.
// Without it the containment check compares against `...test-builder\\` and rejects every
// path in the repository — the whole server answers 403 and the checker silently measures
// an unstyled page.
const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

/**
 * @param {number} port Port to listen on; 0 asks the OS for a free one, which keeps parallel
 *   sessions on this machine from colliding.
 * @returns {Promise<{port: number, close: () => Promise<void>}>}
 */
export function startStaticServer(port = 0) {
  const server = createServer((req, res) => {
    let file;
    try {
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
      file = join(REPO_ROOT, rel);
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }
    if (file !== REPO_ROOT && !file.startsWith(REPO_ROOT + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error("not a file");
    } catch {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

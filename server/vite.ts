/**
 * @module server/vite
 *
 * Mounts Vite as Express middleware for the dev loop:
 * - Vite handles TSX/CSS transforms and HMR for client requests
 * - Express serves the catch-all route that returns the transformed index.html
 *
 * Only active in development. In production `server/static` serves the
 * pre-built `dist/public` bundle instead — see server/index.ts.
 */
import { type Express } from "express";
import { createServer as createViteServer } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";

// Cache-busting id stable for the lifetime of one dev-server process.
const BUILD_ID = Date.now().toString(36);

export async function setupVite(_server: Server, app: Express) {
  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: {
      middlewareMode: true,
      allowedHosts: true,
    },
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("/{*splat}", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${BUILD_ID}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

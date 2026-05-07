import { type Express } from "express";
import { logger } from "./logger";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
const viteLogger = createLogger();

// Single build ID per server start (not per request)
const BUILD_ID = Date.now().toString(36);

export async function setupVite(_server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: false,  // Disabled: WebSocket doesn't work behind reverse proxy
    watch: null, // Disable file watching to prevent HMR client injection
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${BUILD_ID}"`,
      );
      let page = await vite.transformIndexHtml(url, template);
      // Убираем тег <script src="/@vite/client">
      page = page.replace(/<script[^>]*src="[^"]*@vite\/client[^"]*"[^>]*><\/script>/gi, '');
      // Убираем инлайн скрипты которые импортируют @vite/client (runtime-error-plugin и др.)
      page = page.replace(/<script[^>]*>[\s\S]*?@vite\/client[\s\S]*?<\/script>/gi, '');
      if (page.includes('@vite/client')) {
        const idx = page.indexOf('@vite/client');
        const context = page.slice(Math.max(0, idx - 150), idx + 150);
        logger.warn('[vite] WARNING: @vite/client still present in HTML, context: ' + context);
      }
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

import express, { type Express } from "express";
import { type Server } from "http";
import session from "express-session";
import MemoryStore from "memorystore";
import path from "node:path";

import { routerConfig } from "./routes/index";
import { config } from "./config";
import { magicScopeGuard } from "./middleware/magic-scope";
import { legacyUploadsAlias } from "./routes/media";

const MemStore = MemoryStore(session);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // CORS для телеметрии SCORM
  app.use("/api/scorm-telemetry", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Session middleware
  app.use(
    session({
      store: new MemStore({ checkPeriod: 86400000 }),
      secret: config.session.secret || "scorm-test-constructor-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.server.cookieSecure,
        httpOnly: true,
        sameSite: "lax" as const,
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );

  // A magic-link session is access to ONE test: everything under /api that the
  // rule table does not name is refused here, before any router sees it.
  app.use(magicScopeGuard);

  // Медиатека: раздача идёт маршрутом с проверкой прав, публичной статики больше нет.
  // Адреса, сохранённые до реестра, обслуживает совместимостный алиас.
  app.use("/uploads", legacyUploadsAlias);
  app.use("/docs", express.static(path.resolve(process.cwd(), "docs")));

  // ========== Модульные роуты ==========
  for (const { path, router } of routerConfig) {
    app.use(path, router);
  }

  return httpServer;
}
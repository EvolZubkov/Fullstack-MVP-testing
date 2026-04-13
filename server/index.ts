import "dotenv/config";

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./storage";
import {
  waitForDatabase,
  closeDatabaseConnection,
  checkDatabaseHealth,
  getDatabaseStatus,
} from "./db";
import { logger } from "./logger";

process.on("uncaughtException", (err) => {
  console.error("=== UNCAUGHT EXCEPTION ===");
  console.error(err.stack || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("=== UNHANDLED REJECTION ===");
  console.error(reason);
});

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}


app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "50mb" }));

export function log(message: string, source = "express") {
  logger.info(message, source);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api") && !path.startsWith("/api/logs")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  // Warn about weak secrets in production
  if (process.env.NODE_ENV === "production") {
    const weakSecrets = ["scorm-test-constructor-secret", "your-secret-key-change-in-production", ""];
    if (weakSecrets.includes(process.env.SESSION_SECRET ?? "")) {
      logger.warn("SESSION_SECRET is not set or uses a default value — set a strong secret in production!", "security");
    }
  }

  // Wait for database to be available before starting
  await waitForDatabase();
  await seedDatabase();

  // Health check endpoint
  app.get("/api/health", async (_req, res) => {
    const dbHealthy = await checkDatabaseHealth();
    const status = getDatabaseStatus();

    if (dbHealthy) {
      res.json({ status: "healthy", database: status });
    } else {
      res.status(503).json({ status: "unhealthy", database: status });
    }
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  // httpServer.listen(
  //   {
  //     port,
  //     host: "0.0.0.0",
  //     reusePort: true,
  //   },
  //   () => {
  //     log(`serving on port ${port}`);
  //   },
  // );
    httpServer.listen(port, "0.0.0.0", () => {
      log(`serving on port ${port}`);
    });

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      log(`Received ${signal}, shutting down gracefully...`);

      httpServer.close(async () => {
        log("HTTP server closed");
        try {
          await closeDatabaseConnection();
          process.exit(0);
        } catch (error) {
          log(`Error during shutdown: ${(error as Error).message}`);
          process.exit(1);
        }
      });

      // Force exit after 30 seconds
      setTimeout(() => {
        log("Forced shutdown after timeout");
        process.exit(1);
      }, 30000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
})();

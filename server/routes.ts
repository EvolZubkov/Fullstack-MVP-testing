import express, { type Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import session from "express-session";
import MemoryStore from "memorystore";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

import { routerConfig } from "./routes/index";

// Media upload configuration
const mediaDir = path.resolve(process.cwd(), "uploads", "media");
fs.mkdirSync(mediaDir, { recursive: true });

const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${Date.now()}_${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("audio/") ||
      file.mimetype.startsWith("video/");
    cb(ok ? null : new Error("Unsupported media type") as any, ok);
  },
});

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

const MemStore = MemoryStore(session);

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const isProduction = process.env.NODE_ENV === "production";

  // Проверка SESSION_SECRET
  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) {
    if (isProduction) {
      throw new Error(
        "CRITICAL: SESSION_SECRET environment variable must be set in production.\n" +
        "Generate using: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
      );
    }

    console.warn(
      "\n⚠️  WARNING: SESSION_SECRET is not set!\n" +
      "   Using default value for development only.\n" +
      "   Generate secure value for production:\n" +
      "   node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"\n"
    );
  }

  // Trust proxy если за nginx/reverse proxy
  if (isProduction) {
    app.set("trust proxy", 1);
  }

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
      secret: SESSION_SECRET ?? "dev-only-session-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProduction,        // HTTPS only in production
        httpOnly: true,              // Prevent XSS access to cookie
        sameSite: "lax",             // CSRF protection
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    })
  );

  // Static files
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

  // ========== Модульные роуты ==========
  for (const { path, router } of routerConfig) {
    app.use(path, router);
  }

  // ========== Media Upload ==========
  app.post(
    "/api/media/upload",
    requireAuth,
    mediaUpload.single("file"),
    (req: Request, res: Response) => {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const url = `/uploads/media/${req.file.filename}`;
      res.json({
        url,
        mime: req.file.mimetype,
        originalName: req.file.originalname,
        size: req.file.size,
      });
    }
  );

  return httpServer;
}
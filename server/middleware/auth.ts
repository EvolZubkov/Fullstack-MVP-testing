import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

/**
 * Middleware: требует авторизации (любой пользователь)
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/**
 * Middleware: требует роль author
 */
export async function requireAuthor(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "author") {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  } catch (error) {
    return res.status(500).json({ error: "Authorization error" });
  }
}

/**
 * Middleware: требует роль learner
 */
export async function requireLearner(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "learner") {
      return res.status(403).json({ error: "Forbidden - Learner access required" });
    }
    next();
  } catch (error) {
    return res.status(500).json({ error: "Authorization error" });
  }
}
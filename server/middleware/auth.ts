import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { getEffectiveRoles } from "../services/access";
import { hasPermission, type Capability, type Role } from "@shared/access";
import type { User } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** Resolved current user, attached by {@link requirePermission}. */
      currentUser?: User;
      /** Effective roles (stored + configuration superadmin), attached by {@link requirePermission}. */
      effectiveRoles?: Role[];
    }
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
 * Middleware factory: require the given capability (PRD-13). Loads the user and
 * their effective roles (stored roles plus the configuration superadmin) and
 * checks the role -> permission map. Object-level scope (test ownership and
 * grants) is enforced by the route handler via the test-access service. On
 * success the resolved user and roles are attached to the request for reuse.
 *
 * Added alongside the legacy `requireAuthor` / `requireLearner` guards; endpoints
 * are migrated to it in a later phase (PRD-13 implementation plan, Phase 3).
 */
export function requirePermission(capability: Capability) {
  return async function (req: Request, res: Response, next: NextFunction) {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || user.status === "inactive") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const roles = await getEffectiveRoles(user);
      if (!hasPermission(roles, capability)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      req.currentUser = user;
      req.effectiveRoles = roles;
      next();
    } catch (error) {
      return res.status(500).json({ error: "Authorization error" });
    }
  };
}
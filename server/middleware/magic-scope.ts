/**
 * @module server/middleware/magic-scope
 * @description The guard that turns a magic-link session into access to ONE test.
 *
 * A session created by `/access/:token` carries `session.magic`; a password login
 * never sets it and clears it if present. When the field is there, this middleware
 * admits only the paths named in {@link MAGIC_SCOPE_RULES} and verifies the object
 * binding itself, so the individual handlers need no awareness of the restriction.
 *
 * Only `/api/*` is policed. The client bundle and `/uploads/media/*` (question
 * media, without which a question cannot render) are deliberately outside: data
 * travels solely through the API, and a media file carries no test binding to check.
 */
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { matchMagicScopeRule } from "./magic-scope-rules";

/** The scope a magic link opens: one assignment, one test. */
export interface MagicScope {
  assignmentId: string;
  testId: string;
}

declare module "express-session" {
  interface SessionData {
    /** Present only for a session opened by a magic link; absent = full session. */
    magic?: MagicScope;
  }
}

function deny(res: Response) {
  return res.status(403).json({ error: "Link scope", code: "MAGIC_SCOPE" });
}

/**
 * Deny-by-default scope guard. Registered once, before the routers, so a route
 * added later is closed until it is added to the rule table on purpose.
 */
export async function magicScopeGuard(req: Request, res: Response, next: NextFunction) {
  const magic = req.session?.magic;
  if (!magic) return next();
  if (!req.path.startsWith("/api/")) return next();

  const match = matchMagicScopeRule(req.method, req.path);
  if (!match) return deny(res);

  if (match.rule.bind === "test") {
    if (match.params.testId !== magic.testId) return deny(res);
    return next();
  }

  if (match.rule.bind === "attempt") {
    try {
      const attempt = await storage.getAttempt(match.params.attemptId);
      if (!attempt) return deny(res);
      if (attempt.userId !== req.session.userId) return deny(res);
      if (attempt.testId !== magic.testId) return deny(res);
      return next();
    } catch {
      return res.status(500).json({ error: "Authorization error" });
    }
  }

  return next();
}

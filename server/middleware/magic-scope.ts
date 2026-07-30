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
 *
 * Express 5 itself routes case-insensitively, so both the `/api/` prefix gate and
 * the rule-table match must be case-insensitive too — otherwise `/API/...` would
 * reach a handler while sailing past this guard. `HEAD` is normalized to `GET`
 * before matching, since Express answers a registered `GET` route for a `HEAD`
 * request automatically; `HEAD` cannot mutate state, so this does not widen access.
 * Captured path parameters (test/attempt ids) keep their ORIGINAL case — only the
 * literal path segments are compared case-insensitively (see `magic-scope-rules.ts`).
 */
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { matchMagicScopeRule } from "./magic-scope-rules";
import { logger } from "../logger";

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

/** Denies the request, logging enough to investigate without leaking the token or session contents. */
function deny(req: Request, magic: MagicScope, res: Response) {
  logger.warn(`Magic-link scope denied: ${req.method} ${req.path} (test ${magic.testId})`, "access");
  return res.status(403).json({ error: "Link scope", code: "MAGIC_SCOPE" });
}

/**
 * Deny-by-default scope guard. Registered once, before the routers, so a route
 * added later is closed until it is added to the rule table on purpose.
 */
export async function magicScopeGuard(req: Request, res: Response, next: NextFunction) {
  const magic = req.session?.magic;
  if (!magic) return next();
  if (!req.path.toLowerCase().startsWith("/api/")) return next();

  const method = req.method.toUpperCase() === "HEAD" ? "GET" : req.method;
  const match = matchMagicScopeRule(method, req.path);
  if (!match) return deny(req, magic, res);

  if (match.rule.bind === "test") {
    if (match.params.testId !== magic.testId) return deny(req, magic, res);
    return next();
  }

  if (match.rule.bind === "attempt") {
    try {
      const attempt = await storage.getAttempt(match.params.attemptId);
      if (!attempt) return deny(req, magic, res);
      if (attempt.userId !== req.session.userId) return deny(req, magic, res);
      if (attempt.testId !== magic.testId) return deny(req, magic, res);
      return next();
    } catch (error) {
      logger.error(`Magic-link attempt lookup failed: ${(error as Error).message}`, "access");
      return res.status(500).json({ error: "Authorization error" });
    }
  }

  // Exhaustiveness guard: a future `bind` value must be handled explicitly above
  // or it falls to denial here, never to an implicit `next()`.
  if (match.rule.bind === "none") return next();
  const unhandled: never = match.rule.bind;
  void unhandled;
  return deny(req, magic, res);
}

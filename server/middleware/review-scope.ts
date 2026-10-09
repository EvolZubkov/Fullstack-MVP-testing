/**
 * @module server/middleware/review-scope
 *
 * Express middleware enforcing the PRD-52 reviewer scope on a test. It mirrors
 * {@link module:server/middleware/test-scope} — load the test named by the route
 * parameter, ask the access service, answer 401/404/403 — with one deliberate
 * difference: it is NOT chained after `requirePermission`, because the reviewer
 * scope is carried by an object-level grant rather than by a role.
 *
 * An external expert reaches the reviewer screen through a magic link and holds
 * `learner` only; requiring a capability here would deny exactly the audience the
 * screen is built for (FR-02). The permission context (`req.currentUser`,
 * `req.effectiveRoles`) is still attached by the session/auth layer, and its
 * absence is treated as unauthenticated.
 */

import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { canReviewTest } from "../services/test-access";

/**
 * Require review access to the test identified by `paramName` (default `id`):
 * the holder of a `review` grant on that test, or anyone already inside its edit
 * scope (owner, edit grant, administrator).
 */
export function requireReviewScope(paramName = "id") {
  return async function (req: Request, res: Response, next: NextFunction) {
    const roles = req.effectiveRoles;
    const user = req.currentUser;
    if (!roles || !user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const test = await storage.getTest(req.params[paramName]);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }
      if (!(await canReviewTest(roles, user.id, test))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      next();
    } catch {
      return res.status(500).json({ error: "Authorization error" });
    }
  };
}

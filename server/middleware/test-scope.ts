/**
 * @module server/middleware/test-scope
 *
 * Express middleware enforcing object-level test access (PRD-13). Runs AFTER
 * {@link requirePermission}, which attaches `req.currentUser` and
 * `req.effectiveRoles`. It loads the test referenced by the route param and
 * checks the requested action against the test-access service: 401 if the
 * permission middleware did not run, 404 if the test is missing, 403 if the
 * action is not allowed for this specific test.
 */

import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import {
  canReadTest,
  canEditTest,
  canDeleteTest,
  canAssignTest,
  canReadTestAnalytics,
} from "../services/test-access";

/** The scoped action being authorized against a specific test. */
export type TestScopeAction = "read" | "edit" | "delete" | "assign" | "analytics";

/**
 * Require the given object-level access to the test identified by `paramName`
 * (default `id`). Must be chained after `requirePermission(...)`.
 */
export function requireTestScope(action: TestScopeAction, paramName = "id") {
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
      let allowed = false;
      switch (action) {
        case "read":
          allowed = await canReadTest(roles, user.id, test);
          break;
        case "edit":
          allowed = await canEditTest(roles, user.id, test);
          break;
        case "delete":
          allowed = await canDeleteTest(roles, user.id, test);
          break;
        case "assign":
          allowed = await canAssignTest(roles, user.id, test);
          break;
        case "analytics":
          allowed = await canReadTestAnalytics(roles, user.id, test);
          break;
      }
      if (!allowed) {
        return res.status(403).json({ error: "Forbidden" });
      }
      next();
    } catch (error) {
      return res.status(500).json({ error: "Authorization error" });
    }
  };
}

/**
 * Require assign access to the test that an ASSIGNMENT belongs to (PRD-13). For
 * assignment-keyed endpoints (revoke, resend, ...): resolves the assignment by
 * `paramName` (default `id`) -> its test -> `canAssignTest`. Must be chained
 * after `requirePermission("assignments.manage")`.
 */
export function requireAssignmentScope(paramName = "id") {
  return async function (req: Request, res: Response, next: NextFunction) {
    const roles = req.effectiveRoles;
    const user = req.currentUser;
    if (!roles || !user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const assignment = await storage.getAssignment(req.params[paramName]);
      if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
      }
      const test = await storage.getTest(assignment.testId);
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }
      if (!(await canAssignTest(roles, user.id, test))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      next();
    } catch (error) {
      return res.status(500).json({ error: "Authorization error" });
    }
  };
}

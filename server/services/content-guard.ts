/**
 * @module server/services/content-guard
 *
 * Route-level helpers of the PRD-15 block A content protection (FR-02/FR-05).
 * Two concerns, both applied by the topic/question routes before a destructive
 * operation:
 *
 * 1. Creator restriction (FR-02): until topic ownership ships (block C),
 *    destructive operations on shared content are allowed to the creator
 *    (`created_by`) and administrators; legacy rows with NULL creator are
 *    administrator-managed.
 * 2. Referential protection (FR-05): a {@link FeasibilityAssessment} with
 *    blocking entries turns into `409 content_in_use` listing the dependent
 *    tests and reasons; an administrator may override with `?force=true`
 *    (the override is the caller's explicit, logged decision). Warnings are
 *    returned with the success payload and never block.
 */

import type { Request, Response } from "express";
import type { Role } from "@shared/access";
import { isAdminOrSuper } from "./test-access";
import type { FeasibilityAssessment } from "./draw-feasibility";

/** FR-02 (pure form): creator or administrator; NULL creator -> admin only. */
export function canActorMutateContent(
  roles: readonly Role[],
  userId: string | undefined,
  createdBy: string | null | undefined,
): boolean {
  if (isAdminOrSuper(roles)) return true;
  return !!createdBy && !!userId && createdBy === userId;
}

/** FR-02: creator or administrator; NULL creator -> administrator only. */
export function canMutateContent(req: Request, createdBy: string | null | undefined): boolean {
  return canActorMutateContent(req.effectiveRoles ?? [], req.currentUser?.id, createdBy);
}

/** Sends the FR-02 refusal. Returns `true` so callers can `if (...) return;`. */
export function respondForbiddenContent(res: Response): true {
  res.status(403).json({
    error: "content_forbidden",
    message: "Изменять или удалять этот элемент может его создатель или администратор",
  });
  return true;
}

/** `?force=true` is honoured for administrators/superadmin only (FR-05). */
export function isForcedByAdmin(req: Request): boolean {
  return req.query.force === "true" && isAdminOrSuper(req.effectiveRoles ?? []);
}

/** `?dryRun=true`: assess the operation's impact without performing it (T-12). */
export function isDryRun(req: Request): boolean {
  return req.query.dryRun === "true";
}

/**
 * Dry-run preview response: the client opens the confirmation/blocking dialog
 * from this payload BEFORE the real request. `wouldBlock` mirrors the policy
 * of {@link respondIfBlocked} (published dependents block unless an admin
 * forces). Always 200 — nothing was mutated.
 */
export function respondDryRun(
  req: Request,
  res: Response,
  assessment: FeasibilityAssessment,
): void {
  res.json({
    dryRun: true,
    wouldBlock: assessment.blocking.length > 0 && !isForcedByAdmin(req),
    blocking: assessment.blocking,
    warnings: assessment.warnings,
  });
}

/**
 * Sends `409 content_in_use` when the assessment blocks and the actor did not
 * (validly) force. Returns `true` when the response was sent.
 */
export function respondIfBlocked(
  req: Request,
  res: Response,
  assessment: FeasibilityAssessment,
): boolean {
  if (assessment.blocking.length === 0 || isForcedByAdmin(req)) return false;
  res.status(409).json({
    error: "content_in_use",
    message: "Операция затрагивает опубликованные тесты",
    blocking: assessment.blocking,
    warnings: assessment.warnings,
  });
  return true;
}

/** Merges per-item assessments (bulk operations) into one. */
export function mergeAssessments(items: FeasibilityAssessment[]): FeasibilityAssessment {
  const blocking = items.flatMap((a) => a.blocking);
  const warnings = items.flatMap((a) => a.warnings);
  return { blocking, warnings };
}

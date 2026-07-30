/**
 * @module shared/access/capabilities
 *
 * The catalogue of named permissions (capabilities) for the access control
 * model (PRD-13). A capability is one named unit of permission in the
 * `domain.action` namespace. The role -> permission map
 * ({@link module:shared/access/permissions}) is expressed in terms of these
 * identifiers, and the server middleware gates each endpoint by one of them.
 *
 * Some capabilities are scope-aware: holding the capability allows the action
 * in principle, but applicability to a concrete test is further restricted by
 * test ownership or an access grant. Scope is NOT resolved here — it is enforced
 * by the test-access service (Phase 2/3). {@link SCOPE_AWARE_CAPABILITIES} lists
 * them for reference.
 *
 * Normative source: docs/specs/access-control/role-model.md (section 3).
 */

/**
 * Every capability identifier in the system. The {@link Capability} type is
 * derived from this list, so adding a capability here is the single edit needed
 * to extend the vocabulary.
 */
export const CAPABILITIES = [
  // Account and self-service.
  "auth.self",
  // Test taking (gated by assignment, available to every role).
  "attempts.take",
  "attempts.self.read",
  // Content authoring.
  "topics.read",
  "topics.manage",
  "topics.access.grant",
  "topics.owner.change",
  "questions.read",
  "questions.manage",
  "questions.importExport",
  "folders.manage",
  // Tests.
  "tests.read",
  "tests.create",
  "tests.edit",
  "tests.publish",
  "tests.delete",
  "tests.export.scorm",
  // PRD-18 in-service debug player. Split from `tests.export.scorm` so the
  // authoring role keeps the debug run after losing SCORM generation.
  "tests.debug.play",
  "tests.access.grant",
  "tests.owner.change",
  // Templates.
  "templates.read",
  "adminTemplates.manage",
  // Training delivery.
  "assignments.manage",
  // Administration.
  "groups.manage",
  "users.read",
  "users.create",
  "users.manage",
  "users.role.assign",
  "analytics.read",
  "analytics.export",
  "scormPackages.manage",
  "logs.read",
  // System.
  "system.config",
  "system.roles.assignAdmin",
] as const;

/** A single capability identifier. */
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Capabilities whose result is further restricted, for non-admin roles, by test
 * ownership or an access grant (role-model.md section 6). Listed for reference;
 * the actual scope check lives in the test-access service.
 */
export const SCOPE_AWARE_CAPABILITIES: readonly Capability[] = [
  // PRD-15 block C: topic visibility / ownership / grants.
  "topics.read",
  "topics.manage",
  "topics.access.grant",
  "questions.read",
  "questions.manage",
  "questions.importExport",
  // PRD-15 BRC-27: a test owner may grant access to their own test.
  "tests.access.grant",
  "tests.read",
  "tests.edit",
  "tests.publish",
  "tests.delete",
  "tests.export.scorm",
  "tests.debug.play",
  "assignments.manage",
  "analytics.read",
  "analytics.export",
];

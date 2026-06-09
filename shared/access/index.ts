/**
 * @module shared/access
 *
 * Public surface of the access control layer (PRD-13): role vocabulary, the
 * capability catalogue, the role -> permission map with check helpers, and the
 * role-assignment ceiling. Server and client import from here so the permission
 * model has a single source of truth.
 *
 * Normative source: docs/specs/access-control/role-model.md.
 */

export * from "./roles";
export * from "./capabilities";
export * from "./permissions";
export * from "./role-assignment";

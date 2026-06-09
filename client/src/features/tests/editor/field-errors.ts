/**
 * @module client/src/features/tests/editor/field-errors
 * @description Per-field lookup over {@link ValidationIssue}s so section
 * components can mark the exact offending input as invalid (FR-20c). The test
 * editor validates the whole model centrally; this index lets each section
 * surface the relevant message on its own controls without re-validating.
 */
import type { ValidationIssue } from "./test-editor.types";

/**
 * Read-only index of validation issues keyed by field path. Built once per
 * validation pass and passed down to section components.
 */
export interface FieldErrorIndex {
  /**
   * First error message for an exact field path (e.g. `sections[0].drawCount`),
   * or `undefined` when the field has no error. Feed straight into a control's
   * `error` prop.
   */
  get(field: string): string | undefined;
  /**
   * `true` when the field itself or any descendant path has an error. Use for
   * container-level affordances (e.g. flag a topic row when any of its inputs
   * err): `has("sections[0]")` matches `sections[0].drawCount`.
   */
  has(field: string): boolean;
}

/**
 * Builds a {@link FieldErrorIndex} from a validation pass. Only `error`
 * severity issues are indexed — warnings never block or highlight a field.
 * On duplicate field paths the first message wins (validation pushes the most
 * specific issue first).
 */
export function buildFieldErrorIndex(issues: ValidationIssue[]): FieldErrorIndex {
  const byField = new Map<string, string>();
  for (const issue of issues) {
    if (issue.severity !== "error") continue;
    if (!byField.has(issue.field)) byField.set(issue.field, issue.message);
  }

  return {
    get: (field) => byField.get(field),
    has: (field) => {
      if (byField.has(field)) return true;
      for (const key of byField.keys()) {
        if (key.startsWith(`${field}.`) || key.startsWith(`${field}[`)) return true;
      }
      return false;
    },
  };
}

/** Empty index — used as a safe default when a section receives no errors. */
export const EMPTY_FIELD_ERRORS: FieldErrorIndex = {
  get: () => undefined,
  has: () => false,
};

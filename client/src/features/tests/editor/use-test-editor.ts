/**
 * @module features/tests/editor/use-test-editor
 * @description React hook owning the editor draft state. Loads the test from
 * the API, tracks dirty per section, runs validation, and saves with
 * optimistic version check. Implementation is added in phase 4A.
 */
import type { TestEditorModel, ValidationResult } from "./test-editor.types";

export type UseTestEditorResult = {
  model: TestEditorModel | null;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  validation: ValidationResult;
  save: () => Promise<void>;
  reset: () => void;
};

/**
 * Hook that owns the editor draft for a given test id. When `testId` is
 * undefined the hook initializes an empty draft for the create flow.
 */
export function useTestEditor(_testId?: string): UseTestEditorResult {
  return {
    model: null,
    isLoading: false,
    isSaving: false,
    isDirty: false,
    validation: { errors: [], warnings: [] },
    save: async () => {
      throw new Error("not implemented");
    },
    reset: () => {
      throw new Error("not implemented");
    },
  };
}

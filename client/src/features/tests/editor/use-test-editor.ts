/**
 * @module features/tests/editor/use-test-editor
 * @description React hook owning the editor draft state for a single test.
 *
 * Responsibilities:
 *   - Load the source test via `GET /api/tests/:id` and keep it in the React
 *     Query cache (decisions §5.1).
 *   - Build the editor draft from the API snapshot via {@link apiToEditorModel}
 *     and own it as in-memory React state. No `localStorage` / `sessionStorage`
 *     persistence is performed (FR-25j).
 *   - Track aggregated and per-tab dirty / warning / error indicators (FR-25b,
 *     NFR-21) so the Drawer can render the status-dot annotations on tabs.
 *   - Run `validateTestEditor` against the draft, debounced at 300 ms
 *     (decisions §8.2, NFR-18, FR-20a).
 *   - Save with optimistic version check (FR-25k): `PUT /api/tests/:id` with
 *     `expectedVersion` from the snapshot. 409 surfaces a structured conflict
 *     payload; 422 surfaces a `required_fields_missing` payload.
 *   - Provide `reset()` that reverts the draft to the most recent saved
 *     snapshot.
 *
 * Anti-goals:
 *   - The hook does NOT mutate the draft on snapshot changes after the editor
 *     opens — incoming refetches do not stomp local edits. Conflict detection
 *     happens at save time via `expectedVersion`.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiToEditorModel,
  editorModelToPayload,
  emptyEditorModel,
  mapEditorSectionsToPayload,
} from "./test-editor.mappers";
import { validateTestEditor } from "./test-editor.validation";
import type {
  TestEditorModel,
  ValidationResult,
} from "./test-editor.types";

// ─── Public types ─────────────────────────────────────────────────────────────

/** The four primary tabs of the editor Drawer. */
export type EditorTabKey = "composition" | "settings" | "design" | "structure";

/** Aggregated status per tab — drives the `status-dot` indicator (FR-25b). */
export type TabStatus = {
  dirty: boolean;
  warning: boolean;
  error: boolean;
};

/** Optimistic version conflict (409) payload. */
export type ConflictInfo = {
  currentVersion: number;
  expectedVersion: number;
};

/** Required-fields (422) violation surfaced to the UI for anchoring. */
export type RequiredFieldsMissing = {
  pageId: string;
  templateKey: string;
  fieldName: string;
};

/**
 * Discriminated union describing what the editor is doing.
 *
 *   - `edit`   — load an existing test by id, save via PUT with optimistic
 *                version check.
 *   - `create` — start with an empty model (no fetch), save via POST. The new
 *                test inherits `folderId` from the FAB folder-pick modal.
 *
 * Pass `null` (or omit) to keep the hook idle (Drawer closed).
 */
export type UseTestEditorOptions =
  | { mode: "edit"; testId: string }
  | { mode: "create"; folderId: string | null };

export type UseTestEditorResult = {
  /** Editor mode (matches the active {@link UseTestEditorOptions}; `idle` when null). */
  mode: "edit" | "create" | "idle";
  /** Current draft model (null until the API snapshot loads / empty create draft is built). */
  model: TestEditorModel | null;
  /** True while the initial GET is in flight (always false in create mode). */
  isLoading: boolean;
  /** True while the PUT / POST mutation is in flight. */
  isSaving: boolean;
  /** True if the draft differs from the last saved snapshot. */
  isDirty: boolean;
  /** Latest validation result for the draft (debounced). */
  validation: ValidationResult;
  /** Aggregated tab status (dirty/warning/error) keyed by tab id (FR-25b). */
  tabStatuses: Record<EditorTabKey, TabStatus>;
  /** Latest 409 payload if the previous save attempt conflicted, otherwise null. */
  conflict: ConflictInfo | null;
  /** Latest 422 violations if the previous save attempt failed validation. */
  requiredFieldsMissing: RequiredFieldsMissing[];
  /**
   * Set right after a successful create POST. The parent component watches
   * this to close the Drawer and (optionally) re-open it in edit mode.
   * Re-set to `null` by {@link consumeCreatedId} once handled.
   */
  createdId: string | null;
  /** Apply a partial draft update; tracks dirty / validation reactively. */
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  /** Save the draft. PUT for edit (with expectedVersion), POST for create. */
  save: () => Promise<void>;
  /** Revert the draft to the last saved snapshot. */
  reset: () => void;
  /** Resolve the 409 conflict by reloading from server (drops draft). */
  resolveConflictReload: () => Promise<void>;
  /** Resolve the 409 conflict by reusing the new server version and re-saving. */
  resolveConflictOverwrite: () => Promise<void>;
  /** Dismiss the conflict dialog without retrying. */
  dismissConflict: () => void;
  /** Acknowledge handling the post-create transition (resets `createdId`). */
  consumeCreatedId: () => void;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const EMPTY_VALIDATION: ValidationResult = { errors: [], warnings: [] };

const EMPTY_TAB_STATUS: TabStatus = { dirty: false, warning: false, error: false };

/**
 * Map a validation issue field path to the tab that owns it (FR-25b). Falls
 * back to `composition` when the field cannot be attributed to a specific tab.
 */
function tabOfField(field: string): EditorTabKey {
  if (field.startsWith("sections")) return "composition";
  if (field.startsWith("adaptive")) return "settings";
  if (field.startsWith("passRules")) return "settings";
  if (field.startsWith("runtime")) return "settings";
  if (field.startsWith("basic")) return "settings";
  if (field.startsWith("design")) return "design";
  if (field.startsWith("flow") || field.startsWith("structure")) return "structure";
  return "composition";
}

/** Build aggregated per-tab status from the dirty mask and the validation result. */
function buildTabStatuses(
  dirtyTabs: Set<EditorTabKey>,
  validation: ValidationResult,
): Record<EditorTabKey, TabStatus> {
  const statuses: Record<EditorTabKey, TabStatus> = {
    composition: { ...EMPTY_TAB_STATUS },
    settings: { ...EMPTY_TAB_STATUS },
    design: { ...EMPTY_TAB_STATUS },
    structure: { ...EMPTY_TAB_STATUS },
  };
  for (const tab of dirtyTabs) statuses[tab].dirty = true;
  for (const issue of validation.errors) statuses[tabOfField(issue.field)].error = true;
  for (const issue of validation.warnings) statuses[tabOfField(issue.field)].warning = true;
  return statuses;
}

/**
 * Compute the set of dirty tabs by diffing the draft against the snapshot at
 * a coarse top-level granularity. The Drawer only needs to know *which* tabs
 * changed; field-level diffs are produced by the "Показать изменения" view
 * later (FR-25c).
 */
function diffDirtyTabs(
  draft: TestEditorModel,
  snapshot: TestEditorModel,
): Set<EditorTabKey> {
  const dirty = new Set<EditorTabKey>();
  if (
    !shallowEqualJson(draft.sections, snapshot.sections) ||
    !shallowEqualJson(draft.adaptive, snapshot.adaptive)
  ) {
    dirty.add("composition");
  }
  if (
    !shallowEqualJson(draft.basic, snapshot.basic) ||
    !shallowEqualJson(draft.runtime, snapshot.runtime) ||
    !shallowEqualJson(draft.passRules, snapshot.passRules) ||
    draft.mode !== snapshot.mode
  ) {
    dirty.add("settings");
  }
  if (
    draft.flowMode !== snapshot.flowMode ||
    !shallowEqualJson(draft.flowSettings, snapshot.flowSettings)
  ) {
    dirty.add("structure");
  }
  return dirty;
}

/** Structural equality via JSON serialisation. Sufficient for plain editor data. */
function shallowEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Fetch / mutate helpers ───────────────────────────────────────────────────

async function fetchTest(testId: string): Promise<unknown> {
  const res = await fetch(`/api/tests/${testId}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  }
  return res.json();
}

/** Custom error wrapping a non-2xx PUT response so the caller can branch on status. */
export class SaveHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`save failed: ${status}`);
    this.name = "SaveHttpError";
  }
}

async function putTest(testId: string, payload: unknown): Promise<unknown> {
  const res = await fetch(`/api/tests/${testId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new SaveHttpError(res.status, body);
  }
  return res.json();
}

async function postTest(payload: unknown): Promise<unknown> {
  const res = await fetch(`/api/tests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new SaveHttpError(res.status, body);
  }
  return res.json();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook that owns the editor draft for either an existing test (`edit` mode)
 * or a brand-new draft (`create` mode). Pass `null` to keep the hook idle.
 *
 * Edit save → `PUT /api/tests/:id` with `expectedVersion` (optimistic conflict
 * check, FR-25k). Create save → `POST /api/tests` with `folderId`; on success
 * the new id surfaces via {@link UseTestEditorResult.createdId} so the parent
 * Drawer can close itself and let the tests list refetch.
 */
export function useTestEditor(
  options?: UseTestEditorOptions | null,
): UseTestEditorResult {
  const queryClient = useQueryClient();

  const isEdit = options?.mode === "edit";
  const editTestId = isEdit ? options.testId : undefined;
  const createFolderId =
    options?.mode === "create" ? options.folderId : null;

  // Snapshot from server (cache key is `/api/tests/:id`). Disabled in create mode.
  const query = useQuery({
    queryKey: ["/api/tests", editTestId],
    queryFn: () => fetchTest(editTestId as string),
    enabled: isEdit && typeof editTestId === "string" && editTestId.length > 0,
  });

  // Draft state. Initialised once when the snapshot loads (edit) or
  // immediately for create. Not auto-synced on refetch so local edits are
  // preserved. Conflict detection at save time handles divergence (decisions §5.3).
  const [draft, setDraft] = useState<TestEditorModel | null>(null);
  const [snapshot, setSnapshot] = useState<TestEditorModel | null>(null);

  // Compute a stable identifier for the active session so re-renders with the
  // same options object do not reset the draft.
  const sessionKey = options
    ? options.mode === "edit"
      ? `edit:${options.testId}`
      : `create:${options.folderId ?? "_root_"}`
    : "idle";
  const lastSessionKeyRef = useRef<string>("idle");

  useEffect(() => {
    if (sessionKey !== lastSessionKeyRef.current) {
      setDraft(null);
      setSnapshot(null);
      lastSessionKeyRef.current = sessionKey;
    }
    if (options?.mode === "create" && draft === null) {
      // Create mode: skip fetch, build empty draft right away.
      const initial = emptyEditorModel({ folderId: createFolderId });
      setSnapshot(initial);
      setDraft(initial);
      return;
    }
    if (isEdit && query.data && draft === null) {
      try {
        const initial = apiToEditorModel(query.data);
        setSnapshot(initial);
        setDraft(initial);
      } catch {
        setSnapshot(null);
        setDraft(null);
      }
    }
  }, [sessionKey, options, isEdit, createFolderId, query.data, draft]);

  // Debounced validation (NFR-18: 300 ms). Tracks the latest draft and emits a
  // ValidationResult only after the user pauses.
  const [validation, setValidation] = useState<ValidationResult>(EMPTY_VALIDATION);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draft) {
      setValidation(EMPTY_VALIDATION);
      return;
    }
    if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    validationTimerRef.current = setTimeout(() => {
      setValidation(validateTestEditor(draft));
    }, 300);
    return () => {
      if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    };
  }, [draft]);

  // Aggregated dirty mask per tab (FR-25b).
  const isDirty = useMemo(() => {
    if (!draft || !snapshot) return false;
    return !shallowEqualJson(draft, snapshot);
  }, [draft, snapshot]);

  const tabStatuses = useMemo(() => {
    if (!draft || !snapshot) {
      return {
        composition: { ...EMPTY_TAB_STATUS },
        settings: { ...EMPTY_TAB_STATUS },
        design: { ...EMPTY_TAB_STATUS },
        structure: { ...EMPTY_TAB_STATUS },
      };
    }
    const dirty = diffDirtyTabs(draft, snapshot);
    return buildTabStatuses(dirty, validation);
  }, [draft, snapshot, validation]);

  // Mutation: PUT /api/tests/:id (edit) or POST /api/tests (create).
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [requiredFieldsMissing, setRequiredFieldsMissing] = useState<
    RequiredFieldsMissing[]
  >([]);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("save: editor is not ready");
      const payload = editorModelToPayload(draft);
      if (isEdit) {
        if (!editTestId) throw new Error("save: edit mode without testId");
        return putTest(editTestId, payload);
      }
      // Create: POST. Server requires `sections` for standard mode (route),
      // so we attach the mapped sections here in addition to `payload`.
      const createPayload = {
        ...payload,
        sections: mapEditorSectionsToPayload(draft),
      };
      return postTest(createPayload);
    },
    onSuccess: (data) => {
      setConflict(null);
      setRequiredFieldsMissing([]);
      try {
        const next = apiToEditorModel(data);
        setSnapshot(next);
        setDraft(next);
      } catch {
        // ignore — keep last known state
      }
      const newId = (data as { id?: string } | null)?.id;
      if (isEdit && editTestId) {
        queryClient.setQueryData(["/api/tests", editTestId], data);
      } else if (newId) {
        queryClient.setQueryData(["/api/tests", newId], data);
        setCreatedId(newId);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/tests"] });
    },
    onError: (err) => {
      if (err instanceof SaveHttpError) {
        if (err.status === 409 && isConflictBody(err.body)) {
          setConflict({
            currentVersion: err.body.currentVersion,
            expectedVersion: err.body.expectedVersion,
          });
          return;
        }
        if (err.status === 422 && isRequiredFieldsBody(err.body)) {
          setRequiredFieldsMissing(err.body.fields);
          return;
        }
      }
    },
  });

  // Imperative actions exposed to the Drawer.

  const updateModel = useCallback(
    (updater: (model: TestEditorModel) => TestEditorModel) => {
      setDraft((prev) => (prev ? updater(prev) : prev));
    },
    [],
  );

  const save = useCallback(async () => {
    if (!draft || !options) return;
    if (isEdit && !editTestId) return;
    if (validation.errors.length > 0) return;
    await mutation.mutateAsync().catch(() => {
      /* swallow — surfaced via conflict / requiredFieldsMissing state */
    });
  }, [draft, options, isEdit, editTestId, validation.errors.length, mutation]);

  const reset = useCallback(() => {
    if (snapshot) setDraft(snapshot);
    setRequiredFieldsMissing([]);
  }, [snapshot]);

  const resolveConflictReload = useCallback(async () => {
    setConflict(null);
    setRequiredFieldsMissing([]);
    setDraft(null);
    setSnapshot(null);
    if (isEdit && editTestId) {
      await queryClient.invalidateQueries({ queryKey: ["/api/tests", editTestId] });
      await query.refetch();
    }
  }, [queryClient, isEdit, editTestId, query]);

  const resolveConflictOverwrite = useCallback(async () => {
    if (!conflict || !draft) return;
    setConflict(null);
    const overridden: TestEditorModel = { ...draft, version: conflict.currentVersion };
    setDraft(overridden);
    setSnapshot((prev) => (prev ? { ...prev, version: conflict.currentVersion } : prev));
    await mutation.mutateAsync().catch(() => {
      /* state already updated by onError if it fails again */
    });
  }, [conflict, draft, mutation]);

  const dismissConflict = useCallback(() => {
    setConflict(null);
  }, []);

  const consumeCreatedId = useCallback(() => {
    setCreatedId(null);
  }, []);

  const resultMode: UseTestEditorResult["mode"] = options
    ? options.mode
    : "idle";

  return {
    mode: resultMode,
    model: draft,
    isLoading: isEdit ? query.isLoading : false,
    isSaving: mutation.isPending,
    isDirty,
    validation,
    tabStatuses,
    conflict,
    requiredFieldsMissing,
    createdId,
    updateModel,
    save,
    reset,
    resolveConflictReload,
    resolveConflictOverwrite,
    dismissConflict,
    consumeCreatedId,
  };
}

// ─── Response body type guards ────────────────────────────────────────────────

function isConflictBody(value: unknown): value is {
  error: "version_conflict";
  currentVersion: number;
  expectedVersion: number;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { error?: unknown }).error === "version_conflict" &&
    typeof (value as { currentVersion?: unknown }).currentVersion === "number" &&
    typeof (value as { expectedVersion?: unknown }).expectedVersion === "number"
  );
}

function isRequiredFieldsBody(value: unknown): value is {
  error: "required_fields_missing";
  fields: RequiredFieldsMissing[];
} {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { error?: unknown }).error !== "required_fields_missing"
  ) {
    return false;
  }
  const fields = (value as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return false;
  return fields.every(
    (f) =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as { pageId?: unknown }).pageId === "string" &&
      typeof (f as { templateKey?: unknown }).templateKey === "string" &&
      typeof (f as { fieldName?: unknown }).fieldName === "string",
  );
}

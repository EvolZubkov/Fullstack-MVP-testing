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
  mapEditorAdaptiveToPayload,
  mapEditorSectionsToPayload,
} from "./test-editor.mappers";
import { validateTestEditor } from "./test-editor.validation";
import { saveResultVariables } from "./result-variables-api";
import { saveScales, saveMeasurements } from "./scales-api";
import type {
  ScaleModel,
  TestEditorModel,
  ValidationResult,
} from "./test-editor.types";

// ─── Public types ─────────────────────────────────────────────────────────────

/** The four primary tabs of the editor Drawer. */
export type EditorTabKey =
  | "composition"
  | "settings"
  | "design"
  | "structure"
  | "scales"
  | "metrics";

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
  /**
   * Last saved snapshot. `null` in create mode before the first POST and
   * while the initial GET is in flight. PRD-7 S13.7-G2: the changes-popover
   * compares snapshot vs model to surface per-field diffs.
   */
  snapshot: TestEditorModel | null;
  /** True while the initial GET is in flight (always false in create mode). */
  isLoading: boolean;
  /** True while the PUT / POST mutation is in flight. */
  isSaving: boolean;
  /** True if the draft differs from the last saved snapshot. */
  isDirty: boolean;
  /**
   * The `flowMode` value from the last saved snapshot (persisted on server).
   * `null` while the snapshot has not yet loaded or in create mode before the
   * user first saves. Used by {@link StructureSection} to detect an unsaved
   * mode change and show an info-banner (G15 / prd7-structure-linear-flat s-mode-change).
   */
  savedFlowMode: TestEditorModel["flowMode"] | null;
  /** Latest validation result for the draft (debounced). */
  validation: ValidationResult;
  /** Aggregated tab status (dirty/warning/error) keyed by tab id (FR-25b). */
  tabStatuses: Record<EditorTabKey, TabStatus>;
  /** Latest 409 payload if the previous save attempt conflicted, otherwise null. */
  conflict: ConflictInfo | null;
  /** Latest 422 violations if the previous save attempt failed validation. */
  requiredFieldsMissing: RequiredFieldsMissing[];
  /**
   * Unexpected HTTP error from the last save attempt (e.g. 400 zod failure,
   * 5xx). Lets the Drawer keep itself open and show a banner instead of
   * silently closing — the previous "swallow" behaviour masked real bugs.
   */
  saveError: { status: number; message: string } | null;
  /**
   * Set right after a successful create POST. The parent component watches
   * this to close the Drawer and (optionally) re-open it in edit mode.
   * Re-set to `null` by {@link consumeCreatedId} once handled.
   */
  createdId: string | null;
  /** Apply a partial draft update; tracks dirty / validation reactively. */
  updateModel: (updater: (model: TestEditorModel) => TestEditorModel) => void;
  /**
   * Save the draft. PUT for edit (with expectedVersion), POST for create.
   * Resolves with `true` when the network call succeeded and the snapshot has
   * been refreshed; `false` when the call was skipped (invalid / no draft) or
   * failed — in which case the relevant state (`conflict` /
   * `requiredFieldsMissing` / `saveError`) is populated for the UI.
   */
  save: () => Promise<boolean>;
  /** Revert the draft to the last saved snapshot. */
  reset: () => void;
  /** Resolve the 409 conflict by reloading from server (drops draft). */
  resolveConflictReload: () => Promise<void>;
  /** Resolve the 409 conflict by reusing the new server version and re-saving. */
  resolveConflictOverwrite: () => Promise<void>;
  /** Dismiss the conflict dialog without retrying. */
  dismissConflict: () => void;
  /** Dismiss the inline save-error banner. */
  dismissSaveError: () => void;
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
  if (field.startsWith("scales")) return "scales";
  if (field.startsWith("resultVariables")) return "metrics";
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
    scales: { ...EMPTY_TAB_STATUS },
    metrics: { ...EMPTY_TAB_STATUS },
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
  if (!shallowEqualJson(draft.sections, snapshot.sections)) {
    dirty.add("composition");
  }
  if (
    !shallowEqualJson(draft.basic, snapshot.basic) ||
    !shallowEqualJson(draft.runtime, snapshot.runtime) ||
    !shallowEqualJson(draft.passRules, snapshot.passRules) ||
    !shallowEqualJson(draft.adaptive, snapshot.adaptive) ||
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
  if (!shallowEqualJson(draft.resultVariables, snapshot.resultVariables)) {
    dirty.add("metrics");
  }
  if (
    !shallowEqualJson(draft.scales, snapshot.scales) ||
    !shallowEqualJson(draft.measurements, snapshot.measurements)
  ) {
    dirty.add("scales");
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

/**
 * Build the scale `key`→`id` map needed to persist measurements (which reference
 * scales by key). When a scale was just created/changed, the draft rows lack the
 * server id, so re-read the persisted scales; otherwise the draft already carries
 * the ids from the last load.
 */
async function resolveScaleKeyToId(
  testId: string,
  draftScales: ScaleModel[],
  scalesChanged: boolean,
): Promise<Map<string, string>> {
  if (!scalesChanged) {
    return new Map(draftScales.filter((s) => s.id).map((s) => [s.key, s.id as string]));
  }
  const full = (await fetchTest(testId)) as { scales?: Array<{ id?: string; key?: string }> };
  const persisted = full.scales ?? [];
  return new Map(
    persisted.filter((s) => s.id && s.key).map((s) => [s.key as string, s.id as string]),
  );
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

/**
 * Build the full request body for save (PUT or POST).
 *
 * `editorModelToPayload` only covers the test-level scalar fields. The server
 * routes for both create and update read `sections` and `adaptiveSettings` from
 * the same flat body, so we attach them here. `showDifficultyLevel` is also
 * carried at the top level for adaptive tests (server schema, PRD-7 §6.4).
 *
 * For standard mode `mapEditorAdaptiveToPayload` returns `null`, and the
 * adaptive-related fields are simply omitted from the payload.
 */
function buildSavePayload(draft: TestEditorModel): Record<string, unknown> {
  const test = editorModelToPayload(draft);
  const sections = mapEditorSectionsToPayload(draft);
  const adaptive = mapEditorAdaptiveToPayload(draft);
  const payload: Record<string, unknown> = { ...test, sections };
  if (adaptive) {
    payload.showDifficultyLevel = adaptive.showDifficultyLevel;
    payload.adaptiveSettings = adaptive.topics;
  }
  return payload;
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
        scales: { ...EMPTY_TAB_STATUS },
        metrics: { ...EMPTY_TAB_STATUS },
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
  /**
   * Any save error that is not a known 409/422 case. Surfaced to the Drawer
   * so an unexpected 400 (validation rejection) or 5xx does not silently slip
   * past — without this the Drawer would close on a failed save and the user
   * would think the change was persisted.
   */
  const [saveError, setSaveError] = useState<{ status: number; message: string } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("save: editor is not ready");
      const fullPayload = buildSavePayload(draft);
      const snapVars = snapshot?.resultVariables ?? [];
      const snapScales = snapshot?.scales ?? [];
      const snapMeas = snapshot?.measurements ?? [];
      // PRD-2/PRD-5: result variables, scales and measurements are separate CRUD
      // resources. Persist the test first, then reconcile each. Measurements
      // reference scales by stable key, so they run AFTER scales and resolve
      // key→id from the persisted scales (re-read when a scale was just created).
      if (isEdit) {
        if (!editTestId) throw new Error("save: edit mode without testId");
        const saved = await putTest(editTestId, fullPayload);
        const varsChanged = !shallowEqualJson(draft.resultVariables, snapVars);
        const scalesChanged = !shallowEqualJson(draft.scales, snapScales);
        const measChanged = !shallowEqualJson(draft.measurements, snapMeas);
        if (varsChanged) await saveResultVariables(editTestId, draft.resultVariables, snapVars);
        if (scalesChanged) await saveScales(editTestId, draft.scales, snapScales);
        if (measChanged) {
          const keyToId = await resolveScaleKeyToId(editTestId, draft.scales, scalesChanged);
          await saveMeasurements(editTestId, draft.measurements, snapMeas, keyToId);
        }
        if (varsChanged || scalesChanged || measChanged) return fetchTest(editTestId);
        return {
          ...(saved as Record<string, unknown>),
          resultVariables: draft.resultVariables,
          scales: draft.scales,
          measurements: draft.measurements,
        };
      }
      const created = await postTest(fullPayload);
      const newId = (created as { id?: string } | null)?.id;
      const hasChildren =
        draft.resultVariables.length > 0 || draft.scales.length > 0 || draft.measurements.length > 0;
      if (newId && hasChildren) {
        if (draft.resultVariables.length > 0) await saveResultVariables(newId, draft.resultVariables, []);
        if (draft.scales.length > 0) await saveScales(newId, draft.scales, []);
        if (draft.measurements.length > 0) {
          const keyToId = await resolveScaleKeyToId(newId, draft.scales, true);
          await saveMeasurements(newId, draft.measurements, [], keyToId);
        }
        return fetchTest(newId);
      }
      return {
        ...(created as Record<string, unknown>),
        resultVariables: draft.resultVariables,
        scales: draft.scales,
        measurements: draft.measurements,
      };
    },
    onSuccess: (data) => {
      setConflict(null);
      setRequiredFieldsMissing([]);
      setSaveError(null);
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
        // Unknown HTTP error (400 from zod, 5xx, ...): keep the editor open and
        // surface the message so the user is not left thinking the change was saved.
        setSaveError({ status: err.status, message: describeSaveError(err) });
        return;
      }
      setSaveError({ status: 0, message: (err as Error)?.message ?? "Неизвестная ошибка" });
    },
  });

  // Imperative actions exposed to the Drawer.

  const updateModel = useCallback(
    (updater: (model: TestEditorModel) => TestEditorModel) => {
      setDraft((prev) => (prev ? updater(prev) : prev));
    },
    [],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft || !options) return false;
    if (isEdit && !editTestId) return false;
    if (validation.errors.length > 0) return false;
    try {
      await mutation.mutateAsync();
      return true;
    } catch {
      // Surfaced via `conflict` / `requiredFieldsMissing` / `saveError` state.
      return false;
    }
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

  const dismissSaveError = useCallback(() => {
    setSaveError(null);
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
    /** PRD-7 S13.7-G2: last saved snapshot, used by the changes-popover to compute per-field diff. */
    snapshot,
    isLoading: isEdit ? query.isLoading : false,
    isSaving: mutation.isPending,
    isDirty,
    savedFlowMode: snapshot?.flowMode ?? null,
    validation,
    tabStatuses,
    conflict,
    requiredFieldsMissing,
    saveError,
    createdId,
    updateModel,
    save,
    reset,
    resolveConflictReload,
    resolveConflictOverwrite,
    dismissConflict,
    dismissSaveError,
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

/**
 * Build a short human-readable message from an unknown save error. For zod
 * `Validation failed` responses (400) the offending field paths are appended
 * so the author can spot the bad field without opening DevTools.
 */
function describeSaveError(err: SaveHttpError): string {
  const body = err.body as { error?: unknown; fields?: unknown } | null;
  if (body && typeof body === "object") {
    const fields = (body as { fields?: unknown }).fields;
    if (Array.isArray(fields) && fields.length > 0) {
      const names = fields
        .map((f) =>
          typeof f === "object" && f !== null && typeof (f as { field?: unknown }).field === "string"
            ? (f as { field: string }).field
            : null,
        )
        .filter((s): s is string => s !== null);
      const head = names.slice(0, 5).join(", ");
      const tail = names.length > 5 ? `, …(+${names.length - 5})` : "";
      return `Сервер отверг сохранение (HTTP ${err.status}): ${head || "validation failed"}${tail}`;
    }
    if (typeof (body as { error?: unknown }).error === "string") {
      return `Сервер отверг сохранение (HTTP ${err.status}): ${(body as { error: string }).error}`;
    }
  }
  return `Сервер отверг сохранение (HTTP ${err.status})`;
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

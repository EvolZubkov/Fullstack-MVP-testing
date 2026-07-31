/**
 * @module features/tests/editor/result-variables-api
 * @description Client helpers for persisting result variables (PRD-2) and for
 * live formula validation in the «Показатели» tab.
 *
 * Result variables are a separate CRUD resource (A5), but the editor edits them
 * as part of the test draft and persists them on the single «Сохранить». This
 * module provides the save orchestrator that diffs the edited list against the
 * last saved snapshot and applies the minimal set of create/update/delete calls,
 * plus a thin wrapper over the live `validate-formula` endpoint used for inline
 * validation as the author types.
 */

import type { ResultVariableModel } from "./test-editor.types";

/** Shape returned by the shared DSL validator (mirror of `@shared/formula` `validate`). */
export type ResultVariableFormulaValidation = {
  valid: boolean;
  returnType?: "number" | "string" | "boolean";
  errors: Array<{ message: string; position?: number }>;
  warnings: Array<{ message: string; position?: number }>;
};

/** Fields sent to the create/update endpoints. */
function toPayload(v: ResultVariableModel, sortOrder: number) {
  return {
    name: v.name,
    label: v.label,
    type: v.type,
    formula: v.formula,
    learnerVisibility: v.learnerVisibility,
    scormTarget: v.scormTarget,
    controlsStatus: v.controlsStatus,
    sortOrder,
  };
}

/** True when two variables are identical for the fields the server persists. */
function sameVariable(a: ResultVariableModel, b: ResultVariableModel): boolean {
  return (
    a.name === b.name &&
    a.label === b.label &&
    a.type === b.type &&
    a.formula === b.formula &&
    a.learnerVisibility === b.learnerVisibility &&
    a.scormTarget === b.scormTarget &&
    a.controlsStatus === b.controlsStatus &&
    a.sortOrder === b.sortOrder
  );
}

async function mutate(method: string, url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const json = (await res.json()) as { error?: string };
      detail = json?.error ? `: ${json.error}` : "";
    } catch {
      /* ignore non-JSON bodies */
    }
    throw new Error(`${method} ${url} → ${res.status}${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Persist the edited result-variable list against its last saved snapshot.
 *
 * Order of operations matters because the server enforces "at most one
 * success / one completion controller per test": deletes run first (freeing any
 * status a removed row held), then creates/updates run in display order with the
 * row index as the canonical `sortOrder`. Reassigning a controls_status from one
 * row to another in a single save can still trip a transient 422 — uncommon, and
 * surfaced to the caller — but the steady state is always valid because the
 * editor's own validation forbids duplicate controllers in the draft.
 */
export async function saveResultVariables(
  testId: string,
  draft: ResultVariableModel[],
  snapshot: ResultVariableModel[],
): Promise<void> {
  const base = `/api/tests/${testId}/result-variables`;
  const draftIds = new Set(draft.filter((v) => v.id).map((v) => v.id));

  for (const s of snapshot) {
    if (s.id && !draftIds.has(s.id)) {
      await mutate("DELETE", `${base}/${s.id}`);
    }
  }

  const prevById = new Map(snapshot.filter((s) => s.id).map((s) => [s.id, s] as const));
  for (let i = 0; i < draft.length; i++) {
    const v = draft[i];
    const normalized: ResultVariableModel = { ...v, sortOrder: i };
    if (!v.id) {
      await mutate("POST", base, toPayload(v, i));
      continue;
    }
    const prev = prevById.get(v.id);
    if (!prev || !sameVariable(prev, normalized)) {
      await mutate("PUT", `${base}/${v.id}`, toPayload(v, i));
    }
  }
}

/**
 * Validate a single formula against the test context (live, debounced by the
 * caller). `excludeId` keeps a variable from referencing itself when checking
 * `var()` dependency order.
 */
export async function validateResultVariableFormula(
  testId: string,
  input: { formula: string; type: ResultVariableModel["type"]; sortOrder?: number; excludeId?: string },
): Promise<ResultVariableFormulaValidation> {
  const res = await fetch(`/api/tests/${testId}/result-variables/validate-formula`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`validate-formula → ${res.status}`);
  }
  return res.json() as Promise<ResultVariableFormulaValidation>;
}

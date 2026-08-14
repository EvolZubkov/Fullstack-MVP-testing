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

import type { LevelTone } from "@shared/scales/interpretation";
import type { OutcomeModel, ResultVariableModel } from "./test-editor.types";
import { bandsToPayload, hasFeedbackContent } from "./scales-api";
import type { FeedbackEditorValue } from "./sections/feedback-editor-modal";

/** Shape returned by the shared DSL validator (mirror of `@shared/formula` `validate`). */
export type ResultVariableFormulaValidation = {
  valid: boolean;
  returnType?: "number" | "string" | "boolean";
  errors: Array<{ message: string; position?: number }>;
  warnings: Array<{ message: string; position?: number }>;
};

/** One outcome as persisted in `config_json.outcomes` (mirror of `InterpretationOutcome`). */
type OutcomePayload = {
  code: string;
  label: string;
  text?: string;
  tone?: LevelTone;
  feedback?: FeedbackEditorValue;
};

/**
 * Drop draft rows without a code — the code IS the match, so a codeless outcome
 * can never fire — and leave out every empty optional so the config stays lean.
 * Read back by `buildOutcomes` in test-editor.mappers; the two are a pair.
 */
function outcomesToPayload(outcomes: OutcomeModel[]): OutcomePayload[] {
  const out: OutcomePayload[] = [];
  for (const o of outcomes) {
    const code = o.code.trim();
    if (code === "") continue;
    const payload: OutcomePayload = { code, label: o.label.trim() };
    if (o.text.trim() !== "") payload.text = o.text.trim();
    if (o.tone !== "") payload.tone = o.tone;
    if (hasFeedbackContent(o.feedback)) payload.feedback = o.feedback;
    out.push(payload);
  }
  return out;
}

/**
 * PRD-29(+): the indicator's `config_json` — its interpretation. Bands (plus
 * domain/valence) for a numeric indicator, the outcome list for a string/boolean
 * one; all are written when filled, because the type is derived from the formula
 * and may flip back. Empty collections are omitted entirely rather than stored
 * as `[]`. `valence` mirrors `scales-api.ts::toConfigJson`: always written so
 * clearing it back to «Без оценки» actually erases the stored value.
 */
function toConfigJson(v: ResultVariableModel): Record<string, unknown> {
  const config: Record<string, unknown> = { valence: v.valence };
  if (v.domainMin !== null && v.domainMax !== null) {
    config.domainMin = v.domainMin;
    config.domainMax = v.domainMax;
  }
  const bands = bandsToPayload(v.bands);
  if (bands.length > 0) config.bands = bands;
  const outcomes = outcomesToPayload(v.outcomes);
  if (outcomes.length > 0) config.outcomes = outcomes;
  // PRD-49 §6: card slots. Written ONLY when switched off — «show» is the absence of
  // the flag everywhere downstream (`showName !== false`), so an indicator nobody
  // touched keeps the exact config it had and never shows up as a change.
  if (v.showName === false) config.showName = false;
  if (v.showLevel === false) config.showLevel = false;
  return config;
}

/** Fields sent to the create/update endpoints. */
function toPayload(v: ResultVariableModel, sortOrder: number) {
  return {
    name: v.name,
    label: v.label,
    type: v.type,
    formula: v.formula,
    configJson: toConfigJson(v),
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
    a.sortOrder === b.sortOrder &&
    // One comparison for the whole config_json (bands + outcomes): a per-field
    // list would drift the moment another interpretation field is added.
    JSON.stringify(toConfigJson(a)) === JSON.stringify(toConfigJson(b))
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

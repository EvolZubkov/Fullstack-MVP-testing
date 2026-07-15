/**
 * @module features/tests/editor/scales-api
 * @description Client helpers for persisting scales (PRD-5) and for the «Шкалы»
 * tab's calculation preview.
 *
 * Scales are a separate CRUD resource (B3), but the editor edits them as part of
 * the test draft and persists them on the single «Сохранить». This module
 * provides the save orchestrator that diffs the edited list against the last
 * saved snapshot and applies the minimal set of create/update/delete calls, the
 * thin preview client over `POST /scales/preview`, and a loader that assembles
 * the preview's demo-answer context purely from the test's measurements (the
 * unit choices) plus question type/prompt.
 */

import { parseAuthorNumber } from "./numeric-input";
import type { QuestionMeasurementModel, ScaleBandModel, ScaleModel } from "./test-editor.types";

// ─── Persisted payload + diff ───────────────────────────────────────────────────

/** One interpretation band as persisted in `config_json.bands`. */
type BandPayload = { min: number; max: number; level: string; label?: string };

/** Drop empty draft rows and parse min/max; bands the validator rejected never reach here. */
function bandsToPayload(bands: ScaleBandModel[]): BandPayload[] {
  const out: BandPayload[] = [];
  for (const b of bands) {
    const minRaw = b.min.trim();
    const maxRaw = b.max.trim();
    if (minRaw === "" && maxRaw === "" && b.label.trim() === "" && b.level.trim() === "") continue;
    const min = parseAuthorNumber(minRaw);
    const max = parseAuthorNumber(maxRaw);
    if (min === null || max === null) continue;
    const payload: BandPayload = { min, max, level: b.level.trim() };
    if (b.label.trim() !== "") payload.label = b.label.trim();
    out.push(payload);
  }
  return out;
}

/** Fields sent to the create/update endpoints. */
function toPayload(s: ScaleModel, sortOrder: number) {
  return {
    key: s.key,
    label: s.label,
    type: s.type,
    aggregation: s.aggregation,
    normalization: s.normalization,
    direction: s.direction,
    configJson: { bands: bandsToPayload(s.bands) },
    showToLearner: s.showToLearner,
    scormTarget: s.scormTarget,
    sortOrder,
  };
}

/** True when two scales are identical for the fields the server persists. */
function sameScale(a: ScaleModel, b: ScaleModel): boolean {
  return (
    a.key === b.key &&
    a.label === b.label &&
    a.type === b.type &&
    a.aggregation === b.aggregation &&
    a.normalization === b.normalization &&
    a.direction === b.direction &&
    a.showToLearner === b.showToLearner &&
    a.scormTarget === b.scormTarget &&
    a.sortOrder === b.sortOrder &&
    JSON.stringify(bandsToPayload(a.bands)) === JSON.stringify(bandsToPayload(b.bands))
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
 * Persist the edited scale list against its last saved snapshot. Deletes run
 * first (freeing any key a removed row held), then creates/updates run in
 * display order with the row index as the canonical `sortOrder`.
 */
export async function saveScales(
  testId: string,
  draft: ScaleModel[],
  snapshot: ScaleModel[],
): Promise<void> {
  const base = `/api/tests/${testId}/scales`;
  const draftIds = new Set(draft.filter((s) => s.id).map((s) => s.id));

  for (const s of snapshot) {
    if (s.id && !draftIds.has(s.id)) {
      await mutate("DELETE", `${base}/${s.id}`);
    }
  }

  const prevById = new Map(snapshot.filter((s) => s.id).map((s) => [s.id, s] as const));
  for (let i = 0; i < draft.length; i++) {
    const s = draft[i];
    const normalized: ScaleModel = { ...s, sortOrder: i };
    if (!s.id) {
      await mutate("POST", base, toPayload(s, i));
      continue;
    }
    const prev = prevById.get(s.id);
    if (!prev || !sameScale(prev, normalized)) {
      await mutate("PUT", `${base}/${s.id}`, toPayload(s, i));
    }
  }
}

// ─── Measurements (contributions matrix) ──────────────────────────────────────────

/** Stable signature of one question's contribution rows, for change detection. */
function measurementSignature(rows: QuestionMeasurementModel[]): string {
  return rows
    .map((m) => `${m.scaleKey}|${m.sourceType}|${m.sourceKey ?? ""}|${m.value}|${m.weight}`)
    .sort()
    .join(";");
}

/**
 * Persist the edited contribution matrix against its last saved snapshot.
 * Measurements are stored per question (the endpoint replaces all of a question's
 * rows), so this diffs by `questionId` and PUTs only the questions whose row set
 * changed — clearing a question with an empty array. Each row's stable `scaleKey`
 * is resolved to the persisted `scaleId` via `scaleKeyToId`; rows whose scale is
 * not yet persisted are skipped (the scale save must run first).
 */
export async function saveMeasurements(
  testId: string,
  draft: QuestionMeasurementModel[],
  snapshot: QuestionMeasurementModel[],
  scaleKeyToId: Map<string, string>,
): Promise<void> {
  const base = `/api/tests/${testId}/measurements`;

  const groupByQuestion = (rows: QuestionMeasurementModel[]) => {
    const map = new Map<string, QuestionMeasurementModel[]>();
    for (const m of rows) {
      const list = map.get(m.questionId) ?? [];
      list.push(m);
      map.set(m.questionId, list);
    }
    return map;
  };

  const draftByQ = groupByQuestion(draft);
  const snapByQ = groupByQuestion(snapshot);
  const questionIds = new Set([...draftByQ.keys(), ...snapByQ.keys()]);

  for (const questionId of questionIds) {
    const draftRows = draftByQ.get(questionId) ?? [];
    const snapRows = snapByQ.get(questionId) ?? [];
    if (measurementSignature(draftRows) === measurementSignature(snapRows)) continue;
    const payload = draftRows
      .map((m) => {
        const scaleId = scaleKeyToId.get(m.scaleKey);
        if (!scaleId) return null;
        return {
          scaleId,
          sourceType: m.sourceType,
          sourceKey: m.sourceKey,
          valueJson: m.value,
          weight: m.weight,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    await mutate("PUT", `${base}/${questionId}`, payload);
  }
}

// ─── Calculation preview ─────────────────────────────────────────────────────────

/** One scale's computed result, mirror of the shared engine's `ScaleResult`. */
export type ScaleResultDTO = {
  raw: number;
  normalized: number;
  percent: number;
  level: string;
  label: string;
  hasValue: boolean;
};

export type ScalePreviewResult = {
  values: Record<string, ScaleResultDTO>;
  errors: Array<{ key: string; message: string }>;
};

/** Runtime answer encoding accepted by the preview endpoint. */
export type PreviewAnswer = number | number[] | Record<string, number> | null;

/**
 * Run the shared scale engine over a set of demo answers and return the computed
 * `scale.*` values + per-scale errors. Computes over the test's *saved*
 * measurements — unsaved contribution edits are not reflected.
 */
export async function previewScales(
  testId: string,
  answers: Record<string, PreviewAnswer>,
): Promise<ScalePreviewResult> {
  return (await mutate("POST", `/api/tests/${testId}/scales/preview`, { answers })) as ScalePreviewResult;
}

// ─── Preview demo-answer context ──────────────────────────────────────────────────

type QuestionType = "single" | "multiple" | "matching" | "ranking";

/** One selectable answer unit of a measured question, derived from its measurements. */
export type PreviewUnit = {
  /** Source key as stored in the measurement: option index, "left:right" or "item:pos". */
  sourceKey: string;
  label: string;
};

/** A measured question, with the units that carry a contribution to some scale. */
export type PreviewQuestionContext = {
  id: string;
  type: QuestionType;
  prompt: string;
  /** True when the answer encoding is supported by the preview picker (single/multiple). */
  supported: boolean;
  units: PreviewUnit[];
};

type RawMeasurement = {
  questionId: string;
  sourceType: "question" | "option" | "matching_pair" | "ranking_position";
  sourceKey: string | null;
};

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

function unitLabel(sourceType: RawMeasurement["sourceType"], sourceKey: string): string {
  if (sourceType === "option") return `Вариант ${Number(sourceKey) + 1}`;
  if (sourceType === "matching_pair") {
    const [l, r] = sourceKey.split(":").map(Number);
    return `Пара ${l + 1} → ${r + 1}`;
  }
  if (sourceType === "ranking_position") {
    const [item, pos] = sourceKey.split(":").map(Number);
    return `Элемент ${item + 1} @ позиция ${pos + 1}`;
  }
  return sourceKey;
}

/**
 * Build the preview's demo-answer context from the test's measurements (which
 * enumerate the units that matter) joined with question type/prompt. Questions
 * whose only contribution is `source_type=question` need no unit picker (answered
 * vs not); matching/ranking are listed but flagged `supported: false` — their
 * full demo-answer authoring lands with the contributions matrix (B4b).
 */
export async function loadScalePreviewContext(testId: string): Promise<PreviewQuestionContext[]> {
  const [measurementsRaw, questionsRaw] = await Promise.all([
    fetchJson(`/api/tests/${testId}/measurements`),
    fetchJson(`/api/questions`),
  ]);
  const measurements = Array.isArray(measurementsRaw) ? (measurementsRaw as RawMeasurement[]) : [];
  const questions = Array.isArray(questionsRaw) ? (questionsRaw as Array<{ id: string; type: string; prompt?: string }>) : [];
  const qById = new Map(questions.map((q) => [q.id, q]));

  const byQuestion = new Map<string, { units: Map<string, PreviewUnit>; sourceType: RawMeasurement["sourceType"] }>();
  for (const m of measurements) {
    const q = qById.get(m.questionId);
    if (!q) continue;
    let entry = byQuestion.get(m.questionId);
    if (!entry) {
      entry = { units: new Map(), sourceType: m.sourceType };
      byQuestion.set(m.questionId, entry);
    }
    if (m.sourceType !== "question" && m.sourceKey != null && !entry.units.has(m.sourceKey)) {
      entry.units.set(m.sourceKey, { sourceKey: m.sourceKey, label: unitLabel(m.sourceType, m.sourceKey) });
    }
  }

  const out: PreviewQuestionContext[] = [];
  for (const [questionId, entry] of byQuestion) {
    const q = qById.get(questionId)!;
    const type = (["single", "multiple", "matching", "ranking"].includes(q.type) ? q.type : "single") as QuestionType;
    out.push({
      id: questionId,
      type,
      prompt: q.prompt ?? questionId,
      supported: type === "single" || type === "multiple",
      units: Array.from(entry.units.values()).sort((a, b) => a.sourceKey.localeCompare(b.sourceKey, undefined, { numeric: true })),
    });
  }
  return out.sort((a, b) => a.prompt.localeCompare(b.prompt));
}

// ─── Contributions matrix context ──────────────────────────────────────────────

/** One editable row of the contributions matrix: an answer unit of a question. */
export type ContributionUnit = {
  sourceType: "option" | "matching_pair" | "ranking_position";
  sourceKey: string;
  label: string;
  /** True when this unit is (part of) the correct answer — surfaced as a marker. */
  correct: boolean;
};

/** A measured-capable question: its prompt, type and enumerated answer units. */
export type ContributionQuestion = {
  id: string;
  topicId: string;
  prompt: string;
  type: QuestionType;
  units: ContributionUnit[];
};

type RawQuestion = {
  id: string;
  topicId: string;
  type: string;
  prompt?: string;
  dataJson?: unknown;
  correctJson?: unknown;
};

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String(x))) : [];
}

/**
 * Enumerate the answer units of a question and mark which are correct:
 * single/multiple → one row per option; matching → one row per directed pair
 * (left → right); ranking → one row per placement (item @ position). The index-
 * based `sourceKey` mirrors the runtime engine's encoding (option index, "l:r",
 * "item:pos").
 */
function buildContributionUnits(q: RawQuestion, type: QuestionType): ContributionUnit[] {
  const data = (q.dataJson ?? {}) as Record<string, unknown>;
  const correct = (q.correctJson ?? {}) as Record<string, unknown>;

  if (type === "single" || type === "multiple") {
    const options = asStringArray(data.options);
    const correctSet = new Set<number>(
      type === "single"
        ? typeof correct.correctIndex === "number"
          ? [correct.correctIndex]
          : []
        : Array.isArray(correct.correctIndices)
          ? (correct.correctIndices as number[])
          : [],
    );
    return options.map((label, i) => ({
      sourceType: "option" as const,
      sourceKey: String(i),
      label: `${String.fromCharCode(65 + i)}. ${label}`,
      correct: correctSet.has(i),
    }));
  }

  if (type === "matching") {
    const left = asStringArray(data.left);
    const right = asStringArray(data.right);
    const pairs = Array.isArray(correct.pairs) ? (correct.pairs as Array<{ left: number; right: number }>) : [];
    const correctSet = new Set(pairs.map((p) => `${p.left}:${p.right}`));
    const units: ContributionUnit[] = [];
    left.forEach((l, li) => {
      right.forEach((r, ri) => {
        units.push({
          sourceType: "matching_pair",
          sourceKey: `${li}:${ri}`,
          label: `${l} → ${r}`,
          correct: correctSet.has(`${li}:${ri}`),
        });
      });
    });
    return units;
  }

  // ranking
  const items = asStringArray(data.items);
  const order = Array.isArray(correct.correctOrder) ? (correct.correctOrder as number[]) : [];
  const units: ContributionUnit[] = [];
  items.forEach((label, ii) => {
    items.forEach((_, pos) => {
      units.push({
        sourceType: "ranking_position",
        sourceKey: `${ii}:${pos}`,
        label: `${label} @ ${pos + 1}`,
        correct: order[pos] === ii,
      });
    });
  });
  return units;
}

/**
 * Load the test's questions (filtered to its topics) with their enumerated answer
 * units, for the «Вклады вопросов» matrix. Questions are returned in the order
 * GET /api/questions yields them, grouped by the test's topics.
 */
export async function loadContributionQuestions(topicIds: string[]): Promise<ContributionQuestion[]> {
  const raw = await fetchJson("/api/questions");
  const topicSet = new Set(topicIds);
  const list = Array.isArray(raw) ? (raw as RawQuestion[]) : [];
  return list
    .filter((q) => topicSet.has(q.topicId))
    .map((q) => {
      const type = (["single", "multiple", "matching", "ranking"].includes(q.type) ? q.type : "single") as QuestionType;
      return { id: q.id, topicId: q.topicId, prompt: q.prompt ?? q.id, type, units: buildContributionUnits(q, type) };
    });
}

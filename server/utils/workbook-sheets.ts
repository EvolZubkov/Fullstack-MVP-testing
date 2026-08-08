/**
 * @module server/utils/workbook-sheets
 *
 * Parse/serialize helpers for the test-scoped sheets of the multi-sheet workbook
 * (PRD-14 FR-15): «Шкалы» (scales, PRD-5), «Показатели» (result variables,
 * PRD-2) and «Вклады вопросов» (per-question contributions, PRD-5). The «Вопросы»
 * sheet is handled by server/services/questions-import.ts.
 *
 * Parsers turn a row object (from `sheetToObjects`) into a domain-shaped value;
 * the authoritative Zod validation (`insertScaleSchema` etc.) runs in the import
 * orchestrator, which also supplies `testId`. Serializers turn a DB row back
 * into a sheet row for the symmetric export (round-trip, FR-15.9).
 *
 * `source_key` encoding (matches shared/scales/engine.ts, 0-based): `option` —
 * the option index ("2"); `matching_pair` — "left:right"; `ranking_position` —
 * "item:pos"; `question` — empty.
 */

import type { ScaleBand } from "@shared/scales/engine";
import type { InterpretationBand, LearnerVisibility } from "@shared/scales/interpretation";
import type { DrawStratum, QuestionScoring } from "@shared/schema";
import { scales, resultVariables } from "@shared/schema";
import { normalizeTags, TAG_MAX_LENGTH } from "@shared/tags";
import { serializeScoring } from "./scoring-excel";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Canonical headers per test-scoped sheet (export column order). */
export const SCALE_HEADERS = [
  "Ключ", "Название", "Описание", "Тип", "Агрегация", "Нормализация", "Направление",
  "Диапазоны", "Показывать ученику", "SCORM",
];
export const SCALE_WIDTHS = [16, 28, 40, 12, 14, 14, 12, 50, 18, 14];

export const RESULT_VAR_HEADERS = [
  "Имя", "Метка", "Тип", "Формула", "Показывать ученику", "SCORM", "Управляет статусом",
];
export const RESULT_VAR_WIDTHS = [18, 28, 10, 60, 18, 14, 20];

export const MEASUREMENT_HEADERS = ["Вопрос", "Шкала", "Источник", "Ключ источника", "Значение", "Вес"];
export const MEASUREMENT_WIDTHS = [14, 16, 12, 16, 10, 8];

// ─── «Варианты теста» column of the «Вопросы» sheet ──────────────────────────
//
// Variant membership (PRD-17) rides on the «Вопросы» sheet. The column used to be
// called just «Варианты», which collided with the answer options twice over: the
// same sheet already carries «Тексты вариантов ответа» and «Следование вариантов
// ответов», so the bare word read as "answer options" to every first-time author —
// AND «Варианты» is itself the ancient name of the options column. Hence the
// explicit name, with the old one still accepted (see {@link variantsColumnOf}).

/** Canonical name of the variant-membership column. */
export const VARIANTS_COLUMN = "Варианты теста";
/** Legacy name, still read on import (older books and pre-rename exports). */
export const VARIANTS_COLUMN_LEGACY = "Варианты";
/** Canonical name of the answer-options column (whose ancient alias is the above). */
export const OPTIONS_COLUMN = "Тексты вариантов ответа";

/**
 * Which column of a «Вопросы» sheet carries variant membership, or `null` when
 * none does.
 *
 * The legacy name is honoured ONLY next to the canonical options column: a sheet
 * that lacks «Тексты вариантов ответа» is an ancient bank export where «Варианты»
 * still means the answer options — and which predates variants entirely, so it
 * has no membership to read. The canonical name always wins when both appear.
 */
export function variantsColumnOf(headers: Set<string>): string | null {
  if (headers.has(VARIANTS_COLUMN)) return VARIANTS_COLUMN;
  if (headers.has(VARIANTS_COLUMN_LEGACY) && headers.has(OPTIONS_COLUMN)) {
    return VARIANTS_COLUMN_LEGACY;
  }
  return null;
}

// ─── booleans / enums ────────────────────────────────────────────────────────

const TRUE_WORDS = new Set(["да", "yes", "true", "1", "y", "истина"]);

/** Coerce a cell to boolean (`да`/`yes`/`true`/`1` → true). */
export function parseBool(raw: unknown): boolean {
  return TRUE_WORDS.has(String(raw ?? "").trim().toLowerCase());
}

/** Serialize a boolean for a cell. */
export function serBool(b: boolean): string {
  return b ? "да" : "нет";
}

/**
 * The yes/no pair offered in a dropdown. {@link parseBool} also accepts
 * yes/true/1/истина; those stay readable but unadvertised.
 */
export const BOOL_CHOICES = [serBool(true), serBool(false)];

const SOURCE_FROM: Record<string, string> = {
  вопрос: "question",
  вариант: "option",
  пара: "matching_pair",
  позиция: "ranking_position",
  question: "question",
  option: "option",
  matching_pair: "matching_pair",
  ranking_position: "ranking_position",
  // PRD-44: вклад распределения бюджета. Ключ — индекс утверждения, как у «варианта»:
  // утверждения лежат в том же списке `options`.
  распределение: "option_allocation",
  option_allocation: "option_allocation",
};
const SOURCE_TO: Record<string, string> = {
  question: "вопрос",
  option: "вариант",
  matching_pair: "пара",
  ranking_position: "позиция",
  option_allocation: "распределение",
};

const CONTROLS_FROM: Record<string, string> = {
  "": "none",
  нет: "none",
  none: "none",
  успех: "success",
  success: "success",
  завершение: "completion",
  completion: "completion",
};
const CONTROLS_TO: Record<string, string> = {
  none: "нет",
  success: "успех",
  completion: "завершение",
};

// ─── canonical cell values of the enumerated columns ─────────────────────────
//
// The values an author may PICK, as opposed to everything the parsers tolerate.
// The parsers above accept synonyms and English spellings so older books keep
// loading; offering all of them would turn a dropdown into a quiz. Each list is
// therefore derived from the export side (`*_TO`) or straight from the schema
// enum the value must land in — never hand-written, because a hand-kept copy is
// exactly how a template starts offering a value the importer no longer takes.
//
// Consumed by the workbook template (`server/services/workbook-template.ts`),
// which turns them into Excel dropdowns.

/** «Источник» of «Вклады вопросов». */
export const MEASUREMENT_SOURCE_CHOICES = Object.values(SOURCE_TO);
/** «Управляет статусом» of «Показатели». */
export const CONTROLS_CHOICES = Object.values(CONTROLS_TO);
/** Scale kind — the value lands in the `scales.type` enum as written. */
export const SCALE_TYPE_CHOICES = [...scales.type.enumValues];
/** «Агрегация» of «Шкалы». */
export const SCALE_AGGREGATION_CHOICES = [...scales.aggregation.enumValues];
/** «Нормализация» of «Шкалы». */
export const SCALE_NORMALIZATION_CHOICES = [...scales.normalization.enumValues];
/** «Направление» of «Шкалы». */
export const SCALE_DIRECTION_CHOICES = [...scales.direction.enumValues];
/** «SCORM» of «Шкалы». */
export const SCALE_SCORM_CHOICES = [...scales.scormTarget.enumValues];
/** «Тип» of «Показатели». */
export const RESULT_VAR_TYPE_CHOICES = [...resultVariables.type.enumValues];
/** «SCORM» of «Показатели» (a different default order than the scale one). */
export const RESULT_VAR_SCORM_CHOICES = [...resultVariables.scormTarget.enumValues];

// ─── bands grammar («Диапазоны») ──────────────────────────────────────────────

/** Split a bands string on `;`/`,` that are NOT inside «…» (labels may contain commas). */
function splitBandSegments(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const ch of text) {
    if (ch === "«") inQuote = true;
    else if (ch === "»") inQuote = false;
    if (!inQuote && (ch === ";" || ch === ",")) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

const BAND_RE = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)\s+(\S+)(?:\s+«([^»]*)»)?$/;

/**
 * Parse the «Диапазоны» cell: `min..max код «подпись»; …` (PRD-14 §12.2).
 * Bounds inclusive; label optional. Empty → `[]`.
 */
export function parseBands(raw: unknown): ParseResult<ScaleBand[]> {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: [] };

  const bands: ScaleBand[] = [];
  for (const seg of splitBandSegments(text)) {
    const m = BAND_RE.exec(seg);
    if (!m) return { ok: false, error: `некорректный диапазон "${seg}"` };
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      return { ok: false, error: `некорректные границы диапазона "${seg}"` };
    }
    const band: ScaleBand = { min, max, level: m[3] };
    if (m[4] != null) band.label = m[4];
    bands.push(band);
  }
  return { ok: true, value: bands };
}

/** Serialize interpretation bands back to the «Диапазоны» grammar. */
export function serializeBands(bands: ScaleBand[] | undefined): string {
  if (!bands || bands.length === 0) return "";
  return bands
    .map((b) => `${b.min}..${b.max} ${b.level}${b.label != null ? ` «${b.label}»` : ""}`)
    .join("; ");
}

// ─── Видимость ученику (PRD-29) ───────────────────────────────────────────────

/** The three positions of «Показывать ученику», as written into the cell. */
const VISIBILITY_TO: Record<LearnerVisibility, string> = {
  hidden: "нет",
  level: "уровень",
  level_and_value: "уровень и значение",
};

/**
 * The column offers all THREE positions of {@link LearnerVisibility}. A yes/no pair
 * would be a trap once the middle position is authorable: an export followed by an
 * import would collapse «уровень» into «уровень и значение» and DISCLOSE the raw
 * score the methodologist had closed.
 *
 * Legacy books stay readable: `да` reads as «уровень и значение» (the mapping
 * migration 036 applies to the old boolean column), anything else as «нет».
 */
function parseLearnerVisibility(raw: unknown): LearnerVisibility {
  const cell = String(raw ?? "").trim().toLowerCase();
  if (cell === VISIBILITY_TO.level) return "level";
  if (cell === VISIBILITY_TO.level_and_value) return "level_and_value";
  return parseBool(cell) ? "level_and_value" : "hidden";
}

/** Serialize a visibility position into its cell text. */
function serLearnerVisibility(v: LearnerVisibility): string {
  return VISIBILITY_TO[v] ?? VISIBILITY_TO.hidden;
}

/**
 * The values offered in the column's dropdown. «нет» is byte-identical to
 * {@link serBool}(false), so a book written before PRD-29 still reads cleanly.
 */
export const VISIBILITY_CHOICES = [
  VISIBILITY_TO.hidden,
  VISIBILITY_TO.level,
  VISIBILITY_TO.level_and_value,
];

// ─── «Шкалы» ──────────────────────────────────────────────────────────────────

/** Parse a «Шкалы» row into an `insertScaleSchema` input (без testId/sortOrder). */
export function parseScaleRow(row: Record<string, unknown>): ParseResult<Record<string, unknown>> {
  const key = String(row["Ключ"] ?? "").trim();
  if (!key) return { ok: false, error: "не указан ключ шкалы" };

  const bands = parseBands(row["Диапазоны"]);
  if (!bands.ok) return bands;

  return {
    ok: true,
    value: {
      key,
      label: String(row["Название"] ?? "").trim(),
      description: String(row["Описание"] ?? "").trim() || null,
      type: String(row["Тип"] ?? "").trim(),
      aggregation: String(row["Агрегация"] ?? "").trim() || "sum",
      normalization: String(row["Нормализация"] ?? "").trim() || "none",
      direction: String(row["Направление"] ?? "").trim() || "positive",
      // ALWAYS present, empty array included: {@link mergeScaleConfig} treats a missing
      // key as «the book does not set this field», and an emptied «Диапазоны» cell is the
      // author's only way to clear the levels. Written as `{}` before, an emptied cell
      // silently kept the old levels once merging arrived.
      configJson: { bands: bands.value },
      learnerVisibility: parseLearnerVisibility(row["Показывать ученику"]),
      scormTarget: String(row["SCORM"] ?? "").trim() || "none",
    },
  };
}

/** Serialize a scale DB row to a «Шкалы» sheet row. */
export function serializeScaleRow(s: {
  key: string;
  label: string;
  description: string | null;
  type: string;
  aggregation: string;
  normalization: string;
  direction: string;
  configJson: unknown;
  learnerVisibility: LearnerVisibility;
  scormTarget: string;
}): Record<string, unknown> {
  const bands = (s.configJson as { bands?: ScaleBand[] })?.bands;
  return {
    "Ключ": s.key,
    "Название": s.label,
    "Описание": s.description ?? "",
    "Тип": s.type,
    "Агрегация": s.aggregation,
    "Нормализация": s.normalization,
    "Направление": s.direction,
    "Диапазоны": serializeBands(bands),
    "Показывать ученику": serLearnerVisibility(s.learnerVisibility),
    "SCORM": s.scormTarget,
  };
}

/**
 * Carry over what the «Диапазоны» grammar cannot express.
 *
 * The cell says `min..max код «подпись»` and nothing more, so a level's explanatory
 * text, its tone override and its whole feedback block (PRD-29/PRD-32: text, links,
 * events, assets) have no place in the book. They are matched back by the level CODE,
 * which is the level's identity — the code is what formulas address as
 * `scale.<ключ>.level`, and it is what the author keeps stable while moving a
 * boundary. Bounds and label come from the cell: those the book DOES express.
 *
 * A code the book no longer names loses its content, deliberately: the level is gone.
 * Duplicate codes are consumed in order, so a config that has two of them stays
 * predictable instead of copying the first one everywhere.
 */
function mergeBands(stored: InterpretationBand[], incoming: ScaleBand[]): InterpretationBand[] {
  const byLevel = new Map<string, InterpretationBand[]>();
  for (const band of stored) {
    const list = byLevel.get(band.level) ?? [];
    list.push(band);
    byLevel.set(band.level, list);
  }
  return incoming.map((band) => {
    const prev = byLevel.get(band.level)?.shift();
    if (!prev) return band;
    const merged: InterpretationBand = { ...band };
    if (prev.text !== undefined) merged.text = prev.text;
    if (prev.tone !== undefined) merged.tone = prev.tone;
    if (prev.feedback !== undefined) merged.feedback = prev.feedback;
    return merged;
  });
}

/**
 * Merge a parsed «Шкалы» row's `configJson` onto the one already stored.
 *
 * **The book defines, in full, the fields it has a column for, and does not touch the
 * fields it has none for.** The «Шкалы» sheet carries the bands (and, since PRD-46,
 * the domain, the valence and the display limit); everything else in `config_json`
 * belongs to the editor and must survive a round trip through Excel untouched.
 *
 * The distinction that carries the meaning here is «no column» versus «empty cell».
 * A key absent from `incoming` means the book does not set that field, so the stored
 * value stands — that is what makes a legacy book readable. An empty CELL of a column
 * the book does have arrives as an explicit value (`[]`, `null`) and wins, because
 * clearing a field is something the author must be able to do from the book.
 *
 * Only for an EXISTING scale. A scale the book creates has nothing to merge with and
 * gets exactly what the row says.
 */
export function mergeScaleConfig(
  stored: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const base = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base, ...incoming };
  if (Array.isArray(incoming.bands)) {
    const storedBands = Array.isArray(base.bands) ? (base.bands as InterpretationBand[]) : [];
    merged.bands = mergeBands(storedBands, incoming.bands as ScaleBand[]);
  }
  return merged;
}

// ─── «Показатели» ──────────────────────────────────────────────────────────────

/** Parse a «Показатели» row into an `insertResultVariableSchema` input. */
export function parseResultVariableRow(row: Record<string, unknown>): ParseResult<Record<string, unknown>> {
  const name = String(row["Имя"] ?? "").trim();
  if (!name) return { ok: false, error: "не указано имя показателя" };

  const controlsRaw = String(row["Управляет статусом"] ?? "").trim().toLowerCase();
  const controlsStatus = CONTROLS_FROM[controlsRaw];
  if (controlsStatus === undefined) {
    return { ok: false, error: `неизвестное значение «Управляет статусом»: "${row["Управляет статусом"]}"` };
  }

  return {
    ok: true,
    value: {
      name,
      label: String(row["Метка"] ?? "").trim(),
      type: String(row["Тип"] ?? "").trim(),
      formula: String(row["Формула"] ?? "").trim(),
      learnerVisibility: parseLearnerVisibility(row["Показывать ученику"]),
      scormTarget: String(row["SCORM"] ?? "").trim() || "both",
      controlsStatus,
    },
  };
}

/** Serialize a result-variable DB row to a «Показатели» sheet row. */
export function serializeResultVariableRow(rv: {
  name: string;
  label: string;
  type: string;
  formula: string;
  learnerVisibility: LearnerVisibility;
  scormTarget: string;
  controlsStatus: string;
}): Record<string, unknown> {
  return {
    "Имя": rv.name,
    "Метка": rv.label,
    "Тип": rv.type,
    "Формула": rv.formula,
    "Показывать ученику": serLearnerVisibility(rv.learnerVisibility),
    "SCORM": rv.scormTarget,
    "Управляет статусом": CONTROLS_TO[rv.controlsStatus] ?? rv.controlsStatus,
  };
}

// ─── «Вклады вопросов» ────────────────────────────────────────────────────────────────

export interface ParsedMeasurement {
  /** Raw «Вопрос» cell: question `ID` or local «Ключ строки» alias. */
  questionRef: string;
  /** Scale `key`. */
  scaleKey: string;
  sourceType: "question" | "option" | "matching_pair" | "ranking_position" | "option_allocation";
  /** 0-based source key string (empty for `question`). */
  sourceKey: string;
  value: number;
  weight: number;
}

/** Parse an «Вклады вопросов» row (refs resolved later by the orchestrator). */
export function parseMeasurementRow(row: Record<string, unknown>): ParseResult<ParsedMeasurement> {
  const questionRef = String(row["Вопрос"] ?? "").trim();
  if (!questionRef) return { ok: false, error: "не указан вопрос" };

  const scaleKey = String(row["Шкала"] ?? "").trim();
  if (!scaleKey) return { ok: false, error: "не указана шкала" };

  const sourceType = SOURCE_FROM[String(row["Источник"] ?? "").trim().toLowerCase()];
  if (!sourceType) return { ok: false, error: `неизвестный источник "${row["Источник"]}"` };

  const sourceKey = String(row["Ключ источника"] ?? "").trim();

  // PRD-44 FR-14: пустой коэффициент означает 1 — в опроснике из 56 строк вкладов
  // единица стоит в каждой, и требовать её явно значит требовать 56 одинаковых ячеек.
  const valueRaw = String(row["Значение"] ?? "").trim();
  const value = valueRaw === "" ? 1 : Number(valueRaw);
  if (!Number.isFinite(value)) return { ok: false, error: `некорректное значение "${row["Значение"]}"` };

  const weightRaw = String(row["Вес"] ?? "").trim();
  const weight = weightRaw === "" ? 1 : Number(weightRaw);
  if (!Number.isFinite(weight)) return { ok: false, error: `некорректный вес "${row["Вес"]}"` };

  return {
    ok: true,
    value: { questionRef, scaleKey, sourceType: sourceType as ParsedMeasurement["sourceType"], sourceKey, value, weight },
  };
}

/** Validate a parsed measurement's `sourceKey` against the question type/unit count. */
export function validateSourceKey(
  sourceType: ParsedMeasurement["sourceType"],
  sourceKey: string,
  unitCount: number,
): string | null {
  if (sourceType === "question") {
    return sourceKey ? "для источника «вопрос» ключ источника должен быть пустым" : null;
  }
  // «вариант» и «распределение» ключуются одинаково — индексом в списке `options`.
  if (sourceType === "option" || sourceType === "option_allocation") {
    const i = Number(sourceKey);
    if (!Number.isInteger(i) || i < 0 || i >= unitCount) return `ключ источника вне диапазона: "${sourceKey}"`;
    return null;
  }
  // matching_pair / ranking_position: "a:b" (0-based), первый индекс < unitCount.
  const m = /^(\d+):(\d+)$/.exec(sourceKey);
  if (!m) return `ключ источника должен быть в формате "a:b": "${sourceKey}"`;
  if (Number(m[1]) >= unitCount) return `ключ источника вне диапазона: "${sourceKey}"`;
  return null;
}

/** Serialize a measurement DB row to an «Вклады вопросов» sheet row. */
export function serializeMeasurementRow(m: {
  sourceType: string;
  sourceKey: string | null;
  valueJson: number;
  weight: number;
}, questionRef: string, scaleKey: string): Record<string, unknown> {
  return {
    "Вопрос": questionRef,
    "Шкала": scaleKey,
    "Источник": SOURCE_TO[m.sourceType] ?? m.sourceType,
    "Ключ источника": m.sourceKey ?? "",
    "Значение": m.valueJson,
    "Вес": m.weight,
  };
}

// ─── «Структура» / «Квоты» (PRD-14 FR-16: test sections + draw quotas) ─────────
//
// The test's structure — its sections (a topic + draw count + per-topic pass rule)
// and the PRD-11 per-tag draw quotas — is the one part of the model the workbook
// previously left to the editor. These two sheets carry it so a whole test (not
// just its content) round-trips through Excel. The flow is fixed to
// `router_by_topics` by the importer; the router page is materialized by the
// service. A quota row maps 1:1 to a PRD-11 `DrawStratum` ({tag, count, mode}).

/** Canonical «Структура» headers (one row per section). */
export const STRUCTURE_HEADERS = [
  // NB: «Порядок» here is the ORDER OF SECTIONS in the test (sort_order), which
  // is why the PRD-30 delivery setting is a separate, explicitly named column.
  "Раздел", "Порядок", "Вопросов в выборке", "Тип порога", "Порог", "Обязательный",
  "Случайный порядок вопросов",
];
export const STRUCTURE_WIDTHS = [28, 10, 20, 16, 10, 14, 26];

/** Canonical «Квоты» headers (one row per PRD-11 stratum). */
export const QUOTA_HEADERS = ["Раздел", "Тег", "Количество", "Режим"];
export const QUOTA_WIDTHS = [28, 24, 14, 14];

/**
 * Canonical «Настройки» headers (PRD-30 FR-22). The sheet is a key/value list,
 * not a table of columns: it carries settings OF THE TEST, of which there is one
 * of each, and a new setting must not widen a row every author already has.
 */
export const SETTINGS_HEADERS = ["Параметр", "Значение"];
export const SETTINGS_WIDTHS = [34, 30];

/** Test-level settings the workbook transfers. */
export interface ParsedTestSettings {
  /** PRD-30 FR-16: test-wide delivery order; absent = `random` (the default). */
  questionOrder?: "fixed" | "random" | "shuffle_all";
}

/** «Порядок выдачи вопросов» — the parameter name on the sheet. */
const SETTING_QUESTION_ORDER = "Порядок выдачи вопросов";

/** Cell ↔ stored value. Labels match the editor's Select verbatim (FR-16). */
const TEST_ORDER_FROM: Record<string, "fixed" | "random" | "shuffle_all"> = {
  "фиксированный порядок": "fixed",
  "перемешивание": "random",
  "полное перемешивание": "shuffle_all",
};
const TEST_ORDER_TO: Record<"fixed" | "random" | "shuffle_all", string> = {
  fixed: "Фиксированный порядок",
  random: "Перемешивание",
  shuffle_all: "Полное перемешивание",
};

/**
 * Parse one «Настройки» row. An empty value means «оставить как есть» — the
 * import must not silently reset a setting the author cleared out of the cell.
 */
export function parseSettingsRow(row: Record<string, unknown>): ParseResult<ParsedTestSettings> {
  const name = String(row["Параметр"] ?? "").replace(/[\s ​﻿]+/g, " ").trim();
  if (!name) return { ok: false, error: "не указан «Параметр»" };
  const raw = String(row["Значение"] ?? "").trim();

  if (name.toLowerCase() === SETTING_QUESTION_ORDER.toLowerCase()) {
    if (raw === "") return { ok: true, value: {} };
    const order = TEST_ORDER_FROM[raw.toLowerCase()];
    if (!order) return { ok: false, error: `неизвестное значение «${SETTING_QUESTION_ORDER}»: "${raw}"` };
    return { ok: true, value: { questionOrder: order } };
  }

  return { ok: false, error: `неизвестный параметр: "${name}"` };
}

/** Values offered for «Порядок выдачи вопросов» (template dropdown). */
export const TEST_ORDER_CHOICES = [
  TEST_ORDER_TO.fixed,
  TEST_ORDER_TO.random,
  TEST_ORDER_TO.shuffle_all,
];

/** Serialize the test's settings to «Настройки» rows (export). */
export function serializeSettingsRows(test: {
  questionOrder?: "fixed" | "random" | "shuffle_all" | null;
}): Record<string, unknown>[] {
  return [
    {
      "Параметр": SETTING_QUESTION_ORDER,
      "Значение": TEST_ORDER_TO[test.questionOrder ?? "random"],
    },
  ];
}

/** «Тип порога» cell → the editor's `topicPassRuleJson` shape (PRD-7). */
const PASS_TYPE_FROM: Record<string, "percent" | "absolute"> = {
  "процент": "percent",
  "%": "percent",
  "percent": "percent",
  "сумма баллов": "absolute",
  "баллы": "absolute",
  "балл": "absolute",
  "absolute": "absolute",
};
/** Internal pass type → «Тип порога» cell (export). */
const PASS_TYPE_TO: Record<string, string> = { percent: "Процент", absolute: "Сумма баллов" };

/** «Режим» cell → PRD-11 per-tag mode (default `exact`). */
const QUOTA_MODE_FROM: Record<string, "exact" | "min"> = {
  "": "exact",
  "ровно": "exact",
  "exact": "exact",
  "не менее": "min",
  "неменее": "min",
  "min": "min",
  "минимум": "min",
};
/** PRD-11 mode → «Режим» cell (export). */
const QUOTA_MODE_TO: Record<string, string> = { exact: "Ровно", min: "Не менее" };

/** «Режим» of «Квоты». */
export const QUOTA_MODE_CHOICES = Object.values(QUOTA_MODE_TO);

/**
 * «Тип порога» of «Пороги вариантов» — a variant threshold is always a concrete
 * number, so only the two measurable types apply.
 */
export const PASS_TYPE_CHOICES = Object.values(PASS_TYPE_TO);

/**
 * «Тип порога» of «Структура» — the two measurable types plus the three modes
 * {@link parseStructureRow} handles before consulting `PASS_TYPE_FROM`:
 * inherit the test's rule, do not check at all, or take the threshold per
 * variant from the «Пороги вариантов» sheet.
 */
export const STRUCTURE_PASS_TYPE_CHOICES = [
  "Как у теста",
  "Нет",
  ...PASS_TYPE_CHOICES,
  "По вариантам",
];

/** One parsed «Структура» row (refs resolved later by the orchestrator). */
export interface ParsedSection {
  /** Topic name (resolved to `topicId` by the orchestrator). */
  topicName: string;
  /** Sort order; the orchestrator orders sections by this. */
  sortOrder: number;
  drawCount: number;
  /** Editor-shape `topicPassRuleJson` (PRD-7): `{source, type?, value?}`. */
  passRule: Record<string, unknown>;
  required: boolean;
  /** PRD-30 FR-02/FR-18: the topic's override; `null` = «как в тесте». */
  questionOrder: "random" | "fixed" | null;
}

/** Parse a «Структура» row. `rowIndex` (0-based) is the «Порядок» fallback. */
export function parseStructureRow(
  row: Record<string, unknown>,
  rowIndex: number,
): ParseResult<ParsedSection> {
  const topicName = String(row["Раздел"] ?? row["Тема"] ?? "").replace(/[\s ​﻿]+/g, " ").trim();
  if (!topicName) return { ok: false, error: "не указан раздел (тема)" };

  const orderRaw = String(row["Порядок"] ?? "").trim();
  const sortOrder = orderRaw === "" ? rowIndex : Number(orderRaw);
  if (!Number.isFinite(sortOrder)) return { ok: false, error: `некорректный «Порядок»: "${row["Порядок"]}"` };

  const drawCount = Number(String(row["Вопросов в выборке"] ?? "").trim());
  if (!Number.isInteger(drawCount) || drawCount < 1) {
    return { ok: false, error: `«Вопросов в выборке» должно быть целым ≥ 1 ("${row["Вопросов в выборке"]}")` };
  }

  // Pass rule: empty / «как у теста» → inherit; «нет»/«не проверять» → none;
  // otherwise a custom percent/absolute rule with a numeric «Порог».
  const typeRaw = String(row["Тип порога"] ?? "").trim().toLowerCase();
  let passRule: Record<string, unknown>;
  if (typeRaw === "" || typeRaw === "как у теста" || typeRaw === "наследовать" || typeRaw === "inherit") {
    passRule = { source: "inherit_overall" };
  } else if (typeRaw === "нет" || typeRaw === "не проверять" || typeRaw === "none") {
    passRule = { source: "none" };
  } else if (typeRaw === "по вариантам" || typeRaw === "by_variant") {
    // PRD-24: the thresholds themselves live on the «Пороги вариантов» sheet and are
    // keyed by formId, which only exists once the variant set is built — so the rule
    // starts empty here and that pass fills it in.
    passRule = { source: "by_variant", byForm: {} };
  } else {
    const type = PASS_TYPE_FROM[typeRaw];
    if (!type) return { ok: false, error: `неизвестный «Тип порога»: "${row["Тип порога"]}"` };
    const value = Number(String(row["Порог"] ?? "").trim());
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: `некорректный «Порог»: "${row["Порог"]}"` };
    }
    passRule = { source: "custom", type, value };
  }

  // Default required = true (empty cell), else parse the boolean.
  const requiredRaw = String(row["Обязательный"] ?? "").trim();
  const required = requiredRaw === "" ? true : parseBool(requiredRaw);

  // PRD-30 FR-18: an empty cell — and a workbook without the column at all —
  // means «как в тесте»: the topic follows the test-wide rule, which is what a
  // book that never touched the column has to keep meaning. «нет» fixes the
  // order, «да» is an explicit override back to shuffling.
  const randomRaw = String(row["Случайный порядок вопросов"] ?? "").trim();
  const questionOrder = randomRaw === "" ? null : parseBool(randomRaw) ? "random" : "fixed";

  return {
    ok: true,
    value: { topicName, sortOrder, drawCount, passRule, required, questionOrder },
  };
}

/** Serialize a section to a «Структура» row (export). */
export function serializeStructureRow(s: {
  topicName: string;
  sortOrder: number;
  drawCount: number;
  topicPassRuleJson: unknown;
  required: boolean;
  /** PRD-30 FR-02/FR-18: null or absent = «как в тесте» (the topic inherits). */
  questionOrder?: "random" | "fixed" | null;
}): Record<string, unknown> {
  const rule = (s.topicPassRuleJson ?? {}) as { source?: string; type?: string; value?: number };
  let passType = "Как у теста";
  let passValue: number | "" = "";
  if (rule.source === "none") passType = "Нет";
  else if (rule.source === "by_variant") {
    // PRD-24: no single number here — the thresholds go to «Пороги вариантов».
    passType = "По вариантам";
  } else if (rule.source === "custom" && rule.type) {
    passType = PASS_TYPE_TO[rule.type] ?? rule.type;
    passValue = typeof rule.value === "number" ? rule.value : "";
  }
  return {
    "Раздел": s.topicName,
    "Порядок": s.sortOrder + 1,
    "Вопросов в выборке": s.drawCount,
    "Тип порога": passType,
    "Порог": passValue,
    "Обязательный": serBool(s.required),
    // FR-18: пустая ячейка = «как в тесте», иначе явное переопределение темы.
    "Случайный порядок вопросов": s.questionOrder == null ? "" : serBool(s.questionOrder !== "fixed"),
  };
}

/** One parsed «Квоты» row: a PRD-11 stratum scoped to a section (by topic name). */
export interface ParsedQuota {
  topicName: string;
  tag: string;
  count: number;
  mode: "exact" | "min";
}

/** Parse a «Квоты» row into a section-scoped {@link DrawStratum}. */
export function parseQuotaRow(row: Record<string, unknown>): ParseResult<ParsedQuota> {
  const topicName = String(row["Раздел"] ?? row["Тема"] ?? "").replace(/[\s ​﻿]+/g, " ").trim();
  if (!topicName) return { ok: false, error: "не указан раздел (тема)" };

  // Normalized through the SAME helper the «Вопросы» sheet uses for question
  // tags. Trimming alone let a quota keep a form the question side had already
  // rewritten (whitespace runs, over-long text), and the draw matches tags by
  // string — a quota that does not match spelling matches no questions at all.
  const tag = normalizeTags([String(row["Тег"] ?? "")])[0] ?? "";
  if (!tag) return { ok: false, error: "не указан тег" };
  if (tag.length > TAG_MAX_LENGTH) {
    return { ok: false, error: `тег длиннее ${TAG_MAX_LENGTH} символов: "${tag}"` };
  }

  const count = Number(String(row["Количество"] ?? "").trim());
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, error: `«Количество» должно быть целым ≥ 1 ("${row["Количество"]}")` };
  }

  const modeRaw = String(row["Режим"] ?? "").trim().toLowerCase();
  const mode = QUOTA_MODE_FROM[modeRaw];
  if (!mode) return { ok: false, error: `неизвестный «Режим»: "${row["Режим"]}"` };

  return { ok: true, value: { topicName, tag, count, mode } };
}

/** Serialize a PRD-11 stratum to a «Квоты» row (export). */
export function serializeQuotaRow(topicName: string, stratum: DrawStratum): Record<string, unknown> {
  const mode = stratum.mode ?? "exact";
  return {
    "Раздел": topicName,
    "Тег": stratum.tag,
    "Количество": stratum.count,
    "Режим": QUOTA_MODE_TO[mode] ?? mode,
  };
}

// ─── «Пороги вариантов» (PRD-24, FR-14) ──────────────────────────────────────
//
// A per-variant pass threshold is one row per (section, variant) — same shape as
// «Квоты» is for strata. Variants are positional in the workbook (PRD-17 D-10), so
// the key is the 1-based NUMBER, matching the «Варианты» column of «Вопросы»; the
// importer maps it back to the stable formId AFTER the variant set is built.

/** Canonical «Пороги вариантов» headers (one row per variant of a section). */
export const VARIANT_THRESHOLD_HEADERS = ["Раздел", "Вариант", "Тип порога", "Порог"];
export const VARIANT_THRESHOLD_WIDTHS = [28, 12, 16, 10];

/** One parsed «Пороги вариантов» row (variant referenced by its 1-based number). */
export interface ParsedVariantThreshold {
  topicName: string;
  variantNumber: number;
  type: "percent" | "absolute";
  value: number;
}

/** Parse a «Пороги вариантов» row. Accepts «2» or «Вариант 2» in the number cell. */
export function parseVariantThresholdRow(
  row: Record<string, unknown>,
): ParseResult<ParsedVariantThreshold> {
  const topicName = String(row["Раздел"] ?? row["Тема"] ?? "").replace(/[\s ​﻿]+/g, " ").trim();
  if (!topicName) return { ok: false, error: "не указан раздел (тема)" };

  const numberMatch = String(row["Вариант"] ?? "").match(/\d+/);
  if (!numberMatch) return { ok: false, error: `некорректный «Вариант»: "${row["Вариант"]}"` };
  const variantNumber = parseInt(numberMatch[0], 10);
  if (!Number.isInteger(variantNumber) || variantNumber < 1) {
    return { ok: false, error: `«Вариант» должен быть целым ≥ 1 ("${row["Вариант"]}")` };
  }

  const typeRaw = String(row["Тип порога"] ?? "").trim().toLowerCase();
  const type = PASS_TYPE_FROM[typeRaw];
  if (!type) return { ok: false, error: `неизвестный «Тип порога»: "${row["Тип порога"]}"` };

  const value = Number(String(row["Порог"] ?? "").trim());
  if (!Number.isFinite(value) || value < 0 || String(row["Порог"] ?? "").trim() === "") {
    return { ok: false, error: `некорректный «Порог»: "${row["Порог"]}"` };
  }

  return { ok: true, value: { topicName, variantNumber, type, value } };
}

/** Serialize one variant threshold to a «Пороги вариантов» row (export). */
export function serializeVariantThresholdRow(t: ParsedVariantThreshold): Record<string, unknown> {
  return {
    "Раздел": t.topicName,
    "Вариант": t.variantNumber,
    "Тип порога": PASS_TYPE_TO[t.type] ?? t.type,
    "Порог": t.value,
  };
}

// ─── «Оценка» (PRD-15 block D, FR-36: per-test scoring overrides) ─────────────
//
// Scoring is a property of the TEST (block D): the per-question price, graded
// config («Цена ответа», PRD-10 grammar) and difficulty move from the global
// «Вопросы» sheet into this test-scoped sheet as override rows
// (test_question_scoring). An EMPTY cell means "no override" — the effective
// chain falls through (section default -> test default -> system / legacy);
// «точное» in «Цена ответа» is an EXPLICIT exact override (it shadows a graded
// config the question itself may carry). The sheet is authoritative for the
// test's override set: importing it replaces all overrides of the target test.

/** Canonical «Оценка» headers (one row per overridden question). */
export const SCORING_OVERRIDE_HEADERS = ["Вопрос", "Балл", "Цена ответа", "Сложность"];
export const SCORING_OVERRIDE_WIDTHS = [14, 8, 40, 12];

/** One parsed «Оценка» row (the «Цена ответа» cell is resolved later — it
 *  needs the question type and option count, known only to the orchestrator). */
export interface ParsedScoringOverride {
  /** Raw «Вопрос» cell: question `ID` or local «Ключ строки» alias. */
  questionRef: string;
  /** Override price; null = no points override (empty cell). */
  points: number | null;
  /** Raw «Цена ответа» cell text; "" = no scoring override. */
  scoringRaw: string;
  /** Override difficulty (0..100); null = no difficulty override. */
  difficulty: number | null;
}

/** Parse an «Оценка» row. A row with no override values at all is an error. */
export function parseScoringOverrideRow(
  row: Record<string, unknown>,
): ParseResult<ParsedScoringOverride> {
  const questionRef = String(row["Вопрос"] ?? "").trim();
  if (!questionRef) return { ok: false, error: "не указан вопрос" };

  const pointsRaw = String(row["Балл"] ?? "").trim();
  let points: number | null = null;
  if (pointsRaw !== "") {
    const n = Number(pointsRaw);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, error: `«Балл» должен быть целым ≥ 0 ("${row["Балл"]}")` };
    }
    points = n;
  }

  const difficultyRaw = String(row["Сложность"] ?? "").trim();
  let difficulty: number | null = null;
  if (difficultyRaw !== "") {
    const n = Number(difficultyRaw);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return { ok: false, error: `«Сложность» должна быть целым 0..100 ("${row["Сложность"]}")` };
    }
    difficulty = n;
  }

  const scoringRaw = String(row["Цена ответа"] ?? "").trim();
  if (points === null && difficulty === null && scoringRaw === "") {
    return { ok: false, error: "строка без переопределений (укажите балл, цену ответа или сложность)" };
  }

  return { ok: true, value: { questionRef, points, scoringRaw, difficulty } };
}

/** Serialize an override DB row to an «Оценка» sheet row. An explicit exact
 *  override exports as «точное» (an empty cell would re-import as "none"). */
export function serializeScoringOverrideRow(
  o: { points: number | null; scoringJson: QuestionScoring | null; difficulty: number | null },
  questionRef: string,
): Record<string, unknown> {
  return {
    "Вопрос": questionRef,
    "Балл": o.points ?? "",
    "Цена ответа": o.scoringJson
      ? (o.scoringJson.kind === "exact" ? "точное" : serializeScoring(o.scoringJson))
      : "",
    "Сложность": o.difficulty ?? "",
  };
}

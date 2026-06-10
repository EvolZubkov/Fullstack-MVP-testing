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

const SOURCE_FROM: Record<string, string> = {
  вопрос: "question",
  вариант: "option",
  пара: "matching_pair",
  позиция: "ranking_position",
  question: "question",
  option: "option",
  matching_pair: "matching_pair",
  ranking_position: "ranking_position",
};
const SOURCE_TO: Record<string, string> = {
  question: "вопрос",
  option: "вариант",
  matching_pair: "пара",
  ranking_position: "позиция",
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
      configJson: bands.value.length ? { bands: bands.value } : {},
      showToLearner: parseBool(row["Показывать ученику"]),
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
  showToLearner: boolean;
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
    "Показывать ученику": serBool(s.showToLearner),
    "SCORM": s.scormTarget,
  };
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
      showToLearner: parseBool(row["Показывать ученику"]),
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
  showToLearner: boolean;
  scormTarget: string;
  controlsStatus: string;
}): Record<string, unknown> {
  return {
    "Имя": rv.name,
    "Метка": rv.label,
    "Тип": rv.type,
    "Формула": rv.formula,
    "Показывать ученику": serBool(rv.showToLearner),
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
  sourceType: "question" | "option" | "matching_pair" | "ranking_position";
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

  const value = Number(String(row["Значение"] ?? "").trim());
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
  if (sourceType === "option") {
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

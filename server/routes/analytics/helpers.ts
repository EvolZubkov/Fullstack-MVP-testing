import type { Request } from "express";
import { readableTestScope } from "../../services/test-access";
import { storage } from "../../storage";
import { resolveOverallRule, nothingToGrade, hasPronouncedVerdict } from "@shared/scoring/pass-rule";
import { isMeasurementOnly, isTextEntry, hasBlanks, isOpenText } from "@shared/questions/question-type";
import { describeRuleSet } from "@shared/answer-check/describe";
import type { AnswerRuleSet } from "@shared/answer-check";
import {
  parseScaleInterpretation,
  parseIndicatorInterpretation,
  findBand,
  findOutcome,
} from "@shared/scales/interpretation";
import type { AttemptResult } from "@shared/schema";
import { indicatorValuesOf, matchOutcome } from "../../services/analytics/indicator-values";
// Разбор строки прохождения переехал в слой наблюдений (PRD-56 FR-33): сервис не может
// зависеть от маршрутов, а эти помощники нужны обоим. Реэкспорт оставлен, чтобы места
// чтения не переписывались ради переезда.
export { attemptPackage, attemptParticipant, attemptTestId } from "../../services/analytics/attempt-row";

/**
 * What a report prints where a question CANNOT have the value the column asks for —
 * a measurement question has no reference answer, no verdict and no points.
 *
 * A dash and not an empty cell: empty reads as «не заполнено» (a data gap the analyst
 * should chase), the dash reads as «неприменимо» (there is nothing to fill in). And
 * not «Неверно»/`0`, which is what the export printed until this: a category error
 * that turned every questionnaire into a 0% failure.
 */
export const NOT_APPLICABLE = "—";

/**
 * PRD-15 FR-08 (audit F-5): cross-test analytics aggregates and exports are
 * limited to the tests the actor may read (ownership, grants, admin). Wraps
 * {@link readableTestScope} into a predicate; `has(null)` is true only for
 * administrators. Attempts of deleted tests no longer exist (PRD-15 FR-07a:
 * `deleteTest` purges them), so a test-less row is a defect seen only by admins.
 */
export async function analyticsScope(
  req: Request,
): Promise<{
  all: boolean;
  /** Доступные тесты множеством: PRD-56 FR-35 — область видимости уходит в УСЛОВИЕ запроса. */
  ids: ReadonlySet<string>;
  has: (testId: string | null | undefined) => boolean;
}> {
  const scope = await readableTestScope(req.effectiveRoles ?? [], req.currentUser?.id ?? "");
  return {
    all: scope.all,
    ids: scope.ids,
    has: (testId) => scope.all || (!!testId && scope.ids.has(testId)),
  };
}

/**
 * The test's measurement vocabulary: which scales (PRD-5) and indicators (PRD-2)
 * it defines, and what to CALL them.
 *
 * The stored attempt result keys its measurements by scale key / variable name
 * (`{"kom": {...}}`), which is a DSL identifier and not something to show a human.
 * The catalogue is what turns those keys into table columns and card titles; it is
 * loaded once per request and shared by every attempt in the answer.
 *
 * Deliberately NOT taken from {@link module:server/services/scoring-config}: that
 * one maps rows to ENGINE specs and drops the label on the way, because computing
 * a scale never needs its name.
 */
export interface MeasureCatalogue {
  scales: Array<{
    key: string;
    label: string;
    /**
     * Can this scale ever produce a LEVEL («Высокий», «Норма»)? True exactly when the
     * author declared interpretation bands for it (PRD-29). Published so a report adds
     * a level column only where one can be filled: an always-empty column next to every
     * scale reads as lost data rather than as a scale that was never banded.
     */
    hasLevels: boolean;
  }>;
  indicators: Array<{ name: string; label: string }>;
}

/** Empty vocabulary — a control test defines neither scales nor indicators. */
export const EMPTY_MEASURE_CATALOGUE: MeasureCatalogue = { scales: [], indicators: [] };

/**
 * Load a test's measurement vocabulary, in the AUTHOR's order (`sort_order`).
 *
 * The label is optional by design (`insertScaleSchema`), so an empty one falls back
 * to the key: a nameless column is worse than a technical name.
 */
export async function loadMeasureCatalogue(testId: string): Promise<MeasureCatalogue> {
  const [scaleRows, rvRows] = await Promise.all([
    storage.getScales(testId),
    storage.getResultVariables(testId),
  ]);
  const bySortOrder = <T extends { sortOrder?: number | null }>(a: T, b: T) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

  return {
    scales: [...scaleRows].sort(bySortOrder).map((s) => ({
      key: s.key,
      label: s.label || s.key,
      hasLevels: parseScaleInterpretation(s.configJson).bands.length > 0,
    })),
    indicators: [...rvRows].sort(bySortOrder).map((rv) => ({ name: rv.name, label: rv.label || rv.name })),
  };
}

/**
 * ONE indicator of ONE run, ready to print: the author's label, the value the run
 * produced, and what that value MEANS.
 *
 * The stored value is a code («kom») or a bare number — that is what a formula
 * addresses (PRD-2 §5), not what a person reads. The reading comes from the author's
 * interpretation: an outcome list for string/boolean indicators, bands for numeric
 * ones, resolved with the SAME `findOutcome`/`findBand` the learner's screen uses.
 * `null` = the author configured no interpretation, and the column stays honestly
 * empty rather than repeating the code.
 */
export interface IndicatorView {
  name: string;
  label: string;
  value: string | number | boolean | null;
  interpretation: string | null;
}

/**
 * Resolve a run's indicators against the test's interpretation config.
 *
 * @param rvRows The test's `result_variables` rows (author order).
 * @param values The attempt's stored `resultVariables`.
 */
export function buildIndicatorViews(
  rvRows: ReadonlyArray<{ name: string; label: string; sortOrder?: number | null; configJson?: unknown }>,
  values: Record<string, unknown> | undefined,
): IndicatorView[] {
  return [...rvRows]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((rv) => {
      const raw = values?.[rv.name];
      const value = raw === undefined || raw === "" ? null : (raw as string | number | boolean);
      const interpretation = parseIndicatorInterpretation(rv.configJson);
      // The LABEL, never the `text`. The text is the leaflet the author wrote for the
      // learner — on the reference questionnaire it runs to a page and a half, and it
      // turned one table cell into an essay that pushed every other row off screen.
      // A table cell answers «что это значит» in two words; the leaflet belongs to the
      // learner's results screen, where PRD-29 already prints it.
      // Outcome first for text, then a band for anything numeric — including a mask number that
      // an LMS export or a string-typed indicator carries as TEXT («9», PRD-53 §7.1).
      const outcome = typeof value === "number"
        ? null
        : matchOutcome(interpretation.outcomes, value as string | boolean | null);
      const numeric = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== "" ? Number(value.trim().replace(",", ".")) : NaN;
      const band = !outcome && Number.isFinite(numeric) ? findBand(interpretation.bands, numeric) : null;
      return {
        name: rv.name,
        label: rv.label || rv.name,
        value,
        interpretation: band ? band.label || band.level || null : outcome?.label || null,
      };
    });
}

/**
 * What a test's scales and indicators ARE — the interpretation configs a level is read from.
 *
 * Kept apart from {@link MeasureCatalogue} on purpose: the catalogue travels to the screen and
 * carries names only, while this one is server-side input for reading LMS runs (PRD-56 FR-21h).
 */
export interface MeasureDefinitions {
  scales: Array<{ key: string; configJson: unknown }>;
  indicators: Array<{ name: string; label: string; type: string; configJson: unknown; sortOrder?: number | null }>;
}

/** Load the scale and indicator definitions of a test. */
export async function loadMeasureDefinitions(testId: string): Promise<MeasureDefinitions> {
  const [scales, indicators] = await Promise.all([
    storage.getScales(testId),
    storage.getResultVariables(testId),
  ]);
  return { scales, indicators };
}

/**
 * The stored measurements of an LMS run in the SHAPE of a web result
 * (`scaleResults[key] = { raw, label }`, `resultVariables`).
 *
 * Telemetry and an imported export keep a flat «key -> number» map for scales and strings for
 * indicators (PRD-54). Bringing them into the web shape lets every per-run report read all three
 * sources through the same {@link measureCells} — so an LMS row stops printing the «неприменимо»
 * dash next to values that were reported all along. The scale level is read off the scale's own
 * bands: the import does not store a level label, and the analytics profile reads it the same
 * way (`scale-profile`). Nothing is recomputed from the answers (FR-21e).
 *
 * @param definitions the test's scales and indicators
 * @param stored the run's `scales_json` and `variables_json`
 */
export function lmsStoredResult(
  definitions: MeasureDefinitions,
  stored: { scalesJson: unknown; variablesJson: unknown } | undefined,
): { scaleResults: Record<string, { raw: number; label: string }>; resultVariables: Record<string, unknown> } {
  const scalesJson = (stored?.scalesJson ?? {}) as Record<string, unknown>;
  const scaleResults: Record<string, { raw: number; label: string }> = {};
  for (const scale of definitions.scales) {
    const raw = scalesJson[scale.key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(value)) continue;
    const band = findBand(parseScaleInterpretation(scale.configJson).bands, value);
    scaleResults[scale.key] = { raw: value, label: band ? band.label || band.level : "" };
  }
  return {
    scaleResults,
    resultVariables: indicatorValuesOf(
      definitions.indicators,
      stored?.variablesJson as Record<string, unknown> | null | undefined,
    ),
  };
}

/** Is there anything to report about this test's measurements at all? */
export function hasMeasures(catalogue: MeasureCatalogue): boolean {
  return catalogue.scales.length > 0 || catalogue.indicators.length > 0;
}

/**
 * The measurement COLUMNS a per-attempt report grows for this test: one per scale
 * (plus a level column where the scale is banded) and one per indicator.
 *
 * Wide, not long: an attempts sheet is read one row per run, and an analyst filters
 * and sorts by a scale the way they sort by a score. The long form only wins across
 * several tests at once, where the columns would differ per row.
 */
export function measureHeaders(catalogue: MeasureCatalogue): string[] {
  const headers: string[] = [];
  for (const s of catalogue.scales) {
    headers.push(s.label);
    if (s.hasLevels) headers.push(`${s.label}, уровень`);
  }
  for (const i of catalogue.indicators) headers.push(i.label);
  return headers;
}

/**
 * The measurement CELLS of one run, aligned with {@link measureHeaders}.
 *
 * Read off what was STORED at finish — the run's own record, not a replay against
 * today's configuration. A run that carries no measurements (finished before the test
 * had scales) fills the columns with the «неприменимо» dash rather than a zero, which
 * would be indistinguishable from a real score of nothing.
 */
export function measureCells(catalogue: MeasureCatalogue, result: unknown): Array<string | number> {
  const r = (result ?? {}) as {
    scaleResults?: Record<string, { raw?: number; label?: string; level?: string } | undefined>;
    resultVariables?: Record<string, unknown>;
  };
  const cells: Array<string | number> = [];

  for (const s of catalogue.scales) {
    const value = r.scaleResults?.[s.key];
    cells.push(typeof value?.raw === "number" ? value.raw : NOT_APPLICABLE);
    // The learner-facing LABEL of the band, falling back to its code: the code is what
    // a formula addresses, the label is what a person reads (PRD-45).
    if (s.hasLevels) cells.push(value?.label || value?.level || NOT_APPLICABLE);
  }

  for (const i of catalogue.indicators) {
    const value = r.resultVariables?.[i.name];
    cells.push(
      value === undefined || value === null || value === ""
        ? NOT_APPLICABLE
        : typeof value === "number" || typeof value === "string"
          ? value
          : String(value),
    );
  }

  return cells;
}

/**
 * How a single run should be REPORTED to the author (PRD-29 §6.7). TWO flags,
 * because the author's screen asks two questions the learner's screen asks as one:
 *
 *  - `scored` — are the POINTS and the percent of this run meaningful at all? Read
 *    off the run itself: a measurement question has no correct grading, so it brings
 *    no points and never can.
 *  - `verdictPronounced` — is «Сдан / Не сдан» meaningful? That one additionally
 *    needs a declared threshold: a verdict is a judgement, and nobody pronounced it
 *    when the author declared no threshold.
 *
 * The learner's results screen couples them (`hasGradedScore`) because its summary
 * shows the ring and the verdict as one block. Analytics must not: a test that
 * awards points under an explicit «no threshold» still produced real scores, and
 * hiding them from the analyst would lose data, not a lie.
 *
 * ADAPTIVE runs are exempt from both gates and keep exactly today's behaviour: their
 * verdict is pronounced by the confirmed LEVELS, not by points
 * (`buildAdaptiveResult`), and their stored result carries no `totalPossiblePoints`
 * at all — 49 of the 72 finished attempts in the reference database are of this
 * shape, and feeding the points gate with the absent field would silence every one
 * of them.
 *
 * @param result The attempt's stored result; `null` for a run still in progress.
 * @param thresholdDeclared Whether the TEST declares an overall threshold;
 *   `undefined` = unknown, which never silences the verdict.
 */
export function gradingOf(
  result: (Partial<AttemptResult> & { mode?: string }) | null | undefined,
  thresholdDeclared: boolean | undefined,
): { scored: boolean; verdictPronounced: boolean } {
  if (result?.mode === "adaptive") return { scored: true, verdictPronounced: true };
  const possiblePoints = result?.totalPossiblePoints ?? 0;
  return {
    scored: !nothingToGrade(possiblePoints),
    verdictPronounced: hasPronouncedVerdict(thresholdDeclared, possiblePoints),
  };
}

/**
 * Does the test declare an overall pass threshold at all (`type` other than `none`)?
 * The half of the PRD-29 §6.7 rule that belongs to the TEST.
 *
 * Answers `undefined` — «unknown», which never silences a verdict — when the row
 * carries no rule at all. The column is `NOT NULL`, so that cannot happen for a test
 * read whole from the database; it protects the case of a caller handing over a
 * partial test object, where quietly reporting «no threshold» would zero out the
 * pass rate of a perfectly graded test.
 */
export function declaresPassThreshold(test: { overallPassRuleJson?: unknown }): boolean | undefined {
  if (test.overallPassRuleJson === undefined || test.overallPassRuleJson === null) return undefined;
  return resolveOverallRule(test.overallPassRuleJson) !== null;
}

/**
 * Проходной балл теста В ПРОЦЕНТАХ — тем, кто рисует шкалу результата (PRD-56 FR-13a).
 *
 * `null` не только у теста без правила, но и у правила В БАЛЛАХ: сколько это процентов,
 * зависит от достижимых баллов прохождения, а они у разных вариантов выдачи разные. Нарисовать
 * такой порог одной вертикалью значило бы показать линию, которой ни для кого нет.
 */
export function thresholdPercentOfTest(test: { overallPassRuleJson?: unknown }): number | null {
  const rule = resolveOverallRule(test.overallPassRuleJson);
  return rule?.type === "percent" ? rule.value : null;
}

/**
 * PRD-5: how ONE answer moved the scales, as a report cell — «Целевой: +7; Командный: 0».
 *
 * Signed on purpose: a contribution is a movement, and an inverse-direction measurement
 * subtracts. Zero contributions are kept — under PRD-44 a zero is the learner's own
 * «рассмотрел и не дал веса», which is data, not silence.
 *
 * @param contribs Per-scale deltas from `computeAnswerContributions`.
 * @param labels Scale key -> human label (see {@link MeasureCatalogue}).
 */
export function formatContributions(
  contribs: ReadonlyArray<{ scaleKey: string; delta: number }>,
  labels: ReadonlyMap<string, string>,
): string {
  if (!contribs.length) return NOT_APPLICABLE;
  return contribs
    .map((c) => `${labels.get(c.scaleKey) ?? c.scaleKey}: ${c.delta > 0 ? "+" : ""}${c.delta}`)
    .join("; ");
}

/**
 * Форматирует тип вопроса для отображения
 */
export function formatQuestionType(type: string): string {
  const types: Record<string, string> = {
    single: "Один ответ",
    multiple: "Несколько ответов",
    matching: "Сопоставление",
    ranking: "Ранжирование",
    scale: "Шкала",
    allocation: "Распределение баллов",
    // PRD-57: текстовые типы. Сырое `short` в отчёте — это техническое имя там, где
    // читатель ждёт названия метода.
    short: "Короткий ответ",
    blanks: "Пропуски",
    long: "Развёрнутый ответ",
  };
  return types[type] || type;
}

/**
 * Форматирует все варианты ответа.
 *
 * @param correctJson эталон задания — нужен ТОЛЬКО текстовым типам: у пропусков перечень
 *   полей живёт в наборах правил, а не в содержимом (PRD-57 FR-24c).
 */
export function formatAllOptions(type: string, dataJson: any, correctJson?: unknown): string {
  // PRD-57: у текстовых типов вариантов не существует, и печатать здесь нечего, кроме
  // того, чем ограничено поле. Прочерк, а не пустая ячейка: пусто читается как «не
  // заполнено», прочерк — как «неприменимо».
  if (isTextEntry(type) || isOpenText(type) || hasBlanks(type)) {
    if (hasBlanks(type)) {
      const sets = ((correctJson ?? {}) as { blanks?: Array<{ id?: string }> }).blanks ?? [];
      return sets.length === 0 ? NOT_APPLICABLE : `Пропуски: ${sets.map((set) => set.id).join(", ")}`;
    }
    const limits: string[] = [];
    const unit = (correctJson as { unit?: string } | null)?.unit;
    if (typeof dataJson?.maxLength === "number") limits.push(`до ${dataJson.maxLength} символов`);
    if (isTextEntry(type) && typeof unit === "string" && unit.trim() !== "") limits.push(`единица: ${unit.trim()}`);
    return limits.length === 0 ? NOT_APPLICABLE : limits.join("; ");
  }
  if (!dataJson) return "";

  switch (type) {
    case "single":
    case "multiple":
    // Шкала хранит градации в том же списке options (PRD-26).
    case "scale":
      if (dataJson.options && Array.isArray(dataJson.options)) {
        return dataJson.options.map((opt: string, i: number) => `${i + 1}) ${opt}`).join("\n");
      }
      break;
    // PRD-44: утверждения распределения лежат в том же `options` (FR-02), но у типа
    // есть ещё и бюджет — без него список утверждений не читается: аналитик не знает,
    // из скольких баллов ученик выбирал. Без этой ветки колонка печатала сырой JSON.
    case "allocation":
      if (dataJson.options && Array.isArray(dataJson.options)) {
        const statements = dataJson.options.map((opt: string, i: number) => `${i + 1}) ${opt}`).join("\n");
        const budget = Number(dataJson.budget);
        return Number.isFinite(budget) ? `Бюджет: ${budget}\n${statements}` : statements;
      }
      break;
    case "matching":
      if (dataJson.left && dataJson.right) {
        const leftStr = dataJson.left.map((l: string, i: number) => `${i + 1}. ${l}`).join(", ");
        const rightStr = dataJson.right.map((r: string, i: number) => `${String.fromCharCode(65 + i)}. ${r}`).join(", ");
        return `Левая: ${leftStr}\nПравая: ${rightStr}`;
      }
      break;
    case "ranking":
      if (dataJson.items && Array.isArray(dataJson.items)) {
        return dataJson.items.map((item: string, i: number) => `${i + 1}) ${item}`).join("\n");
      }
      break;
  }
  return JSON.stringify(dataJson);
}

/**
 * Форматирует правильный ответ
 */
export function formatCorrectAnswerText(type: string, dataJson: any, correctJson: any): string {
  if (!correctJson) return "";

  // PRD-26 FR-08 / PRD-44 FR-09: у измерительного вопроса эталона НЕ СУЩЕСТВУЕТ.
  // Без этой проверки колонка печатала `{}` — `questions.correct_json` NOT NULL, так
  // что «измерительное» состояние это пустой объект, и он доезжал до `JSON.stringify`.
  // Прочерк — это ответ «эталона нет», а пустая ячейка читалась бы как «не заполнено».
  if (isMeasurementOnly({ type, correctJson })) return NOT_APPLICABLE;

  // PRD-57 FR-32: эталон текстового задания — НАБОР ПРАВИЛ, и читается он теми же
  // словами, какими автор видит его в ящике. Второй редакции формулировок на сервере не
  // заводится: она разошлась бы с первой молча.
  if (isTextEntry(type)) return describeRuleSet(correctJson as AnswerRuleSet);
  if (hasBlanks(type)) {
    const sets = ((correctJson ?? {}) as { blanks?: Array<AnswerRuleSet & { id: string }> }).blanks ?? [];
    return sets
      .map((set) => `${set.id}: ${describeRuleSet(set)}`)
      .join("; ");
  }

  switch (type) {
    case "single":
    // У измерительной шкалы correctIndex отсутствует — вернётся пустая строка.
    case "scale":
      if (correctJson.correctIndex !== undefined && dataJson?.options) {
        const idx = correctJson.correctIndex;
        return `${idx + 1}) ${dataJson.options[idx] || "?"}`;
      }
      break;
    case "multiple":
      if (correctJson.correctIndices && dataJson?.options) {
        return correctJson.correctIndices
          .map((idx: number) => `${idx + 1}) ${dataJson.options[idx] || "?"}`)
          .join(", ");
      }
      break;
    case "matching":
      if (correctJson.pairs && dataJson?.left && dataJson?.right) {
        return correctJson.pairs
          .map((p: any) => `${dataJson.left[p.left]} → ${dataJson.right[p.right]}`)
          .join(", ");
      }
      break;
    case "ranking":
      if (correctJson.correctOrder && dataJson?.items) {
        return correctJson.correctOrder
          .map((idx: number, pos: number) => `${pos + 1}. ${dataJson.items[idx] || "?"}`)
          .join(", ");
      }
      break;
  }
  return JSON.stringify(correctJson);
}

/**
 * Форматирует ответ пользователя
 */
export function formatUserAnswerText(type: string, dataJson: any, userAnswer: unknown): string {
  if (userAnswer === null || userAnswer === undefined) return "(нет ответа)";

  // PRD-57: написанный ответ печатается ровно так, как его набрали. У задания с
  // пропусками ответ — карта «поле → написанное»: без имён это был бы `[object Object]`,
  // а пустое поле должно быть видно, а не выпадать из строки.
  if (isTextEntry(type) || isOpenText(type)) return String(userAnswer);
  if (hasBlanks(type)) {
    const written = (userAnswer ?? {}) as Record<string, unknown>;
    const entries = Object.keys(written);
    if (entries.length === 0) return "(нет ответа)";
    return entries
      .map((id) => {
        const value = written[id];
        const text = typeof value === "string" ? value.trim() : "";
        return `${id}: ${text === "" ? "(нет ответа)" : text}`;
      })
      .join(", ");
  }

  switch (type) {
    case "single":
    case "scale":
      if (typeof userAnswer === "number" && dataJson?.options) {
        return `${userAnswer + 1}) ${dataJson.options[userAnswer] || "?"}`;
      }
      break;
    case "multiple":
      if (Array.isArray(userAnswer) && dataJson?.options) {
        if (userAnswer.length === 0) return "(ничего не выбрано)";
        return userAnswer
          .map((idx: number) => `${idx + 1}) ${dataJson.options[idx] || "?"}`)
          .join(", ");
      }
      break;
    // PRD-44: распределение показывается ПОЛНОСТЬЮ, вместе с нулями — ноль здесь
    // содержателен, он отличает «рассмотрел и не дал веса» от «не дошёл».
    case "allocation":
      if (typeof userAnswer === "object" && dataJson?.options) {
        const assigned = userAnswer as Record<string, number>;
        return (dataJson.options as string[])
          .map((label, i) => `${label}: ${Number(assigned[String(i)] ?? 0)}`)
          .join(", ");
      }
      break;
    case "matching":
      if (typeof userAnswer === "object" && dataJson?.left && dataJson?.right) {
        const pairs = userAnswer as Record<string, number>;
        return Object.entries(pairs)
          .map(([leftIdx, rightIdx]) => {
            const leftItem = dataJson.left[Number(leftIdx)] || "?";
            const rightItem = dataJson.right[rightIdx] || "?";
            return `${leftItem} → ${rightItem}`;
          })
          .join(", ");
      }
      break;
    case "ranking":
      if (Array.isArray(userAnswer) && dataJson?.items) {
        return userAnswer
          .map((idx: number, pos: number) => `${pos + 1}. ${dataJson.items[idx] || "?"}`)
          .join(", ");
      }
      break;
  }
  return String(userAnswer);
}
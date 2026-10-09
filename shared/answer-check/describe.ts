/**
 * @module shared/answer-check/describe
 *
 * A rule said in words (PRD-57 FR-28aa2): the operator gives the constructor its
 * compactness, the sentence below it gives the author something to proof-read — «от -27
 * до -23 °C» is checkable at a glance, `= -25 ± 2` has to be converted in the head first.
 *
 * Shared, but deliberately NOT re-exported from `shared/answer-check/index`: the wording is
 * written for the AUTHOR (the editor's rule list and probe, the analytics column and the
 * Excel report), the learner never sees it, and the index is what the SCORM runtime bundle
 * pulls in — text nobody in the package reads has no business travelling there.
 *
 * It lived in the editor until Э10, when the analytics export needed the same sentences: a
 * second edition of the same wording on the server would drift from this one silently.
 */
import type { AnswerRule, AnswerRuleSet, RuleSetOutcome } from "./rules";
import type { NumericOp, NumericRule } from "./number";

/** The operator list of the approved wireframe, in its order. */
export const NUMERIC_OPERATORS: Array<{ value: NumericOp; label: string }> = [
  { value: "eq", label: "равно" },
  { value: "ne", label: "не равно" },
  { value: "gt", label: "больше" },
  { value: "gte", label: "больше или равно" },
  { value: "lt", label: "меньше" },
  { value: "lte", label: "меньше или равно" },
];

/** Does this operator honour a tolerance? Only equality does (§6.6). */
export function hasTolerance(op: NumericOp): boolean {
  return op === "eq" || op === "ne";
}

/**
 * Print a number the way the author typed it, not the way JavaScript stores it.
 *
 * Six decimals is where a third (`0,333333`) still reads as a third and the floating-point
 * dust of `3,09` (which arrives as `3.0900000000000003`) is already gone.
 *
 * @param value Any finite number.
 * @returns The Russian spelling: a comma, no trailing zeros.
 */
export function formatRuleNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(6))).replace(".", ",");
}

/** Half-width of the window around the value; zero when the operator ignores a tolerance. */
function windowOf(rule: NumericRule): number {
  const tolerance = rule.tolerance;
  if (!tolerance || !hasTolerance(rule.op)) return 0;
  return tolerance.unit === "pct" ? (Math.abs(rule.value) * tolerance.value) / 100 : Math.abs(tolerance.value);
}

/** ` °C` — or nothing at all, so a rule without a unit does not end in a space. */
function suffix(unit: string): string {
  const trimmed = (unit ?? "").trim();
  return trimmed === "" ? "" : ` ${trimmed}`;
}

/** The word for the operator, as the select spells it. */
function operatorLabel(op: NumericOp): string {
  return NUMERIC_OPERATORS.find((item) => item.value === op)?.label ?? "равно";
}

/**
 * Title of a COLLAPSED rule row — what this rule checks, in one line (FR-28b).
 *
 * @param rule The numeric rule.
 * @param unit Display unit of the answer, `""` when the question has none.
 */
export function numericRuleTitle(rule: NumericRule, unit: string): string {
  const head = `${operatorLabel(rule.op)} ${formatRuleNumber(rule.value)}${suffix(unit)}`;
  if (!rule.tolerance || !hasTolerance(rule.op)) return head;
  const measure = rule.tolerance.unit === "pct" ? " %" : "";
  return `${head} ±${formatRuleNumber(rule.tolerance.value)}${measure}`;
}

/** Title of a rule of EITHER kind — what the collapsed row shows (FR-28b). */
export function ruleTitleOf(rule: AnswerRule, unit: string): string {
  if (rule.kind === "number") return numericRuleTitle(rule, unit);
  return rule.value.trim() === "" ? "Правило не заполнено" : rule.value;
}

/** Always the last sentence of a probe explanation — the promise of FR-28h. */
const PROBE_DISCLAIMER = "Проба не сохраняется и на статистику не влияет.";

/**
 * The probe's verdict in plain words (FR-28g).
 *
 * The sentence names a RULE rather than repeating the verdict tag beside the field: the
 * tag already says whether the answer counts, and what the author is checking is WHICH
 * rule did the counting — two similar rules that both fire look identical until one of
 * them is the only one firing.
 *
 * @param set     The rules as they will be saved.
 * @param outcome Result of {@link checkRuleSet} for the probed answer.
 */
export function describeProbe(set: AnswerRuleSet, outcome: RuleSetOutcome): string {
  const unit = typeof set.unit === "string" ? set.unit : "";
  const titleAt = (index: number) => ruleTitleOf(set.rules[index], unit);

  // Правило, которое замер назвал долгим, проба не запускает: иначе она подвесила бы
  // ящик ровно на то время, о котором предупреждение и говорит (Э7).
  if (outcome.pending) {
    return `Выражение считается слишком долго, поэтому проба его не запускала. ${PROBE_DISCLAIMER}`;
  }

  if (outcome.passed) {
    if (set.join === "all") return `Выполнены все правила. ${PROBE_DISCLAIMER}`;
    const fired = outcome.perRule.findIndex(Boolean);
    return fired < 0
      ? `Ответ засчитан. ${PROBE_DISCLAIMER}`
      : `Выполнено правило «${titleAt(fired)}». ${PROBE_DISCLAIMER}`;
  }

  if (set.join === "all") {
    const missed = outcome.perRule.findIndex((hit) => !hit);
    return missed < 0
      ? `Ответ не засчитан. ${PROBE_DISCLAIMER}`
      : `Не выполнено правило «${titleAt(missed)}», а ответ засчитывается, если выполнены все. ${PROBE_DISCLAIMER}`;
  }
  return (
    `Не выполнено ни одно правило, а ответ засчитывается, если выполнено любое из них. ${PROBE_DISCLAIMER}`
  );
}

/**
 * The rule in plain words, shown under the condition (FR-28aa2).
 *
 * A tolerance is always spelled out as BOUNDARIES: «± 2 %» still leaves the author
 * counting, and counting is exactly what the sentence is here to spare them.
 *
 * @param rule The numeric rule.
 * @param unit Display unit of the answer, `""` when the question has none.
 */
export function describeNumericRule(rule: NumericRule, unit: string): string {
  const tail = suffix(unit);
  const value = formatRuleNumber(rule.value);
  const window = windowOf(rule);
  const low = formatRuleNumber(rule.value - window);
  const high = formatRuleNumber(rule.value + window);

  switch (rule.op) {
    case "ne":
      return window === 0
        ? `Засчитывается любой ответ, кроме ${value}${tail}`
        : `Засчитывается любой ответ, кроме значений от ${low} до ${high}${tail}`;
    case "gt":
      return `Засчитывается ответ больше ${value}${tail}`;
    case "gte":
      return `Засчитывается ответ не меньше ${value}${tail}`;
    case "lt":
      return `Засчитывается ответ меньше ${value}${tail}`;
    case "lte":
      return `Засчитывается ответ не больше ${value}${tail}`;
    case "eq":
    default:
      return window === 0
        ? `Засчитывается ответ ровно ${value}${tail}`
        : `Засчитывается ответ от ${low} до ${high}${tail}`;
  }
}

/**
 * Один набор правил ОДНОЙ строкой — для колонки отчёта и для карточки аналитики.
 *
 * Читается теми же словами, какими автор видит правило в ящике: выгрузка, которая
 * пересказала бы эталон по-своему, рано или поздно разошлась бы с экраном, и спорить
 * пришлось бы уже о том, какая формулировка верна.
 *
 * @param set Набор правил задания или пропуска.
 * @returns Правила, соединённые связкой набора; пустая строка, если правил нет вовсе.
 */
export function describeRuleSet(set: AnswerRuleSet | null | undefined): string {
  const rules = Array.isArray(set?.rules) ? set.rules : [];
  if (rules.length === 0) return "";
  const unit = typeof set?.unit === "string" ? set.unit : "";
  const words = rules.map((rule) => {
    if (rule.kind === "number") return describeNumericRule(rule, unit);
    if (rule.match === "regex") return `Засчитывается ответ по выражению «${rule.value}»`;
    return `Засчитывается ответ «${rule.value}»`;
  });
  // Связка называется словом, а не знаком: «и» против «либо» — это и есть разница между
  // «нужно выполнить всё» и «достаточно одного», и читатель отчёта не обязан её помнить.
  return words.join(set?.join === "all" ? "; и " : "; либо ");
}

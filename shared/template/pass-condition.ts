/**
 * @module shared/template/pass-condition
 * @description The learner-facing wording of a test's PASS CONDITION, built in ONE place for
 * both hosts (the web run and the SCORM package) and every design template.
 *
 * Two screens state the condition before the learner has answered anything:
 *
 * - the cover (`course.passCondition`) — how many topics must be passed, when the
 *   «Тест пройден, если» policy makes the topics decide;
 * - the section intro (`sectionIntro.passCondition` / `isRequired` / `timerWarning`) — the
 *   threshold of THIS topic, whether the topic is one the verdict depends on, and the
 *   warning that the section countdown starts on «Далее».
 *
 * The rules mirror {@link module:shared/scoring/aggregate}.aggregateStandardResult, which is
 * what actually pronounces the verdict: a topic is GATED when its resolved rule is not null,
 * an absent `required` flag means required, and a `count` rule compares Σ earned points.
 * A screen that promised a condition the grader does not apply would be worse than none.
 *
 * Pure — no DOM, no Node; bundled into the package through `TBTemplate`.
 */

import { resolveOverallRule, resolveTopicRule, type ResolvedRule } from "../scoring/pass-rule";
import { formatMinutesHuman } from "./duration";

/** A section as the cover needs it: whether the verdict may depend on it, and its rule. */
export interface PassConditionSection {
  /** `test_sections.required`; absent — required (the DB default). */
  required?: boolean | null;
  /** `test_sections.topic_pass_rule_json`, as authored. */
  topicPassRule?: unknown;
}

/** `course.passCondition`: the topic part of the pass condition shown on the cover. */
export interface CtxCoursePassCondition {
  /** How many topics must be passed. */
  count: number;
  /** Out of how many — equal to `count`: every topic of the kind must be passed. */
  total: number;
  /** `required` — the required topics; `all` — every gated topic. */
  kind: "required" | "all";
  /** The tile number, «8 из 8». */
  countLabel: string;
  /** The tile caption, «обязательных тем для прохождения» / «тем для прохождения». */
  label: string;
}

/**
 * Whether a topic carries a gate at all, before the variant is known. A `by_variant` rule
 * gates by the delivered variant's threshold, which the cover cannot know yet, but it gates.
 */
function isGated(raw: unknown, overall: ResolvedRule | null): boolean {
  if (raw && typeof raw === "object" && (raw as { source?: string }).source === "by_variant") return true;
  return resolveTopicRule(raw, overall) !== null;
}

/**
 * The topic part of the pass condition for the cover, or `null` when the topics do not
 * decide the outcome: under «Только общий результат», for a test that predates the
 * policy, and when no topic of the kind carries a gate.
 *
 * @param policy `tests.pass_decision_policy`.
 * @param overallPassRule `tests.overall_pass_rule_json` — an `inherit_overall` topic
 *   gates only when the test has an overall rule.
 * @param sections The test's sections.
 */
export function buildCoursePassCondition(
  policy: string | null | undefined,
  overallPassRule: unknown,
  sections: PassConditionSection[] | null | undefined,
): CtxCoursePassCondition | null {
  const requiredOnly = policy === "overall_and_required_topics" || policy === "required_topics_only";
  if (!requiredOnly && policy !== "all_topics_passed") return null;
  const overall = resolveOverallRule(overallPassRule);
  const count = (sections ?? []).filter(
    (s) => (!requiredOnly || s.required !== false) && isGated(s.topicPassRule, overall),
  ).length;
  if (count === 0) return null;
  return {
    count,
    total: count,
    kind: requiredOnly ? "required" : "all",
    countLabel: count + " из " + count,
    label: requiredOnly ? "обязательных тем для прохождения" : "тем для прохождения",
  };
}

/** A number of points the way the results screen prints it: at most one decimal, comma. */
function formatPoints(n: number): string {
  const r = Math.round(n * 10) / 10;
  return String(r).replace(".", ",");
}

/** «балл» / «балла» / «баллов» for a number of points (a fraction takes «балла»). */
function pluralPoints(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (!Number.isInteger(r)) return "балла";
  const abs = Math.abs(r) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return "баллов";
  if (d === 1) return "балл";
  if (d > 1 && d < 5) return "балла";
  return "баллов";
}

/**
 * «Для прохождения: 70 %» / «Для прохождения: 7 баллов из 10» — the threshold of one topic.
 * Empty string when the topic is not gated, or when it has nothing to grade (the grader
 * leaves such a topic without a verdict, so there is no threshold to meet).
 *
 * @param rule The topic rule, resolved against the overall one and the DELIVERED variant.
 * @param possiblePoints Σ prices of the delivered graded questions; `null`/absent — unknown,
 *   and a `count` rule is then stated without the «из M» part.
 */
export function sectionPassConditionText(
  rule: ResolvedRule | null | undefined,
  possiblePoints?: number | null,
): string {
  if (!rule) return "";
  const known = typeof possiblePoints === "number" && Number.isFinite(possiblePoints);
  if (known && Math.round((possiblePoints as number) * 10) / 10 <= 0) return "";
  if (rule.type === "percent") return "Для прохождения: " + formatPoints(rule.value) + " %";
  const head = "Для прохождения: " + formatPoints(rule.value) + " " + pluralPoints(rule.value);
  return known ? head + " из " + formatPoints(possiblePoints as number) : head;
}

/**
 * Whether the section intro marks the topic «Обязательная тема»: only where the obligation
 * changes the verdict («Общий результат и обязательные темы», «Все обязательные темы») and
 * only for a topic that has a threshold to meet — a required topic without a gate passes
 * by itself, and the mark would name a condition that does not exist.
 */
export function sectionIsRequiredForVerdict(
  policy: string | null | undefined,
  required: boolean | null | undefined,
  rule: ResolvedRule | null | undefined,
): boolean {
  const requiredMatters = policy === "overall_and_required_topics" || policy === "required_topics_only";
  return requiredMatters && required !== false && !!rule;
}

/**
 * The system warning of the section intro when the section has its own time limit: the
 * countdown starts on the continue button, and it cannot be paused. Empty string without
 * a limit. The button caption is quoted as the screen shows it.
 */
export function sectionTimerWarningText(
  timeLimitMinutes: number | null | undefined,
  continueLabel: string,
): string {
  if (!(typeof timeLimitMinutes === "number" && timeLimitMinutes > 0)) return "";
  return (
    "После нажатия кнопки «" + continueLabel + "» начнётся отсчёт времени раздела — " +
    formatMinutesHuman(timeLimitMinutes) + ". Поставить тест на паузу будет нельзя."
  );
}

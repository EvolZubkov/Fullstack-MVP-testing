/**
 * @module shared/template/start-facts
 * @description Which facts of the START screen («вопросов», «проходной балл», «на
 * прохождение», «попыток») the author has hidden — the ONE rule both hosts and both editor
 * previews follow.
 *
 * Every fact is a switch of the start page itself (`settings[]` of the start variant,
 * `boolean`, default `true`), so a customer who asks to drop one of them gets it from the
 * page, not from a template of its own. Hiding works on the DATA: the builder drops the
 * fact from `course.*`, and every layout already gates its tile on the field
 * (`{{#if course.questionCount}}` …), so no layout of any template has to change — the
 * same route contract 3.15.0 took for `passConditionShown` of the section intro.
 *
 * A switch counts only when the page's variant DECLARES it: a value saved under another
 * variant must not hide a tile the author has no switch to bring back.
 *
 * Pure — no DOM, no Node; bundled into the package through `TBTemplate`.
 */

import type { CtxCourse } from "./context";
import type { StartVariantDecl } from "./start-image";

/** A fact of the start screen that the author may hide. */
export type StartFact = "questionCount" | "passCondition" | "timeLimit" | "maxAttempts";

/**
 * The page property that shows each fact. `passConditionShown` is the key the section
 * intro uses for the same thing — «Показывать условие прохождения».
 */
export const START_FACT_SETTING_KEYS: Readonly<Record<StartFact, string>> = {
  questionCount: "questionCountShown",
  passCondition: "passConditionShown",
  timeLimit: "timeLimitShown",
  maxAttempts: "maxAttemptsShown",
};

/**
 * The facts this start page hides: the variant declares the switch AND the page stores
 * `false` for it. An unset value is the manifest's default, which is «shown».
 *
 * @param variant The start variant of the page, as the manifest declares it. Absent —
 *   nothing is hidden.
 * @param pageSettings `content_pages.settings_json` of the start page (the package
 *   carries it as `contentPages[].settings`).
 */
export function hiddenStartFacts(
  variant: StartVariantDecl | null | undefined,
  pageSettings: Record<string, unknown> | null | undefined,
): StartFact[] {
  const list = variant?.settings;
  const declared = new Set(
    (Array.isArray(list) ? list : [])
      .filter((s) => s?.type === "boolean")
      .map((s) => s?.key),
  );
  const settings = pageSettings ?? {};
  return (Object.keys(START_FACT_SETTING_KEYS) as StartFact[]).filter((fact) => {
    const key = START_FACT_SETTING_KEYS[fact];
    return declared.has(key) && settings[key] === false;
  });
}

/**
 * The cover's `course` without the hidden facts. The pass condition goes as a whole —
 * the percent, the points and the topic tile — because each states the same thing in
 * its own unit. Only the TILES go: the subtitle «Попытка N из M», the threshold and the
 * verdict do not depend on the switches.
 *
 * @param course The course built by {@link module:shared/template/start-state}.
 * @param hidden The facts to drop; absent or empty — the course is returned as is.
 */
export function hideStartFacts(course: CtxCourse, hidden: readonly StartFact[] | null | undefined): CtxCourse {
  if (!hidden || hidden.length === 0) return course;
  const out: CtxCourse = { ...course };
  if (hidden.includes("questionCount")) delete out.questionCount;
  if (hidden.includes("passCondition")) {
    out.passPercent = null;
    delete out.passPoints;
    delete out.passCondition;
  }
  if (hidden.includes("timeLimit")) {
    out.timeLimitMinutes = null;
    out.timeLimitLabel = "";
  }
  if (hidden.includes("maxAttempts")) out.maxAttempts = null;
  return out;
}

/**
 * A ready start render context with the hidden facts dropped from its `course` — for the
 * editor previews, which take the start context from the template's demo builder rather
 * than from {@link module:shared/template/start-state} with the page at hand.
 *
 * @param context The start render context; anything without a `course` object is
 *   returned as is.
 * @param hidden The facts to drop.
 */
export function hideStartFactsInContext(context: unknown, hidden: readonly StartFact[]): unknown {
  if (!hidden.length || !context || typeof context !== "object") return context;
  const course = (context as { course?: unknown }).course;
  if (!course || typeof course !== "object") return context;
  return { ...(context as object), course: hideStartFacts(course as CtxCourse, hidden) };
}

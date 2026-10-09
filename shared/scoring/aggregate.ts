/**
 * @module shared/scoring/aggregate
 * @description THE single standard result-aggregation algorithm (PRD-18). ONE
 * implementation consumed by BOTH the web grader (`server/routes/attempts.ts`) and
 * the SCORM package runtime (`resultsPage.js calculateResults`, via the `TBTemplate`
 * IIFE bundle). Per-question scoring delegates to {@link scoreAnswer}; pass-rule
 * resolution/eval to `./pass-rule`. The function is PURE and ROUNDING-FREE — each
 * host rounds only at render / LMS emission. Adaptive aggregation (level coverage)
 * is a separate engine.
 *
 * Behaviour (faithful to the prior SCORM `calculateResults`, with the pass-rule
 * bug fixed): per-question `ratio = scoreAnswer(...).ratio` (0 for unanswered);
 * `earned += points*ratio`, `possible += points`, `correct++` only on `ratio===1`
 * (partial credit does NOT count as correct); per-topic + overall percent are
 * points-based; the final verdict combines the overall rule with the topic gates
 * per the authored `passDecisionPolicy` (see {@link decideVerdict}) — data written
 * before that policy existed keeps the old `overallPassed && every gated topic`.
 * The TOPIC verdict is decided in a SECOND pass, after the breakdown records exist
 * (FR-16). It is the section's OWN rule and nothing else: a key threshold no longer
 * participates (решение владельца 2026-09-03 — подтема ГОВОРИТ о результате, но не
 * судит его). The first pass still computes every value it always did — `percent`,
 * `earnedPoints`, `resolvedPassRule` — and the second one only reads them.
 *
 * PRD-50: this module is also the ONLY entry point into `shared/breakdown/` — every
 * delivered, graded question is fed to {@link computeBreakdowns} here, so the
 * per-topic (`AggregateTopicResult.breakdown`) and per-test (`AggregateResult.breakdowns`)
 * records are computed once, in this one place, for both hosts. They are purely
 * additive: absent `axisKeys` never affects `earned`/`possible`/the verdict above.
 * The adaptive mode reaches the same engine through {@link adaptiveResultAsStandard},
 * which takes the delivered items from its host (FR-17) — the ladder result alone does
 * not know which questions were asked.
 *
 * PRD-50 Э3 adds the group counters (FR-24 - FR-27): the sections' verdicts are folded per
 * group into «пройдено N из M» by `./section-groups`, LAST — after the second pass, so the
 * counter counts the verdict the key thresholds could still have flipped. Absent groups
 * leave both the topic results and the result itself byte-identical.
 */
import { scoreAnswer, type Answer, type CorrectData, type QuestionType } from "./engine";
import type { QuestionScoring } from "../schema";
import { checkRuleSet, type AnswerRuleSet, type RuleVerdicts } from "../answer-check/rules";
import { isMeasurementOnly, isOpenText, isTextEntry } from "../questions/question-type";
import {
  resolveOverallRule,
  resolveTopicRule,
  checkPassRule,
  resolvePassDecisionPolicy,
  type PassDecisionPolicy,
  type ResolvedRule,
} from "./pass-rule";
import { computeBreakdowns, sectionScope, TEST_SCOPE } from "../breakdown/compute";
import { applyBreakdownGate, thresholdPercentOf } from "../breakdown/gate";
import type { BreakdownEntry, BreakdownItem } from "../breakdown/types";
import { groupSections } from "./section-groups";

export interface AggregateQuestion {
  /**
   * PRD-57 (#43): идентификатор вопроса. Нужен, чтобы результат нёс исход КАЖДОГО ответа
   * — иначе аналитика вынуждена пересчитывать верность заново, по живым вопросам, и
   * расходится с вердиктом самой попытки.
   */
  id?: string;
  type: QuestionType;
  correct: CorrectData;
  scoring?: QuestionScoring | null;
  /** Effective per-question points (resolved by the caller / baked into TEST_DATA). */
  points: number;
  answer: Answer;
  /**
   * PRD-50 FR-15: keys of this question per breakdown axis, e.g. `{ tag: [...] }`.
   * Absent = the question groups into no breakdown; the verdict is unaffected.
   */
  axisKeys?: Record<string, string[]> | null;
  /**
   * PRD-57 Э7 (FR-28q): verdicts of the expression rules, computed by whoever owns a
   * killable executor. A `"budget"` entry that nothing else settles makes the answer
   * UNCHECKED, and an unchecked answer is graded like a measurement one — see the loop.
   */
  ruleVerdicts?: RuleVerdicts;
}

export interface AggregateSection<E = unknown> {
  topicId: string;
  topicName: string;
  /** Stored topic pass rule (any authored shape — resolved here). */
  topicPassRule: unknown;
  /**
   * PRD-24: stable `formId` of the PRD-17 variant delivered for this topic in this
   * attempt. Feeds the `by_variant` rule so the topic is gated by ITS variant's
   * threshold. Absent/null (non-variant topic, legacy attempt, SCORM state without
   * the pin) → the rule degrades to the overall one.
   */
  formId?: string | null;
  /**
   * `test_sections.required` — whether the topic is an obligatory gate. Only the
   * `*_required_topics*` policies read it. Absent (legacy attempt / legacy SCORM
   * state) counts as REQUIRED, matching the DB default.
   */
  required?: boolean;
  /**
   * PRD-50 FR-11: `test_sections.group_key` — the group this section belongs to. Absent /
   * null / a key the test does not declare all mean the same thing: no group (FR-12).
   */
  groupKey?: string | null;
  questions: AggregateQuestion[];
  /** Host-specific passthrough echoed verbatim into the topic result (feedback/recommendations). */
  extra?: E;
}

export interface AggregateInput<E = unknown> {
  sections: AggregateSection<E>[];
  overallPassRule: unknown;
  /**
   * Stored `tests.pass_decision_policy` (any shape — normalised here). Decides HOW
   * the overall rule and the topic gates combine; see {@link PassDecisionPolicy}.
   * Absent/unrecognised keeps the pre-policy verdict (see {@link resolvePassDecisionPolicy}).
   */
  passDecisionPolicy?: unknown;
  /**
   * PRD-50 FR-53: `tests.breakdown_gate_enabled` — учитывать ли подтемы в вердикте темы.
   * Отсутствие = ВЫКЛЮЧЕНО, и это ровно поведение до §16: попытка по старому снимку или
   * пакету, собранному раньше, судится как судилась.
   */
  breakdownGateEnabled?: boolean;
  /**
   * PRD-50 FR-11: the test's declared groups (`tests.section_groups_json`), any shape —
   * normalised here like `topicPassRule`. Absent = no groups, and the result keeps exactly
   * the shape it had before this PRD (FR-27, решение 6).
   */
  sectionGroups?: unknown;
}

export interface AggregateTopicResult<E = unknown> {
  topicId: string;
  topicName: string;
  correct: number;
  total: number;
  earnedPoints: number;
  possiblePoints: number;
  percent: number;
  passed: boolean | null;
  passRule: unknown;
  /**
   * PRD-24: the rule that ACTUALLY gated this topic, after resolution — i.e. the
   * delivered variant's threshold for `by_variant`, the overall rule for
   * `inherit_overall`, `null` when the topic is ungated. `passRule` above stays the
   * raw authored shape; hosts render the «Требуется…» label from THIS field, which
   * also survives being persisted with the attempt.
   */
  resolvedPassRule: ResolvedRule | null;
  /** PRD-50: breakdown records in THIS section's scope (empty when nothing is keyed). */
  breakdown: BreakdownEntry[];
  /**
   * PRD-50 FR-11: the group this section was delivered in. Set ONLY when the section
   * carried a key, so a test without groups stores the very same result JSON it always
   * did — and an attempt keeps the membership it was graded under even if the author
   * regroups the test afterwards.
   */
  groupKey?: string;
  extra?: E;
}

export interface AggregateResult<E = unknown> {
  correct: number;
  /** Questions that took part in grading — measurement-only ones are not counted. */
  totalQuestions: number;
  /**
   * PRD-26 FR-09: the same count, exposed under its own name so a host can tell
   * «nothing was graded» (a pure opinion inventory) from «everything was answered
   * wrong». Zero means the run has no percent and no verdict to show.
   */
  scoredQuestions: number;
  earnedPoints: number;
  possiblePoints: number;
  percent: number;
  /** Overall rule only (before topic gating). */
  overallPassed: boolean;
  /** Final: overall rule AND every gated topic. */
  passed: boolean;
  topicResults: AggregateTopicResult<E>[];
  /** PRD-50: breakdown records in the TEST scope (empty when nothing is keyed). */
  breakdowns: BreakdownEntry[];
  /**
   * PRD-50 FR-24 - FR-26: the test's groups that actually hold a section, in author order,
   * each with the counter of the counters («пройдено N из M»). ABSENT — not empty — when
   * the test declares no groups or none of them is referenced: a test built before this
   * stage must produce the byte-identical result it always did (решение 6).
   */
  sectionGroups?: AggregateSectionGroup[];
  /**
   * PRD-57 (#43): исход каждого ответа в порядке выдачи.
   *
   * НЕОБЯЗАТЕЛЬНОЕ: у попытки, завершённой до этой работы, списка нет, и читатель обязан
   * это различать — считать на месте, но по СНИМКУ попытки, а не по живому вопросу.
   * Отсутствие ключа и пустой список — разные вещи: второй означает «вопросов не было».
   */
  questionOutcomes?: QuestionOutcome[];
  /**
   * PRD-57 FR-36: оценка завершена — или результат ПРЕДВАРИТЕЛЬНЫЙ.
   *
   * Предварительна попытка, где хотя бы один ответ ждёт проверки (развёрнутый ответ;
   * ответ, чьё выражение не уложилось в бюджет). Сегодня, пока проверки нет, признак
   * только вычисляется — но существовать он обязан с первого дня: добавить его позже
   * значит пересчитать уже собранные результаты и перевыпустить пакеты.
   */
  gradingComplete: boolean;
}

/**
 * Исход ОДНОГО ответа — то, что аналитика и выгрузка сегодня пересчитывают заново.
 *
 * Состояний три, как у телеметрии (PRD-54): измерительный ответ не может быть ни верным,
 * ни неверным, и называть его «неверно» значит показать ошибку там, где ошибиться не во
 * что. Частичная правота живёт не в исходе, а в `earned`: исход двузначен, цена числовая.
 */
export interface QuestionOutcome {
  questionId: string;
  /**
   * PRD-57 FR-35: состояний ЧЕТЫРЕ, и третье с четвёртым различаются по существу.
   * `neutral` — «не требует оценки» (измерительный ответ, задание без правил);
   * `pending` — «ждёт проверки» (развёрнутый ответ; ответ, чьё выражение не уложилось в
   * бюджет). Булево «оценено или нет» этого различия не несёт, а на нём стоит аналитика.
   */
  result: "correct" | "incorrect" | "neutral" | "pending";
  earned: number;
  possible: number;
}

/**
 * One printable group of sections in the aggregated result (PRD-50 FR-26).
 *
 * It carries topic IDs and not the topic results themselves: the result is stored in
 * `attempts.result_json`, and repeating whole topic objects inside the groups would store
 * every number twice and let the two copies disagree. The render context joins them back
 * by ID (`shared/template/result-context`).
 */
export interface AggregateSectionGroup {
  key: string;
  label: string;
  /** `topicId` of every section of this group, in delivery order. */
  topicIds: string[];
  /** Sections of the group with a PASSED verdict. */
  passedCount: number;
  /** Sections with ANY pronounced verdict — a section without one is not counted (FR-26). */
  totalCount: number;
}

/**
 * Ответ, который НЕ УДАЛОСЬ проверить: правило-выражение вышло за бюджет, и остальные
 * правила исход не сняли (PRD-57 FR-28r).
 *
 * Считается тем же `checkRuleSet`, что и оценка, — чтобы «непроверено» и «неверно» не
 * разошлись между этой проверкой и движком.
 */
function isUnchecked(q: AggregateQuestion): boolean {
  if (!q.ruleVerdicts || !isTextEntry(q.type) || typeof q.answer !== "string") return false;
  return checkRuleSet(q.correct as unknown as AnswerRuleSet, q.answer, q.ruleVerdicts).pending === true;
}

export function aggregateStandardResult<E = unknown>(input: AggregateInput<E>): AggregateResult<E> {
  const overall = resolveOverallRule(input.overallPassRule);
  let tEarned = 0;
  let tPossible = 0;
  let tCorrect = 0;
  let tQuestions = 0;
  let tScored = 0;
  let allTopicsPassed = true;
  let requiredTopicsPassed = true;
  const policy = resolvePassDecisionPolicy(input.passDecisionPolicy);
  const breakdownItems: BreakdownItem[] = [];
  /**
   * Per-section inputs the SECOND pass needs, positionally aligned with `topicResults`.
   * The verdict cannot be decided in the first pass any more: FR-16 puts the breakdown
   * records BEFORE the topic verdict, and those records exist only once every section has
   * contributed its delivered items.
   */
  const gates: Array<{
    rule: ResolvedRule | null;
    scored: number;
    required: boolean;
  }> = [];

  // PRD-57 (#43): исходы собираются В ТОМ ЖЕ проходе, где считаются баллы. Второй проход
  // по ответам разошёлся бы с первым на первой же правке правил оценки.
  const questionOutcomes: QuestionOutcome[] = [];

  const topicResults: AggregateTopicResult<E>[] = input.sections.map((sec) => {
    let earned = 0;
    let possible = 0;
    let correct = 0;
    let scored = 0;
    for (const q of sec.questions) {
      // PRD-26 FR-08: a measurement-only question (a scale whose author set no correct
      // graduation) is not graded at all. It adds nothing to earned, nothing to
      // possible, and is not counted among the questions — otherwise a 22-item survey
      // would read as «0 из 22 верно» and drag the percent of a mixed test to zero.
      // Its result is the contribution it makes to the PRD-5 scales, computed
      // elsewhere.
      // PRD-57 FR-28r: ответ, который НЕКОМУ было проверить — авторское выражение не
      // уложилось в бюджет, — идёт той же дорогой, что и неоцениваемый. Он не верный и
      // не неверный: его не проверяли. Наказывать участника за ошибку автора запрещено.
      if (isMeasurementOnly(q) || isUnchecked(q)) {
        // Нейтральный исход, а не пропуск: «не оценивается» — это факт об ответе, и
        // аналитике он нужен ровно так же, как «верно» и «неверно».
        //
        // PRD-57 FR-35: «ждёт проверки» и «не требует оценки» — РАЗНЫЕ состояния, и
        // различие не косметическое: на нём стоит вся аналитика открытых ответов.
        const waiting = isOpenText(q.type) || isUnchecked(q);
        if (q.id) {
          questionOutcomes.push({
            questionId: q.id,
            result: waiting ? "pending" : "neutral",
            earned: 0,
            possible: 0,
          });
        }
        continue;
      }
      scored++;
      const ratio =
        q.answer === undefined || q.answer === null
          ? 0
          : scoreAnswer({
            type: q.type,
            correct: q.correct || {},
            answer: q.answer,
            scoring: q.scoring,
            verdicts: q.ruleVerdicts,
          }).ratio;
      const questionEarned = q.points * ratio;
      const answered = q.answer !== undefined && q.answer !== null;
      possible += q.points;
      earned += questionEarned;
      breakdownItems.push({
        sectionId: sec.topicId,
        axisKeys: q.axisKeys ?? null,
        earned: questionEarned,
        possible: q.points,
        answered,
      });
      if (ratio === 1) correct++;
      if (q.id) {
        questionOutcomes.push({
          questionId: q.id,
          result: ratio === 1 ? "correct" : "incorrect",
          earned: questionEarned,
          possible: q.points,
        });
      }
    }
    const total = scored;
    const percent = possible > 0 ? (earned / possible) * 100 : 0;
    const resolved = resolveTopicRule(sec.topicPassRule, overall, { formId: sec.formId ?? null });
    gates.push({
      rule: resolved,
      scored,
      // FR: absent flag = required (DB default `test_sections.required = true`).
      required: sec.required !== false,
    });

    tEarned += earned;
    tPossible += possible;
    tCorrect += correct;
    tQuestions += total;
    tScored += scored;

    return {
      topicId: sec.topicId,
      topicName: sec.topicName,
      correct,
      total,
      earnedPoints: earned,
      possiblePoints: possible,
      percent,
      // Filled by the second pass below (FR-16): the key gate needs this topic's records.
      passed: null,
      passRule: sec.topicPassRule,
      resolvedPassRule: resolved,
      breakdown: [],
      // Only when the section actually declares one — see `AggregateTopicResult.groupKey`.
      ...(sec.groupKey ? { groupKey: sec.groupKey } : {}),
      extra: sec.extra,
    };
  });

  // ONE pass over the delivered items, then split by scope: the test-scope records are
  // NOT a sum of the section ones (FR-04). Group once instead of filtering the whole
  // array per topic — this runs on every attempt finish, on both hosts.
  const entries = computeBreakdowns(breakdownItems);
  const bySection = new Map<string, BreakdownEntry[]>();
  for (const e of entries) {
    const list = bySection.get(e.scope);
    if (list) list.push(e);
    else bySection.set(e.scope, [e]);
  }
  // FR-16, шаги 2 и 3: сперва записи в области раздела, ПОТОМ вердикт темы, который на них
  // опирается. Накопители `allTopicsPassed`/`requiredTopicsPassed` — конъюнкции, поэтому
  // перенос их сложения в этот проход не может изменить ни один существующий вердикт.
  const gateOn = input.breakdownGateEnabled === true;
  for (let i = 0; i < topicResults.length; i++) {
    const topic = topicResults[i];
    const gate = gates[i];
    topic.breakdown = bySection.get(sectionScope(topic.topicId)) ?? [];
    // FR-52: порог подтем — разрешённое правило ТЕМЫ. Правила нет («Не проверять отдельно»
    // либо у теста нет общего порога) — порога нет и у подтем: тема молчит, молчат и они.
    const keysFailed = applyBreakdownGate(
      topic.breakdown,
      thresholdPercentOf(gate.rule, topic.possiblePoints),
    );
    // FR-09: раздел, где нечего оценивать, остаётся БЕЗ вердикта (`null`), а не проваливает
    // своё правило на 0 %.
    const ownPassed =
      gate.rule && gate.scored > 0 ? checkPassRule(gate.rule, topic.percent, topic.earnedPoints) : null;
    // FR-53: подтема роняет тему только при включённом переключателе и только там, где тема
    // вообще судит. Тема без вердикта его не получает — суд не возвращается вопреки настройке.
    const passed = ownPassed === null ? null : ownPassed && !(gateOn && keysFailed);
    topic.passed = passed;
    if (passed === false) {
      allTopicsPassed = false;
      if (gate.required) requiredTopicsPassed = false;
    }
  }

  // FR-26, ПОСЛЕ второго прохода и только после него: счётчик блока складывает вердикты,
  // которые цикл выше вынес с учётом порогов ключей. Считать его раньше — значит считать
  // пройденным раздел, который ещё не судили.
  const groupedSections = groupSections(input.sectionGroups, topicResults).groups;
  const sectionGroups: AggregateSectionGroup[] = groupedSections.map((g) => ({
    key: g.key,
    label: g.label,
    topicIds: g.sections.map((t) => t.topicId),
    passedCount: g.passedCount,
    totalCount: g.totalCount,
  }));

  const percent = tPossible > 0 ? (tEarned / tPossible) * 100 : 0;
  // FR-09: a test made entirely of measurement questions (an opinion inventory such as
  // MBI) has nothing to grade, so there is no threshold to miss — it cannot be «not
  // passed». Hosts read `scoredQuestions === 0` to hide the percent and the verdict;
  // the meaning of such a run is carried by the PRD-2 indicators.
  const overallPassed = tScored > 0 ? checkPassRule(overall, percent, tEarned) : true;

  // FR-52: у сводных записей темы нет — их судит общее правило теста. Гейта в области теста
  // по-прежнему нет (FR-23): блок ГОВОРИТ о тесте, а вердикт теста выносит политика.
  const testEntries = entries.filter((e) => e.scope === TEST_SCOPE);
  applyBreakdownGate(testEntries, thresholdPercentOf(overall, tPossible));

  return {
    correct: tCorrect,
    totalQuestions: tQuestions,
    scoredQuestions: tScored,
    earnedPoints: tEarned,
    possiblePoints: tPossible,
    percent,
    overallPassed,
    passed: decideVerdict(policy, { overallPassed, requiredTopicsPassed, allTopicsPassed }),
    topicResults,
    breakdowns: testEntries,
    // Absent, not empty: a test without groups keeps the result shape it always had.
    ...(sectionGroups.length ? { sectionGroups } : {}),
    // Тем же правилом: попытка без единого опознанного вопроса хранит прежнюю форму
    // результата, и читатель отличает «списка нет» от «список пуст».
    ...(questionOutcomes.length ? { questionOutcomes } : {}),
    // PRD-57 FR-36: попытка предварительна, пока хоть один ответ ждёт проверки.
    gradingComplete: !questionOutcomes.some((outcome) => outcome.result === "pending"),
  };
}

/**
 * Combine the overall verdict with the topic gates per the authored policy.
 *
 * `null` policy = data written before the policy shipped (legacy attempt, legacy
 * snapshot, SCORM package built earlier): it keeps the pre-policy rule — the overall
 * threshold AND every gated topic, `required` ignored — so an old package regrades to
 * the same verdict it produced on the day it was built.
 */
function decideVerdict(
  policy: PassDecisionPolicy | null,
  gates: { overallPassed: boolean; requiredTopicsPassed: boolean; allTopicsPassed: boolean },
): boolean {
  switch (policy) {
    case "overall_only":
      return gates.overallPassed;
    case "overall_and_required_topics":
      return gates.overallPassed && gates.requiredTopicsPassed;
    case "required_topics_only":
      return gates.requiredTopicsPassed;
    case "all_topics_passed":
      return gates.allTopicsPassed;
    default:
      return gates.overallPassed && gates.allTopicsPassed;
  }
}

// ─── Adaptive aggregation (PRD-4/PRD-18) ─────────────────────────────────────
// THE single adaptive result-aggregation algorithm. ONE implementation consumed
// by BOTH the web grader (`server/routes/attempts.ts buildAdaptiveResult`) and the
// SCORM package runtime (`adaptive.js buildAdaptiveResult`, via the `TBTemplate`
// bundle). The two hosts previously hand-rolled this with a subtle, confirmed bug:
// `finalLevelIndex` is a POSITION in `levelsState` (it is initialized to
// `Math.floor(levelsState.length/2)` and moved by ±1), yet the WEB builder resolved
// the achieved level by `levelIndex` VALUE-match (`.find(l => l.levelIndex === final)`)
// — correct ONLY while the DB `levelIndex` equals the array position; with 1-based
// or sparse indices it picked the WRONG level. The SCORM builder indexed by POSITION
// (semantically correct, the reference behaviour) but threw, unguarded, out of range.
// This engine unifies on the CORRECT POSITIONAL convention with a safe bounds guard.
// `levels` MUST be supplied in the SAME order as `levelsState` (both sorted by
// `levelIndex` ascending). Per-host data (feedback / recommended links, whose SOURCE
// differs — DB rows vs in-package TEST_DATA) is supplied through the input, not here.

/** One delivered level's running tally (from `levelsState`), in sorted order. */
export interface AdaptiveLevelState {
  levelIndex: number;
  levelName: string;
  /** Lifecycle: only `passed`/`failed` levels count toward totals + `levelsAttempted`. */
  status: string;
  /** `answeredQuestionIds.length` for this level. */
  answeredCount: number;
  correctCount: number;
}

/** Static level metadata, POSITIONALLY aligned with `levelsState` (same sorted order). */
export interface AdaptiveLevelMeta {
  levelName?: string;
  feedback?: string | null;
  links?: Array<{ title: string; url: string }>;
}

export interface AdaptiveTopicInput<E = unknown> {
  topicId: string;
  topicName: string;
  /** The confirmed level as a POSITION in `levelsState`, or null when none achieved (→ failed). */
  finalLevelIndex: number | null;
  levelsState: AdaptiveLevelState[];
  /** Same length/order as `levelsState`; indexed by `finalLevelIndex` POSITION. */
  levels: AdaptiveLevelMeta[];
  /** Shown when no level is achieved (host-supplied: DB setting vs TEST_DATA). */
  failureFeedback?: string | null;
  /** Links to recommend on failure (host-supplied: SCORM=lowest level's links, web=[]). */
  failureLinks?: Array<{ title: string; url: string }>;
  /** Host-specific passthrough echoed verbatim into the topic result. */
  extra?: E;
}

export interface AdaptiveInput<E = unknown> {
  topics: AdaptiveTopicInput<E>[];
}

export interface AdaptiveTopicResult<E = unknown> {
  topicId: string;
  topicName: string;
  achievedLevelIndex: number | null;
  achievedLevelName: string | null;
  levelPercent: number;
  totalQuestionsAnswered: number;
  totalCorrect: number;
  levelsAttempted: Array<{
    levelIndex: number;
    levelName: string;
    questionsAnswered: number;
    correctCount: number;
    status: string;
  }>;
  feedback: string | null;
  recommendedLinks: Array<{ title: string; url: string }>;
  extra?: E;
}

export interface AdaptiveResult<E = unknown> {
  mode: "adaptive";
  /** True only when EVERY topic achieved a level. */
  overallPassed: boolean;
  topicResults: AdaptiveTopicResult<E>[];
}

export function aggregateAdaptiveResult<E = unknown>(input: AdaptiveInput<E>): AdaptiveResult<E> {
  let overallPassed = true;

  const topicResults: AdaptiveTopicResult<E>[] = input.topics.map((topic) => {
    let totalQuestionsAnswered = 0;
    let totalCorrect = 0;
    const levelsAttempted: AdaptiveTopicResult<E>["levelsAttempted"] = [];

    for (const lvl of topic.levelsState) {
      if (lvl.status === "passed" || lvl.status === "failed") {
        totalQuestionsAnswered += lvl.answeredCount;
        totalCorrect += lvl.correctCount;
        levelsAttempted.push({
          levelIndex: lvl.levelIndex,
          levelName: lvl.levelName,
          questionsAnswered: lvl.answeredCount,
          correctCount: lvl.correctCount,
          status: lvl.status,
        });
      }
    }

    const achievedLevelIndex = topic.finalLevelIndex;
    let achievedLevelName: string | null = null;
    let levelPercent = 0;
    let feedback: string | null = null;
    let recommendedLinks: Array<{ title: string; url: string }> = [];

    if (achievedLevelIndex !== null) {
      // POSITIONAL resolution (finalLevelIndex is a position in levelsState), with a
      // bounds guard so a corrupt/out-of-range index degrades to null instead of throwing.
      const achievedState = topic.levelsState[achievedLevelIndex] ?? null;
      const achievedMeta = topic.levels[achievedLevelIndex] ?? null;
      achievedLevelName = achievedState ? achievedState.levelName : achievedMeta?.levelName ?? null;
      if (achievedState && achievedState.answeredCount > 0) {
        levelPercent = (achievedState.correctCount / achievedState.answeredCount) * 100;
      }
      feedback = achievedMeta ? achievedMeta.feedback ?? null : null;
      recommendedLinks = achievedMeta ? achievedMeta.links ?? [] : [];
    } else {
      overallPassed = false;
      feedback = topic.failureFeedback ?? null;
      recommendedLinks = topic.failureLinks ?? [];
    }

    return {
      topicId: topic.topicId,
      topicName: topic.topicName,
      achievedLevelIndex,
      achievedLevelName,
      levelPercent,
      totalQuestionsAnswered,
      totalCorrect,
      levelsAttempted,
      feedback,
      recommendedLinks,
      extra: topic.extra,
    };
  });

  return { mode: "adaptive", overallPassed, topicResults };
}

/** One topic of {@link adaptiveResultAsStandard}: the level ladder read as a score. */
export interface AdaptiveAsStandardTopic {
  topicId: string;
  topicName: string;
  correct: number;
  total: number;
  percent: number;
  earnedPoints: number;
  possiblePoints: number;
  passed: boolean;
  achievedLevelName: string | null;
  recommendedCourses: Array<{ title: string; url: string }>;
  /**
   * PRD-50 FR-17: breakdown records in THIS topic's scope. Empty when the caller passed
   * no items — an adaptive host that knows nothing of the axis keeps its old result shape.
   */
  breakdown: BreakdownEntry[];
}

/** {@link adaptiveResultAsStandard}: an adaptive result told in standard-result words. */
export interface AdaptiveAsStandard {
  correct: number;
  totalQuestions: number;
  earnedPoints: number;
  possiblePoints: number;
  percent: number;
  passed: boolean;
  /** PRD-50 FR-17: breakdown records in the TEST scope (empty without items). */
  breakdowns: BreakdownEntry[];
  topicResults: AdaptiveAsStandardTopic[];
}

/**
 * An adaptive result restated in the STANDARD result's words — counts, percent and a
 * per-topic verdict.
 *
 * It exists because two consumers can only speak that language. The result-variable
 * formulas of PRD-2 read `percent`, `score` and `topicById(...).passed` (see
 * `EvalContext`), and the LMS report of PRD-4 wants a score and per-topic objectives;
 * neither has a notion of a confirmed level. So the ladder is read as: one answered
 * question is worth one point, a topic's percent is the percent WITHIN its confirmed
 * level (`levelPercent`), and a topic «passed» when any level was confirmed at all —
 * the same non-success the results screen paints red (`hasAchievedLevel`).
 *
 * ONE implementation, shared, because both hosts must feed the formulas identically:
 * the package runs it through `getAdaptiveResultForScorm` (telemetry + `finishScormAdaptive`),
 * the web server through the adaptive `/answer-adaptive` finish (issue #33 — before it,
 * the web computed no scales or indicators for an adaptive attempt at all). A second
 * copy would surface as the same formula returning different values in the browser and
 * in the LMS.
 *
 * NOT a substitute for the adaptive result itself: the counts and the verdict here are
 * neither stored nor shown — the learner's screen renders confirmed LEVELS, and this
 * shape never reaches it. The one exception is PRD-50: the breakdown records computed
 * from `breakdownItems` DO travel back onto the stored adaptive result (FR-39), because
 * the axis is a property of the delivered questions, not of the ladder.
 */
export function adaptiveResultAsStandard<E = unknown>(
  result: AdaptiveResult<E>,
  breakdownItems: readonly BreakdownItem[] = [],
  overallPassRule?: unknown,
): AdaptiveAsStandard {
  let totalQuestions = 0;
  let correct = 0;
  for (const tr of result.topicResults) {
    totalQuestions += tr.totalQuestionsAnswered;
    correct += tr.totalCorrect;
  }

  // PRD-50 FR-17: the SAME engine the standard aggregate calls — the ladder does not get
  // its own arithmetic. The items cannot be derived here: an adaptive result carries only
  // per-level tallies, while a breakdown is computed over DELIVERED questions, so the host
  // that knows which questions were asked assembles them (web: `buildAdaptiveResult`,
  // package: `adaptiveBreakdownItems`). No items = no records, and the result keeps
  // exactly the shape it had before this work (FR-18).
  const entries = computeBreakdowns(breakdownItems);
  const bySection = new Map<string, BreakdownEntry[]>();
  for (const e of entries) {
    const list = bySection.get(e.scope);
    if (list) list.push(e);
    else bySection.set(e.scope, [e]);
  }
  // PRD-50 §16: у ступени порога нет и быть не может, поэтому подтемы адаптива судит ОБЩИЙ
  // порог теста — и записи раздела, и сводные. Иначе тексты подтем, которые адаптивный экран
  // выдавал до §16, исчезли бы вместе с переездом отбора на исход записи. Балл адаптива —
  // один за вопрос, поэтому достижимое здесь равно числу выданных вопросов.
  const adaptiveThreshold = thresholdPercentOf(resolveOverallRule(overallPassRule), totalQuestions);
  applyBreakdownGate(entries, adaptiveThreshold);

  return {
    correct,
    totalQuestions,
    // Each answered question is worth one point in the adaptive mode: the ladder has no
    // per-question price (`test_question_scoring` gates the standard delivery only).
    earnedPoints: correct,
    possiblePoints: totalQuestions,
    percent: totalQuestions > 0 ? (correct / totalQuestions) * 100 : 0,
    passed: result.overallPassed,
    breakdowns: entries.filter((e) => e.scope === TEST_SCOPE),
    topicResults: result.topicResults.map((tr) => ({
      topicId: tr.topicId,
      topicName: tr.topicName,
      correct: tr.totalCorrect,
      total: tr.totalQuestionsAnswered,
      percent: tr.levelPercent,
      earnedPoints: tr.totalCorrect,
      possiblePoints: tr.totalQuestionsAnswered,
      passed: tr.achievedLevelIndex !== null,
      achievedLevelName: tr.achievedLevelName,
      recommendedCourses: tr.recommendedLinks,
      breakdown: bySection.get(sectionScope(tr.topicId)) ?? [],
    })),
  };
}

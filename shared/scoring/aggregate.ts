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
 * points-based; `passed = overallPassed && every topic with a resolved rule passes`.
 */
import { scoreAnswer, type Answer, type CorrectData, type QuestionType } from "./engine";
import type { QuestionScoring } from "../schema";
import { isMeasurementOnly } from "../questions/question-type";
import { resolveOverallRule, resolveTopicRule, checkPassRule, type ResolvedRule } from "./pass-rule";

export interface AggregateQuestion {
  type: QuestionType;
  correct: CorrectData;
  scoring?: QuestionScoring | null;
  /** Effective per-question points (resolved by the caller / baked into TEST_DATA). */
  points: number;
  answer: Answer;
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
  questions: AggregateQuestion[];
  /** Host-specific passthrough echoed verbatim into the topic result (feedback/recommendations). */
  extra?: E;
}

export interface AggregateInput<E = unknown> {
  sections: AggregateSection<E>[];
  overallPassRule: unknown;
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
}

export function aggregateStandardResult<E = unknown>(input: AggregateInput<E>): AggregateResult<E> {
  const overall = resolveOverallRule(input.overallPassRule);
  let tEarned = 0;
  let tPossible = 0;
  let tCorrect = 0;
  let tQuestions = 0;
  let tScored = 0;
  let allTopicsPassed = true;

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
      if (isMeasurementOnly(q)) continue;
      scored++;
      const ratio =
        q.answer === undefined || q.answer === null
          ? 0
          : scoreAnswer({ type: q.type, correct: q.correct || {}, answer: q.answer, scoring: q.scoring }).ratio;
      possible += q.points;
      earned += q.points * ratio;
      if (ratio === 1) correct++;
    }
    const total = scored;
    const percent = possible > 0 ? (earned / possible) * 100 : 0;
    const resolved = resolveTopicRule(sec.topicPassRule, overall, { formId: sec.formId ?? null });
    // FR-09: a section with nothing to grade has no percent to compare, so it stays
    // UNGATED (`null`) instead of failing its rule at 0%.
    const passed: boolean | null = resolved && scored > 0 ? checkPassRule(resolved, percent, earned) : null;
    if (passed === false) allTopicsPassed = false;

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
      passed,
      passRule: sec.topicPassRule,
      resolvedPassRule: resolved,
      extra: sec.extra,
    };
  });

  const percent = tPossible > 0 ? (tEarned / tPossible) * 100 : 0;
  // FR-09: a test made entirely of measurement questions (an opinion inventory such as
  // MBI) has nothing to grade, so there is no threshold to miss — it cannot be «not
  // passed». Hosts read `scoredQuestions === 0` to hide the percent and the verdict;
  // the meaning of such a run is carried by the PRD-2 indicators.
  const overallPassed = tScored > 0 ? checkPassRule(overall, percent, tEarned) : true;

  return {
    correct: tCorrect,
    totalQuestions: tQuestions,
    scoredQuestions: tScored,
    earnedPoints: tEarned,
    possiblePoints: tPossible,
    percent,
    overallPassed,
    passed: overallPassed && allTopicsPassed,
    topicResults,
  };
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

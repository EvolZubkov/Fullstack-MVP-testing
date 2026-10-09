/**
 * @module shared/sim/scoring
 *
 * How a «Сценарий в ИС» run turns into the share of the question's price
 * (docs/specs/sim-scenario/plan-tests.md, section 2, «Оценка»):
 *
 *   ratio = max(0, goal share − Σ count × penalty)
 *
 * The goal share is 1 for `success`, the weight share of the passed checks for `partial`, and 0
 * for every other outcome (`fail`, `exited`, `timeout`). Penalties are SHARES OF THE PRICE per
 * occurrence, not points: the same scenario then costs the same in a test priced at 1 and in
 * one priced at 10.
 *
 * The values here are the system defaults. The chain «система → тест → вопрос» is
 * {@link resolveSimScoring}: each penalty, and the partial-credit switch, is taken from the
 * nearest level that sets it (stage Э5а).
 *
 * Pure and framework-free: the web grader runs it now, the SCORM runtime gets its twin at Э4.
 */

/** Penalty per occurrence, as a share of the question's price. */
export interface SimPenalties {
  /** A click past every zone. */
  miss: number;
  /** An action the system refused (`otherwise`). */
  blocked: number;
  /** A committed field value that failed its check. */
  wrongValue: number;
  /** A harmless extra action («в сторону»). */
  detour: number;
  /** A trap fallen into. */
  trap: number;
  /** A hint shown. */
  hint: number;
}

/** System default penalties. */
export const DEFAULT_SIM_PENALTIES: Readonly<SimPenalties> = Object.freeze({
  miss: 0.02,
  blocked: 0.02,
  wrongValue: 0.05,
  detour: 0.01,
  trap: 0.15,
  hint: 0.05,
});

/** The part of a run result grading reads; the full `SimResult` fits it. */
export interface GradedRun {
  outcome: string;
  goal?: { share?: number } | null;
  counts?: Partial<Record<keyof SimPenalties | "traps" | "misses" | "wrongValues" | "detours" | "hints" | "actions", number>>;
}

/** Is this value a run result at all? An unanswered question has none. */
export function isGradedRun(value: unknown): value is GradedRun {
  return typeof value === "object" && value !== null && typeof (value as { outcome?: unknown }).outcome === "string";
}

/** Share of the goal reached: 1, the partial share, or 0. */
export function goalShare(run: GradedRun, countPartial = true): number {
  if (run.outcome === "success") return 1;
  if (run.outcome === "partial" && countPartial) {
    const share = run.goal?.share;
    return typeof share === "number" && share > 0 ? Math.min(1, share) : 0;
  }
  return 0;
}

/** Total penalty of a run, as a share of the price. */
export function penaltyShare(run: GradedRun, penalties: SimPenalties = DEFAULT_SIM_PENALTIES): number {
  const c = run.counts ?? {};
  const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : 0);
  return (
    n(c.misses) * penalties.miss
    + n(c.blocked) * penalties.blocked
    + n(c.wrongValues) * penalties.wrongValue
    + n(c.detours) * penalties.detour
    + n(c.traps) * penalties.trap
    + n(c.hints) * penalties.hint
  );
}

/**
 * The share of the price a run earns: the goal share minus the penalties, never below zero.
 *
 * @param run The player's result, or anything else for an unanswered question (scores 0).
 */
export function simulationRatio(
  run: unknown,
  penalties: SimPenalties = DEFAULT_SIM_PENALTIES,
  countPartial = true,
): number {
  if (!isGradedRun(run)) return 0;
  const share = goalShare(run, countPartial);
  if (share === 0) return 0;
  return Math.max(0, Math.min(1, share - penaltyShare(run, penalties)));
}

/** The six penalties, in the order the editor shows them. */
export const SIM_PENALTY_KEYS: readonly (keyof SimPenalties)[] = ["miss", "blocked", "wrongValue", "detour", "trap", "hint"];

/** One level of the chain: any penalty, and the switch, may be absent. */
export interface SimScoringLevel {
  penalties?: Partial<SimPenalties> | null;
  countPartial?: boolean | null;
}

/** The fully resolved scoring of one scenario question in one test. */
export interface ResolvedSimScoring {
  kind: "simulation";
  penalties: SimPenalties;
  countPartial: boolean;
}

/** A penalty a level may legitimately set: a finite share of the price in [0, 1]. */
function isShare(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Resolve the chain «система → тест → вопрос в тесте». Each penalty is taken on its own from the
 * nearest level that sets it, so a question may raise one penalty and inherit the rest.
 *
 * @param testLevel The test's defaults (`tests.sim_scoring_json`).
 * @param questionLevel The question's override in this test (`test_question_scoring.scoring_json`).
 */
export function resolveSimScoring(
  testLevel?: SimScoringLevel | null,
  questionLevel?: SimScoringLevel | null,
): ResolvedSimScoring {
  const penalties = { ...DEFAULT_SIM_PENALTIES } as SimPenalties;
  for (const key of SIM_PENALTY_KEYS) {
    const fromQuestion = questionLevel?.penalties?.[key];
    const fromTest = testLevel?.penalties?.[key];
    if (isShare(fromQuestion)) penalties[key] = fromQuestion;
    else if (isShare(fromTest)) penalties[key] = fromTest;
  }
  const countPartial =
    typeof questionLevel?.countPartial === "boolean"
      ? questionLevel.countPartial
      : typeof testLevel?.countPartial === "boolean"
        ? testLevel.countPartial
        : true;
  return { kind: "simulation", penalties, countPartial };
}

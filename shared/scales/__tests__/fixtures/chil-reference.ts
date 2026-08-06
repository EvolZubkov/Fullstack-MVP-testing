/**
 * @module shared/scales/__tests__/fixtures/chil-reference
 *
 * The control filling of the reference questionnaire «Опросник ЧИЛ V3.6» — the acceptance
 * fixture PRD-44 A-02 requires. Taken from `docs/references/Опросник ЧИЛ_V3.6_фин.xlsx`,
 * sheet «Механика подсчета результатов», rows 2..15 (columns K..N hold the points the
 * respondent gave to each style in each block; row 16 sums them).
 *
 * Why this fixture exists at all: the type's whole purpose is to reproduce a method that
 * already works on paper, so «our engine computes something» is not the bar — «our engine
 * computes what the method computes» is. The expected totals below are the file's OWN
 * results (`K16:N16` = 34 / 16 / 14 / 34, sum 98), not numbers derived from our code.
 *
 * Two properties of the reference are load-bearing elsewhere in PRD-44 and are asserted
 * from here:
 *
 *  - The maximum a single style can reach is 98 — the file says so in its own note — which
 *    is what the budget-capped scale domain (FR-15) must produce. A domain computed as
 *    «four statements times max 7 times 14 questions» would say 392 and put every band
 *    marker in the wrong place.
 *  - Two styles TIE at 34. The file resolves it silently: `MATCH(MAX(...))` returns
 *    whichever column stands further left. That is the concrete case behind FR-21/FR-22,
 *    so the tie must be reproducible here rather than smoothed away.
 *
 * The four statements of every block map to the four styles one-to-one (A/B/C/D in the
 * file). The letters are the DELIVERY order the file shuffles per block; our answers are
 * stored in the AUTHOR's order (FR-06), so statement 0 is always «Целеустремленный».
 */
import type { MeasurementSpec, ScaleSpec } from "../../engine";
import type { QuestionType } from "../../../questions/question-type";
import type { AllocationSpec } from "../../../questions/allocation";

/** Scale keys in the file's column order — also the authored order, which breaks ties. */
export const CHIL_SCALE_KEYS = ["cel", "vdo", "kom", "pro"] as const;

/** Style labels, for readable assertions. */
export const CHIL_SCALE_LABELS: Record<string, string> = {
  cel: "Целеустремленный",
  vdo: "Вдохновляющий",
  kom: "Командный",
  pro: "Процессный",
};

/**
 * Points per block, in scale order `[cel, vdo, kom, pro]` — the file's K..N for rows 2..15.
 * Every row sums to the budget of 7; blanks in the file mean zero.
 */
export const CHIL_BLOCKS: number[][] = [
  [3, 1, 1, 2],
  [0, 2, 0, 5],
  [2, 0, 0, 5],
  [0, 3, 0, 4],
  [0, 0, 4, 3],
  [3, 4, 0, 0],
  [7, 0, 0, 0],
  [7, 0, 0, 0],
  [0, 0, 3, 4],
  [3, 0, 0, 4],
  [2, 3, 2, 0],
  [3, 0, 4, 0],
  [0, 0, 0, 7],
  [4, 3, 0, 0],
];

/** The file's own totals (`K16:N16`) and their sum — the numbers our engine must match. */
export const CHIL_EXPECTED_TOTALS: Record<string, number> = { cel: 34, vdo: 16, kom: 14, pro: 34 };
export const CHIL_EXPECTED_SUM = 98;

/** The questionnaire's shape: 14 blocks of 4 statements, budget 7, no floor. */
export const CHIL_BUDGET = 7;
export const CHIL_QUESTION_IDS = CHIL_BLOCKS.map((_, i) => `q${i + 1}`);

/** Four scales, aggregation «sum», no normalization — exactly the method's arithmetic. */
export const CHIL_SCALES: ScaleSpec[] = CHIL_SCALE_KEYS.map((key) => ({
  key,
  aggregation: "sum",
  normalization: "none",
  direction: "positive",
}));

/** 56 contribution rows: statement `i` of every block feeds scale `i` with coefficient 1. */
export const CHIL_MEASUREMENTS: MeasurementSpec[] = CHIL_QUESTION_IDS.flatMap((questionId) =>
  CHIL_SCALE_KEYS.map((scaleKey, index) => ({
    questionId,
    scaleKey,
    sourceType: "option_allocation" as const,
    sourceKey: String(index),
    value: 1,
    weight: 1,
  })),
);

/** The control filling, in the answer encoding the runtime stores (FR-06). */
export const CHIL_ANSWERS: Record<string, Record<string, number>> = Object.fromEntries(
  CHIL_QUESTION_IDS.map((questionId, block) => [
    questionId,
    Object.fromEntries(CHIL_BLOCKS[block].map((points, index) => [String(index), points])),
  ]),
);

export const CHIL_TYPES: Record<string, QuestionType> = Object.fromEntries(
  CHIL_QUESTION_IDS.map((id) => [id, "allocation" as QuestionType]),
);

export const CHIL_BUDGETS: Record<string, AllocationSpec> = Object.fromEntries(
  CHIL_QUESTION_IDS.map((id) => [
    id,
    { options: ["a", "b", "c", "d"], budget: CHIL_BUDGET, minPerOption: 0, maxPerOption: CHIL_BUDGET },
  ]),
);

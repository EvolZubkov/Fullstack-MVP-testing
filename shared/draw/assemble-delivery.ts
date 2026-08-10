/**
 * @module shared/draw/assemble-delivery
 *
 * Pure delivery-STREAM core (PRD-30 раздел 14). Selection stays where it was —
 * {@link module:shared/draw/blueprint drawSection} (PRD-11) and
 * {@link module:shared/draw/forms selectForm} (PRD-17) decide WHICH questions a
 * topic delivers — and {@link module:shared/draw/order-questions orderQuestions}
 * still orders one topic. This module answers the question above them: in what
 * order the learner walks through the topics of the WHOLE test.
 *
 * It is the single place where the delivery order is decided. The web host calls
 * it directly (`server/routes/attempts.ts`); the SCORM package runs a plain-JS
 * twin (`server/scorm/assets/app.js`) kept in parity by a golden test. Nothing
 * downstream may reshuffle what comes out of here — a second pass over the flat
 * list is exactly the defect that made the package deliver a different order
 * than the web (spec §6.4).
 *
 * Model (spec §14.2-14.4):
 * - the TEST owns the default (`tests.question_order`): `fixed`, `random` or —
 *   in the flat flow only — `shuffle_all`;
 * - a TOPIC may override it (`test_sections.question_order`); NULL = «как в
 *   тесте» (FR-18);
 * - `shuffle_all` merges the questions of all topics into one stream (FR-19),
 *   except that a topic whose effective order is `fixed` travels as ONE
 *   unbroken block whose position in the stream is random (FR-20). An author who
 *   pins an order pins a sequence — a case walked through in steps, a
 *   questionnaire with a canonical numbering — and a foreign question wedged
 *   between its steps breaks it just as surely as a permutation would;
 * - the sectional flows keep the topic boundary (it carries the section screens
 *   and the section result), so `shuffle_all` degrades to `random` there
 *   (FR-17).
 */

import type { ShuffleFn } from "./blueprint";
import { orderQuestions, type OrderableQuestion, type QuestionOrderMode } from "./order-questions";

/** Test-wide delivery order (`tests.question_order`). */
export type TestQuestionOrder = "fixed" | "random" | "shuffle_all";

/** A topic's override (`test_sections.question_order`); null = inherit the test. */
export type SectionQuestionOrder = QuestionOrderMode | null | undefined;

/** One topic as the assembler sees it: its selected questions and its override. */
export interface DeliverySection<Q extends OrderableQuestion> {
  questions: Q[];
  questionOrder?: SectionQuestionOrder;
  /**
   * PRD-17 + PRD-30 FR-07: the topic runs in variants mode, so `selectForm` has
   * ALREADY put the questions in delivery order — the variant's own list when
   * the topic delivers fixed, a shuffle of it otherwise. `orderIndex` must not
   * touch such a topic: the author would then be setting the order twice, and
   * the list they curated for this exact delivery would silently lose.
   */
  preordered?: boolean;
}

/** The assembled delivery: per-topic composition plus the stream itself. */
export interface AssembledDelivery<Q extends OrderableQuestion> {
  /**
   * Each topic's questions in the order they are delivered, topics in the
   * author's order. Under `shuffle_all` this is the projection of `flat` onto
   * the topic — the composition of a topic never changes, only the order (FR-06).
   */
  sections: Q[][];
  /** The stream the learner walks through, in order. */
  flat: Q[];
  /**
   * True when the stream mixes questions ACROSS topics, i.e. it does not follow
   * from concatenating `sections` and has to be transported on its own
   * (`TestVariant.deliveryOrder`). Reported as a property of the SETTINGS, not of
   * the outcome: a shuffle may land on the concatenation order by chance, and a
   * flag that flickers with luck would make the persisted attempt shape random.
   */
  mixed: boolean;
}

/** The flat flow is the only one without a topic boundary; absent = flat. */
function isFlatFlow(flowMode: string | null | undefined): boolean {
  return flowMode !== "linear_by_topics" && flowMode !== "router_by_topics";
}

/**
 * The order a topic actually delivers in: its own value when it overrides the
 * test, the test's otherwise. `shuffle_all` is not a per-topic order — a topic
 * that inherits it sends its questions into the common pool, where the stream
 * decides, so the topic's own mode is `random` (FR-18).
 */
export function effectiveSectionOrder(
  testOrder: TestQuestionOrder | null | undefined,
  sectionOrder: SectionQuestionOrder,
): QuestionOrderMode {
  if (sectionOrder === "fixed" || sectionOrder === "random") return sectionOrder;
  return testOrder === "fixed" ? "fixed" : "random";
}

/**
 * Read a persisted delivery back: put `items` into the order of `deliveryOrder`
 * (PRD-30 FR-19, `TestVariant.deliveryOrder`). Used by the web learner, whose
 * variant stores composition per topic and the stream separately.
 *
 * Defensive by construction: an id the attempt no longer carries is skipped, and
 * an item the order does not mention keeps its relative place at the end — a
 * half-known order must degrade to «section order», never to a lost question.
 * Missing/empty `deliveryOrder` returns the input order (every test that does not
 * mix across topics, and every pre-PRD-30 attempt).
 */
export function applyDeliveryOrder<T>(
  items: T[],
  deliveryOrder: string[] | null | undefined,
  idOf: (item: T) => string,
): T[] {
  if (!deliveryOrder?.length) return items.slice();
  const rank = new Map(deliveryOrder.map((id, i) => [id, i]));
  const known: T[] = [];
  const rest: T[] = [];
  for (const item of items) (rank.has(idOf(item)) ? known : rest).push(item);
  known.sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!);
  return [...known, ...rest];
}

/** One topic's questions in delivery order — the variant's list wins as it is. */
function orderSection<Q extends OrderableQuestion>(
  section: DeliverySection<Q>,
  testOrder: TestQuestionOrder | null | undefined,
  shuffle: ShuffleFn,
): Q[] {
  if (section.preordered) return section.questions.slice();
  return orderQuestions(section.questions, effectiveSectionOrder(testOrder, section.questionOrder), shuffle);
}

/**
 * Assemble the delivery of a whole test. `sections` carry the ALREADY SELECTED
 * questions (draw or variant); the result is new arrays — the input is never
 * mutated.
 */
export function assembleDelivery<Q extends OrderableQuestion>(
  sections: DeliverySection<Q>[],
  testOrder: TestQuestionOrder | null | undefined,
  flowMode: string | null | undefined,
  shuffle: ShuffleFn,
): AssembledDelivery<Q> {
  const mixAcrossTopics = testOrder === "shuffle_all" && isFlatFlow(flowMode);

  if (!mixAcrossTopics) {
    // Topics stay blocks in the author's order; each orders its own questions.
    const ordered = sections.map((section) => orderSection(section, testOrder, shuffle));
    return { sections: ordered, flat: ordered.flat(), mixed: false };
  }

  // One stream. The units of the shuffle are single questions of the topics that
  // deliver at random, and ONE block per topic that delivers fixed — so a block
  // can move anywhere but never splits and never reorders inside (FR-20). The
  // stream is shuffled ONCE: a per-topic shuffle on top would be a second pass
  // over the same questions and would say nothing extra.
  const units: Q[][] = [];
  for (const section of sections) {
    if (effectiveSectionOrder(testOrder, section.questionOrder) === "fixed") {
      units.push(orderSection(section, testOrder, shuffle));
    } else {
      for (const question of section.questions) units.push([question]);
    }
  }
  const flat = shuffle(units).flat();

  // Per-topic composition, read back OUT of the stream, so the two views of the
  // same delivery can never disagree.
  const projected = sections.map((section) => {
    const own = new Set(section.questions.map((question) => question.id));
    return flat.filter((question) => own.has(question.id));
  });
  return { sections: projected, flat, mixed: true };
}

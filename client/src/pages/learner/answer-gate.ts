/**
 * @module client/pages/learner/answer-gate
 * @description Pure answer-readiness + ranking-delivery helpers for the learner
 * flow, extracted from `take-test.tsx` so the submit-button gate is unit-testable
 * in isolation. Mirrors the SCORM runtime (`hasAnswer` / `createRankingOrder`);
 * both hosts must agree so scoring and the «Отправить ответ» gate never diverge.
 */

/** Produces a permutation of `[0..length-1]`. Injectable for deterministic tests. */
export type ShuffleFn = (length: number) => number[];

/** Fisher–Yates index shuffle (unbiased). */
export function shuffleIndices(length: number): number[] {
  const arr = Array.from({ length }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Sequence equality by position. */
function sameSequence(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Ranking delivery order guaranteed NOT to already equal `correctOrder`, so an
 * untouched arrangement can never score correct by luck (P = 1/N! otherwise —
 * 50% for two items). Reshuffles until it differs; a pathological RNG falls back
 * to a forced first-pair swap. When `correctOrder` is absent/mismatched or the
 * length is < 2, any order is acceptable. `shuffle` is injectable for tests.
 */
export function rankingDeliveryOrder(
  length: number,
  correctOrder?: number[],
  shuffle: ShuffleFn = shuffleIndices,
): number[] {
  let order = shuffle(length);
  if (length < 2 || !Array.isArray(correctOrder) || correctOrder.length !== length) {
    return order;
  }
  let tries = 0;
  while (sameSequence(order, correctOrder) && tries < 20) {
    order = shuffle(length);
    tries++;
  }
  if (sameSequence(order, correctOrder)) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

/**
 * Does `answer` count as a usable answer for its question type? Gates the submit
 * button so nothing can be submitted empty (parity with the SCORM runtime).
 * Ranking requires an actual reorder — the delivered order is not seeded as the
 * answer, so an untouched ranking is `undefined` here and stays disabled.
 */
export function hasAnswer(question: { type?: string; dataJson?: unknown } | null | undefined, answer: unknown): boolean {
  if (!question) return true;
  const data = question.dataJson as { left?: unknown[]; items?: unknown[] } | undefined;
  switch (question.type) {
    case "single":
      return typeof answer === "number";
    case "multiple":
      return Array.isArray(answer) && answer.length > 0;
    case "matching": {
      if (!answer || typeof answer !== "object") return false;
      const need = Array.isArray(data?.left) ? data.left.length : 0;
      const keys = Object.keys(answer as Record<string, unknown>);
      return keys.length === need && keys.every((k) => typeof (answer as Record<string, unknown>)[k] === "number");
    }
    case "ranking": {
      const need = Array.isArray(data?.items) ? data.items.length : 0;
      return Array.isArray(answer) && answer.length === need;
    }
    default:
      return answer !== undefined && answer !== null;
  }
}

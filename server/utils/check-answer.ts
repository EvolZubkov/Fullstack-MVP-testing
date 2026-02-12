import type { Question } from "@shared/schema";

/**
 * Проверяет ответ пользователя на вопрос.
 * @returns Число от 0 до 1 (0 = неверно, 1 = верно)
 */
export function checkAnswer(question: Question, answer: unknown): number {
  if (answer === undefined || answer === null) return 0;

  const correct = question.correctJson as any;

  if (question.type === "single") {
    return answer === correct.correctIndex ? 1 : 0;
  }

  if (question.type === "multiple") {
    const correctIndices = new Set(correct.correctIndices as number[]);
    const answerList = (answer || []) as number[];
    const answerSet = new Set(answerList);

    if (correctIndices.size !== answerSet.size) return 0;

    for (const idx of correctIndices) {
      if (!answerSet.has(idx)) return 0;
    }

    return 1;
  }

  if (question.type === "matching") {
    const pairs = answer || {};
    const correctPairs = correct.pairs || [];

    if (correctPairs.length === 0) return 0;

    for (const p of correctPairs) {
      if ((pairs as any)[p.left] !== p.right) {
        return 0;
      }
    }

    return 1;
  }

  if (question.type === "ranking") {
    const order = (answer || []) as number[];
    const correctOrder = correct.correctOrder as number[];

    if (correctOrder.length === 0) return 0;
    if (order.length !== correctOrder.length) return 0;

    for (let i = 0; i < correctOrder.length; i++) {
      if (order[i] !== correctOrder[i]) {
        return 0;
      }
    }

    return 1;
  }

  return 0;
}
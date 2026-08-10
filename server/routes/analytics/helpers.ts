import type { Request } from "express";
import { readableTestScope } from "../../services/test-access";

/**
 * PRD-15 FR-08 (audit F-5): cross-test analytics aggregates and exports are
 * limited to the tests the actor may read (ownership, grants, admin). Wraps
 * {@link readableTestScope} into a predicate; `has(null)` is true only for
 * administrators, so LMS attempts of deleted tests stay admin-visible only.
 */
export async function analyticsScope(
  req: Request,
): Promise<{ all: boolean; has: (testId: string | null | undefined) => boolean }> {
  const scope = await readableTestScope(req.effectiveRoles ?? [], req.currentUser?.id ?? "");
  return {
    all: scope.all,
    has: (testId) => scope.all || (!!testId && scope.ids.has(testId)),
  };
}

/**
 * Форматирует тип вопроса для отображения
 */
export function formatQuestionType(type: string): string {
  const types: Record<string, string> = {
    single: "Один ответ",
    multiple: "Несколько ответов",
    matching: "Сопоставление",
    ranking: "Ранжирование",
    scale: "Шкала",
    allocation: "Распределение баллов",
  };
  return types[type] || type;
}

/**
 * Форматирует все варианты ответа
 */
export function formatAllOptions(type: string, dataJson: any): string {
  if (!dataJson) return "";

  switch (type) {
    case "single":
    case "multiple":
    // Шкала хранит градации в том же списке options (PRD-26).
    case "scale":
      if (dataJson.options && Array.isArray(dataJson.options)) {
        return dataJson.options.map((opt: string, i: number) => `${i + 1}) ${opt}`).join("\n");
      }
      break;
    case "matching":
      if (dataJson.left && dataJson.right) {
        const leftStr = dataJson.left.map((l: string, i: number) => `${i + 1}. ${l}`).join(", ");
        const rightStr = dataJson.right.map((r: string, i: number) => `${String.fromCharCode(65 + i)}. ${r}`).join(", ");
        return `Левая: ${leftStr}\nПравая: ${rightStr}`;
      }
      break;
    case "ranking":
      if (dataJson.items && Array.isArray(dataJson.items)) {
        return dataJson.items.map((item: string, i: number) => `${i + 1}) ${item}`).join("\n");
      }
      break;
  }
  return JSON.stringify(dataJson);
}

/**
 * Форматирует правильный ответ
 */
export function formatCorrectAnswerText(type: string, dataJson: any, correctJson: any): string {
  if (!correctJson) return "";

  switch (type) {
    case "single":
    // У измерительной шкалы correctIndex отсутствует — вернётся пустая строка.
    case "scale":
      if (correctJson.correctIndex !== undefined && dataJson?.options) {
        const idx = correctJson.correctIndex;
        return `${idx + 1}) ${dataJson.options[idx] || "?"}`;
      }
      break;
    case "multiple":
      if (correctJson.correctIndices && dataJson?.options) {
        return correctJson.correctIndices
          .map((idx: number) => `${idx + 1}) ${dataJson.options[idx] || "?"}`)
          .join(", ");
      }
      break;
    case "matching":
      if (correctJson.pairs && dataJson?.left && dataJson?.right) {
        return correctJson.pairs
          .map((p: any) => `${dataJson.left[p.left]} → ${dataJson.right[p.right]}`)
          .join(", ");
      }
      break;
    case "ranking":
      if (correctJson.correctOrder && dataJson?.items) {
        return correctJson.correctOrder
          .map((idx: number, pos: number) => `${pos + 1}. ${dataJson.items[idx] || "?"}`)
          .join(", ");
      }
      break;
  }
  return JSON.stringify(correctJson);
}

/**
 * Форматирует ответ пользователя
 */
export function formatUserAnswerText(type: string, dataJson: any, userAnswer: unknown): string {
  if (userAnswer === null || userAnswer === undefined) return "(нет ответа)";

  switch (type) {
    case "single":
    case "scale":
      if (typeof userAnswer === "number" && dataJson?.options) {
        return `${userAnswer + 1}) ${dataJson.options[userAnswer] || "?"}`;
      }
      break;
    case "multiple":
      if (Array.isArray(userAnswer) && dataJson?.options) {
        if (userAnswer.length === 0) return "(ничего не выбрано)";
        return userAnswer
          .map((idx: number) => `${idx + 1}) ${dataJson.options[idx] || "?"}`)
          .join(", ");
      }
      break;
    // PRD-44: распределение показывается ПОЛНОСТЬЮ, вместе с нулями — ноль здесь
    // содержателен, он отличает «рассмотрел и не дал веса» от «не дошёл».
    case "allocation":
      if (typeof userAnswer === "object" && dataJson?.options) {
        const assigned = userAnswer as Record<string, number>;
        return (dataJson.options as string[])
          .map((label, i) => `${label}: ${Number(assigned[String(i)] ?? 0)}`)
          .join(", ");
      }
      break;
    case "matching":
      if (typeof userAnswer === "object" && dataJson?.left && dataJson?.right) {
        const pairs = userAnswer as Record<string, number>;
        return Object.entries(pairs)
          .map(([leftIdx, rightIdx]) => {
            const leftItem = dataJson.left[Number(leftIdx)] || "?";
            const rightItem = dataJson.right[rightIdx] || "?";
            return `${leftItem} → ${rightItem}`;
          })
          .join(", ");
      }
      break;
    case "ranking":
      if (Array.isArray(userAnswer) && dataJson?.items) {
        return userAnswer
          .map((idx: number, pos: number) => `${pos + 1}. ${dataJson.items[idx] || "?"}`)
          .join(", ");
      }
      break;
  }
  return String(userAnswer);
}
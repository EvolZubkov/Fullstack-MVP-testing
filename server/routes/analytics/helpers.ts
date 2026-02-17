/**
 * Форматирует тип вопроса для отображения
 */
export function formatQuestionType(type: string): string {
  const types: Record<string, string> = {
    single: "Один ответ",
    multiple: "Несколько ответов",
    matching: "Сопоставление",
    ranking: "Ранжирование",
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
/**
 * @module server/services/questions-export
 *
 * Serialize a question DB row to a «Вопросы» Excel sheet row, shared by the
 * standalone question export (`GET /api/questions/export`) and the multi-sheet
 * workbook export (PRD-14 FR-15). Mirrors the import contract (спецификация
 * формата §3/§5), so a question round-trips through either path.
 */

import { serializeScoring } from "../utils/scoring-excel";
import type { Question } from "@shared/schema";

/** Маппинг типов: внутренний -> Excel. */
const typeToExcel: Record<string, string> = {
  single: "multiple_choice",
  multiple: "multiple_response",
  matching: "matching",
  ranking: "ranking",
};

/** Canonical «Вопросы» headers (order = export column order). */
export const QUESTION_HEADERS = [
  "ID",
  "Тема",
  "Тип вопроса",
  "Текст вопроса",
  "Балл",
  "Сложность",
  "Тексты вариантов ответа",
  "Номера правильных ответов",
  "Следование вариантов ответов",
  "Обратная связь",
  "Теги",
  "Режим ОС",
  "ОС при верном",
  "ОС при неверном",
  "Цена ответа",
];

/** Column widths matching {@link QUESTION_HEADERS}. */
export const QUESTION_WIDTHS = [36, 25, 18, 50, 8, 12, 60, 25, 15, 40, 25, 12, 30, 30, 40];

/** Serialize one question into a «Вопросы» sheet row (without «Ключ строки»). */
export function serializeQuestionRow(q: Question, topicName: string): Record<string, unknown> {
  const data = q.dataJson as any;
  const correct = q.correctJson as any;

  let optionsStr = "";
  let correctStr = "";

  if (q.type === "single" || q.type === "multiple") {
    optionsStr = (data.options || []).join("#");
    if (q.type === "single") {
      correctStr = String((correct.correctIndex ?? 0) + 1);
    } else {
      correctStr = (correct.correctIndices || []).map((i: number) => i + 1).join(",");
    }
  } else if (q.type === "matching") {
    // PRD-14 Ф0 (FR-01): "left list || right list" (round-trippable, distractors).
    const left = data.left || [];
    const right = data.right || [];
    optionsStr = `${left.join(" # ")} || ${right.join(" # ")}`;
    correctStr = (correct.pairs || []).map((p: any) => `${p.left + 1}-${p.right + 1}`).join(", ");
  } else if (q.type === "ranking") {
    optionsStr = (data.items || []).join("#");
    correctStr = (correct.correctOrder || []).map((i: number) => i + 1).join(",");
  }

  return {
    "ID": q.id,
    "Тема": topicName,
    "Тип вопроса": typeToExcel[q.type] || q.type,
    "Текст вопроса": q.prompt,
    // PRD-14 Ф0 (FR-04): `?? ` not `|| ` so an explicit 0 round-trips.
    "Балл": q.points ?? 1,
    "Сложность": q.difficulty ?? 50,
    "Тексты вариантов ответа": optionsStr,
    "Номера правильных ответов": correctStr,
    "Следование вариантов ответов": q.shuffleAnswers === false ? "Fixed" : "Random",
    "Обратная связь": q.feedback || "",
    // PRD-14 Ф1 (FR-06..FR-08): паритет с моделью вопроса.
    "Теги": (q.tags || []).join("; "),
    "Режим ОС": q.feedbackMode === "conditional" ? "условная" : "общая",
    "ОС при верном": q.feedbackCorrect || "",
    "ОС при неверном": q.feedbackIncorrect || "",
    "Цена ответа": serializeScoring(q.scoringJson),
  };
}

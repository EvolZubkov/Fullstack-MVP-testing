/**
 * @module server/services/questions-export
 *
 * Serialize a question DB row to a «Вопросы» Excel sheet row, shared by the
 * standalone question export (`GET /api/questions/export`) and the multi-sheet
 * workbook export (PRD-14 FR-15). Mirrors the import contract (спецификация
 * формата §3/§5), so a question round-trips through either path.
 *
 * PRD-15 block D, T-40: «Балл» and «Цена ответа» left this sheet — scoring is a
 * property of the test, not the question, and lives in the test-scoped «Оценка»
 * sheet (FR-36). The «Вопросы» sheet carries question content only.
 */

import type { Question } from "@shared/schema";
import { hasOptionList, isMeasurementOnly } from "@shared/questions/question-type";

/** Маппинг типов: внутренний -> Excel. */
const typeToExcel: Record<string, string> = {
  single: "multiple_choice",
  multiple: "multiple_response",
  matching: "matching",
  ranking: "ranking",
  scale: "scale",
};

/** Canonical «Вопросы» headers (order = export column order). */
export const QUESTION_HEADERS = [
  "ID",
  "Тема",
  "Тип вопроса",
  "Текст вопроса",
  "Сложность",
  // PRD-30 FR-15: author's position of the question inside its topic.
  "Индекс в теме",
  "Тексты вариантов ответа",
  "Номера правильных ответов",
  "Следование вариантов ответов",
  "Обратная связь",
  "Теги",
  "Режим ОС",
  "ОС при верном",
  "ОС при неверном",
];

/** Column widths matching {@link QUESTION_HEADERS}. */
export const QUESTION_WIDTHS = [36, 25, 18, 50, 12, 14, 60, 25, 15, 40, 25, 12, 30, 30];

// ─── canonical cell values of the enumerated «Вопросы» columns ───────────────
//
// What an author may PICK, offered as dropdowns by the workbook template. The
// importer is more forgiving than these lists (it also reads `single`/`multiple`
// for the type, and treats every non-`Fixed` value as "shuffle"), but a template
// advertises the canonical spelling — the one the export writes back.

/** «Тип вопроса» — derived from the export mapping, so the two cannot diverge. */
export const QUESTION_TYPE_CHOICES = Object.values(typeToExcel);
/** «Следование вариантов ответов» (see the serializer below). */
export const SHUFFLE_CHOICES = ["Random", "Fixed"];
/** «Режим ОС» (see the serializer below). */
export const FEEDBACK_MODE_CHOICES = ["общая", "условная"];

/** Serialize one question into a «Вопросы» sheet row (without «Ключ строки»). */
export function serializeQuestionRow(q: Question, topicName: string): Record<string, unknown> {
  const data = q.dataJson as any;
  const correct = q.correctJson as any;

  let optionsStr = "";
  let correctStr = "";

  if (hasOptionList(q.type)) {
    optionsStr = (data.options || []).join("#");
    if (q.type === "multiple") {
      correctStr = (correct.correctIndices || []).map((i: number) => i + 1).join(",");
    } else if (isMeasurementOnly(q)) {
      // PRD-26 FR-23: a measurement-only scale round-trips through an EMPTY cell —
      // that emptiness is what tells the import there is no correct graduation.
      correctStr = "";
    } else {
      correctStr = String((correct.correctIndex ?? 0) + 1);
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
    "Сложность": q.difficulty ?? 50,
    // PRD-30 FR-01: an empty cell means «не задано». The fallback is the EMPTY
    // STRING, not a number: 0 is a real index, and a default like the one above
    // would invent an order the author never set.
    "Индекс в теме": q.orderIndex ?? "",
    "Тексты вариантов ответа": optionsStr,
    "Номера правильных ответов": correctStr,
    "Следование вариантов ответов": q.shuffleAnswers === false ? "Fixed" : "Random",
    "Обратная связь": q.feedback || "",
    // PRD-14 Ф1 (FR-06..FR-08): паритет с моделью вопроса.
    "Теги": (q.tags || []).join("; "),
    "Режим ОС": q.feedbackMode === "conditional" ? "условная" : "общая",
    "ОС при верном": q.feedbackCorrect || "",
    "ОС при неверном": q.feedbackIncorrect || "",
  };
}

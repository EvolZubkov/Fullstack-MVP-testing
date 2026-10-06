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

import {
  OPTION_FEEDBACK_TYPE,
  hasOptionFeedback,
  optionCountOf,
  optionFeedbackAt,
} from "@shared/questions/option-feedback";
import type { Question } from "@shared/schema";
import {
  hasOptionList,
  isMeasurementOnly,
  distributesBudget,
  isTextEntry,
  hasBlanks,
  isOpenText,
} from "@shared/questions/question-type";
import { printRulesCell, printAnswerKind, printJoin, printPromptFormat } from "./workbook-answer-rules";

/** Маппинг типов: внутренний -> Excel. */
const typeToExcel: Record<string, string> = {
  single: "multiple_choice",
  multiple: "multiple_response",
  matching: "matching",
  ranking: "ranking",
  scale: "scale",
  allocation: "allocation",
  // PRD-57 FR-31: текстовые типы. Имена по образцу `multiple_choice` — англоязычные и
  // читаемые; импорт принимает и короткие, и русские написания (§4).
  short: "short_answer",
  blanks: "fill_in_blanks",
  long: "long_answer",
};

/** Canonical «Вопросы» headers (order = export column order). */
export const QUESTION_HEADERS = [
  "ID",
  "Тема",
  "Тип вопроса",
  "Текст вопроса",
  // PRD-57 §4.3: в каком режиме автор набрал текст. Пусто = разметка, то есть так, как
  // написаны все задания, заведённые до появления режимов.
  "Формат текста",
  "Сложность",
  // PRD-30 FR-15: author's position of the question inside its topic.
  "Индекс в теме",
  "Тексты вариантов ответа",
  "Номера правильных ответов",
  // PRD-44 FR-38: бюджет и домен варианта у распределения. Для остальных типов пусты.
  "Бюджет распределения",
  "Минимум на вариант",
  "Максимум на вариант",
  // PRD-57 FR-31: свойства текстового ответа, которые не выражаются ни текстом задания,
  // ни правилами. Пусты у всех прочих типов — как колонки бюджета у распределения.
  "Вид ответа",
  "Связка правил",
  "Единица измерения",
  "Предел длины",
  "Подсказка в поле",
  "Ответ обязателен",
  "Следование вариантов ответов",
  "Обратная связь",
  "Теги",
  "Режим ОС",
  "ОС при верном",
  "ОС при неверном",
  // Тексты обратной связи отдельных вариантов (только одиночный выбор): через `#`, в том
  // же порядке, что «Тексты вариантов ответа»; пустой слот — у варианта своего текста нет.
  "ОС по вариантам",
];

/** Column widths matching {@link QUESTION_HEADERS}. */
// Позиционно параллелен QUESTION_HEADERS: три ширины после «Номера правильных
// ответов» — колонки бюджета распределения (PRD-44), следующие шесть — колонки
// текстового ответа (PRD-57).
export const QUESTION_WIDTHS = [
  36, 25, 18, 50, 18, 12, 14, 60, 25, 20, 20, 20, 14, 14, 18, 14, 30, 16, 15, 40, 25, 12, 30, 30, 60,
];

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
  } else if (isTextEntry(q.type) || hasBlanks(q.type) || isOpenText(q.type)) {
    // PRD-57 FR-31: у текстовых типов вариантов нет, а эталон — набор правил сравнения.
    // Он печатается в ту же колонку, где у остальных типов стоит правильный ответ: правила
    // И ЕСТЬ эталон, и живут они в том же `correct_json`.
    correctStr = printRulesCell(q.type, q.correctJson);
  }

  const textual = isTextEntry(q.type) || hasBlanks(q.type) || isOpenText(q.type);

  return {
    "ID": q.id,
    "Тема": topicName,
    "Тип вопроса": typeToExcel[q.type] || q.type,
    "Текст вопроса": q.prompt,
    "Формат текста": printPromptFormat(String((q as { promptFormat?: string }).promptFormat ?? "markdown")),
    "Сложность": q.difficulty ?? 50,
    // PRD-30 FR-01: an empty cell means «не задано». The fallback is the EMPTY
    // STRING, not a number: 0 is a real index, and a default like the one above
    // would invent an order the author never set.
    "Индекс в теме": q.orderIndex ?? "",
    "Тексты вариантов ответа": optionsStr,
    "Номера правильных ответов": correctStr,
    // Пусто у всех типов, кроме распределения: пустая ячейка и есть «неприменимо».
    "Бюджет распределения": distributesBudget(q.type) ? (data.budget ?? "") : "",
    "Минимум на вариант": distributesBudget(q.type) ? (data.minPerOption ?? "") : "",
    "Максимум на вариант": distributesBudget(q.type) ? (data.maxPerOption ?? "") : "",
    // PRD-57 FR-31. Вид ответа и связка — свойства НАБОРА правил, поэтому у развёрнутого
    // ответа, у которого правил нет вовсе, они пусты.
    "Вид ответа": textual ? printAnswerKind(q.type, q.correctJson) : "",
    "Связка правил": textual ? printJoin(q.type, q.correctJson) : "",
    "Единица измерения": isTextEntry(q.type) ? (correct.unit ?? "") : "",
    "Предел длины": isTextEntry(q.type) || isOpenText(q.type) ? (data.maxLength ?? "") : "",
    "Подсказка в поле": isOpenText(q.type) ? (data.placeholder ?? "") : "",
    // Пустая ячейка читается как «нет»: обязательность — переключатель, и «да» в нём
    // стоит только тогда, когда автор его включил.
    "Ответ обязателен": isOpenText(q.type) && data.required === true ? "да" : "",
    "Следование вариантов ответов": q.shuffleAnswers === false ? "Fixed" : "Random",
    "Обратная связь": q.feedback || "",
    // PRD-14 Ф1 (FR-06..FR-08): паритет с моделью вопроса.
    "Теги": (q.tags || []).join("; "),
    "Режим ОС": q.feedbackMode === "conditional" ? "условная" : "общая",
    "ОС при верном": q.feedbackCorrect || "",
    "ОС при неверном": q.feedbackIncorrect || "",
    "ОС по вариантам": printOptionFeedback(q),
  };
}

/**
 * «ОС по вариантам»: one slot per option, joined by `#` like «Тексты вариантов ответа»,
 * an empty slot for an option without its own text. Empty for every other type and for a
 * single-choice question without any — that emptiness round-trips as «no texts».
 */
function printOptionFeedback(q: Question): string {
  if (q.type !== OPTION_FEEDBACK_TYPE || !hasOptionFeedback(q.optionFeedbackJson)) return "";
  const count = optionCountOf(q.dataJson);
  return Array.from({ length: count }, (_, i) => optionFeedbackAt(q.optionFeedbackJson, i) ?? "").join("#");
}

/**
 * @module shared/questions/blanks-render
 *
 * Подстановка маркера пропуска там, где полей ввода нет (PRD-57 FR-24i).
 *
 * Текст задания печатается далеко не только на экране вопроса: обзор PRD-19 выводит его
 * через `renderPlainText`, PDF-отчёт растеризует, комментарий рецензента (PRD-52) хранит
 * снимок формулировки, аналитика показывает задание в разборе. Сырой `{{organ}}` в любом
 * из этих мест читается как сбой продукта, а не как пропуск.
 *
 * Поэтому подстановка ОДНА на все три случая. Три копии этой логики означали бы три разных
 * вида одного задания — ровно тот дефект, который PRD-38 устранял для медиа.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */
import type { AnswerRuleSet } from "../answer-check";
import { parseBlanks } from "./blanks";

/** Прочерк постоянной ширины: «Наряд выдаёт ______». */
export const BLANK_DASH = "______";

/** Набор правил одного пропуска: правила короткого ответа плюс имя. */
export type BlankRuleSet = AnswerRuleSet & { id: string };

export type BlanksRenderOptions =
  | { mode: "dash" }
  | { mode: "answer"; answer?: Record<string, string> | null }
  | { mode: "reference"; blanks?: readonly BlankRuleSet[] | null };

/**
 * Эталон пропуска одной строкой — или его отсутствие.
 *
 * Есть он далеко не всегда, и выдумывать нельзя: у выражения «правильного ответа» строкой
 * не существует, у подстановочного знака их бесконечно много, у числа с допуском их целый
 * отрезок. В этих случаях честный ответ — прочерк.
 *
 * @param set Набор правил пропуска (или короткого ответа).
 * @returns Эталон либо `null`.
 */
export function referenceAnswer(set: AnswerRuleSet | null | undefined): string | null {
  const rules = set && Array.isArray(set.rules) ? set.rules : [];
  for (const rule of rules) {
    if (rule.kind === "number") {
      if (rule.op === "eq" && !rule.tolerance) return String(rule.value).replace(".", ",");
      continue;
    }
    if (rule.match !== "wildcard") continue;
    if (rule.value.indexOf("*") !== -1 || rule.value.indexOf("?") !== -1) continue;
    if (rule.value.trim() === "") continue;
    return rule.value;
  }
  return null;
}

/**
 * Напечатать текст задания без полей ввода.
 *
 * @param text    Текст задания как его набрал автор.
 * @param options Режим подстановки и данные к нему.
 */
export function renderBlanksText(text: string, options: BlanksRenderOptions): string {
  if (typeof text !== "string" || text === "") return "";
  const blanks = parseBlanks(text);
  let out = "";
  let at = 0;

  for (const blank of blanks) {
    out += text.slice(at, blank.start) + substitute(blank.id, options);
    at = blank.end;
  }
  out += text.slice(at);
  // Экранирование снимается ПОСЛЕ подстановки: иначе `\{{a}}` превратился бы в `{{a}}` и
  // следующий проход принял бы его за настоящий пропуск.
  return out.replace(/\\\{\{/g, "{{");
}

/** Чем заменить один маркер. */
function substitute(id: string, options: BlanksRenderOptions): string {
  if (options.mode === "answer") {
    const written = options.answer?.[id];
    return typeof written === "string" && written.trim() !== "" ? written : BLANK_DASH;
  }
  if (options.mode === "reference") {
    const set = (options.blanks ?? []).find((item) => item.id === id);
    return referenceAnswer(set) ?? BLANK_DASH;
  }
  return BLANK_DASH;
}

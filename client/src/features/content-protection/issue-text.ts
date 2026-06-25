/**
 * @module features/content-protection/issue-text
 *
 * Renders a PRD-15 feasibility issue as a human-readable Russian reason for the
 * content-impact dialog (T-12). Pure function, no React — reused by the dialog
 * and tests.
 */

import type { FeasibilityIssue } from "./types";

/** One short sentence describing why a dependent test is affected. */
export function describeIssue(issue: FeasibilityIssue): string {
  switch (issue.kind) {
    case "pool_shortfall":
      return `Выдача вопросов: тесту нужно ${issue.required}, останется ${issue.available}`;
    case "quota_shortfall":
      return `Квота по тегу «${issue.tag}»: нужно ${issue.requested}, останется ${issue.available}`;
    case "adaptive_shortfall": {
      const level = issue.levelName ? `«${issue.levelName}»` : `№${issue.levelIndex + 1}`;
      return `Уровень адаптивной выдачи ${level}: нужно ${issue.required}, останется ${issue.available}`;
    }
    case "measurement_loss":
      return `Будут потеряны вклады ${issue.questionIds.length} вопрос(ов) в шкалы теста`;
    case "variant_incomplete":
      return `Вариант теста станет неполным: затронуто ${issue.questionIds.length} вопрос(ов)`;
    case "content_pages_loss":
      return `Будут удалены страницы контента, привязанные к теме: ${issue.pageCount}`;
    case "formula_loss":
      return `Затрагиваются показатели результата: ${issue.variableNames.join(", ")}`;
    case "draw_all_shrink":
      return `Тест выдаёт все вопросы темы — выдача сократится на ${issue.removed}`;
    default:
      return "Затрагивается выдача или оценивание теста";
  }
}

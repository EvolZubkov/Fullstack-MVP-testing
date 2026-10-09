/**
 * @module features/content-protection/issue-text
 *
 * Renders a PRD-15 feasibility issue as a human-readable Russian reason for the
 * content-impact dialog (T-12). Pure function, no React — reused by the dialog
 * and tests.
 */

import type { BreakdownWarning, FeasibilityIssue } from "./types";

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
    case "scenario_item_empty":
      return `Пункт-сценарий «${issue.itemTitle}» останется без сценария`;
    default:
      return "Затрагивается выдача или оценивание теста";
  }
}

/**
 * The same issue read as the test's CURRENT state, not as the consequence of a
 * mutation. `describeIssue` above says «останется» because it answers «что будет,
 * если это удалить»; the editor's own check answers «что сейчас не так», where the
 * future tense would be simply wrong — nothing is being deleted.
 */
export function describeFeasibilityState(issue: FeasibilityIssue): string {
  switch (issue.kind) {
    case "pool_shortfall":
      return `Выдача вопросов: нужно ${issue.required}, в теме есть ${issue.available}`;
    case "quota_shortfall":
      return `Квота по тегу «${issue.tag}»: нужно ${issue.requested}, есть ${issue.available}`;
    case "adaptive_shortfall": {
      const level = issue.levelName ? `«${issue.levelName}»` : `№${issue.levelIndex + 1}`;
      return issue.available === 0
        ? `Уровень ${level}: под его диапазон сложности в теме нет ни одного вопроса (нужно ${issue.required})`
        : `Уровень ${level}: нужно ${issue.required}, под его диапазон сложности есть ${issue.available}`;
    }
    default:
      return describeIssue(issue);
  }
}

/** Одно предупреждение публикации (PRD-50 FR-45 - FR-47) человеческим языком. */
export function describeBreakdownWarning(w: BreakdownWarning): string {
  switch (w.code) {
    case "quota_sum_mismatch":
      return `Тема «${w.topicName}»: сумма квот ${w.count} не равна выборке ${w.total} — подтемы не разбивают выдачу целиком.`;
    case "questions_without_key":
      return `Тема «${w.topicName}»: вопросов без подтемы — ${w.count}. Они попадут в выдачу, но не войдут ни в одну полосу.`;
    case "question_outside_variants":
      return `Тема «${w.topicName}»: вопросов вне вариантов — ${w.count}. Они не будут выданы никогда.`;
    case "quotas_ignored_in_variants":
      return `Тема «${w.topicName}»: заданы и квоты, и варианты. В режиме вариантов квоты не применяются.`;
    // FR-56: правило уровня ТЕСТА — темы у него нет, а текст приезжает готовым: собрать
    // его здесь не из чего, потому что называет он не тему, а пару настроек.
    case "gate_without_display":
      return w.message
        ?? "Подтемы учитываются в вердикте темы, но подытоги по подтемам скрыты — участник не увидит причину.";
  }
}

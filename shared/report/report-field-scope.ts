/**
 * @module shared/report/report-field-scope
 *
 * К ЧЕМУ ОТНОСИТСЯ ПОЛЕ ВИДА ОТЧЁТА — к содержанию документа или к его облику.
 *
 * Поля одного вида разнородны по природе: `scalesChartKind` решает, ПОЯВИТСЯ ли в отчёте
 * диаграмма по шкалам, а `backgroundImage` — КАК страница выглядит. Автор ищет их в разных
 * местах редактора: содержательное — в «Настройках», рядом с обратной связью, которую
 * получит слушатель; оформительское — в «Оформлении», рядом с шаблоном и брендингом.
 * Раскладывать поля по этим двум экранам может только тот, кто их объявил, — шаблон.
 *
 * УМОЛЧАНИЕ — `appearance`, и оно не нейтральное, а совместимое: до появления признака все
 * поля показывались в «Оформлении», и шаблон, ничего про признак не знающий, оставляет их
 * ровно там, где автор их и находил.
 *
 * Чистый модуль: ни DOM, ни Node.
 */

/** Куда попадает поле вида в редакторе теста. */
export type ReportFieldScope = "content" | "appearance";

/** Значение по умолчанию: поле без признака — оформительское (см. заголовок модуля). */
export const DEFAULT_REPORT_FIELD_SCOPE: ReportFieldScope = "appearance";

/** Допустимые значения признака — для валидации манифеста. */
export const REPORT_FIELD_SCOPES: readonly ReportFieldScope[] = ["content", "appearance"];

/** Признак ли это, который мы понимаем. */
export function isReportFieldScope(value: unknown): value is ReportFieldScope {
  return typeof value === "string" && (REPORT_FIELD_SCOPES as readonly string[]).includes(value);
}

/**
 * Назначение поля.
 *
 * @param field Объявление поля из `settings[]` варианта.
 * @returns `content` только когда шаблон сказал это прямо; всё прочее — `appearance`.
 */
export function reportFieldScope(field: unknown): ReportFieldScope {
  const raw = (field as { scope?: unknown } | null | undefined)?.scope;
  return isReportFieldScope(raw) ? raw : DEFAULT_REPORT_FIELD_SCOPE;
}

/**
 * Оставить поля одного назначения, сохранив порядок объявления.
 *
 * @param fields Поля варианта.
 * @param scope Назначение, которое показывает экран.
 */
export function fieldsOfScope<T>(fields: readonly T[], scope: ReportFieldScope): T[] {
  return fields.filter((field) => reportFieldScope(field) === scope);
}

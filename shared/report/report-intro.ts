/**
 * @module shared/report/report-intro
 *
 * КАКОЙ вводный блок печатает отчёт — свой или тот же, что экран итогов.
 *
 * Правило вынесено из `shared/schema.ts` не для красоты: схему тянет за собой drizzle и
 * zod, а этот ответ нужен ВНУТРИ SCORM-пакета, который собирается для браузера и живёт
 * offline. Модуль чистый, поэтому его одинаково зовут веб-маршрут, сборка пакета,
 * рантайм в LMS и предпросмотр в редакторе — а значит, ни одно из этих мест не может
 * решить иначе.
 *
 * Чистый модуль: ни DOM, ни Node.
 */

/** Вводный блок: текст и формат, в котором автор его написал. */
export interface IntroBlockLike {
  text?: string | null;
  format?: "plain" | "richText" | "html" | null;
}

/** Вводные блоки теста (`tests.intro_json`) в том виде, в каком их читает выдача. */
export interface TestIntroLike {
  results?: IntroBlockLike | null;
  report?: IntroBlockLike | null;
  /** Печатать в отчёте текст экрана итогов (см. `testIntroSchema.reportSameAsResults`). */
  reportSameAsResults?: boolean;
}

/**
 * Вводный блок ОТЧЁТА с учётом переключателя «как на экране итогов».
 *
 * Переключатель — ссылка, а не копия: собственный текст отчёта не стирается, он просто не
 * используется, пока переключатель включён, и возвращается, стоит его выключить.
 *
 * @param intro Вводные блоки теста.
 * @returns Блок для отчёта либо `null`, когда печатать нечего (пустой текст = блока нет).
 */
export function resolveReportIntro(intro: TestIntroLike | null | undefined): IntroBlockLike | null {
  if (!intro) return null;
  const source = intro.reportSameAsResults ? intro.results : intro.report;
  return source && String(source.text ?? "").trim() ? source : null;
}

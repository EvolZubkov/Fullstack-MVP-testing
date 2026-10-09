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

/** ОДИН текст вводного блока: разметка и формат, в котором автор его написал. */
export interface IntroTextLike {
  text?: string | null;
  format?: "plain" | "richText" | "html" | null;
}

/**
 * Вводный блок ОДНОЙ выдачи: общее вступление плюс необязательные тексты по исходу (PRD-61).
 *
 * `text`/`format` — общее вступление, печатаемое при ЛЮБОМ исходе; это ровно то, что лежало
 * здесь до PRD-61. `passed`/`failed` печатаются вторым блоком — см. {@link introBlocksToPrint}.
 */
export interface IntroBlockLike extends IntroTextLike {
  /** Текст прошедшему. Отсутствие = такого текста автор не писал. */
  passed?: IntroTextLike | null;
  /** Текст не прошедшему. */
  failed?: IntroTextLike | null;
}

/**
 * Исход прогона в тех терминах, в которых его знает построитель контекста.
 *
 * ДВА поля, а не одно: `passed` у теста, который ничего не судит, — это умолчание, а не
 * суждение, и печатать по нему текст исхода значит соврать.
 */
export interface IntroOutcome {
  /**
   * Был ли вердикт ВЫНЕСЕН.
   *
   * Считается `hasPronouncedVerdict()` из `shared/scoring/pass-rule` — ТОЙ ЖЕ функцией, которой
   * построитель гасит вердиктную шапку. Второе определение этого понятия заводить нельзя:
   * расхождение двух копий вердиктного гейта уже давало дефект, когда шапка печатала зелёное
   * «Пройден» над блоком работы над ошибками.
   */
  verdictPronounced: boolean;
  passed: boolean;
}

/**
 * КАКИЕ тексты печатает вводный блок этой выдачи и в каком порядке (PRD-61 FR-06 - FR-09).
 *
 * Общее вступление идёт первым и печатается всегда; текст исхода — вторым и только когда
 * вердикт вынесен. Пустой текст блока не даёт: гейт стоит на самом тексте, а не на наличии
 * записи, — автор, стерший текст, ожидает, что блок исчезнет, а не станет пустой рамкой.
 *
 * Разметку строит ВЫЗЫВАЮЩИЙ: правило отвечает на вопрос «что печатать», а не «как». Формат
 * каждого блока едет свой — автор вправе написать вступление простым текстом, а поздравление
 * разметкой.
 *
 * Адаптивный режим сюда приходит с `verdictPronounced: false`: он вердикта не выносит, и
 * заголовков исхода у него нет (см. `buildAdaptiveResultContext`).
 *
 * @param block Вводный блок выдачи (`intro_json.results` либо ветвь отчёта).
 * @param outcome Исход прогона.
 * @returns Блоки к печати, в порядке печати: ноль, один или два.
 */
export function introBlocksToPrint(
  block: IntroBlockLike | null | undefined,
  outcome: IntroOutcome,
): Array<{ text: string; format: IntroTextLike["format"] }> {
  if (!block) return [];
  const out: Array<{ text: string; format: IntroTextLike["format"] }> = [];
  const push = (source: IntroTextLike | null | undefined) => {
    const text = String(source?.text ?? "");
    if (text.trim()) out.push({ text, format: source?.format ?? null });
  };
  push(block);
  if (outcome.verdictPronounced) push(outcome.passed ? block.passed : block.failed);
  return out;
}

/** Вводные блоки теста (`tests.intro_json`) в том виде, в каком их читает выдача. */
export interface TestIntroLike {
  results?: IntroBlockLike | null;
  report?: IntroBlockLike | null;
  /** Печатать в отчёте текст экрана итогов (см. `testIntroSchema.reportSameAsResults`). */
  reportSameAsResults?: boolean;
}

/** Есть ли в тексте хоть что-то, кроме пробелов. */
function hasText(source: IntroTextLike | null | undefined): boolean {
  return String(source?.text ?? "").trim().length > 0;
}

/**
 * Вводный блок ОТЧЁТА с учётом переключателя «как на экране итогов».
 *
 * Переключатель — ссылка, а не копия: собственный текст отчёта не стирается, он просто не
 * используется, пока переключатель включён, и возвращается, стоит его выключить.
 *
 * ГЕЙТ СТОИТ НА ВСЕХ ТРЁХ ТЕКСТАХ ВЕТВИ, а не на одном общем вступлении. Пока он смотрел
 * только на `text`, PRD-61 не доезжал до отчёта: автор, заполнивший «Если тест пройден» и
 * оставивший «При любом исходе» пустым, получал документ БЕЗ вводного блока — при том что
 * экран итогов тот же текст печатал, потому что туда ветвь едет объектом, без этого гейта
 * (`measures.intro.results` в `server/services/result-context.ts`). Расхождение било по трём
 * выдачам разом: веб-отчёт, предпросмотр в редакторе и отчёт внутри SCORM-пакета — все три
 * спрашивают это правило.
 *
 * Отбор ПУСТЫХ текстов остаётся за {@link introBlocksToPrint}: здесь решается только, есть
 * ли у отчёта вводный блок вообще (FR-05: ветвь без единого текста = блока нет).
 *
 * @param intro Вводные блоки теста.
 * @returns Блок для отчёта либо `null`, когда печатать нечего (пустая ветвь = блока нет).
 */
export function resolveReportIntro(intro: TestIntroLike | null | undefined): IntroBlockLike | null {
  if (!intro) return null;
  const source = intro.reportSameAsResults ? intro.results : intro.report;
  if (!source) return null;
  return hasText(source) || hasText(source.passed) || hasText(source.failed) ? source : null;
}

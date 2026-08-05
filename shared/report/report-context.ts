/**
 * @module shared/report/report-context
 *
 * PRD-27 §5 — публичный КОНТЕКСТ страницы отчёта: то, из чего макет варианта рисует
 * отчёт через общий рендерер.
 *
 * Контракт расширяется только аддитивно: на него опираются макеты внешних шаблонов.
 *
 * Два правила, из которых всё остальное следует:
 *
 * 1. `result.*` строится ТЕМ ЖЕ построителем, что экран результатов
 *    ({@link module:shared/template/result-context}). Отчёт не вправе показать иной
 *    вердикт, чем экран, с которого его скачали (§5.2) — а два независимых расчёта
 *    одного вердикта всегда расходятся. Это относится и к КОНСОЛИДИРОВАННОМУ блоку
 *    обратной связи (`result.recommendations`): тексты теста, тем и разделов, курсы,
 *    мероприятия и вложения собирает и дедуплицирует общий сборщик, а отчёт лишь
 *    докладывает ему то, чего нет в результате попытки, — обратную связь самого теста и
 *    признак «у теста объявлен порог» (см. `ReportMeta.feedback` / `hasPassThreshold`).
 *    Своей копии правила видимости у отчёта нет.
 * 2. DSL ничего не считает (spec §9). Проценты, смещение дуги, число колонок сетки,
 *    склонения и даты приходят ГОТОВЫМИ (§5.3).
 *
 * Чистый модуль: ни DOM, ни Node.
 */

import {
  buildResultContext,
  buildAdaptiveResultContext,
  type MeasuresInput,
  type ResultRenderContext,
} from "../template/result-context";
import type { ReportInput, AdaptiveReportInput, ReportMeta } from "./report-html";
import { formatTimestamp, pluralize } from "./report-html";

/** Блок `report.*` — то, чего на экране результатов нет (§5.3). */
export interface ReportBlock {
  /** Готовая подпись даты прохождения (`дд.мм.гггг чч:мм`). */
  attemptDateLabel: string;
  /** Готовая подпись числа попыток, со склонением. */
  attemptsCountLabel: string;
  /** ФИО слушателя: `cmi.learner_name` в LMS, пользователь сессии в вебе. */
  learnerName: string;
  /** Гейт строки со слушателем: имя может быть неизвестно. */
  hasLearnerName: boolean;
  /** Число колонок сетки тем, вычисленное ядром. */
  gridColumns: number;
  /** Предпросмотр: макет может показать пометку «образец». */
  isPreview: boolean;
  /**
   * Значения `settings[]` варианта (§5.4). Картинки приходят строками, готовыми к
   * печати: подложку и логотип объявляет ШАБЛОН своими полями (FR-05), а хост
   * разрешает их в data-URL — ядро не знает ни имён этих полей, ни их файлов.
   */
  values: Record<string, unknown>;
  /** Заголовок отчёта: «Тест пройден» / «Тест не пройден». */
  verdictHeadline: string;
  /** Подпись бейджа вердикта — строчными, как в отчёте. */
  verdictBadge: string;
  /** Класс вердикта для CSS отчёта: `is-pass` / `is-fail`. */
  verdictClass: string;
  /** Гейт блока тем. */
  hasTopics: boolean;
  /** «3/5» — верно из общего числа вопросов. */
  correctLabel: string;
  /** Заработанные баллы с одним знаком после запятой, как печатает отчёт. */
  earnedPointsLabel: string;
  /** Длина окружности дуги отчёта (радиус 44, СВОЙ, не как у кольца экрана). */
  ringDasharray: number;
  /** Смещение дуги отчёта. */
  ringDashoffset: number;
  /**
   * Рекомендованные материалы. В обычном режиме — курсы по темам, которые ученик НЕ
   * взял (всё, кроме явно пройденных), без дублей; в адаптивном — материалы всех тем, у
   * которых они есть, с названием темы: там нет «провала», уровень либо подтверждён,
   * либо нет.
   */
  courses: Array<{ title: string; url: string; topicName?: string }>;
  hasCourses: boolean;
  /** Рекомендованные мероприятия по тем же темам, без дублей. */
  events: Array<{ title: string }>;
  hasEvents: boolean;
}

/** Геометрия дуги отчёта: радиус 44 против 63 у кольца экрана результатов. */
const REPORT_RING_RADIUS = 44;

/** Число с одним знаком после запятой — так печатает отчёт. */
function fixed1(value: unknown): string {
  return (Number(value) || 0).toFixed(1);
}

/** Полный контекст страницы отчёта. */
export interface ReportRenderContext extends ResultRenderContext {
  design: Record<string, unknown>;
  report: ReportBlock;
}

/** Что хост добавляет к результату при сборке контекста. */
export interface ReportContextOptions {
  /**
   * Значения `settings[]` выбранного варианта (см. `resolveReportValues`), картинки
   * в которых хост уже инлайнил в data-URL (FR-05).
   */
  values?: Record<string, unknown> | null;
  /** Параметры оформления активного шаблона (`design.*`). */
  design?: Record<string, unknown> | null;
  /** Предпросмотр в настройках теста, а не выдача обучающемуся. */
  isPreview?: boolean;
  /**
   * PRD-29/PRD-35: измерения попытки — шкалы, показатели, рекомендации и радар.
   *
   * Приходят так же, как `values` и `design`: хост уже собрал их для экрана итогов,
   * а отчёт печатает то же самое. До PRD-35 отчёт измерений не получал вовсе, и
   * измерительная методика уносила с собой документ, в котором её вывода не было.
   * Отсутствие поля сохраняет прежний отчёт байт в байт.
   */
  measures?: MeasuresInput;
}

/** Колонки сетки тем — не больше трёх: на A4 шириной 595 px четвёртая нечитаема. */
export function reportGridColumns(topicCount: number): number {
  if (topicCount <= 1) return 1;
  if (topicCount === 2) return 2;
  return 3;
}

/** Подпись «Лучший результат за N попыток» — со склонением, готовой строкой. */
export function attemptsCountLabel(count?: number): string {
  const n = count && count > 0 ? count : 1;
  return `Лучший результат за ${n} ${pluralize(n, "попытку", "попытки", "попыток")}`;
}

/** Общая часть блока `report.*` для обоих видов. */
function reportBlock(meta: ReportMeta, topicCount: number, opts: ReportContextOptions): ReportBlock {
  const learnerName = String(meta.learnerName ?? "").trim();
  return {
    attemptDateLabel: formatTimestamp(meta.timestamp),
    attemptsCountLabel: attemptsCountLabel(meta.attemptsCount),
    learnerName,
    hasLearnerName: learnerName.length > 0,
    gridColumns: reportGridColumns(topicCount),
    isPreview: !!opts.isPreview,
    values: { ...(opts.values ?? {}) },
    // Значения вердикта и счёта заполняются вызывающим: у адаптивного отчёта их нет.
    verdictHeadline: "",
    verdictBadge: "",
    verdictClass: "",
    hasTopics: topicCount > 0,
    correctLabel: "",
    earnedPointsLabel: "",
    ringDasharray: 0,
    ringDashoffset: 0,
    courses: [],
    hasCourses: false,
    events: [],
    hasEvents: false,
  };
}

/**
 * Дедуп рекомендаций по темам, которые ученик НЕ взял: помощь адресуется пробелу, а не
 * строке отчёта. Пропускается только ЯВНО пройденная тема — то же правило, что на экране
 * итогов (`shared/template/result-context`, `vrRecommended` в пакете). Раньше здесь
 * стояло `!== false`, то есть тема без вердикта молчала; потемные пороги задают редко,
 * так что отчёт терял курсы там, где экран их показывал.
 *
 * Это НЕ вторая копия консолидации: список другой. Курсы и мероприятия ТЕМЫ экран
 * показывает в карточке темы, а не в общем блоке (`topicRecommendationSources` их туда не
 * кладёт), и отчёт печатает их сводкой, потому что в его карточках тем их нет. Общий блок
 * приходит отдельно, из общего сборщика, и содержит источники уровня теста и измерений.
 * Свести курсы тем в тот же блок — открытый вопрос плана: это меняет состав курсов на уже
 * работающих тестах и решается владельцем отдельно.
 */
function unmasteredRecommendations(topics: ReportInput["result"]["topicResults"]): {
  courses: Array<{ title: string; url: string }>;
  events: Array<{ title: string }>;
} {
  const seenC = new Set<string>();
  const seenE = new Set<string>();
  const courses: Array<{ title: string; url: string }> = [];
  const events: Array<{ title: string }> = [];
  for (const t of topics ?? []) {
    if (t.passed === true) continue;
    for (const c of t.recommendedCourses ?? []) {
      if (!c || seenC.has(c.title)) continue;
      seenC.add(c.title);
      courses.push({ title: c.title, url: c.url ?? "" });
    }
    for (const e of t.recommendedEvents ?? []) {
      if (!e || seenE.has(e.title)) continue;
      seenE.add(e.title);
      events.push({ title: e.title });
    }
  }
  return { courses, events };
}

/**
 * Контекст отчёта для ОБЫЧНОГО режима (баллы).
 *
 * @param input Нормализованный результат плюс кто и когда проходил.
 * @param opts См. {@link ReportContextOptions}.
 */
export function buildReportContext(input: ReportInput, opts: ReportContextOptions = {}): ReportRenderContext {
  // `withTopicPoints` — в отчёте строка «Баллов» по теме нужна всегда: это документ,
  // а не экран, и досчитать её потом читателю нечем. `topicPointsIgnoreScoreSummary`
  // держит её и тогда, когда автор выключил сводку по баллам (issue #30 гасит эту
  // строку только на ЭКРАНЕ — там у ученика есть настройка, у скачанного PDF её нет).
  const base = buildResultContext(input.result, input.testName || "", {
    withTopicPoints: true,
    topicPointsIgnoreScoreSummary: true,
    // Источники консолидированного блока обратной связи, которых нет в результате
    // попытки: обратная связь самого теста и признак «тест выносит вердикт». Уходят в
    // ТОТ ЖЕ построитель, что собирает блок для экрана, — второго правила консолидации
    // здесь нет и быть не должно. Пока они сюда не доезжали, отчёт печатал курсы и
    // мероприятия своей функцией, а текстов не печатал вовсе (см. §5.2: отчёт не вправе
    // показать иное, чем экран, с которого его скачали).
    ...(input.feedback ? { testFeedback: input.feedback } : {}),
    ...(input.hasPassThreshold !== undefined ? { hasPassThreshold: input.hasPassThreshold } : {}),
    ...(opts.measures ? { measures: opts.measures } : {}),
  });
  const topics = input.result.topicResults ?? [];
  const passed = !!input.result.passed;
  const percent = base.result.scorePercent ?? 0;
  const circumference = 2 * Math.PI * REPORT_RING_RADIUS;
  const rec = unmasteredRecommendations(topics);

  const report = reportBlock(input, topics.length, opts);
  report.verdictHeadline = passed ? "Тест пройден" : "Тест не пройден";
  report.verdictBadge = passed ? "пройден" : "не пройден";
  report.verdictClass = passed ? "is-pass" : "is-fail";
  report.correctLabel = `${input.result.correct}/${input.result.totalQuestions}`;
  report.earnedPointsLabel = fixed1(input.result.earnedPoints);
  report.ringDasharray = circumference;
  report.ringDashoffset = circumference - (circumference * percent) / 100;
  report.courses = rec.courses;
  report.hasCourses = rec.courses.length > 0;
  report.events = rec.events;
  report.hasEvents = rec.events.length > 0;

  const ctx: ReportRenderContext = { ...base, design: { ...(opts.design ?? {}) }, report };

  // Готовые подписи строки темы: отчёт печатает свои формулировки и свою точность
  // («Пройден», «3.0/5.0»), экран — свои («Пройдено», «3 / 5»).
  const rows = ctx.result.topicResults;
  if (Array.isArray(rows)) {
    rows.forEach((row, i) => {
      const src = topics[i];
      if (!src) return;
      const topicPassed = src.passed === true;
      const target = row as unknown as Record<string, unknown>;
      const topicPercent = Math.round(Number(src.percent) || 0);
      target.verdictLabel = topicPassed ? "Пройден" : "Не пройден";
      target.barPercent = topicPercent;
      target.countsLabel = `${src.correct} из ${src.total} (${topicPercent}%)`;
      target.pointsFixedLabel = `${fixed1(src.earnedPoints)}/${fixed1(src.possiblePoints)}`;
      // Признака `showFeedback` здесь больше нет: текст обратной связи темы печатается
      // ОДИН раз — в консолидированном блоке, который отчёт берёт из общего сборщика
      // (`buildResultContext` выше). Слот в карточке темы после консолидации мог только
      // пустовать либо повторять ту же строку на той же странице, и снят из `report.html`
      // обоих шаблонов.
      //
      // В АДАПТИВНОМ отчёте слот сохранён и признак вычисляется — см.
      // `buildAdaptiveReportContext` ниже: там `feedback` темы означает другое (обратная
      // связь достигнутого уровня либо текст провала темы), в блок не подаётся, и снятие
      // слота стёрло бы её из продукта. Расхождение макетов намеренное.
    });
  }
  return ctx;
}

/**
 * Контекст отчёта для АДАПТИВНОГО режима (подтверждённые уровни, без баллов).
 *
 * @param input Нормализованный адаптивный результат плюс кто и когда проходил.
 * @param opts См. {@link ReportContextOptions}.
 */
export function buildAdaptiveReportContext(
  input: AdaptiveReportInput,
  opts: ReportContextOptions = {},
): ReportRenderContext {
  // Обратная связь теста — свойство ТЕСТА, а не режима выдачи, поэтому уходит в
  // адаптивный построитель ровно так же, как в обычный. Порога здесь нет: адаптивный
  // вердикт выносится по подтверждённым уровням, и `hasPassThreshold` этому режиму
  // нечего сказать.
  const base = buildAdaptiveResultContext(input.result, input.testName || "", {
    ...(input.feedback ? { testFeedback: input.feedback } : {}),
  });
  const topics = input.result.topicResults ?? [];
  const report = reportBlock(input, topics.length, opts);
  // Адаптивные материалы перечисляются по КАЖДОЙ теме, у которой они есть, с названием
  // темы: понятия «проваленная тема» здесь нет.
  for (const t of topics) {
    for (const c of t.recommendedCourses ?? []) {
      if (!c) continue;
      report.courses.push({ topicName: t.topicName || "", title: c.title, url: c.url ?? "" });
    }
  }
  report.hasCourses = report.courses.length > 0;
  const ctx: ReportRenderContext = { ...base, design: { ...(opts.design ?? {}) }, report };
  // Счётчики заданных и верных вопросов у уровневых строк — их нет в контексте экрана
  // (экран показывает уровень), а отчёт печатает, поэтому добавляются здесь.
  const rows = ctx.result.topicResults;
  if (Array.isArray(rows)) {
    rows.forEach((row, i) => {
      const src = topics[i];
      if (!src) return;
      const answered = src.totalQuestionsAnswered;
      const correct = src.totalCorrect;
      const target = row as unknown as Record<string, unknown>;
      target.hasCounts = answered != null || correct != null;
      target.answeredLabel = `Вопросов: ${answered ?? 0}`;
      target.correctLabel = `Правильных: ${correct ?? 0}`;
      // Класс для CSS отчёта: подтверждён уровень или нет. Не `levelClass` экрана —
      // тот несёт классы дизайн-системы и меняется вместе с оформлением тега.
      target.achievedClass =
        src.achievedLevelIndex !== null && src.achievedLevelIndex !== undefined ? "is-achieved" : "is-below";
    });
  }
  return ctx;
}

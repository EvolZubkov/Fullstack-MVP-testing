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
 *    одного вердикта всегда расходятся.
 * 2. DSL ничего не считает (spec §9). Проценты, смещение дуги, число колонок сетки,
 *    склонения и даты приходят ГОТОВЫМИ (§5.3).
 *
 * Чистый модуль: ни DOM, ни Node.
 */

import {
  buildResultContext,
  buildAdaptiveResultContext,
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
   * Рекомендованные материалы. В обычном режиме — курсы по ПРОВАЛЕННЫМ темам без дублей;
   * в адаптивном — материалы всех тем, у которых они есть, с названием темы: там нет
   * «провала», уровень либо подтверждён, либо нет.
   */
  courses: Array<{ title: string; url: string; topicName?: string }>;
  hasCourses: boolean;
  /** Рекомендованные мероприятия по проваленным темам, без дублей. */
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

/** Дедуп рекомендаций по ПРОВАЛЕННЫМ темам: помощь адресуется провалу, а не строке. */
function failedRecommendations(topics: ReportInput["result"]["topicResults"]): {
  courses: Array<{ title: string; url: string }>;
  events: Array<{ title: string }>;
} {
  const seenC = new Set<string>();
  const seenE = new Set<string>();
  const courses: Array<{ title: string; url: string }> = [];
  const events: Array<{ title: string }> = [];
  for (const t of topics ?? []) {
    if (t.passed !== false) continue;
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
  // а не экран, и досчитать её потом читателю нечем.
  const base = buildResultContext(input.result, input.testName || "", { withTopicPoints: true });
  const topics = input.result.topicResults ?? [];
  const passed = !!input.result.passed;
  const percent = base.result.scorePercent ?? 0;
  const circumference = 2 * Math.PI * REPORT_RING_RADIUS;
  const rec = failedRecommendations(topics);

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
      // Обратную связь отчёт печатает ТОЛЬКО по проваленной теме — как и раньше.
      target.showFeedback = !topicPassed && String(src.feedback ?? "").trim().length > 0;
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
  const base = buildAdaptiveResultContext(input.result, input.testName || "");
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

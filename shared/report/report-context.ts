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
import type { ReportInput, AdaptiveReportInput, ReportAssets, ReportMeta } from "./report-html";
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
  /** Значения `settings[]` варианта (§5.4), картинки — уже строками-URL. */
  values: Record<string, unknown>;
  /** Подложка страницы, разрешённая в data-URL; пусто — макет рисует свой фон. */
  backgroundUrl: string;
  /** Логотип, разрешённый в data-URL; пусто — строки логотипа нет. */
  logoUrl: string;
  /** Гейт строки логотипа. */
  hasLogo: boolean;
}

/** Полный контекст страницы отчёта. */
export interface ReportRenderContext extends ResultRenderContext {
  design: Record<string, unknown>;
  report: ReportBlock;
}

/** Что хост добавляет к результату при сборке контекста. */
export interface ReportContextOptions {
  /** Разрешённые подложка и логотип. */
  assets?: ReportAssets;
  /** Значения `settings[]` выбранного варианта (см. `resolveReportValues`). */
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
  const background = opts.assets?.backgroundDataUrl ?? "";
  const logo = opts.assets?.logoDataUrl ?? "";
  return {
    attemptDateLabel: formatTimestamp(meta.timestamp),
    attemptsCountLabel: attemptsCountLabel(meta.attemptsCount),
    learnerName,
    hasLearnerName: learnerName.length > 0,
    gridColumns: reportGridColumns(topicCount),
    isPreview: !!opts.isPreview,
    values: { ...(opts.values ?? {}) },
    backgroundUrl: background || "",
    logoUrl: logo || "",
    hasLogo: !!logo,
  };
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
  return {
    ...base,
    design: { ...(opts.design ?? {}) },
    report: reportBlock(input, (input.result.topicResults ?? []).length, opts),
  };
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
  const ctx: ReportRenderContext = {
    ...base,
    design: { ...(opts.design ?? {}) },
    report: reportBlock(input, topics.length, opts),
  };
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
    });
  }
  return ctx;
}

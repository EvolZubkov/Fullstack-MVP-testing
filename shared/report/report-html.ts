/**
 * @module shared/report/report-html
 *
 * Входные типы отчёта и его текстовые помощники.
 *
 * ВЁРСТКИ здесь больше нет: страницу отчёта рисует МАКЕТ шаблона
 * (`contentTemplates[].layoutFile`, PRD-27 Фаза 2), а данные для него собирает
 * {@link module:shared/report/report-context}. До PRD-27 страница собиралась кодом —
 * инлайн-стилями, с зашитыми цветами, — из-за чего разработчик шаблона не мог изменить
 * ни структуру отчёта, ни его оформление.
 *
 * Осталось то, что к вёрстке не относится: нормализованный вход, имя файла и подписи,
 * которые считает ядро (DSL не считает — spec §9).
 *
 * Чистый модуль: ни DOM, ни Node, ни PDF-библиотек.
 */

import type { ResultInput, AdaptiveResultInput, AdaptiveTopicInput } from "../template/result-context";
import type { FeedbackBlock } from "../scales/interpretation";

/** What the report prints besides the result itself. */
export interface ReportMeta {
  /**
   * Which page to build — set by the host that knows the test's mode, so a consumer
   * never has to guess from the shape of `topicResults`.
   */
  adaptive?: boolean;
  /** Test title (the card headline). */
  testName: string;
  /** Learner's full name — LMS `cmi.learner_name` in SCORM, session user on the web. */
  learnerName?: string | null;
  /** ISO timestamp of the attempt being reported. */
  timestamp?: string | null;
  /** How many attempts the «Лучший результат за N попыток» line counts. */
  attemptsCount?: number;
  /**
   * Обратная связь САМОГО теста (`tests.feedback_json`), уже нормализованная хостом
   * (`normalizeFeedback`) — самый общий источник консолидированного блока рекомендаций
   * и первый в нём.
   *
   * Лежит во ВХОДЕ отчёта, а не в параметрах сборки, потому что оба хоста собирают вход
   * там, где этот факт известен: веб — в маршруте результата, рядом с материалом экрана
   * итогов; пакет — в рантайме, из `TEST_DATA.testFeedbackJson`. Клиенту тогда нечего
   * прокидывать: он лишь передаёт то, что приехало с сервера.
   *
   * Отсутствие поля оставляет отчёт прежним: блок соберётся из того, что несут темы.
   */
  feedback?: FeedbackBlock | null;
  /**
   * Объявлен ли у теста порог прохождения (`tests.overall_pass_rule_json` с типом,
   * отличным от `none`). Единственный факт, отличающий ЯВНЫЙ успех от `passed: false` по
   * умолчанию у теста, который вердикта не выносит: обратная связь теста молчит только
   * при явном успехе (см. `ResultContextOptions.hasPassThreshold`).
   *
   * Отсутствие = «неизвестно», и неизвестность трактуется в пользу показа.
   */
  hasPassThreshold?: boolean;
  /**
   * Вводный блок ОТЧЁТА (`tests.intro_json.report`) — текст и его формат.
   *
   * Отдельный от текста экрана: документ уносят с собой и показывают специалисту, поэтому
   * вводное слово у него своё. Отсутствие = блока в отчёте нет.
   */
  intro?: { text?: string | null; format?: "plain" | "richText" | "html" | null } | null;
}

/** Standard-mode report input — the SAME normalized result the results screen takes. */
export interface ReportInput extends ReportMeta {
  result: ResultInput;
}

/** Adaptive-mode per-topic extras the report prints (counts have no level analogue). */
export interface AdaptiveReportTopic extends AdaptiveTopicInput {
  totalQuestionsAnswered?: number;
  totalCorrect?: number;
}

/** Adaptive-mode report input. */
export interface AdaptiveReportInput extends ReportMeta {
  result: Omit<AdaptiveResultInput, "topicResults"> & { topicResults: AdaptiveReportTopic[] };
}

/** Russian plural form for a count (попытку / попытки / попыток). */
export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** `дд.мм.гггг чч:мм` of an ISO timestamp (or now, when the host has none). */
export function formatTimestamp(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Strip characters a file name cannot carry, and cap the length. */
export function sanitizeFileName(name?: string | null): string {
  if (!name) return "test";
  return String(name)
    .replace(/[^a-zA-Zа-яА-Я0-9_\-\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 50);
}

/** `Результаты_<Тест>_дд_мм_гггг.pdf` — the download name both hosts use. */
export function reportFileName(testName?: string | null, date: Date = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${p2(date.getDate())}_${p2(date.getMonth() + 1)}_${date.getFullYear()}`;
  return `Результаты_${sanitizeFileName(testName)}_${stamp}.pdf`;
}

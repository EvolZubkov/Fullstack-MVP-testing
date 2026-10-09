/**
 * @module tests/helpers/report-fixture
 *
 * PRD-51, задача 10 — ЗАПОЛНЕННЫЙ контекст отчёта для сравнения двух способов печати.
 *
 * Контекст собирается НАСТОЯЩИМИ сборщиками (`buildReportContext`) на синтетическом
 * входе, а не пишется руками: контекст, собранный руками, не заметит, если ядро сменит
 * форму поля, и сравнение начнёт молча проверять не то.
 *
 * Вход намеренно открывает КАЖДЫЙ гейт документа: без этого сравнение двух пустых
 * документов сошлось бы и ничего не доказало. Какие именно разделы удалось наполнить,
 * проверяет сам тест — по маркерам в разметке.
 */
import { buildReportContext, buildAdaptiveReportContext } from "@shared/report/report-context";
import { resolveReportBake } from "@shared/report/report-variants";
import type { ReportInput, AdaptiveReportInput } from "@shared/report/report-html";
import type { ReportRenderContext } from "@shared/report/report-context";

/** Попытка со всеми разделами: темы в блоках, разрезы, рекомендации, курсы, мероприятия. */
const STANDARD: ReportInput = {
  testName: "Сертификация руководителей",
  learnerName: "Макарова Анна Васильевна",
  timestamp: "2026-08-15T10:00:00.000Z",
  attemptsCount: 2,
  // Вводный блок и показ разрезов — поля ВХОДА отчёта, а не опции сборщика: без них
  // ядро не кладёт в строку темы ни одной полосы, и половина сравниваемой разметки
  // просто не родилась бы.
  intro: { text: "Поздравляем с прохождением тестирования!", format: "plain" },
  breakdownDisplay: { visibility: "bar_and_value", basis: "units", placement: "both" },
  result: {
    passed: false,
    percent: 62,
    totalQuestions: 20,
    correct: 12,
    earnedPoints: 12.5,
    possiblePoints: 20,
    // PRD-50: записи разреза области ТЕСТА — сводный блок документа.
    breakdowns: [
      { key: "Корпоративная культура", items: 4, answered: 4, earned: 3, possible: 4, percentUnits: 75, percentPoints: 75, passed: true },
      { key: "Финансовые метрики", items: 3, answered: 3, earned: 1, possible: 3, percentUnits: 33.3, percentPoints: 33.3, passed: false },
    ],
    topicResults: [
      {
        topicId: "t1",
        topicName: "Управление командой",
        correct: 7,
        total: 10,
        percent: 70,
        earnedPoints: 7,
        possiblePoints: 10,
        passed: true,
        breakdown: [
          { key: "Корпоративная культура", items: 4, answered: 4, earned: 3, possible: 4, percentUnits: 75, percentPoints: 75, passed: true },
        ],
        recommendedCourses: [{ title: "Основы лидерства", url: "https://e/lead" }],
        recommendedEvents: [{ title: "Семинар для руководителей" }],
        feedbackTexts: ["Обратите внимание на делегирование."],
      },
      {
        topicId: "t2",
        topicName: "Корпоративные финансы",
        correct: 5,
        total: 10,
        percent: 50,
        earnedPoints: 5.5,
        possiblePoints: 10,
        passed: false,
        breakdown: [
          { key: "Финансовые метрики", items: 3, answered: 3, earned: 1, possible: 3, percentUnits: 33.3, percentPoints: 33.3, passed: false },
        ],
        recommendedCourses: [{ title: "Финансы для нефинансистов", url: "https://e/fin" }],
        feedbackTexts: ["Подтяните метрики эффективности."],
      },
    ],
  },
};

/**
 * Заполненный контекст отчёта.
 *
 * Разрезы включаются настройкой показа: без неё ядро не кладёт в строку темы ни одной
 * полосы, и половина сравниваемой разметки просто не родилась бы.
 */
export function buildReportFixtureContext(manifest: unknown): ReportRenderContext {
  // Словарь надписей разрешается ТЕМ ЖЕ путём, каким его получает документ у обоих
  // хостов. Без него заголовки, гейтящиеся словарём (в том числе зонтичный «Ваш
  // результат»), не рождаются вовсе — и сравнение молча не проверяло бы ни их наличие,
  // ни их МЕСТО в документе.
  const bake = resolveReportBake(manifest, "report", null, "");
  return buildReportContext(STANDARD, { labels: bake.labels });
}

/** Адаптивная попытка: подтверждённые уровни, разрезы, рекомендации и материалы. */
const ADAPTIVE: AdaptiveReportInput = {
  testName: "Сертификация руководителей",
  learnerName: "Макарова Анна Васильевна",
  timestamp: "2026-08-15T10:00:00.000Z",
  adaptive: true,
  intro: { text: "Поздравляем с прохождением тестирования!", format: "plain" },
  breakdownDisplay: { visibility: "bar_and_value", basis: "units", placement: "both" },
  result: {
    passed: true,
    breakdowns: [
      { key: "Корпоративная культура", items: 4, answered: 4, earned: 3, possible: 4, percentUnits: 75, percentPoints: 75, passed: true },
    ],
    topicResults: [
      {
        topicName: "Управление командой",
        achievedLevelIndex: 1,
        achievedLevelName: "Целевой",
        feedback: "Уровень подтверждён.",
        recommendedCourses: [{ title: "Основы лидерства", url: "https://e/lead" }],
      },
      {
        topicName: "Корпоративные финансы",
        achievedLevelIndex: 0,
        achievedLevelName: "Начальный",
        feedback: "Уровень не подтверждён.",
        recommendedCourses: [{ title: "Финансы для нефинансистов", url: "https://e/fin" }],
      },
    ],
  },
};

/** Заполненный контекст АДАПТИВНОГО отчёта — по тем же правилам, что и обычного. */
export function buildAdaptiveReportFixtureContext(manifest: unknown): ReportRenderContext {
  const bake = resolveReportBake(manifest, "report.adaptive", null, "");
  return buildAdaptiveReportContext(ADAPTIVE, { labels: bake.labels });
}

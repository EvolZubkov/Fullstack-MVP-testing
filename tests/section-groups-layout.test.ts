/**
 * @module tests/section-groups-layout
 * @description PRD-50 FR-24 - FR-27, задача 6 (часть Б): экран итогов и страница отчёта
 * ОБОИХ штатных шаблонов печатают блоки разделов — заголовок блока, счётчик и карточки
 * его тем, а следом карточки тем без блока.
 *
 * Два требования, ради которых тест и написан:
 *   - тема печатается РОВНО ОДИН раз. Плоский `result.topicResults` остаётся полным (его
 *     печатает сторонний шаблон, не знающий блоков), поэтому раскладка, печатающая блоки,
 *     обязана печатать `ungroupedTopics`, а не весь плоский список;
 *   - тест БЕЗ блоков печатается ровно как сегодня: одна сетка тем, ни одного узла блока.
 *
 * Макеты читаются с диска: контракт — отгруженные файлы, а не копия в фикстуре.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compileTemplate } from "../shared/template/dsl";
import { TEMPLATE_IDS, templateLayouts } from "./helpers/template-roots";

// Все три шаблона: встроенный и два вынесенных в собственные репозитории. Смысл
// паритета в том, что они печатают одну разметку, поэтому список берётся из общего
// реестра — новый шаблон попадает в проверки сам.
const TEMPLATES: Record<string, string> = Object.fromEntries(
  TEMPLATE_IDS.map((id) => [id, templateLayouts(id)]),
);

const topic = (topicName: string) => ({
  topicName,
  correct: 4,
  total: 5,
  percent: 80,
  passClass: "is-pass",
  statusLabel: "Пройдено",
  countsLabel: "4 из 5 (80%)",
  pointsFixedLabel: "4.0/5.0",
  verdictLabel: "Пройден",
  barPercent: 80,
  recommendedCourses: [],
  recommendedEvents: [],
  hasRecommendations: false,
});

const LABELS = {
  results: { heading: "Ваш результат", topics: "Результаты по темам", recommendations: "Рекомендации" },
  facts: { questions: "вопросов", correct: "верно", points: "баллов" },
  topic: { correct: "Правильно", points: "Баллов" },
  recommendations: { courses: "Курсы", events: "Мероприятия", assets: "Материалы" },
};

const GROUPED = {
  topicGroups: [
    {
      key: "competencies",
      label: "Управленческие компетенции",
      counterLabel: "1 / 2",
      passedCount: 1,
      totalCount: 2,
      topics: [topic("Делегирование"), topic("Обратная связь")],
    },
    {
      key: "knowledge",
      label: "Знания",
      counterLabel: "1 / 1",
      passedCount: 1,
      totalCount: 1,
      topics: [topic("Право")],
    },
  ],
  ungroupedTopics: [topic("Вне блоков")],
  topicResults: [topic("Делегирование"), topic("Обратная связь"), topic("Право"), topic("Вне блоков")],
};

const FLAT = { topicResults: [topic("Делегирование"), topic("Право")] };

const resultsContext = (result: Record<string, unknown>) => ({
  course: { title: "Тест" },
  design: {},
  labels: LABELS,
  result: {
    passClass: "is-pass",
    statusLabel: "Пройден",
    scorePercent: 80,
    totalQuestions: 10,
    correct: 8,
    earnedPoints: 8,
    blocks: [{ key: "topics", heading: "Результаты по темам", isTopics: true }],
    ...result,
  },
});

const reportContext = (result: Record<string, unknown>) => ({
  design: {},
  labels: LABELS,
  report: {
    kind: "standard",
    hasTopics: true,
    gridColumns: 2,
    verdictHeadline: "Тест пройден",
    correctLabel: "8/10",
    earnedPointsLabel: "8.0",
    ringDasharray: 276,
    ringDashoffset: 55,
  },
  result: { passed: true, scorePercent: 80, ...result },
});

/** How many times a name shows up in the rendered screen. */
const times = (html: string, needle: string): number => html.split(needle).length - 1;

for (const [templateId, dir] of Object.entries(TEMPLATES)) {
  describe(`${templateId}: экран итогов печатает блоки разделов`, () => {
    const render = compileTemplate(fs.readFileSync(path.join(dir, "results.html"), "utf-8"));

    it("печатает заголовок блока, счётчик и темы блока, а следом темы без блока", () => {
      const html = render(resultsContext(GROUPED));
      expect(html).toContain("Управленческие компетенции");
      expect(html).toContain("1 / 2");
      expect(html).toContain("Знания");
      expect(html).toContain("1 / 1");
      // Порядок: блоки — по порядку автора, темы без блока — ПОСЛЕ всех блоков (FR-25).
      expect(html.indexOf("Управленческие компетенции")).toBeLessThan(html.indexOf("Знания"));
      expect(html.indexOf("Право")).toBeLessThan(html.indexOf("Вне блоков"));
    });

    it("тема печатается ровно один раз, хотя плоский список остаётся полным", () => {
      const html = render(resultsContext(GROUPED));
      for (const name of ["Делегирование", "Обратная связь", "Право", "Вне блоков"]) {
        expect(times(html, name), `тема «${name}» напечатана не один раз`).toBe(1);
      }
    });

    it("тест без блоков печатает прежний плоский список и ни одного узла блока", () => {
      const html = render(resultsContext(FLAT));
      expect(html).not.toContain("tb-topic-group");
      expect(times(html, 'class="tb-topics-grid"')).toBe(1);
      expect(times(html, "Делегирование")).toBe(1);
      expect(times(html, "Право")).toBe(1);
    });
  });

  describe(`${templateId}: страница отчёта печатает блоки разделов`, () => {
    const render = compileTemplate(fs.readFileSync(path.join(dir, "report.html"), "utf-8"));

    it("печатает заголовок блока, счётчик и темы блока, а следом темы без блока", () => {
      const html = render(reportContext(GROUPED));
      expect(html).toContain("Управленческие компетенции");
      expect(html).toContain("1 / 2");
      expect(html.indexOf("Право")).toBeLessThan(html.indexOf("Вне блоков"));
    });

    it("тема печатается ровно один раз", () => {
      const html = render(reportContext(GROUPED));
      for (const name of ["Делегирование", "Обратная связь", "Право", "Вне блоков"]) {
        expect(times(html, name), `тема «${name}» напечатана не один раз`).toBe(1);
      }
    });

    it("тест без блоков печатает прежнюю одну сетку тем", () => {
      const html = render(reportContext(FLAT));
      expect(html).not.toContain("tb-report__topic-group");
      expect(times(html, 'class="tb-report__topics"')).toBe(1);
      expect(times(html, "Делегирование")).toBe(1);
    });
  });

  /**
   * Э6.3: тот же блок в ДОКУМЕНТЕ из блоков (PRD-51, `layouts/report/topics.html`).
   * Новые тесты блоков разделов не заводят — карточка «Блоки итогов» из редактора убрана
   * (решение владельца 12), поэтому ветка БЕЗ блоков стала основной, и шапка со счётчиком
   * не должна оставлять от себя пустую полосу: у «Сертификации» она нарисована карточкой
   * высотой 59 px с собственным фоном, и пустой узел был бы виден на бумаге.
   */
  describe(`${templateId}: блок тем документа гасит шапку, когда блоков разделов нет`, () => {
    const render = compileTemplate(fs.readFileSync(path.join(dir, "report/topics.html"), "utf-8"));

    it("без блоков разделов шапки нет вовсе", () => {
      const html = render(reportContext(FLAT));
      expect(html).not.toContain("tb-report__topic-group-head");
      expect(html).not.toContain("tb-report__topic-group-counter");
      expect(times(html, 'class="tb-report__topics"')).toBe(1);
      expect(times(html, "Делегирование")).toBe(1);
    });

    it("с блоками шапка печатает заголовок и счётчик", () => {
      const html = render(reportContext(GROUPED));
      expect(times(html, "tb-report__topic-group-head")).toBe(2);
      expect(html).toContain("Управленческие компетенции");
      expect(html).toContain("1 / 2");
      // Темы вне блоков идут своей карточкой — и она тоже без шапки.
      expect(times(html, "Вне блоков")).toBe(1);
    });
  });
}

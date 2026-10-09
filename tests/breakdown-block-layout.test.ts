/**
 * @module tests/breakdown-block-layout
 * @description PRD-50 FR-28/FR-30/FR-33, задача 9: экран итогов и страница отчёта ОБОИХ
 * штатных шаблонов печатают сводный блок разреза по области теста.
 *
 * Требования, ради которых написан тест:
 *   - ключ, живущий в двух разделах, виден ОДНОЙ сводной строкой: строки внутри блока не
 *     группируются по разделам, иначе блок повторял бы карточки тем;
 *   - тест без включённого блока печатает ровно то же, что печатал до этапа — ни одного
 *     нового узла.
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

const LABELS = {
  results: { heading: "Ваш результат", topics: "Результаты по темам", breakdown: "Разрез результата" },
  facts: { questions: "вопросов", correct: "верно", points: "баллов" },
  topic: { correct: "Правильно", points: "Баллов" },
  recommendations: { courses: "Курсы", events: "Мероприятия", assets: "Материалы" },
};

/**
 * Ключ «ПДн» выдан в двух разделах — в блоке он ОДНА строка на весь тест.
 *
 * Исход у строки ЕСТЬ (PRD-50 §16), но говорит он ТОНОМ: `passed`/`passClass` и надпись
 * порога `requiredLabel`. Словесной метки исхода у строки нет и не заводится — вердикт
 * словом объявляет карточка темы вокруг. Порога у ключа может не быть вовсе, и тогда
 * строка печатается ровно так, как печаталась до §16, — обе ветки в фикстуре ниже.
 */
const ROWS = [
  { key: "ПДн", items: 4, answered: 4, earned: 3, possible: 4, percent: 75, percentUnits: 75,
    percentPoints: 75, barPercent: 75, showValue: true, valueLabel: "75 %",
    passed: true, passClass: "is-pass", requiredLabel: "Нужно 70 %" },
  { key: "Антикоррупция", items: 2, answered: 1, earned: 0, possible: 2, percent: 0, percentUnits: 0,
    percentPoints: 0, barPercent: 0, showValue: true, valueLabel: "0 %",
    passed: false, passClass: "is-fail", requiredLabel: "Нужно 60 %" },
  // Порога нет — исхода нет: ни класса, ни надписи.
  { key: "Этика", items: 3, answered: 3, earned: 2, possible: 3, percent: 67, percentUnits: 67,
    percentPoints: 67, barPercent: 67, showValue: true, valueLabel: "67 %",
    passed: null, passClass: "" },
];

const topic = (topicName: string) => ({
  topicName, correct: 4, total: 5, percent: 80, passClass: "is-pass", statusLabel: "Пройдено",
  countsLabel: "4 из 5 (80%)", pointsFixedLabel: "4.0/5.0", verdictLabel: "Пройден", barPercent: 80,
  recommendedCourses: [], recommendedEvents: [], hasRecommendations: false,
});

const WITH_BLOCK = { topicResults: [topic("Право")], breakdown: ROWS };
const WITHOUT_BLOCK = { topicResults: [topic("Право")] };

const resultsContext = (result: Record<string, unknown>, withBlockSubblock: boolean) => ({
  course: { title: "Тест" },
  design: {},
  labels: LABELS,
  result: {
    passClass: "is-pass", statusLabel: "Пройден", scorePercent: 80,
    totalQuestions: 10, correct: 8, earnedPoints: 8,
    blocks: [
      { key: "topics", heading: "Результаты по темам", isTopics: true },
      ...(withBlockSubblock ? [{ key: "breakdown", heading: "Разрез результата", isBreakdown: true }] : []),
    ],
    ...result,
  },
});

const reportContext = (result: Record<string, unknown>) => ({
  design: {},
  labels: LABELS,
  report: {
    kind: "standard", hasTopics: true, gridColumns: 2, verdictHeadline: "Тест пройден",
    correctLabel: "8/10", earnedPointsLabel: "8.0", ringDasharray: 276, ringDashoffset: 55,
  },
  result: { passed: true, scorePercent: 80, ...result },
});

/** How many times a name shows up in the rendered screen. */
const times = (html: string, needle: string): number => html.split(needle).length - 1;

for (const [templateId, dir] of Object.entries(TEMPLATES)) {
  describe(`${templateId}: экран итогов печатает сводный блок разреза`, () => {
    const render = compileTemplate(fs.readFileSync(path.join(dir, "results.html"), "utf-8"));

    it("печатает заголовок блока и по одной строке на ключ", () => {
      const html = render(resultsContext(WITH_BLOCK, true));
      expect(html).toContain("Разрез результата");
      expect(times(html, 'class="tb-breakdown"')).toBe(1);
      expect(times(html, 'data-item="ПДн"')).toBe(1);
      expect(times(html, 'data-item="Антикоррупция"')).toBe(1);
      expect(html).toContain("width: 75%;");
    });

    it("строка несёт число базы, тон исхода и надпись порога — но не слово вердикта", () => {
      const html = render(resultsContext(WITH_BLOCK, true));
      expect(html).toContain("75 %");
      // Тон говорит об исходе; слово об исходе принадлежит карточке темы вокруг.
      expect(html).toContain("tb-breakdown__row is-pass");
      expect(html).toContain("tb-breakdown__row is-fail");
      expect(html).toContain("Нужно 70 %");
      expect(html).not.toContain("tb-breakdown__status");
    });

    it("ключ без порога печатается нейтрально", () => {
      const html = render(resultsContext(WITH_BLOCK, true));
      // «Этика» порога не знает: строка без модификатора и без надписи порога.
      expect(html).toContain('class="tb-breakdown__row " data-item="Этика"');
      expect(times(html, "Нужно ")).toBe(2);
    });

    it("блок выключен — ни узла, ни заголовка", () => {
      const html = render(resultsContext(WITHOUT_BLOCK, false));
      expect(html).not.toContain('class="tb-breakdown"');
      expect(html).not.toContain("Разрез результата");
    });

    it("шаблон печатает блок ТОЛЬКО по флагу подблока (FR-30)", () => {
      // Данные в контексте есть, но состав подблоков их не объявил — так выглядит экран
      // шаблона, который ключа `breakdown` не знает.
      const html = render(resultsContext(WITH_BLOCK, false));
      expect(html).not.toContain('class="tb-breakdown"');
    });
  });

  describe(`${templateId}: страница отчёта печатает сводный блок разреза`, () => {
    const render = compileTemplate(fs.readFileSync(path.join(dir, "report.html"), "utf-8"));

    it("печатает свою карточку с заголовком и строками", () => {
      const html = render(reportContext(WITH_BLOCK));
      expect(html).toContain("Разрез результата");
      expect(times(html, "tb-report__breakdown--block")).toBe(1);
      expect(times(html, 'data-item="ПДн"')).toBe(1);
      // Бумага повторяет экран и в этом: тон исхода есть, слова вердикта нет.
      expect(html).toContain("tb-report__breakdown-row is-pass");
      expect(html).toContain("tb-report__breakdown-row is-fail");
      expect(html).toContain("Нужно 70 %");
      expect(html).not.toContain("tb-report__breakdown-status");
    });

    it("блок выключен — карточки нет", () => {
      const html = render(reportContext(WITHOUT_BLOCK));
      expect(html).not.toContain("tb-report__breakdown--block");
      expect(html).not.toContain("Разрез результата");
    });
  });

  /**
   * Э5: адаптивный режим печатает ОДИН разрез — сводный. Карточка темы там говорит
   * подтверждённым уровнем, поэтому полос внутри неё нет ни на экране, ни в документе, а
   * блок по области теста с лестницей не спорит.
   */
  describe(`${templateId}: адаптивный экран и документ печатают ТОЛЬКО сводный блок`, () => {
    const screen = compileTemplate(fs.readFileSync(path.join(dir, "results.adaptive.html"), "utf-8"));
    const report = compileTemplate(fs.readFileSync(path.join(dir, "report.adaptive.html"), "utf-8"));
    const level = { topicName: "Право", levelLabel: "Базовый", levelClass: "is-pass", achievedClass: "is-pass" };
    const adaptiveScreen = (result: Record<string, unknown>, withBlockSubblock: boolean) => ({
      course: { title: "Тест" },
      design: {},
      labels: LABELS,
      result: {
        adaptive: true,
        topicResults: [level],
        blocks: [
          { key: "topics", heading: "Результаты по темам", isTopics: true },
          ...(withBlockSubblock ? [{ key: "breakdown", heading: "Разрез результата", isBreakdown: true }] : []),
        ],
        ...result,
      },
    });
    const adaptiveReport = (result: Record<string, unknown>) => ({
      design: {},
      labels: LABELS,
      report: { kind: "adaptive", hasTopics: true, gridColumns: 2 },
      result: { adaptive: true, topicResults: [level], ...result },
    });

    it("экран печатает по одной строке на ключ", () => {
      const html = screen(adaptiveScreen({ breakdown: ROWS }, true));
      expect(html).toContain("Разрез результата");
      expect(times(html, 'class="tb-breakdown"')).toBe(1);
      expect(times(html, 'data-item="ПДн"')).toBe(1);
      expect(times(html, 'data-item="Антикоррупция"')).toBe(1);
    });

    it("экран без включённого блока остаётся прежним", () => {
      const html = screen(adaptiveScreen({}, false));
      expect(html).not.toContain('class="tb-breakdown"');
      expect(html).not.toContain("Разрез результата");
    });

    it("документ печатает свою карточку теми же строками", () => {
      const html = report(adaptiveReport({ breakdown: ROWS }));
      expect(html).toContain("Разрез результата");
      expect(times(html, "tb-report__breakdown--block")).toBe(1);
      expect(times(html, 'data-item="ПДн"')).toBe(1);
    });

    it("документ без блока остаётся прежним", () => {
      const html = report(adaptiveReport({}));
      expect(html).not.toContain("tb-report__breakdown--block");
      expect(html).not.toContain("Разрез результата");
    });

    it("состав подблоков этого экрана объявлен манифестом и несёт разрез последним", () => {
      const manifestPath = path.join(dir, "..", "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(manifest.resultsBlockOrder["results.adaptive"]).toEqual([
        "topics", "scales", "indicators", "breakdown",
      ]);
      // Сводки баллов у адаптивного экрана нет и быть не может — состав это и говорит.
      expect(manifest.resultsBlockOrder["results.adaptive"]).not.toContain("summary");
    });
  });
}

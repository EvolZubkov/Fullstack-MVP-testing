// @vitest-environment jsdom
/**
 * @module tests/report-layout-parity
 *
 * PRD-27 §6.2 — приёмка ПЕРЕНОСА вёрстки отчёта из кода в макет шаблона.
 *
 * Требование документа: «перенос — это перенос, а не редизайн», любое расхождение вида до
 * и после — дефект переноса. Побайтно сравнить нельзя (в коде были инлайн-стили, у макета
 * своя таблица), поэтому сравнивается то, что видит человек: весь ТЕКСТ страницы, число и
 * порядок карточек тем, кликабельные чипы и их адреса, наличие блоков.
 *
 * Пока строитель `buildReportHtml` жив, он и служит эталоном. Когда Фаза 2 его удалит,
 * эталоном останутся зафиксированные здесь ожидания.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildReportHtml, buildAdaptiveReportHtml } from "../shared/report/report-html";
import { buildReportContext, buildAdaptiveReportContext } from "../shared/report/report-context";
import type { ReportInput, AdaptiveReportInput } from "../shared/report/report-html";

const DEFAULT_DIR = path.resolve(process.cwd(), "server", "scorm", "templates", "default");
const layout = (name: string) => fs.readFileSync(path.join(DEFAULT_DIR, "layouts", name), "utf8");
const REPORT = layout("report.html");
const REPORT_ADAPTIVE = layout("report.adaptive.html");

/**
 * Подпись видимого текста. Пробелы убираются ПОЛНОСТЬЮ: строитель склеивал блоки без
 * разделителей, у макета есть отступы, и предмет сверки — состав и порядок текста, а не
 * разметка. Обе стороны нормализуются одинаково.
 */
function textSignature(source: string | HTMLElement): string {
  const text =
    typeof source === "string"
      ? ((): string => {
          const host = document.createElement("div");
          host.innerHTML = source;
          return host.textContent ?? "";
        })()
      : (source.textContent ?? "");
  return text.replace(/\s+/g, "");
}

/** Видимый текст со схлопнутыми пробелами — для проверок «содержит». */
function visibleText(html: string): string {
  const host = document.createElement("div");
  host.innerHTML = html;
  return (host.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** То же для отрендеренного макета. */
function renderToRoot(layoutHtml: string, context: unknown): HTMLElement {
  const root = document.createElement("div");
  renderScreenInto(root, { layout: layoutHtml, context });
  return root;
}

const linkUrls = (el: ParentNode) =>
  [...el.querySelectorAll(".pdf-link-btn")].map((n) => n.getAttribute("data-url"));

const linkUrlsFromHtml = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return linkUrls(host);
};

const STANDARD: ReportInput = {
  testName: "Сертификационный тест",
  learnerName: "Ольга Швецова",
  timestamp: "2026-07-29T20:00:00.000Z",
  attemptsCount: 2,
  result: {
    passed: false,
    percent: 33.94,
    totalQuestions: 64,
    correct: 10,
    earnedPoints: 37,
    possiblePoints: 109,
    topicResults: [
      {
        topicId: "t1",
        topicName: "Корпоративные компетенции (часть 1)",
        correct: 0,
        total: 8,
        percent: 31,
        earnedPoints: 5,
        possiblePoints: 16,
        passed: true,
      },
      {
        topicId: "t2",
        topicName: "Технологии",
        correct: 1,
        total: 12,
        percent: 18,
        earnedPoints: 4,
        possiblePoints: 22,
        passed: false,
        feedback: "Повторите раздел про сети",
        recommendedCourses: [{ title: "Основы сетей", url: "https://e/net" }],
        recommendedEvents: [{ title: "Семинар по инфраструктуре" }],
      },
      {
        topicId: "t3",
        topicName: "Право",
        correct: 1,
        total: 10,
        percent: 36,
        earnedPoints: 5,
        possiblePoints: 14,
        passed: false,
        // Тот же курс, что у другой проваленной темы — в отчёте он один раз.
        recommendedCourses: [{ title: "Основы сетей", url: "https://e/net" }],
      },
    ],
  },
};

describe("report.html: макет повторяет страницу, которую печатал код", () => {
  it("весь видимый текст совпадает", () => {
    const expected = textSignature(buildReportHtml(STANDARD));
    const actual = textSignature(renderToRoot(REPORT, buildReportContext(STANDARD)));
    expect(actual).toBe(expected);
  });

  it("карточек тем столько же и в том же порядке", () => {
    const root = renderToRoot(REPORT, buildReportContext(STANDARD));
    const names = [...root.querySelectorAll(".tb-report__topic-name")].map((n) => n.textContent);
    expect(names).toEqual([
      "Корпоративные компетенции (часть 1)",
      "Технологии",
      "Право",
    ]);
  });

  it("вердикт темы и класс исхода на месте", () => {
    const root = renderToRoot(REPORT, buildReportContext(STANDARD));
    const cards = [...root.querySelectorAll(".tb-report__topic")];
    expect(cards[0].className).toContain("is-pass");
    expect(cards[1].className).toContain("is-fail");
    expect(cards[0].querySelector(".tb-report__topic-verdict")?.textContent).toBe("Пройден");
    expect(cards[1].querySelector(".tb-report__topic-verdict")?.textContent).toBe("Не пройден");
  });

  it("обратная связь печатается только по проваленной теме", () => {
    const root = renderToRoot(REPORT, buildReportContext(STANDARD));
    const cards = [...root.querySelectorAll(".tb-report__topic")];
    expect(cards[0].querySelector(".tb-report__topic-fb")).toBeNull();
    expect(cards[1].querySelector(".tb-report__topic-fb")?.textContent).toBe("Повторите раздел про сети");
  });

  it("кликабельные чипы и их адреса совпадают с эталоном, дубль курса убран", () => {
    const root = renderToRoot(REPORT, buildReportContext(STANDARD));
    expect(linkUrls(root)).toEqual(linkUrlsFromHtml(buildReportHtml(STANDARD)));
    expect(linkUrls(root)).toEqual(["https://e/net"]);
  });

  it("геометрия дуги — своя, радиусом 44, а не кольцо экрана", () => {
    const root = renderToRoot(REPORT, buildReportContext(STANDARD));
    const fill = root.querySelector(".tb-report__ring-fill");
    expect(fill?.getAttribute("stroke-dasharray")).toBe(String(2 * Math.PI * 44));
    // 34% пройдено -> дуга закрашена на треть.
    const offset = Number(fill?.getAttribute("stroke-dashoffset"));
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(2 * Math.PI * 44);
  });

  it("класс исхода на корне и колонки сетки из контекста", () => {
    const root = renderToRoot(REPORT, buildReportContext(STANDARD));
    expect(root.querySelector(".tb-report")?.className).toContain("is-fail");
    expect(root.querySelector<HTMLElement>(".tb-report__topics")?.style.gridTemplateColumns).toBe("repeat(3, 1fr)");
  });

  it("пройденный тест меняет заголовок и класс, как раньше", () => {
    const passed: ReportInput = { ...STANDARD, result: { ...STANDARD.result, passed: true } };
    const root = renderToRoot(REPORT, buildReportContext(passed));
    expect(root.querySelector(".tb-report__headline")?.textContent).toBe("Тест пройден");
    expect(root.querySelector(".tb-report")?.className).toContain("is-pass");
    expect(visibleText(buildReportHtml(passed))).toContain("Тест пройден");
  });

  it("без тем блок тем не рендерится", () => {
    const empty: ReportInput = { ...STANDARD, result: { ...STANDARD.result, topicResults: [] } };
    const root = renderToRoot(REPORT, buildReportContext(empty));
    expect(root.querySelector(".tb-report__topics")).toBeNull();
    expect(root.querySelector(".tb-report__headline")).not.toBeNull();
  });

  it("логотип и подложку ставит контекст, без них строк нет", () => {
    const plain = renderToRoot(REPORT, buildReportContext(STANDARD));
    expect(plain.querySelector(".tb-report__brand")).toBeNull();
    const branded = renderToRoot(
      REPORT,
      buildReportContext(STANDARD, { assets: { logoDataUrl: "data:image/png;base64,AA" } }),
    );
    expect(branded.querySelector(".tb-report__brand img")?.getAttribute("src")).toBe("data:image/png;base64,AA");
  });

  it("имя слушателя гейтит свою строку", () => {
    const anon: ReportInput = { ...STANDARD, learnerName: null };
    expect(renderToRoot(REPORT, buildReportContext(anon)).querySelector(".tb-report__learner")).toBeNull();
    expect(renderToRoot(REPORT, buildReportContext(STANDARD)).querySelector(".tb-report__learner")?.textContent).toContain(
      "Ольга Швецова",
    );
  });
});

const ADAPTIVE: AdaptiveReportInput = {
  testName: "Тест профессиональных знаний",
  learnerName: "Ольга Швецова",
  timestamp: "2026-07-29T20:00:00.000Z",
  adaptive: true,
  result: {
    topicResults: [
      {
        topicName: "Управление численностью",
        achievedLevelIndex: null,
        achievedLevelName: null,
        totalQuestionsAnswered: 9,
        totalCorrect: 1,
        feedback: "Ваш уровень знаний по данной теме - начальный",
        recommendedCourses: [{ title: "Планирование штата", url: "https://e/hc" }],
      },
      {
        topicName: "Вознаграждение и льготы",
        achievedLevelIndex: 1,
        achievedLevelName: "Базовый",
      },
    ],
  },
};

describe("report.adaptive.html: макет повторяет адаптивную страницу", () => {
  it("весь видимый текст совпадает", () => {
    const expected = textSignature(buildAdaptiveReportHtml(ADAPTIVE));
    const actual = textSignature(renderToRoot(REPORT_ADAPTIVE, buildAdaptiveReportContext(ADAPTIVE)));
    expect(actual).toBe(expected);
  });

  it("уровни, класс подтверждения и счётчики", () => {
    const root = renderToRoot(REPORT_ADAPTIVE, buildAdaptiveReportContext(ADAPTIVE));
    const cards = [...root.querySelectorAll(".tb-report__topic")];
    expect(cards[0].className).toContain("is-below");
    expect(cards[1].className).toContain("is-achieved");
    expect(cards[0].querySelector(".tb-report__topic-level")?.textContent).toContain(
      "Минимально требуемый уровень не подтверждён",
    );
    expect(cards[0].querySelector(".tb-report__topic-counts")?.textContent).toContain("Вопросов: 9");
    // Тема без счётчиков строку не печатает — нулей быть не должно.
    expect(cards[1].querySelector(".tb-report__topic-counts")).toBeNull();
  });

  it("материалы перечисляются с названием темы и остаются кликабельными", () => {
    const root = renderToRoot(REPORT_ADAPTIVE, buildAdaptiveReportContext(ADAPTIVE));
    expect(root.querySelector(".tb-report__rec-topic")?.textContent).toBe("Управление численностью");
    expect(linkUrls(root)).toEqual(linkUrlsFromHtml(buildAdaptiveReportHtml(ADAPTIVE)));
    expect(linkUrls(root)).toEqual(["https://e/hc"]);
  });

  it("баллов и кольца в адаптивном отчёте нет", () => {
    const root = renderToRoot(REPORT_ADAPTIVE, buildAdaptiveReportContext(ADAPTIVE));
    expect(root.querySelector(".tb-report__ring")).toBeNull();
    expect(root.querySelector(".tb-report__badge")).toBeNull();
  });
});

describe("макеты отчёта соблюдают контракт среды стилей (§6.3)", () => {
  it("корневой класс tb-report и ни одного класса слоя сцены", () => {
    for (const [name, html] of [["report.html", REPORT], ["report.adaptive.html", REPORT_ADAPTIVE]] as const) {
      expect(html, name).toMatch(/class="tb-report\b/);
      expect(html, name).not.toMatch(/\btb-scene/);
    }
  });

  it("таблица стилей отчёта скоуплена и не адресует документ", () => {
    const css = fs.readFileSync(path.join(DEFAULT_DIR, "styles", "report.css"), "utf8");
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/(^|[};])\s*([^{}@;]+)\{/g) ?? [];
    for (const raw of selectors) {
      const selector = raw.replace(/^[};]?\s*/, "").replace(/\s*\{$/, "");
      expect(selector, selector).toContain(".tb-report");
      expect(selector, selector).not.toMatch(/(^|[\s,>+~])(:root|html|body)(?![\w-])/i);
    }
  });
});

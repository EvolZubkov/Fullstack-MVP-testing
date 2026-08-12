// @vitest-environment jsdom
/**
 * @module tests/report-layout-parity
 *
 * PRD-27 §6.2 — приёмка ПЕРЕНОСА вёрстки отчёта из кода в макет шаблона.
 *
 * Требование документа: «перенос — это перенос, а не редизайн», любое расхождение вида до
 * и после — дефект переноса.
 *
 * Равенство макета и прежнего строителя проверено в коммите 2ac6b2d, где оба
 * существовали: подпись всего видимого текста совпадала символ в символ. Строитель удалён
 * (Фаза 2), поэтому эталоном служат перечисленные здесь ожидания — состав и ПОРЯДОК
 * текста, число и порядок карточек тем, вердикты, адреса кликабельных чипов, гейты блоков.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildReportContext, buildAdaptiveReportContext } from "../shared/report/report-context";
import { LEVEL_SCHEMES } from "../shared/template/level-ramp";
import type { ReportInput, AdaptiveReportInput } from "../shared/report/report-html";

const DEFAULT_DIR = path.resolve(process.cwd(), "server", "scorm", "templates", "default");
const CERT_DIR = path.resolve(process.cwd(), "templates", "certification");
const layout = (name: string) => fs.readFileSync(path.join(DEFAULT_DIR, "layouts", name), "utf8");
const REPORT = layout("report.html");
const REPORT_ADAPTIVE = layout("report.adaptive.html");

/** Макеты отчёта КАЖДОГО поставляемого шаблона — паритет держится вручную. */
const REPORT_LAYOUTS: Array<[string, string, string]> = [
  ["default", REPORT, REPORT_ADAPTIVE],
  [
    "certification",
    fs.readFileSync(path.join(CERT_DIR, "layouts", "report.html"), "utf8"),
    fs.readFileSync(path.join(CERT_DIR, "layouts", "report.adaptive.html"), "utf8"),
  ],
];

/** Видимый текст со схлопнутыми пробелами. */
function visibleText(source: HTMLElement): string {
  return (source.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Каждый фрагмент присутствует и идёт ПОСЛЕ предыдущего. Порядок — часть вида отчёта:
 * вердикт до счёта, счёт до тем, темы до рекомендаций.
 */
function expectInOrder(text: string, fragments: string[]): void {
  let cursor = 0;
  for (const fragment of fragments) {
    const at = text.indexOf(fragment, cursor);
    expect(at, "фрагмент не найден по порядку: " + fragment).toBeGreaterThanOrEqual(0);
    cursor = at + fragment.length;
  }
}

/** То же для отрендеренного макета. */
function renderToRoot(layoutHtml: string, context: unknown): HTMLElement {
  const root = document.createElement("div");
  renderScreenInto(root, { layout: layoutHtml, context });
  return root;
}

const linkUrls = (el: ParentNode) =>
  [...el.querySelectorAll(".pdf-link-btn")].map((n) => n.getAttribute("data-url"));

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
  it("печатает всё, что печатал код, и в том же порядке", () => {
    const text = visibleText(renderToRoot(REPORT, buildReportContext(STANDARD)));
    expectInOrder(text, [
      // Название теста печатается ПЕРВЫМ: документ должен назвать себя раньше, чем
      // вынесет вердикт. Раньше оно стояло в карточке счёта, то есть после вводного
      // блока автора и посреди страницы.
      "Сертификационный тест",
      "Тест не пройден",
      "Лучший результат за 2 попытки",
      "Слушатель: Ольга Швецова",
      "Дата прохождения:",
      "Результат теста",
      "64",
      "вопросов",
      "10/64",
      "верно",
      "37.0",
      "баллов",
      "34%",
      "не пройден",
      "Результаты по темам",
      "Корпоративные компетенции (часть 1)",
      "Пройден",
      "0 из 8 (31%)",
      "5.0/16.0",
      "Технологии",
      "Не пройден",
      "1 из 12 (18%)",
      "4.0/22.0",
      "Право",
      "1 из 10 (36%)",
      "5.0/14.0",
      "Рекомендации по курсам",
      "Изучите эти материалы для улучшения знаний по темам, которые требуют внимания.",
      "Основы сетей",
      "Рекомендуемые мероприятия",
      "Посетите очные мероприятия для углублённого изучения материала.",
      "Семинар по инфраструктуре",
    ]);
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

  // Слот текста в карточке темы снят: текст обратной связи печатается один раз, в
  // консолидированном блоке (см. describe ниже). Контекст здесь нарочно несёт устаревшее
  // поле `feedback` у проваленной темы — макет обязан его игнорировать.
  it("карточка темы обратной связи не печатает", () => {
    const root = renderToRoot(REPORT, buildReportContext(STANDARD));
    expect(root.querySelector(".tb-report__topic-fb")).toBeNull();
    expect(visibleText(root)).not.toContain("Повторите раздел про сети");
  });

  it("кликабельный чип один: дубль курса по двум проваленным темам убран", () => {
    const root = renderToRoot(REPORT, buildReportContext(STANDARD));
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
    // Бейдж вердикта тоже переключается — строчными, как печаталось раньше.
    expect(root.querySelector(".tb-report__badge")?.textContent).toBe("пройден");
  });

  it("без тем блок тем не рендерится", () => {
    const empty: ReportInput = { ...STANDARD, result: { ...STANDARD.result, topicResults: [] } };
    const root = renderToRoot(REPORT, buildReportContext(empty));
    expect(root.querySelector(".tb-report__topics")).toBeNull();
    expect(root.querySelector(".tb-report__headline")).not.toBeNull();
  });

  it("логотип ставит поле ВАРИАНТА, без него строки нет", () => {
    const plain = renderToRoot(REPORT, buildReportContext(STANDARD));
    expect(plain.querySelector(".tb-report__brand")).toBeNull();
    const branded = renderToRoot(
      REPORT,
      buildReportContext(STANDARD, { values: { logoImage: "data:image/png;base64,AA" } }),
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
  it("печатает всё, что печатал код, и в том же порядке", () => {
    const text = visibleText(renderToRoot(REPORT_ADAPTIVE, buildAdaptiveReportContext(ADAPTIVE)));
    expectInOrder(text, [
      "Результаты теста",
      "Адаптивное тестирование",
      "Слушатель: Ольга Швецова",
      "Дата прохождения:",
      "Тест профессиональных знаний",
      "Результаты по темам",
      "Управление численностью",
      "Минимально требуемый уровень не подтверждён",
      "Вопросов: 9",
      "Правильных: 1",
      "Ваш уровень знаний по данной теме - начальный",
      "Вознаграждение и льготы",
      "Базовый",
      "Рекомендуемые материалы",
      "Изучите эти материалы для улучшения знаний.",
      "Управление численностью",
      "Планирование штата",
    ]);
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
    expect(linkUrls(root)).toEqual(["https://e/hc"]);
  });

  it("баллов и кольца в адаптивном отчёте нет", () => {
    const root = renderToRoot(REPORT_ADAPTIVE, buildAdaptiveReportContext(ADAPTIVE));
    expect(root.querySelector(".tb-report__ring")).toBeNull();
    expect(root.querySelector(".tb-report__badge")).toBeNull();
  });
});

describe("содержательные правила отчёта, перенесённые из удалённых строителей", () => {
  it("склонение числа попыток печатается макетом", () => {
    const forms = (attemptsCount: number | undefined) =>
      visibleText(renderToRoot(REPORT, buildReportContext({ ...STANDARD, attemptsCount })));
    expect(forms(1)).toContain("за 1 попытку");
    expect(forms(3)).toContain("за 3 попытки");
    expect(forms(11)).toContain("за 11 попыток");
    // Ни попытки — всё равно «за 1 попытку», а не «за 0 попыток».
    expect(forms(undefined)).toContain("за 1 попытку");
  });

  it("у теста, который ничего не оценивает, строки попыток нет вовсе", () => {
    // «Лучший результат за 1 попытку» над профилем измерений сравнивает прогоны по баллам,
    // которых у методики нет. Гейт стоит на УЗЛЕ: пустой подписи мало — блок несёт отступ и
    // оставил бы разрыв между шапкой и строкой слушателя.
    const measurement: ReportInput = {
      ...STANDARD,
      hasPassThreshold: true,
      result: {
        passed: true,
        percent: 0,
        totalQuestions: 0,
        correct: 0,
        earnedPoints: 0,
        possiblePoints: 0,
        topicResults: [],
      },
    };
    const root = renderToRoot(REPORT, buildReportContext(measurement));
    expect(root.querySelector(".tb-report__attempts")).toBeNull();
    expect(visibleText(root)).not.toContain("Лучший результат");
    // Дата прохождения — не утверждение о баллах, она остаётся.
    expect(visibleText(root)).toContain("Дата прохождения:");
  });

  it("авторский текст экранируется, а не исполняется", () => {
    const evil: ReportInput = { ...STANDARD, testName: '<img src=x onerror="alert(1)">' };
    const root = renderToRoot(REPORT, buildReportContext(evil));
    expect(root.querySelector("img")).toBeNull();
    expect(visibleText(root)).toContain('<img src=x onerror="alert(1)">');
  });

  it("рекомендации проваленных тем: курсы и мероприятия, без дублей и без пройденных", () => {
    const withPassedCourse: ReportInput = {
      ...STANDARD,
      result: {
        ...STANDARD.result,
        topicResults: [
          ...STANDARD.result.topicResults,
          {
            topicId: "t4",
            topicName: "Сети",
            correct: 8,
            total: 8,
            percent: 100,
            earnedPoints: 8,
            possiblePoints: 8,
            passed: true,
            // Курс ПРОЙДЕННОЙ темы в отчёт не попадает: помощь адресуется провалу.
            recommendedCourses: [{ title: "Курс пройденной темы", url: "https://e/passed" }],
          },
        ],
      },
    };
    const text = visibleText(renderToRoot(REPORT, buildReportContext(withPassedCourse)));
    expect(text).toContain("Основы сетей");
    expect(text).toContain("Семинар по инфраструктуре");
    expect(text).not.toContain("Курс пройденной темы");
    expect(text.match(/Основы сетей/g)).toHaveLength(1);
  });

  it("без рекомендаций блоки курсов и мероприятий не рендерятся", () => {
    const bare: ReportInput = {
      ...STANDARD,
      result: {
        ...STANDARD.result,
        topicResults: STANDARD.result.topicResults.map((t) => ({
          ...t,
          recommendedCourses: [],
          recommendedEvents: [],
        })),
      },
    };
    const text = visibleText(renderToRoot(REPORT, buildReportContext(bare)));
    expect(text).not.toContain("Рекомендации по курсам");
    expect(text).not.toContain("Рекомендуемые мероприятия");
  });

  it("подложка приходит полем варианта, без неё макет держит свой фон", () => {
    const withBg = renderToRoot(
      REPORT,
      buildReportContext(STANDARD, { values: { backgroundImage: "data:image/png;base64,AA" } }),
    );
    expect(withBg.querySelector<HTMLElement>(".tb-report")?.style.backgroundImage).toContain("data:image/png;base64,AA");
    const plain = renderToRoot(REPORT, buildReportContext(STANDARD));
    expect(plain.querySelector<HTMLElement>(".tb-report")?.style.backgroundImage).toBe("");
  });
});

/**
 * Консолидированный блок обратной связи — тот же, что на экране итогов. Отчёт печатал
 * только курсы и мероприятия тем, а текстов не печатал вовсе: ни теста, ни темы.
 */
describe("макет печатает консолидированный блок обратной связи", () => {
  const TEST_FEEDBACK = {
    text: "Разберите ошибки.",
    links: [{ title: "Курс по сетям", url: "https://e/net" }],
    events: [{ title: "Разбор кейсов" }],
    assets: [{ title: "Памятка теста", url: "assets/media/test.pdf" }],
  };
  const TOPIC_ASSET = { title: "Разбор темы", url: "assets/media/topic.pdf" };

  const WITH_FEEDBACK: ReportInput = {
    ...STANDARD,
    feedback: TEST_FEEDBACK,
    hasPassThreshold: true,
    result: {
      ...STANDARD.result,
      topicResults: STANDARD.result.topicResults.map((t, i) =>
        i === 1 ? { ...t, feedbackTexts: ["Текст темы", "Текст раздела"], recommendedAssets: [TOPIC_ASSET] } : t,
      ),
    },
  };

  /** Карточка блока: у неё СВОЙ заголовок, класс карточки общий с соседними. */
  const recsCard = (root: HTMLElement): HTMLElement | null => {
    const title = [...root.querySelectorAll(".tb-report__title")].find(
      (n) => (n.textContent ?? "").trim() === "Рекомендации",
    );
    return (title?.parentElement as HTMLElement) ?? null;
  };

  it("печатает тексты теста, темы и раздела в порядке блока", () => {
    const card = recsCard(renderToRoot(REPORT, buildReportContext(WITH_FEEDBACK)));
    expect(card).not.toBeNull();
    expect(visibleText(card as HTMLElement)).toContain("Разберите ошибки. Текст темы Текст раздела");
  });

  it("печатает вложения кликабельными чипами, как курсы", () => {
    const root = renderToRoot(REPORT, buildReportContext(WITH_FEEDBACK));
    const card = recsCard(root) as HTMLElement;
    expect(linkUrls(card)).toEqual(["https://e/net", "assets/media/test.pdf", "assets/media/topic.pdf"]);
    expect(visibleText(card)).toContain("Памятка теста");
    expect(visibleText(card)).toContain("Разбор темы");
  });

  it("текст, написанный и у теста, и у темы, печатается один раз", () => {
    const dup: ReportInput = {
      ...WITH_FEEDBACK,
      result: {
        ...WITH_FEEDBACK.result,
        topicResults: WITH_FEEDBACK.result.topicResults.map((t, i) =>
          i === 1 ? { ...t, feedbackTexts: ["Разберите ошибки."] } : t,
        ),
      },
    };
    const text = visibleText(recsCard(renderToRoot(REPORT, buildReportContext(dup))) as HTMLElement);
    expect(text.match(/Разберите ошибки\./g)).toHaveLength(1);
  });

  it("пройденная тема и явно пройденный тест молчат", () => {
    const passed: ReportInput = {
      ...WITH_FEEDBACK,
      result: {
        ...WITH_FEEDBACK.result,
        passed: true,
        topicResults: WITH_FEEDBACK.result.topicResults.map((t) => ({ ...t, passed: true })),
      },
    };
    expect(recsCard(renderToRoot(REPORT, buildReportContext(passed)))).toBeNull();
  });

  it("отчёт без обратной связи блока не рисует", () => {
    expect(recsCard(renderToRoot(REPORT, buildReportContext(STANDARD)))).toBeNull();
  });

  it("адаптивный отчёт печатает тот же блок", () => {
    const adaptive: AdaptiveReportInput = {
      ...ADAPTIVE,
      feedback: TEST_FEEDBACK,
      result: {
        topicResults: ADAPTIVE.result.topicResults.map((t, i) =>
          i === 0 ? { ...t, feedbackTexts: ["Текст темы"], recommendedAssets: [TOPIC_ASSET] } : t,
        ),
      },
    };
    const card = recsCard(renderToRoot(REPORT_ADAPTIVE, buildAdaptiveReportContext(adaptive))) as HTMLElement;
    expect(card).not.toBeNull();
    expect(visibleText(card)).toContain("Разберите ошибки. Текст темы");
    expect(linkUrls(card)).toEqual(["https://e/net", "assets/media/test.pdf", "assets/media/topic.pdf"]);
  });

  it("адаптивный отчёт без обратной связи блока не рисует", () => {
    expect(recsCard(renderToRoot(REPORT_ADAPTIVE, buildAdaptiveReportContext(ADAPTIVE)))).toBeNull();
  });

  for (const [templateId, reportLayout, adaptiveLayout] of REPORT_LAYOUTS) {
    it(`${templateId}: карточка темы не дублирует текст блока`, () => {
      const both: ReportInput = {
        ...WITH_FEEDBACK,
        result: {
          ...WITH_FEEDBACK.result,
          topicResults: WITH_FEEDBACK.result.topicResults.map((t, i) =>
            // Один и тот же текст и в устаревшем per-topic поле, и в источниках блока.
            i === 1 ? { ...t, feedback: "Текст темы", feedbackTexts: ["Текст темы"] } : t,
          ),
        },
      };
      const root = renderToRoot(reportLayout, buildReportContext(both));
      expect(root.querySelector(".tb-report__topic-fb")).toBeNull();
      expect(visibleText(root).match(/Текст темы/g)).toHaveLength(1);
    });

    // В АДАПТИВНОМ отчёте `feedback` темы — обратная связь достигнутого уровня, а не
    // текст темы: в блок она не подаётся, поэтому слот в карточке сохранён.
    it(`${templateId}: адаптивная карточка печатает обратную связь уровня`, () => {
      const root = renderToRoot(adaptiveLayout, buildAdaptiveReportContext(ADAPTIVE));
      const cards = [...root.querySelectorAll(".tb-report__topic")];
      expect(cards[0].querySelector(".tb-report__topic-fb")?.textContent).toBe(
        "Ваш уровень знаний по данной теме - начальный",
      );
    });

    // issue #33: блок показателей — новый в обоих макетах отчёта, блок шкал в адаптивном
    // до этой работы стоял мёртвым (контекст его не наполнял ни разу).
    it(`${templateId}: печатает показатели и шкалы в обоих режимах`, () => {
      const measures = {
        ramp: LEVEL_SCHEMES.traffic,
        scaleKind: "band_ruler" as const,
        indicatorKind: "label" as const,
        scales: [
          {
            key: "comm", name: "Коммуникация", value: 8, visibility: "level_and_value" as const,
            interpretation: {
              domainMin: 0, domainMax: 10, valence: "higher_is_better" as const,
              bands: [
                { min: 0, max: 5, level: "low", label: "Низкий" },
                { min: 5.01, max: 10, level: "high", label: "Высокий" },
              ],
            },
          },
        ],
        indicators: [
          {
            key: "profile", name: "Профиль", value: "ok", visibility: "level" as const,
            interpretation: {
              domainMin: null, domainMax: null, valence: "none" as const, bands: [],
              outcomes: [{ code: "ok", label: "Устойчивый" }],
            },
          },
        ],
      };
      for (const [layoutName, root] of [
        ["report.html", renderToRoot(reportLayout, buildReportContext(STANDARD, { measures }))],
        ["report.adaptive.html", renderToRoot(adaptiveLayout, buildAdaptiveReportContext(ADAPTIVE, { measures }))],
      ] as const) {
        const text = visibleText(root);
        expect(text, layoutName).toContain("Ваш результат");
        expect(text, layoutName).toContain("Устойчивый");
        expect(text, layoutName).toContain("По шкалам");
        expect(text, layoutName).toContain("Коммуникация");
      }
    });

    // Сетка «диаграмма слева, список справа» включается модификатором, а не самим
    // блоком: без диаграммы единственный ребёнок — список толкований — падал в колонку
    // 240 px и печатался лентой в половину ширины страницы A4.
    it(`${templateId}: колонки блока измерений только там, где есть диаграмма`, () => {
      const scale = {
        key: "comm", name: "Коммуникация", value: 8, visibility: "level_and_value" as const,
        interpretation: {
          domainMin: 0, domainMax: 10, displayMax: null, valence: "higher_is_better" as const,
          bands: [
            { min: 0, max: 5, level: "low", label: "Низкий" },
            { min: 5.01, max: 10, level: "high", label: "Высокий" },
          ],
        },
      };
      const indicator = {
        key: "profile", name: "Профиль", value: "ok", visibility: "level" as const,
        interpretation: {
          domainMin: null, domainMax: null, valence: "none" as const, bands: [],
          outcomes: [{ code: "ok", label: "Устойчивый" }],
        },
      };
      const base = {
        ramp: LEVEL_SCHEMES.traffic,
        scaleKind: "band_ruler" as const,
        indicatorKind: "label" as const,
        scales: [scale],
        indicators: [indicator],
      };
      // Диаграмма выключена — ни один блок измерений колонок не получает.
      const plain = renderToRoot(reportLayout, buildReportContext(STANDARD, { measures: base }));
      const blocks = [...plain.querySelectorAll(".tb-report__scales")];
      expect(blocks.length, "оба блока измерений на месте").toBe(2);
      for (const block of blocks) {
        expect(block.classList.contains("tb-report__scales--chart")).toBe(false);
      }

      // Диаграмма включена — колонки появляются РОВНО у блока шкал, который её рисует.
      // Осей нужно три: фигуру по одной шкале ядро не строит.
      const charted = renderToRoot(
        reportLayout,
        // Переключатель диаграммы у отчёта СВОЙ — поле варианта, а не блок экрана итогов.
        buildReportContext(STANDARD, {
          measures: {
            ...base,
            scales: ["a", "b", "c"].map((key, i) => ({ ...scale, key, name: `Шкала ${key}`, value: 2 + i * 3 })),
            chartSettings: { scalesChartKind: "radar" },
          },
        }),
      );
      const chartBlock = charted.querySelector(".tb-chart")?.closest(".tb-report__scales");
      expect(chartBlock, "блок с диаграммой").toBeTruthy();
      expect(chartBlock!.classList.contains("tb-report__scales--chart")).toBe(true);
      const indicatorsBlock = [...charted.querySelectorAll(".tb-report__scales")].find((b) => !b.querySelector(".tb-chart"));
      expect(indicatorsBlock!.classList.contains("tb-report__scales--chart")).toBe(false);
    });

    // Тест без измерений печатает документ ровно как прежде — карточек не прибавилось.
    it(`${templateId}: без измерений новых карточек в отчёте нет`, () => {
      for (const [layoutName, root] of [
        ["report.html", renderToRoot(reportLayout, buildReportContext(STANDARD))],
        ["report.adaptive.html", renderToRoot(adaptiveLayout, buildAdaptiveReportContext(ADAPTIVE))],
      ] as const) {
        expect(visibleText(root), layoutName).not.toContain("Ваш результат");
        expect(visibleText(root), layoutName).not.toContain("По шкалам");
      }
    });
  }
});

describe("макеты отчёта соблюдают контракт среды стилей (§6.3)", () => {
  it("корневой класс tb-report и ни одного класса слоя сцены", () => {
    for (const [name, html] of [["report.html", REPORT], ["report.adaptive.html", REPORT_ADAPTIVE]] as const) {
      expect(html, name).toMatch(/class="tb-report\b/);
      expect(html, name).not.toMatch(/\btb-scene/);
    }
  });

  it("подпись уровня переносится: длинный вердикт не обрезается", () => {
    // Регрессия: плашка несла `white-space: nowrap` со времён короткого «Не достигнут»,
    // и полный вердикт выходил за карточку, а карточка его обрезала.
    const css = fs.readFileSync(path.join(DEFAULT_DIR, "styles", "report.css"), "utf8");
    const rule = /\.tb-report__topic-level\s*\{([^}]*)\}/.exec(css);
    expect(rule, "правило .tb-report__topic-level не найдено").not.toBeNull();
    expect(rule![1]).not.toContain("nowrap");
    expect(rule![1]).toContain("max-width: 100%");
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

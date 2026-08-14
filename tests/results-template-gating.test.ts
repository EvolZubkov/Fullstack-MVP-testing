// @vitest-environment jsdom
/**
 * @module tests/results-template-gating
 *
 * Guards the PRD-12 host-superset invariant for the results layouts: the SCORM
 * runtime renders the SAME `results.html` / `results.adaptive.html` as the web
 * host, with the SCORM-richer parts (per-topic points / threshold / feedback,
 * recommended courses & events, the back action, the adaptive PDF/retry/finish
 * actions) gated on context flags the WEB context never sets. So the web output
 * must stay identical (those blocks absent) while the SCORM context lights them
 * up. This test renders each layout with a web-shaped and a SCORM-shaped context
 * and asserts the gating, protecting "web byte-identical, SCORM enriched".
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildResultContext } from "../shared/template/result-context";
import { buildResultsNav } from "../shared/template/results-nav";

const layoutsDir = path.join(process.cwd(), "server", "scorm", "templates", "default", "layouts");
const resultsLayout = fs.readFileSync(path.join(layoutsDir, "results.html"), "utf8");
const adaptiveLayout = fs.readFileSync(path.join(layoutsDir, "results.adaptive.html"), "utf8");
/**
 * The adaptive results layout of EVERY shipped design template. Parity between the
 * two is kept by hand, so the recommendations block is asserted on both: a template
 * that never got the block renders an adaptive results screen with no feedback at
 * all, and nothing in the render tests would notice if only `default` were checked.
 */
const adaptiveLayouts: Array<[string, string]> = [
  ["default", adaptiveLayout],
  [
    "certification",
    fs.readFileSync(
      path.join(process.cwd(), "templates", "certification", "layouts", "results.adaptive.html"),
      "utf8",
    ),
  ],
];

/** The STANDARD results layout of every shipped design template — parity kept by hand. */
const standardLayouts: Array<[string, string]> = [
  ["default", resultsLayout],
  [
    "certification",
    fs.readFileSync(path.join(process.cwd(), "templates", "certification", "layouts", "results.html"), "utf8"),
  ],
];

function render(layout: string, context: unknown): HTMLElement {
  const root = document.createElement("div");
  renderScreenInto(root, { layout, context });
  return root;
}

const actions = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("[data-action]")).map((b) => b.getAttribute("data-action"));

/**
 * PRD-49: the standard results screen walks `result.blocks` and takes every heading and
 * row label from `labels` — both are Core-prepared, so a hand-built context must carry
 * them exactly as `buildResultContext` would. The certification layout still prints its
 * own strings and simply ignores the two keys, which is what keeps this fixture shared.
 */
const labels = {
  results: { heading: "Ваш результат", topics: "Результаты по темам", recommendations: "Рекомендации" },
  facts: { questions: "вопросов", correct: "верно", points: "баллов" },
  topic: { correct: "Правильно", points: "Баллов" },
  recommendations: { courses: "Пройти обучение", events: "Мероприятия", assets: "Материалы" },
};

// Minimal web-shaped context (the shape buildResultContext produces — no SCORM extras).
const webResult = {
  course: { title: "Тест" },
  labels,
  result: {
    blocks: [
      { key: "summary", heading: "Общий балл", isSummary: true },
      { key: "topics", heading: "Результаты по темам", isTopics: true },
    ],
    passed: true,
    passClass: "is-pass",
    statusLabel: "Пройден",
    scorePercent: 80,
    ringDashoffset: 79,
    totalQuestions: 5,
    correct: 4,
    earnedPoints: 4,
    possiblePoints: 5,
    topicResults: [
      { topicName: "Тема 1", correct: 4, total: 5, percent: 80, passClass: "is-pass", statusLabel: "Пройдено" },
    ],
  },
};

describe("results.html — superset gating", () => {
  it("web context: restart action only, no SCORM-only blocks", () => {
    const root = render(resultsLayout, webResult);
    expect(actions(root)).toEqual(["restart"]);
    expect(root.querySelector(".tb-topic-card__req")).toBeNull();
    expect(root.querySelector(".tb-recs")).toBeNull();
    // The score-strip "баллов" fact always shows; only the per-topic points ROW is
    // gated — so scope the check to the topic card.
    expect(root.querySelector(".tb-topic-card")?.textContent).not.toContain("Баллов");
    expect(root.querySelectorAll(".tb-topic-card .ou-stat-row").length).toBe(1); // "Правильно" only
  });

  it("SCORM context: points row + threshold + recommendations + back action", () => {
    const scorm = {
      course: { title: "Тест" },
      labels,
      result: {
        ...webResult.result,
        topicResults: [
          {
            ...webResult.result.topicResults[0],
            pointsLabel: "4.0 / 5.0",
            requiredLabel: "Требуется: 70%",
            recommendedCourses: [{ title: "Курс A", url: "https://e/a" }],
            recommendedEvents: [{ title: "Семинар B" }],
            hasRecommendations: true,
          },
        ],
        backAction: "back-to-start",
        backLabel: "Вернуться к тесту",
      },
    };
    const root = render(resultsLayout, scorm);
    expect(actions(root)).toEqual(["back-to-start"]); // restart is hidden via {{#unless backAction}}
    expect(root.querySelector(".tb-topic-card__req")?.textContent).toContain("70%");
    expect(root.querySelectorAll(".tb-topic-card .ou-stat-row").length).toBe(2); // "Правильно" + "Баллов"
    expect(root.querySelector(".tb-topic-card")?.textContent).toContain("Баллов");
    expect(root.textContent).toContain("4.0 / 5.0");
    // Recommendations are per-topic chips now (not a result-level section).
    const recs = [...root.querySelectorAll(".tb-topic-card .tb-rec")].map((r) => r.textContent);
    expect(recs).toContain("Курс A");
    expect(recs).toContain("Семинар B");
    expect(root.querySelector('[data-action="back-to-start"]')?.textContent).toBe("Вернуться к тесту");
  });

  // A topic made entirely of measurement questions (no correct-answer grading) has
  // `total: 0` — aggregateStandardResult never counts measurement-only questions
  // toward it. Printing "Правильно 0 / 0" there is the exact nonsense PRD-29 removed
  // from the test-level summary, just one level down (see acceptance.md "Наблюдения
  // вне объёма PRD-29"). The row must not render at all, in EITHER template.
  for (const [templateId, layout] of standardLayouts) {
    it(`${templateId}: тема без оцениваемых вопросов не печатает «Правильно»`, () => {
      const root = render(layout, {
        course: { title: "Тест" },
        labels,
        result: {
          ...webResult.result,
          topicResults: [
            { topicName: "Опросник", correct: 0, total: 0, percent: 0, passClass: "", statusLabel: "" },
          ],
        },
      });
      const card = root.querySelector(".tb-topic-card") as HTMLElement;
      expect(card.textContent).not.toContain("Правильно");
      expect(card.querySelectorAll(".ou-stat-row").length).toBe(0);
    });
  }
});

/**
 * Текст обратной связи живёт ТОЛЬКО в консолидированном блоке. Раньше карточка темы
 * несла собственный слот текста, и после консолидации он либо пустовал, либо печатал
 * ту же строку второй раз — на одном экране, в двух местах.
 *
 * Проверяется именно МАКЕТ, а не построитель: контекст здесь нарочно несёт и
 * `feedback`/`hasFeedback` (как их несла бы попытка, посчитанная старым построителем),
 * и тот же текст в блоке. Слот снят — значит текст печатается один раз, откуда бы поле
 * в контексте ни взялось.
 */
describe("results.html — текст обратной связи только в консолидированном блоке", () => {
  const TEXT = "Повторите тему «Сети».";
  const contextWithBoth = {
    course: { title: "Тест" },
    labels,
    result: {
      ...webResult.result,
      topicResults: [
        {
          ...webResult.result.topicResults[0],
          feedback: TEXT,
          hasFeedback: true,
          recommendedCourses: [{ title: "Курс A", url: "https://e/a" }],
          recommendedEvents: [],
          hasRecommendations: true,
        },
      ],
      recommendations: { texts: [TEXT], textsHtml: [TEXT], links: [], events: [], assets: [], hasAny: true },
    },
  };

  for (const [templateId, layout] of standardLayouts) {
    it(`${templateId}: карточка темы текста не печатает, а блок печатает`, () => {
      const root = render(layout, contextWithBoth);
      const card = root.querySelector(".tb-topic-card") as HTMLElement;
      expect(card.querySelector(".tb-topic-card__fb-text")).toBeNull();
      expect(card.textContent).not.toContain(TEXT);
      // Текст не потерян — он переехал в блок, и ровно один раз на весь экран.
      expect(root.querySelector(".tb-recs-block .tb-recs-group__text")?.textContent).toBe(TEXT);
      expect((root.textContent ?? "").match(new RegExp(TEXT, "g"))).toHaveLength(1);
    });

    it(`${templateId}: курсы и мероприятия темы в карточке остаются`, () => {
      const root = render(layout, contextWithBoth);
      const card = root.querySelector(".tb-topic-card") as HTMLElement;
      expect(card.querySelector("a.tb-rec")?.getAttribute("href")).toBe("https://e/a");
      expect(card.querySelectorAll(".tb-topic-card__fb")).toHaveLength(1);
    });

    it(`${templateId}: тема без курсов не оставляет пустой блок в карточке`, () => {
      const root = render(layout, {
        ...contextWithBoth,
        result: {
          ...contextWithBoth.result,
          topicResults: [{ ...contextWithBoth.result.topicResults[0], recommendedCourses: [], hasRecommendations: false }],
        },
      });
      expect(root.querySelector(".tb-topic-card__fb")).toBeNull();
    });
  }
});

describe("results.html — пустая плашка не рисуется", () => {
  it("тест без вердикта не оставляет цветной прямоугольник в шапке", () => {
    const root = render(resultsLayout, {
      course: { title: "Опросник" },
      result: { ...webResult.result, passed: false, passClass: "", statusLabel: "", hideScoreSummary: true },
    });
    expect(root.querySelector(".tb-scene__headtag .ou-tag")).toBeNull();
    expect(root.querySelector(".tb-scene__headtag")).not.toBeNull();
  });

  it("шкала без сработавшего интервала не оставляет плашку уровня", () => {
    const root = render(resultsLayout, {
      course: { title: "Опросник" },
      labels,
      result: {
        passed: false,
        passClass: "",
        statusLabel: "",
        hideScoreSummary: true,
        topicResults: [],
        // Only the scales sub-block is visible: no summary (hidden), no topics, no indicators.
        blocks: [{ key: "scales", heading: "По шкалам", isScales: true }],
        scales: [
          { name: "Без интервалов", levelLabel: "", toneClass: "", renderKind: "band_ruler" },
          { name: "С уровнем", levelLabel: "Высокий", toneClass: "ou-tag--error", renderKind: "band_ruler" },
        ],
      },
    });
    const levels = root.querySelectorAll(".tb-measure__level");
    expect(levels.length).toBe(1);
    expect(levels[0].textContent).toBe("Высокий");
  });
});

const webAdaptive = {
  course: { title: "Адаптивный тест" },
  // PRD-49: адаптивный экран, как и обычный, проходит `result.blocks` и берёт надписи из
  // словаря, поэтому рукописный контекст обязан нести и то, и другое — ровно так их
  // отдаёт `buildAdaptiveResultContext`. Сводки в списке нет: на этом экране её не бывает.
  labels,
  result: {
    adaptive: true,
    blocks: [{ key: "topics", heading: "Результаты по темам", isTopics: true }],
    topicResults: [
      { topicName: "Сети", levelLabel: "Средний", levelClass: "ou-tag--solid ou-tag--accent", hasFeedback: false, hasLinks: false },
    ],
  },
};

describe("results.adaptive.html — superset gating", () => {
  it("web context: restart action only", () => {
    const root = render(adaptiveLayout, { ...webAdaptive, result: { ...webAdaptive.result, nav: { canRetake: true } } });
    expect(actions(root)).toEqual(["restart"]);
    expect(root.querySelector('[data-action="download-report"]')).toBeNull();
    expect(root.querySelector('[data-action="finish"]')).toBeNull();
  });

  // The web «Пройти снова» follows the host-resolved ATTEMPT state: with the cap spent
  // the server answers ATTEMPTS_EXHAUSTED, so the button would be an offer the product
  // refuses. Unlike the standard layout's «Пройти заново», the verdict is not part of
  // it — re-running an adaptive test after a pass is a legitimate ask.
  it("web context: no restart once the attempts are spent", () => {
    const root = render(adaptiveLayout, {
      ...webAdaptive,
      result: { ...webAdaptive.result, showBack: true, nav: { showReport: true, canRetake: false } },
    });
    expect(actions(root)).toEqual(["results-back", "download-report"]);
    expect(root.querySelector('[data-action="restart"]')).toBeNull();
  });

  it("web context: restart survives a PASSED attempt while attempts remain", () => {
    const root = render(adaptiveLayout, {
      ...webAdaptive,
      result: { ...webAdaptive.result, passed: true, nav: { canRetry: false, canRetake: true } },
    });
    expect(actions(root)).toEqual(["restart"]);
  });

  it("report + retry + finish actions, no web restart", () => {
    const scorm = {
      course: { title: "Адаптивный тест" },
      result: {
        ...webAdaptive.result,
        hasScormActions: true,
        // ONE report contract across both results layouts: the adaptive footer used to
        // read `showPdf`/`download-pdf`, a spelling only the package filled — so the
        // web host offered no report on adaptive tests (see shared/template/results-nav).
        nav: { showReport: true },
        canRetry: true,
        showFinish: true,
      },
    };
    const root = render(adaptiveLayout, scorm);
    expect(actions(root)).toEqual(["download-report", "restart-adaptive", "finish"]);
    expect(root.querySelector('[data-action="restart"]')).toBeNull();
  });

  it("the report shows on the WEB adaptive footer too (nav is host-filled)", () => {
    const web = {
      course: { title: "Адаптивный тест" },
      result: { ...webAdaptive.result, showBack: true, nav: { showReport: true, canRetake: true } },
    };
    const root = render(adaptiveLayout, web);
    expect(actions(root)).toEqual(["results-back", "download-report", "restart"]);
  });

  it("renders per-topic level pill + feedback/links only where present", () => {
    const ctx = {
      course: { title: "T" },
      labels,
      result: {
        adaptive: true,
        blocks: [{ key: "topics", heading: "Результаты по темам", isTopics: true }],
        topicResults: [
          {
            topicName: "Сети",
            levelLabel: "Средний",
            levelClass: "ou-tag--solid ou-tag--accent",
            feedback: "Хорошо",
            hasFeedback: true,
            hasRecommendations: true,
            recommendedCourses: [{ title: "Курс TCP/IP", url: "https://e/x" }],
            recommendedEvents: [],
          },
          { topicName: "БД", levelLabel: "Минимально требуемый уровень не подтверждён", levelClass: "ou-tag--solid ou-tag--error", hasFeedback: false, hasRecommendations: false },
        ],
      },
    };
    const root = render(adaptiveLayout, ctx);
    const cards = root.querySelectorAll(".tb-topic-card");
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector(".tb-topic-card__fb-text")?.textContent).toContain("Хорошо");
    expect(cards[0].querySelector("a.tb-rec")?.getAttribute("href")).toBe("https://e/x");
    expect(cards[1].querySelector(".tb-topic-card__fb-text")).toBeNull();
    expect(cards[1].querySelector(".ou-tag")?.textContent).toContain("Минимально требуемый уровень не подтверждён");
  });
});

describe("results.adaptive.html — консолидированный блок рекомендаций", () => {
  // Блок «Рекомендации» существовал только в стандартных итогах, поэтому адаптивный
  // экран не показывал ученику НИЧЕГО: ни текстов обратной связи, ни курсов, ни
  // мероприятий, ни вложений — ни у одной темы. Разметка перенесена из `results.html`
  // дословно: это паритет режимов, а не новая вёрстка.
  const recommendations = {
    texts: ["Повторите тему «Сети»."],
    // Разметку текста печатает `textsHtml` — его наполняет `collectRecommendations`
    // из формата, выбранного автором; здесь контекст собран руками, поэтому поле задано
    // явно (обычный текст = сам себе разметка).
    textsHtml: ["Повторите тему «Сети»."],
    links: [{ title: "Курс TCP/IP", url: "https://e/course" }],
    events: [{ title: "Семинар по сетям" }],
    assets: [{ title: "Разбор темы", url: "/api/media/aaaa" }],
    hasAny: true,
  };

  for (const [templateId, layout] of adaptiveLayouts) {
    it(`${templateId}: рисует тексты, курсы, мероприятия и материалы`, () => {
      const root = render(layout, {
        course: { title: "Адаптивный тест" },
        labels,
        result: { ...webAdaptive.result, recommendations },
      });
      const block = root.querySelector(".tb-recs-block");
      expect(block).not.toBeNull();
      expect(root.textContent).toContain("Рекомендации");
      expect(block?.querySelector(".tb-recs-group__text")?.textContent).toBe("Повторите тему «Сети».");
      const hrefs = [...block!.querySelectorAll("a.tb-rec")].map((a) => a.getAttribute("href"));
      expect(hrefs).toEqual(["https://e/course", "/api/media/aaaa"]);
      expect(block?.textContent).toContain("Семинар по сетям");
      expect([...block!.querySelectorAll(".tb-eyebrow")].map((e) => e.textContent)).toEqual([
        "Пройти обучение",
        "Мероприятия",
        "Материалы",
      ]);
    });

    it(`${templateId}: без рекомендаций пустого блока не рисует`, () => {
      const root = render(layout, webAdaptive);
      expect(root.querySelector(".tb-recs-block")).toBeNull();
      expect(root.textContent).not.toContain("Рекомендации");
    });

    // Слот текста в АДАПТИВНОЙ карточке снимать нельзя: `feedback` здесь — не текст
    // темы (тот уехал в блок), а обратная связь ДОСТИГНУТОГО УРОВНЯ либо текст провала
    // темы. В консолидированный блок она не подаётся, и снятие слота стёрло бы её из
    // продукта совсем.
    it(`${templateId}: обратная связь уровня остаётся в карточке темы`, () => {
      const root = render(layout, {
        course: { title: "Адаптивный тест" },
        labels,
        result: {
          adaptive: true,
          blocks: [{ key: "topics", heading: "Результаты по темам", isTopics: true }],
          topicResults: [
            {
              topicName: "Сети",
              levelLabel: "Средний",
              levelClass: "ou-tag--solid ou-tag--accent",
              feedback: "Ваш уровень по теме — средний",
              hasFeedback: true,
              hasRecommendations: false,
              recommendedCourses: [],
              recommendedEvents: [],
            },
          ],
          recommendations,
        },
      });
      expect(root.querySelector(".tb-topic-card .tb-topic-card__fb-text")?.textContent).toBe(
        "Ваш уровень по теме — средний",
      );
    });

    it(`${templateId}: показывает только непустые группы`, () => {
      const root = render(layout, {
        course: { title: "Адаптивный тест" },
        result: {
          ...webAdaptive.result,
          recommendations: {
            texts: ["Только текст"],
            textsHtml: ["Только текст"],
            links: [],
            events: [],
            assets: [],
            hasAny: true,
          },
        },
      });
      expect(root.querySelector(".tb-recs-block")).not.toBeNull();
      expect(root.querySelectorAll(".tb-recs-group")).toHaveLength(1);
      expect(root.querySelector(".tb-eyebrow")).toBeNull();
    });
  }
});

/**
 * Блок «Результаты по темам» целиком: он держится на НАЛИЧИИ темы в контексте, а всё
 * его содержимое гасится поодиночке. У чисто измерительного теста (опросник Маслач)
 * это оставляло на экране заголовок, разделитель и карточку с названием темы и вечно
 * пустой полосой прогресса — блок без единого факта. Правило живёт в построителе, а не
 * в макете, поэтому проверяется именно связка «построитель + макет» и на ОБОИХ
 * шаблонах: сторонние шаблоны гасят заголовок тем же `{{#if result.topicResults}}`.
 */
describe("results.html — блок «Результаты по темам» молчит, когда темам нечего сказать", () => {
  // PRD-49: the builder resolves the heading from the FLAT label values a host passes in
  // (`labels['results.topics']`), so the assertion below reads the same wording the
  // certification layout still prints from its own markup.
  const labelValues = { "results.topics": "Результаты по темам" };
  const measurementRun = {
    passed: false,
    percent: 0,
    totalQuestions: 22,
    correct: 0,
    earnedPoints: 0,
    possiblePoints: 0,
    topicResults: [
      {
        topicId: "t1",
        topicName: "Опросник профессионального выгорания Маслач",
        correct: 0,
        total: 0,
        percent: 0,
        earnedPoints: 0,
        possiblePoints: 0,
        passed: null,
      },
    ],
  };

  for (const [templateId, layout] of standardLayouts) {
    it(`${templateId}: измерительная тема не оставляет ни заголовка, ни карточки`, () => {
      const root = render(layout, buildResultContext(measurementRun, "Опросник", { withTopicPoints: true, labels: labelValues }));
      expect(root.querySelector(".tb-topics-grid")).toBeNull();
      expect(root.querySelector(".tb-topic-card")).toBeNull();
      expect(root.textContent).not.toContain("Результаты по темам");
    });

    it(`${templateId}: оцениваемая тема блок сохраняет`, () => {
      const graded = {
        ...measurementRun,
        topicResults: [
          { ...measurementRun.topicResults[0], correct: 3, total: 4, percent: 75, earnedPoints: 3, possiblePoints: 4 },
        ],
      };
      const root = render(layout, buildResultContext(graded, "Тест", { withTopicPoints: true, labels: labelValues }));
      expect(root.querySelector(".tb-topic-card")).not.toBeNull();
      expect(root.textContent).toContain("Результаты по темам");
    });

    it(`${templateId}: у темы без оценивания нет и полосы прогресса`, () => {
      // Карточка выживает ради курсов темы — показать их больше негде, — но полоса
      // прогресса без оцениваемых вопросов всегда пуста и означать ничего не может.
      const withCourses = {
        ...measurementRun,
        topicResults: [
          { ...measurementRun.topicResults[0], recommendedCourses: [{ title: "Курс A", url: "https://e/a" }] },
        ],
      };
      const root = render(layout, buildResultContext(withCourses, "Опросник", { withTopicPoints: true, labels: labelValues }));
      const card = root.querySelector(".tb-topic-card") as HTMLElement;
      expect(card).not.toBeNull();
      expect(card.querySelector(".tb-topic-card__bar")).toBeNull();
      expect(card.querySelector("a.tb-rec")?.getAttribute("href")).toBe("https://e/a");
    });
  }
});

describe("buildResultsNav — the two retake facts", () => {
  it("derives canRetake from canRetry: offering the remedy implies an attempt to spend", () => {
    const nav = buildResultsNav({ canReport: false, canRetry: true, hasPostPages: false });
    expect(nav.canRetake).toBe(true);
  });

  it("keeps canRetake on after a pass, and off once the attempts are spent", () => {
    expect(buildResultsNav({ canReport: false, canRetry: false, canRetake: true, hasPostPages: false }).canRetake).toBe(true);
    expect(buildResultsNav({ canReport: false, canRetry: false, canRetake: false, hasPostPages: false }).canRetake).toBe(false);
  });
});

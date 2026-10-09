/**
 * @module shared/template/__tests__/result-context.intro
 *
 * ВВОДНЫЙ ТЕКСТ ПО ИСХОДУ в контексте экрана итогов и отчёта (PRD-61).
 *
 * Что здесь пиннится:
 *   1. текст исхода печатается ВТОРЫМ, под общим вступлением;
 *   2. исход берётся из того же ответа, которым гасится вердиктная шапка, — иначе шапка и
 *      текст под ней снова начнут говорить разное, как в боевом отчёте 2026-09-22;
 *   3. старая форма (только `format`/`text`) печатается ровно как печаталась;
 *   4. адаптивный режим текстов исхода не печатает: он вердикта не выносит.
 */

import { describe, it, expect } from "vitest";
import { buildResultContext, buildAdaptiveResultContext } from "../result-context";

const intro = {
  format: "plain" as const,
  text: "Спасибо за прохождение теста.",
  passed: { format: "plain" as const, text: "Поздравляем." },
  failed: { format: "plain" as const, text: "Не хватило баллов." },
};

/** Оцениваемый прогон: важны вердикт и то, что оценивать было что. */
const run = (passed: boolean) => ({
  passed,
  percent: passed ? 80 : 20,
  totalQuestions: 10,
  correct: passed ? 8 : 2,
  earnedPoints: passed ? 8 : 2,
  possiblePoints: 10,
  topicResults: [],
});

describe("вводный текст по исходу (PRD-61)", () => {
  it("пройден: общее вступление, затем текст прошедшему", () => {
    const ctx = buildResultContext(run(true), "Тест", { intro, hasPassThreshold: true });
    expect(ctx.result.introHtml).toBe("Спасибо за прохождение теста.<br><br>Поздравляем.");
  });

  it("не пройден: общее вступление, затем текст не прошедшему", () => {
    const ctx = buildResultContext(run(false), "Тест", { intro, hasPassThreshold: true });
    expect(ctx.result.introHtml).toContain("Не хватило баллов.");
    expect(ctx.result.introHtml).not.toContain("Поздравляем.");
  });

  it("порога нет: печатается только общее вступление", () => {
    // Вердикта никто не выносил, и `passed` здесь — умолчание, а не суждение.
    const ctx = buildResultContext(run(false), "Тест", { intro, hasPassThreshold: false });
    expect(ctx.result.introHtml).toBe("Спасибо за прохождение теста.");
  });

  it("нечего было оценивать: тоже только общее вступление", () => {
    const ctx = buildResultContext(
      { ...run(false), possiblePoints: 0, earnedPoints: 0 },
      "Тест",
      { intro, hasPassThreshold: true },
    );
    expect(ctx.result.introHtml).toBe("Спасибо за прохождение теста.");
  });

  it("признак порога НЕ передан: текст исхода печатается — неизвестность в пользу показа", () => {
    // То же, что делает вердиктная шапка: хост, не обученный передавать признак, не должен
    // терять текст исхода у каждого оцениваемого теста.
    const ctx = buildResultContext(run(true), "Тест", { intro });
    expect(ctx.result.introHtml).toContain("Поздравляем.");
  });

  it("исход печатается ровно тогда, когда печатается вердиктная шапка", () => {
    // Одна причина — один ответ. Гасится шапка (`statusLabel`) — молчит и текст исхода.
    const silent = buildResultContext(run(true), "Тест", { intro, hasPassThreshold: false });
    expect(silent.result.statusLabel).toBe("");
    expect(silent.result.introHtml).not.toContain("Поздравляем.");

    const loud = buildResultContext(run(true), "Тест", { intro, hasPassThreshold: true });
    expect(loud.result.statusLabel).toBeTruthy();
    expect(loud.result.introHtml).toContain("Поздравляем.");
  });

  it("формат каждого блока свой", () => {
    const ctx = buildResultContext(run(true), "Тест", {
      intro: { format: "plain", text: "Строка\nВторая", passed: { format: "richText", text: "<b>Ура</b>" } },
      hasPassThreshold: true,
    });
    expect(ctx.result.introHtml).toBe("Строка<br>Вторая<br><br><b>Ура</b>");
  });

  it("старая форма без ветвей исхода: контекст прежний", () => {
    const ctx = buildResultContext(run(true), "Тест", {
      intro: { format: "plain", text: "Об итогах" },
      hasPassThreshold: true,
    });
    expect(ctx.result.introHtml).toBe("Об итогах");
  });

  it("текстов нет вовсе: поля в контексте нет", () => {
    expect(buildResultContext(run(true), "Тест", { hasPassThreshold: true }).result.introHtml).toBeUndefined();
    expect(
      buildResultContext(run(true), "Тест", { intro: { format: "plain", text: "  " }, hasPassThreshold: true })
        .result.introHtml,
    ).toBeUndefined();
  });
});

describe("адаптивный режим печатает только общее вступление (FR-14b)", () => {
  it("тексты исхода молчат: вердикта этот режим не выносит", () => {
    const ctx = buildAdaptiveResultContext(
      { passed: true, topicResults: [] },
      "Адаптивный тест",
      { intro },
    );
    expect(ctx.result.introHtml).toBe("Спасибо за прохождение теста.");
  });

  it("старая форма печатается как печаталась", () => {
    const ctx = buildAdaptiveResultContext(
      { passed: false, topicResults: [] },
      "Адаптивный тест",
      { intro: { format: "plain", text: "Об итогах" } },
    );
    expect(ctx.result.introHtml).toBe("Об итогах");
  });
});

describe("общая обратная связь ТЕСТА снята (PRD-61 §10)", () => {
  const failedRun = {
    ...run(false),
    topicResults: [
      {
        topicId: "t1",
        topicName: "Тема",
        correct: 0,
        total: 2,
        percent: 0,
        earnedPoints: 0,
        possiblePoints: 2,
        passed: false,
        feedbackTexts: ["Текст ТЕМЫ"],
      },
    ],
  };

  it("текст теста не попадает в рекомендации, а текст темы попадает", () => {
    const ctx = buildResultContext(failedRun, "Тест", {
      hasPassThreshold: true,
      testFeedback: { format: "plain", text: "Текст ТЕСТА" },
    });
    const printed = JSON.stringify(ctx.result);
    expect(printed).toContain("Текст ТЕМЫ");
    expect(printed).not.toContain("Текст ТЕСТА");
  });

  it("тест без обратной связи печатает рекомендации тем как раньше", () => {
    const ctx = buildResultContext(failedRun, "Тест", { hasPassThreshold: true });
    expect(JSON.stringify(ctx.result)).toContain("Текст ТЕМЫ");
  });
});

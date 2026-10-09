/**
 * @module tests/prd19-free-section-navigation
 * @description PRD-19 FR-11a - FR-11d: настройка теста «Свободная навигация внутри раздела».
 *
 * Проверяется то, что решает ОДИН раз и для обоих хостов: значение, которое выпекается в
 * `TEST_DATA` пакета. Само правило доступности живёт в общем построителе карты вопросов
 * (`shared/template/question-progress-context`) и закрыто его собственными проверками — здесь
 * пакет, потому что в LMS никакого сервера рядом нет и настройка обязана уехать внутрь.
 *
 * Отдельно закрепляется адаптивный случай: там порядок ведёт лестница уровней, и значение
 * автора до выдачи доходить не должно (FR-11b), иначе пакет пообещал бы свободу, которой в
 * адаптивном прохождении не бывает.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

const baseTest = {
  id: "t1",
  title: "Тест",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  feedbackJson: null,
  timeLimitMinutes: null,
  maxAttempts: 3,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
  allowReturnToUnanswered: true,
};

function fixture(overrides: Record<string, unknown>) {
  return {
    test: { ...baseTest, ...overrides },
    sections: [
      {
        id: "sec-1", topicId: "t1", drawCount: 1, required: true, feedbackJson: null,
        topic: { id: "t1", name: "Тема", feedback: null, feedbackJson: null },
        questions: [
          {
            id: "q1", type: "single", prompt: "?", dataJson: {}, correctJson: { correctIndex: 0 },
            points: 1, difficulty: 50, tags: [],
          },
        ],
        courses: [], events: [],
      },
    ],
  } as never;
}

const bake = (data: unknown): Record<string, unknown> => JSON.parse(buildTestJson(data as never));

describe("свободная навигация внутри раздела — выпечка в пакет", () => {
  it("включённая настройка уезжает в TEST_DATA", () => {
    expect(bake(fixture({ allowFreeSectionNavigation: true })).allowFreeSectionNavigation).toBe(true);
  });

  it("выключенная и отсутствующая читаются одинаково: прежний фронтир (FR-11c)", () => {
    // Тест, заведённый до этой колонки, обязан вести себя ровно как вчера — без правок автора.
    expect(bake(fixture({ allowFreeSectionNavigation: false })).allowFreeSectionNavigation).toBe(false);
    expect(bake(fixture({})).allowFreeSectionNavigation).toBe(false);
  });

  it("адаптивный тест получает ВЫКЛ, даже когда автор включил (FR-11b)", () => {
    const baked = bake(fixture({ mode: "adaptive", allowFreeSectionNavigation: true }));
    expect(baked.allowFreeSectionNavigation).toBe(false);
  });
});

/**
 * Сторож паритета хостов. Правило доступности одно (`buildQuestionProgress`), но КОРМЯТ его
 * два разных хоста, каждый из своего состояния: веб — из `navSettings`, пакет — из
 * `TEST_DATA`. Забыть проброс в одном из них — значит выдать ученику разную навигацию в вебе
 * и в LMS, причём молча: карта отрисуется, просто без свободы. Исполнить рантайм пакета
 * здесь нельзя (это несобираемый plain JS с DOM), поэтому проверяется его исходник — так же,
 * как это делают соседние *-port проверки рантайма.
 */
const squeeze = (src: string) => src.replace(/\s+/g, " ");
const webHost = squeeze(readFileSync(resolve(process.cwd(), "client/src/pages/learner/take-test.tsx"), "utf8"));
const scormHost = squeeze(
  readFileSync(resolve(process.cwd(), "server/scorm/template/app/render/mainRender.js"), "utf8"),
);

describe("оба хоста кормят одно правило", () => {
  it("карта вопросов получает свободу с обеих сторон, и обе гасят её без возврата", () => {
    expect(webHost).toContain(
      "freeNavigation: navSettings.allowReturnToUnanswered && navSettings.allowFreeSectionNavigation",
    );
    expect(scormHost).toContain(
      "freeNavigation: !!TEST_DATA.allowReturnToUnanswered && !!TEST_DATA.allowFreeSectionNavigation",
    );
  });

  it("экран обзора у обоих перечисляет вопросы охвата целиком", () => {
    // Иначе обзор умолчал бы о вопросе, до которого при свободе один клик.
    expect(webHost).toContain("delivered: freeNavWeb || i <= currentIndex");
    expect(scormHost).toContain("delivered: freeNav || (i <= frontier)");
  });
});

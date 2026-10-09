// @vitest-environment node
/**
 * @module server/scorm/__tests__/test-json-interpretation
 * @description Толкование темы и подтемы в пакете SCORM.
 *
 * Проверяется ДОСТАВКА, а не вывод: сборка везёт оба текста — темы и теста — не разрешая
 * их, потому что правило замены принадлежит общему построителю; пустой текст в пакет не
 * едет; тест без толкований не получает в `TEST_DATA` ни одного нового ключа.
 */
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../builders/test-json";

const baseTest = {
  id: "t1",
  title: "Сертификация руководителей",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  feedbackJson: null,
  timeLimitMinutes: null,
  maxAttempts: null,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
};

/** Parse the baked TEST_DATA (buildTestJson returns the serialized JSON). */
function bake(section: Record<string, unknown>, topic: Record<string, unknown> = {}): any {
  const data = {
    test: baseTest,
    sections: [
      {
        id: "sec-1",
        topicId: "t1",
        drawCount: 1,
        required: true,
        feedbackJson: null,
        topic: { id: "t1", name: "Управляет потенциалом команды", feedback: null, feedbackJson: null, ...topic },
        questions: [
          {
            id: "q1",
            type: "single",
            prompt: "?",
            dataJson: {},
            correctJson: { correctIndex: 0 },
            points: 1,
            difficulty: 50,
            tags: ["Стратегия компании"],
          },
        ],
        courses: [],
        events: [],
        ...section,
      },
    ],
  };
  return JSON.parse(buildTestJson(data as never));
}

const section = (json: any) => json.sections[0];

describe("buildTestJson: толкование темы", () => {
  it("везёт текст ТЕМЫ и текст ТЕСТА порознь — разрешает их построитель", () => {
    const baked = section(
      bake(
        { interpretationJson: { format: "plain", text: "Текст теста" } },
        { interpretationJson: { format: "plain", text: "Текст темы" } },
      ),
    );
    expect(baked.interpretation).toEqual({ format: "plain", text: "Текст темы" });
    expect(baked.sectionInterpretation).toEqual({ format: "plain", text: "Текст теста" });
  });

  it("формат сохраняется: форматированный текст не превращается в простой", () => {
    const baked = section(bake({}, { interpretationJson: { format: "richText", text: "<p>Абзац</p>" } }));
    expect(baked.interpretation).toEqual({ format: "richText", text: "<p>Абзац</p>" });
  });

  it("написанное и стёртое в пакет не едет: пустой текст = толкования нет", () => {
    const baked = section(bake({ interpretationJson: { format: "plain", text: "   " } }));
    expect(baked.sectionInterpretation).toBeUndefined();
  });
});

describe("buildTestJson: толкование подтемы", () => {
  it("везёт текст каждой подтемы по её ключу", () => {
    const baked = section(
      bake({
        breakdownInterpretationJson: {
          axis: "tag",
          keys: { "Стратегия компании": { format: "plain", text: "Понимание целей до 2030" } },
        },
      }),
    );
    expect(baked.breakdownInterpretation).toEqual({
      "Стратегия компании": { format: "plain", text: "Понимание целей до 2030" },
    });
  });

  it("подтемы с пустым текстом отсеиваются, и пустая карта ключа не добавляет", () => {
    const baked = section(
      bake({ breakdownInterpretationJson: { axis: "tag", keys: { "Стратегия компании": { text: "" } } } }),
    );
    expect(baked.breakdownInterpretation).toBeUndefined();
  });
});

describe("buildTestJson: совместимость", () => {
  it("тест без толкований не получает в TEST_DATA ни одного нового ключа", () => {
    const baked = section(bake({}));
    expect(baked).not.toHaveProperty("interpretation");
    expect(baked).not.toHaveProperty("sectionInterpretation");
    expect(baked).not.toHaveProperty("breakdownInterpretation");
  });
});

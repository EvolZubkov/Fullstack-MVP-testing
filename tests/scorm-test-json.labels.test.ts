/**
 * PRD-49. Надписи и порядок подблоков итогов доезжают до `test.json` пакета SCORM.
 *
 * Манифеста в LMS нет, поэтому пакет обязан нести УЖЕ РАЗРЕШЁННУЮ плоскую карту
 * «ключ → текст» и разрешённые по экранам списки подблоков — их кладёт сборщик
 * (`build-export-data`), а `buildTestJson` только переносит их в `designSettings`
 * рядом с прочими необязательными полями оформления.
 *
 * Форма проверяется отдельно: в пакет едет ПЛОСКАЯ карта, а не дерево. Дерево строит
 * ядро (`shared/template/labels`), и второго места, где оно строится, быть не должно.
 */
import { describe, it, expect } from "vitest";
import { buildTestJson, type ExportData } from "../server/scorm/builders/test-json";

const question: any = {
  id: "q1",
  topicId: "t1",
  type: "single",
  prompt: "Вопрос",
  dataJson: { options: ["А", "Б"] },
  correctJson: { correctIndex: 0 },
  difficulty: 50,
  shuffleAnswers: true,
  mediaUrl: null,
  mediaType: null,
  feedback: null,
  feedbackMode: "general",
  feedbackCorrect: null,
  feedbackIncorrect: null,
};

const section: any = {
  id: "s1",
  testId: "test-1",
  topicId: "t1",
  topic: { id: "t1", name: "Тема", feedback: null },
  questions: [question],
  courses: [],
  events: [],
  drawCount: 1,
  topicPassRuleJson: null,
};

const test: any = {
  id: "test-1",
  title: "Тест",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  createdAt: new Date(),
  webhookUrl: null,
  feedback: null,
  timeLimitMinutes: null,
  maxAttempts: null,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
};

const BASE_DESIGN = {
  templateId: "default",
  templateVersion: "1.6.0",
  templateApiVersion: "1.0",
  params: {},
};

/** Разрешённые надписи экрана итогов — ровно та плоская форма, что кладёт сборщик. */
const RESOLVED_LABELS = {
  "results.heading": "Ваш результат",
  "results.scales": "Профиль",
  // Выключенная надпись едет ПУСТОЙ СТРОКОЙ: «не печатать» — это факт, а не отсутствие
  // ключа, и рантайм не должен подставлять вместо неё умолчание.
  "results.topics": "",
};

function bake(designSettings: unknown): any {
  return JSON.parse(buildTestJson({ test, sections: [section], designSettings } as unknown as ExportData));
}

describe("test.json: надписи итогов (PRD-49)", () => {
  it("переносит разрешённые надписи и оба порядка подблоков", () => {
    const data = bake({
      ...BASE_DESIGN,
      labels: RESOLVED_LABELS,
      resultsBlockOrder: ["topics", "summary", "scales", "indicators"],
      templateBlockOrder: {
        results: ["summary", "scales", "indicators", "topics"],
        "results.adaptive": ["topics", "scales", "indicators"],
      },
    });
    expect(data.designSettings.labels).toEqual(RESOLVED_LABELS);
    expect(data.designSettings.resultsBlockOrder).toEqual(["topics", "summary", "scales", "indicators"]);
    expect(data.designSettings.templateBlockOrder["results.adaptive"]).toEqual([
      "topics",
      "scales",
      "indicators",
    ]);
  });

  it("везёт надписи ПЛОСКОЙ картой, а не деревом", () => {
    const labels = bake({ ...BASE_DESIGN, labels: RESOLVED_LABELS }).designSettings.labels;
    // Ключ с точкой остаётся ключом: разворачивать его — работа ядра, а не пакета.
    expect(Object.keys(labels)).toContain("results.scales");
    expect(labels.results).toBeUndefined();
    for (const value of Object.values(labels)) expect(typeof value).toBe("string");
  });

  it("не добавляет ключей, когда шаблон надписей не объявлял", () => {
    const design = bake(BASE_DESIGN).designSettings;
    expect(design.templateId).toBe("default");
    expect("labels" in design).toBe(false);
    expect("resultsBlockOrder" in design).toBe(false);
    expect("templateBlockOrder" in design).toBe(false);
  });

  it("не заводит designSettings у пакета без настроек оформления", () => {
    const data = JSON.parse(buildTestJson({ test, sections: [section] } as unknown as ExportData));
    expect(data.designSettings).toBeUndefined();
  });
});

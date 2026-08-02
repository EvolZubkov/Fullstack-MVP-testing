// @vitest-environment node
/**
 * @module server/scorm/__tests__/test-json-prd29
 *
 * PRD-29: the SCORM package draws the SAME scale/indicator cards as the web host,
 * through the SAME shared builder. That only works if the bake ships the WHOLE
 * interpretation — domain, favourable direction, per-level texts and feedback — plus
 * the test's own feedback block, and if the shared runtime bundle exposes the pieces
 * the plain-JS runtime needs to assemble the builder's input.
 *
 * A test with neither scales nor indicators must stay byte-identical (FR-02).
 */

import { describe, it, expect } from "vitest";
import { buildTestJson } from "../builders/test-json";
import { buildSharedRuntimeBundle, SHARED_RUNTIME_GLOBAL } from "../builders/shared-runtime";

const SCALE = {
  id: "s1",
  testId: "t1",
  key: "emotional_exhaustion",
  label: "Эмоциональное истощение",
  type: "number",
  aggregation: "sum",
  normalization: "none",
  direction: "positive",
  learnerVisibility: "level_and_value",
  scormTarget: "none",
  sortOrder: 0,
  configJson: {
    domainMin: 0,
    domainMax: 45,
    valence: "lower_is_better",
    bands: [
      // Deliberately unsorted: the bake must hand the runtime an ordered list.
      {
        min: 25,
        max: 45,
        level: "high",
        label: "Высокий",
        text: "Ресурс расходуется быстрее.",
        tone: "critical",
        feedback: { text: "Снизьте нагрузку." },
      },
      { min: 0, max: 14, level: "low", label: "Низкий" },
    ],
  },
} as never;

const VARIABLE = {
  id: "v1",
  testId: "t1",
  name: "profile",
  label: "Профиль",
  type: "string",
  formula: "'burnout'",
  learnerVisibility: "level",
  scormTarget: "both",
  controlsStatus: "none",
  sortOrder: 0,
  configJson: { outcomes: [{ code: "burnout", label: "Выгорание", tone: "attention" }] },
} as never;

const baseTest = {
  id: "t1",
  title: "Маслач",
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

const exportData = { test: baseTest, sections: [], questions: [], scales: [SCALE] } as never;

/** Parse the baked TEST_DATA (buildTestJson returns the serialized JSON). */
function bake(data: unknown): any {
  return JSON.parse(buildTestJson(data as never));
}

describe("buildTestJson (PRD-29)", () => {
  it("запекает домен, направление и толкования интервалов", () => {
    const baked = bake(exportData).scales[0];
    expect(baked.domainMin).toBe(0);
    expect(baked.domainMax).toBe(45);
    expect(baked.valence).toBe("lower_is_better");
    // Ordered by `min`, so the runtime's zone geometry matches the web host's.
    expect(baked.bands.map((b: any) => b.level)).toEqual(["low", "high"]);
    expect(baked.bands[1].text).toBe("Ресурс расходуется быстрее.");
    expect(baked.bands[1].tone).toBe("critical");
    // Level feedback travels RAW: the shared builder normalises it itself.
    expect(baked.bands[1].feedback).toEqual({ text: "Снизьте нагрузку." });
  });

  it("запекает видимость для ученика", () => {
    expect(bake(exportData).scales[0].learnerVisibility).toBe("level_and_value");
  });

  it("выводит домен из интервалов, когда он не задан явно", () => {
    const scale = { ...(SCALE as any), configJson: { bands: [{ min: 1, max: 9, level: "l" }] } };
    const baked = bake({ ...(exportData as any), scales: [scale] }).scales[0];
    expect(baked.domainMin).toBe(1);
    expect(baked.domainMax).toBe(9);
    expect(baked.valence).toBe("none");
  });

  it("запекает толкование показателя и его видимость", () => {
    const baked = bake({ ...(exportData as any), resultVariables: [VARIABLE] }).resultVariables[0];
    expect(baked.learnerVisibility).toBe("level");
    expect(baked.configJson.outcomes[0].code).toBe("burnout");
  });

  it("запекает блок обратной связи теста целиком", () => {
    const feedbackJson = {
      text: "Опросник носит справочный характер.",
      links: [{ title: "Курс", url: "https://example.test/c" }],
      assets: [{ title: "Памятка.pdf", fileName: "p.pdf", mimeType: "application/pdf", scormHref: "feedback/p.pdf" }],
    };
    const baked = bake({ ...(exportData as any), test: { ...baseTest, feedbackJson } });
    // RAW, with `scormHref` intact — the runtime normalises it exactly once.
    expect(baked.testFeedbackJson).toEqual(feedbackJson);
  });

  it("запекает вложения ТЕМЫ и РАЗДЕЛА в один список раздела (PRD-32)", () => {
    // Приёмочный дефект Д-2: вложения этих двух мест не доезжали до итогов. Тема идёт
    // первой (общее раньше частного), адрес выбирается ЕДИНЫМ правилом: `url` бьёт
    // унаследованный `scormHref`, вложение без адреса выбрасывается.
    const section = {
      id: "sec-1",
      topicId: "tp1",
      drawCount: 1,
      required: true,
      feedbackJson: {
        assets: [
          { title: "Памятка раздела", fileName: "s.pdf", mimeType: "application/pdf", url: "/api/media/bbbb" },
          { title: "Не загружен", fileName: "x.pdf", mimeType: "application/pdf" },
        ],
      },
      topic: {
        id: "tp1",
        name: "Тема",
        feedback: null,
        feedbackJson: {
          assets: [
            {
              title: "Разбор темы",
              fileName: "t.pdf",
              mimeType: "application/pdf",
              url: "/api/media/aaaa",
              scormHref: "feedback/old.pdf",
            },
          ],
        },
      },
      questions: [],
      courses: [],
      events: [],
    };
    const baked = bake({ ...(exportData as any), sections: [section] });
    expect(baked.sections[0].recommendedAssets).toEqual([
      { title: "Разбор темы", url: "/api/media/aaaa" },
      { title: "Памятка раздела", url: "/api/media/bbbb" },
    ]);
  });

  it("не добавляет поле разделу без вложений — пакет прежних тестов не меняется (FR-02)", () => {
    const section = {
      id: "sec-1", topicId: "tp1", drawCount: 1, required: true, feedbackJson: null,
      topic: { id: "tp1", name: "Тема", feedback: null, feedbackJson: null },
      questions: [], courses: [], events: [],
    };
    const baked = bake({ ...(exportData as any), sections: [section] });
    expect(baked.sections[0]).not.toHaveProperty("recommendedAssets");
  });

  it("оставляет пакет теста без измерений неизменным (FR-02)", () => {
    const plain = { test: baseTest, sections: [] } as never;
    expect(buildTestJson(plain)).toBe(buildTestJson(plain));
    const json = bake(plain);
    expect(json.scales).toBeUndefined();
    expect(json.resultVariables).toBeUndefined();
    expect(json.testFeedbackJson).toBeUndefined();
  });
});

describe("shared runtime bundle (PRD-29)", () => {
  it("выставляет в TBTemplate всё, что нужно рантайму пакета", async () => {
    const code = await buildSharedRuntimeBundle();
    const capture: { TBTemplate?: any } = {};
    // eslint-disable-next-line no-new-func
    new Function("sandbox", `${code}\nsandbox.TBTemplate = ${SHARED_RUNTIME_GLOBAL};`)(capture);

    const TB = capture.TBTemplate;
    expect(typeof TB.parseScaleInterpretation).toBe("function");
    expect(typeof TB.parseIndicatorInterpretation).toBe("function");
    expect(typeof TB.normalizeFeedback).toBe("function");
    expect(TB.LEVEL_SCHEMES.traffic.favorable).toBe("142 76% 36%");

    // The BAKED scale is flat, and the parser reads exactly those keys — that is what
    // lets the package rebuild the web host's interpretation object.
    const baked = bake(exportData).scales[0];
    const parsed = TB.parseScaleInterpretation(baked);
    expect(parsed.domainMin).toBe(0);
    expect(parsed.domainMax).toBe(45);
    expect(parsed.valence).toBe("lower_is_better");
    expect(parsed.bands).toHaveLength(2);
  }, 30000);
});

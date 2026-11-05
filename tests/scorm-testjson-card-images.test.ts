/**
 * @module tests/scorm-testjson-card-images
 *
 * Картинки карточек хаба едут в пакет только для пунктов, которые пакет выдаёт.
 *
 * Упаковщик медиа обходит ВСЁ дерево TEST_DATA: картинка пункта, ушедшего из теста, легла бы в
 * архив файлом, который никто не увидит. Ключи — ключи пунктов: тема по голому `topicId` раздела,
 * сценарий — по `scenario:<id>`, который несёт его синтезированный раздел.
 */

import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

const baseTest: any = {
  id: "test-hub",
  title: "Сертификация",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  timeLimitMinutes: null,
  maxAttempts: null,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: false,
  flowPolicyJson: { mode: "router_by_topics" },
};

const section = (id: string, name: string): any => ({
  id: `s-${id}`, testId: "test-hub", topicId: id,
  topic: { id, name, feedback: null },
  questions: [],
  courses: [], events: [],
  drawCount: 0,
  topicPassRuleJson: null,
});

function exportData(settingsJson: unknown, kind = "router"): any {
  return {
    test: baseTest,
    sections: [section("t1", "О компании"), section("scenario:it1", "Работа в CRM")],
    contentPages: [
      {
        id: "p-router", topicId: null, position: "before", mode: "template", type: null,
        kind, templateKey: "router.menu-images", sortOrder: 0,
        valuesJson: { values: {} },
        settingsJson,
        autoAdvance: false, autoAdvanceDelayMs: null,
      },
    ],
  };
}

/** `buildTestJson` returns `var TEST_DATA = { … };` — the object is what matters here. */
function parse(json: string): Record<string, any> {
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  return JSON.parse(json.slice(start, end + 1));
}

describe("buildTestJson — картинки карточек хаба", () => {
  it("везёт картинки пунктов теста — и темы, и сценария", () => {
    const out = parse(
      buildTestJson(
        exportData({
          cardImages: {
            "topic:t1": { url: "/api/media/a", name: "a.png" },
            "scenario:it1": { url: "/api/media/c" },
          },
        }),
      ),
    );
    expect(out.contentPages[0].settings.cardImages).toEqual({
      "topic:t1": { url: "/api/media/a", name: "a.png" },
      "scenario:it1": { url: "/api/media/c" },
    });
  });

  it("не везёт картинку пункта, которого в тесте больше нет", () => {
    const out = parse(
      buildTestJson(
        exportData({
          cardImages: {
            "topic:t1": { url: "/api/media/a" },
            "topic:gone": { url: "/api/media/b" },
          },
        }),
      ),
    );
    expect(out.contentPages[0].settings.cardImages).toEqual({ "topic:t1": { url: "/api/media/a" } });
  });

  it("снимает свойство целиком, когда от карты ничего не осталось", () => {
    const out = parse(buildTestJson(exportData({ cardImages: { "topic:gone": { url: "/api/media/b" } } })));
    expect(out.contentPages[0].settings).toEqual({});
  });

  it("не трогает страницу без картинок", () => {
    const out = parse(buildTestJson(exportData({})));
    expect(out.contentPages[0].settings).toEqual({});
  });
});

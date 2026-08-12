/**
 * PRD-49. Надписи и порядок подблоков итогов доезжают до `test.json` пакета SCORM.
 *
 * Манифеста в LMS нет, поэтому пакет обязан нести УЖЕ РАЗРЕШЁННЫЕ надписи — и нести их ПО
 * ЭКРАНАМ, потому что умолчание объявляется по экранам (`defaults.<экран>`): одна карта на
 * все три экрана печатала бы в пакете формулировку чужого экрана, пока веб-хост печатает
 * свою. Карты кладёт сборщик (`build-export-data`), а `buildTestJson` только переносит их
 * в `designSettings` рядом с прочими необязательными полями оформления.
 *
 * Форма проверяется отдельно: у экрана — ПЛОСКАЯ карта, а не дерево. Дерево строит ядро
 * (`shared/template/labels`), и второго места, где оно строится, быть не должно.
 *
 * Здесь же — совместимость рантайма со СТАРОЙ формой: первые пакеты PRD-49 несли одну
 * плоскую карту, они уже в LMS, и `vrScreenLabels` обязан их читать.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTestJson, type ExportData } from "../server/scorm/builders/test-json";
import { buildScormExportData } from "../server/scorm/build-export-data";

// ─── Шаблон на диске: манифест с СОБСТВЕННЫМ умолчанием адаптивного экрана ───────
// Каталог временный: сборка читает манифест с диска (`readResultsDeclarations`), и
// проверять разрешение по экранам имеет смысл только на объявлении, где экраны
// действительно расходятся. Штатные шаблоны такого умолчания сегодня не объявляют.
const { templateDir } = vi.hoisted(() => {
  const nodeFs = require("node:fs") as typeof fs;
  const nodeOs = require("node:os") as typeof os;
  const nodePath = require("node:path") as typeof path;
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "tb-prd49-"));
  nodeFs.writeFileSync(
    nodePath.join(dir, "manifest.json"),
    JSON.stringify({
      id: "screens",
      labels: [
        {
          key: "results.heading",
          group: "Первый уровень",
          label: "Зонтик",
          default: "Ваш результат",
          defaults: { "results.adaptive": "Ваш уровень" },
        },
        { key: "results.scales", group: "Второй уровень", label: "Шкалы", default: "По шкалам" },
        { key: "section.eyebrow", group: "Итоги раздела", label: "Надпись", default: "Итоги раздела" },
      ],
      resultsBlockOrder: {
        default: ["summary", "scales", "indicators", "topics"],
        "results.adaptive": ["topics", "scales", "indicators"],
      },
    }),
    "utf8",
  );
  return { templateDir: dir };
});

vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/services/template-dir", () => ({
  resolveTemplateDir: async () => templateDir,
  resolveSystemScreenDir: async () => templateDir,
  defaultTemplateDir: () => templateDir,
}));
vi.mock("../server/services/test-snapshot", () => ({
  liveDataSource: () => source,
  exportSourceForTest: async () => source,
}));

afterAll(() => {
  fs.rmSync(templateDir, { recursive: true, force: true });
});

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

/** Источник содержания теста для сборщика — ровно те чтения, что он делает. */
const source = {
  getTest: async () => test,
  getTestSections: async () => [section],
  getTopic: async () => section.topic,
  getQuestionsByTopic: async () => [question],
  getTopicCourses: async () => [],
  getTopicEvents: async () => [],
  getContentPages: async () => [],
  getResultVariables: async () => [],
  getScales: async () => [],
  getQuestionMeasurements: async () => [],
  getTestQuestionScoring: async () => [],
};

const BASE_DESIGN = {
  templateId: "screens",
  templateVersion: "1.6.0",
  templateApiVersion: "1.0",
  params: {},
};

/** Разрешённые надписи ОДНОГО экрана — та плоская форма, что кладёт сборщик. */
const RESULTS_LABELS = {
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
  it("переносит карты надписей по экранам и оба порядка подблоков", () => {
    const labels = {
      results: RESULTS_LABELS,
      "results.adaptive": { ...RESULTS_LABELS, "results.heading": "Ваш уровень" },
      "section-results": { "section.eyebrow": "Итоги раздела" },
    };
    const data = bake({
      ...BASE_DESIGN,
      labels,
      resultsBlockOrder: ["topics", "summary", "scales", "indicators"],
      templateBlockOrder: {
        results: ["summary", "scales", "indicators", "topics"],
        "results.adaptive": ["topics", "scales", "indicators"],
      },
    });
    expect(data.designSettings.labels).toEqual(labels);
    expect(data.designSettings.resultsBlockOrder).toEqual(["topics", "summary", "scales", "indicators"]);
    expect(data.designSettings.templateBlockOrder["results.adaptive"]).toEqual([
      "topics",
      "scales",
      "indicators",
    ]);
  });

  it("везёт надписи экрана ПЛОСКОЙ картой, а не деревом", () => {
    const labels = bake({ ...BASE_DESIGN, labels: { results: RESULTS_LABELS } }).designSettings.labels;
    // Ключ с точкой остаётся ключом: разворачивать его — работа ядра, а не пакета.
    expect(Object.keys(labels.results)).toContain("results.scales");
    expect(labels.results.results).toBeUndefined();
    for (const value of Object.values(labels.results)) expect(typeof value).toBe("string");
  });

  it("не добавляет ключей, когда шаблон надписей не объявлял", () => {
    const design = bake(BASE_DESIGN).designSettings;
    expect(design.templateId).toBe("screens");
    expect("labels" in design).toBe(false);
    expect("resultsBlockOrder" in design).toBe(false);
    expect("templateBlockOrder" in design).toBe(false);
  });

  it("не заводит designSettings у пакета без настроек оформления", () => {
    const data = JSON.parse(buildTestJson({ test, sections: [section] } as unknown as ExportData));
    expect(data.designSettings).toBeUndefined();
  });
});

describe("сборка пакета разрешает надписи ПО ЭКРАНАМ (PRD-49)", () => {
  it("адаптивный экран получает своё умолчание, а не формулировку экрана итогов", async () => {
    test.designSettingsJson = BASE_DESIGN;
    const data = await buildScormExportData("test-1", { source: "export" });
    const labels = (data.designSettings as any).labels;

    expect(labels.results["results.heading"]).toBe("Ваш результат");
    // Ради этого разрешение и делается по экранам: манифест объявил адаптивному экрану
    // своё умолчание, и в пакете оно обязано отличаться — иначе LMS печатает одно, а веб
    // другое.
    expect(labels["results.adaptive"]["results.heading"]).toBe("Ваш уровень");
    expect(labels["section-results"]["section.eyebrow"]).toBe("Итоги раздела");
    // Общая надпись, у которой умолчания экрана нет, у всех трёх одна и та же.
    expect(labels["results.adaptive"]["results.scales"]).toBe("По шкалам");
  });

  it("формулировка ТЕСТА перекрывает умолчание на каждом экране", async () => {
    test.designSettingsJson = {
      ...BASE_DESIGN,
      labels: { "results.heading": { on: true, text: "Итог" }, "results.scales": { on: false } },
      resultsBlockOrder: ["topics", "summary", "scales", "indicators"],
    };
    const data = await buildScormExportData("test-1", { source: "export" });
    const design = data.designSettings as any;

    expect(design.labels.results["results.heading"]).toBe("Итог");
    // Своя формулировка одна на все экраны — она перекрывает и умолчание экрана.
    expect(design.labels["results.adaptive"]["results.heading"]).toBe("Итог");
    // Выключенная надпись — пустая строка, а не пропавший ключ.
    expect(design.labels.results["results.scales"]).toBe("");
    expect(design.resultsBlockOrder).toEqual(["topics", "summary", "scales", "indicators"]);
    // Списки подблоков — из манифеста, по экранам: у адаптивного своя композиция.
    expect(design.templateBlockOrder.results).toEqual(["summary", "scales", "indicators", "topics"]);
    expect(design.templateBlockOrder["results.adaptive"]).toEqual(["topics", "scales", "indicators"]);
  });
});

// ─── Совместимость рантайма со старой формой ────────────────────────────────────
// `viewResults.js` — плоский файл пакета, а не модуль: он собирается в `app.js`
// конкатенацией (`server/scorm/index.ts`). Здесь из него достаётся ОДНА функция —
// `vrLabelOptions`, единственный читатель `designSettings` в рантайме; DOM ей не нужен.
function labelOptionsOf(designSettings: unknown, screen: string): any {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "server/scorm/template/app/render/viewResults.js"),
    "utf8",
  );
  const factory = new Function("TEST_DATA", `${src}\nreturn vrLabelOptions;`);
  return factory({ designSettings })(screen);
}

describe("рантайм читает обе формы карты надписей (PRD-49)", () => {
  it("новая форма: каждый экран получает СВОЮ карту", () => {
    const labels = {
      results: { "results.heading": "Ваш результат" },
      "results.adaptive": { "results.heading": "Ваш уровень" },
      "section-results": { "section.eyebrow": "Итоги раздела" },
    };
    expect(labelOptionsOf({ labels }, "results").labels).toBe(labels.results);
    expect(labelOptionsOf({ labels }, "results.adaptive").labels).toBe(labels["results.adaptive"]);
    expect(labelOptionsOf({ labels }, "section-results").labels).toBe(labels["section-results"]);
  });

  it("новая форма: экран, которого в карте нет, надписей не получает", () => {
    const labels = { results: { "results.heading": "Ваш результат" } };
    expect(labelOptionsOf({ labels }, "results.adaptive").labels).toBeUndefined();
  });

  it("СТАРАЯ плоская карта читается всеми экранами и не роняет рантайм", () => {
    // Пакет, собранный до разделения по экранам, уже в LMS: одна карта отвечала за все
    // экраны — ровно тем она и остаётся, а не пропадает и не разворачивается в дерево.
    const labels = { "results.heading": "Ваш результат", "section.eyebrow": "Итоги раздела" };
    expect(labelOptionsOf({ labels }, "results").labels).toBe(labels);
    expect(labelOptionsOf({ labels }, "results.adaptive").labels).toBe(labels);
    expect(labelOptionsOf({ labels }, "section-results").labels).toBe(labels);
  });

  it("пакет без надписей не отдаёт построителю ни одной опции", () => {
    expect(labelOptionsOf({}, "results")).toEqual({});
    expect(labelOptionsOf(undefined, "results")).toEqual({});
  });

  it("порядок подблоков берётся по экрану, а надписи от него не зависят", () => {
    const ds = {
      labels: { results: { "results.heading": "Ваш результат" } },
      resultsBlockOrder: ["topics", "summary"],
      templateBlockOrder: {
        results: ["summary", "scales", "indicators", "topics"],
        "results.adaptive": ["topics", "scales", "indicators"],
      },
    };
    expect(labelOptionsOf(ds, "results").templateBlockOrder).toBe(ds.templateBlockOrder.results);
    expect(labelOptionsOf(ds, "results.adaptive").templateBlockOrder).toBe(
      ds.templateBlockOrder["results.adaptive"],
    );
    // Итогам раздела списка не пекут — подблоков у них нет.
    expect(labelOptionsOf(ds, "section-results").templateBlockOrder).toBeUndefined();
    expect(labelOptionsOf(ds, "results").blockOrder).toBe(ds.resultsBlockOrder);
  });
});

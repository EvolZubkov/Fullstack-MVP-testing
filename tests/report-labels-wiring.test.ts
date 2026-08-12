/**
 * @module tests/report-labels-wiring
 *
 * PRD-49 «хвост» — доводка словаря надписей отчёта до ОБОИХ хостов.
 *
 * `resolveReportBake` (`shared/report/report-variants.ts`) и `resolveLabels`
 * (`shared/template/labels.ts`) уже умеют разрешать слои надписей отчёта — это
 * проверяет `shared/report/__tests__/report-labels.test.ts`. Здесь проверяется не
 * разрешение, а ПРОВОДКА: доходит ли карта тестового переопределения до места, где
 * `resolveReportBake` её резолвит, — на сборке SCORM-пакета (`server/scorm/index.ts`) и
 * на веб-хосте (`server/services/template-render.ts`, `readReportRenderPayload`).
 * Без этой проводки обе функции работают верно, а PDF всё равно выходит без заголовков —
 * ровно тот дефект, который закрывает эта работа.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { generateScormPackage } from "../server/scorm-exporter";
import { readReportRenderPayload } from "../server/services/template-render";
import type { ReportLabelLayers } from "@shared/report/report-variants";

const DEFAULT_TEMPLATE_DIR = path.resolve(process.cwd(), "server", "scorm", "templates", "default");

// ─── Оснастка сборки пакета (тот же приём, что в tests/report-package-bake.test.ts) ──

// Строитель манифеста пишет код теста в отслеживаемый файл — снимок и возврат,
// чтобы прогон не оставлял следов и не сталкивался с параллельными сессиями
// (см. CLAUDE.md «SCORM tests share a real file»).
const IDENT = path.resolve(process.cwd(), "uploads", "scorm", "identifiers.json");
let identSnapshot: Buffer | null = null;

beforeAll(() => {
  identSnapshot = fs.existsSync(IDENT) ? fs.readFileSync(IDENT) : null;
});

afterAll(() => {
  if (identSnapshot === null) {
    if (fs.existsSync(IDENT)) fs.rmSync(IDENT);
  } else {
    fs.writeFileSync(IDENT, identSnapshot);
  }
});

const TEST_ID = "prd49-report-labels";
const TOPIC = "topic-a";

function question(id: string) {
  return {
    id, topicId: TOPIC, type: "single", prompt: `Q ${id}`,
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    points: 1, difficulty: 50, mediaUrl: null, mediaType: null,
    feedback: null, feedbackMode: "general", feedbackCorrect: null,
    feedbackIncorrect: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

/**
 * Фикстура пакета: тест с одним разделом на «Стандартном» шаблоне, чьи `labels[]`
 * объявляют отчётные умолчания для четырёх ключей (см. `manifest.json`). `designLabels`
 * — общий слой (`design_settings_json.labels`), `reportLabels` — слой ИМЕННО отчёта
 * (`report_settings_json.labels`, вне ветки режима).
 */
function buildFixture(opts: { designLabels?: unknown; reportLabels?: unknown } = {}) {
  const topic = { id: TOPIC, name: "Тема A", description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() };
  const designSettingsJson: Record<string, unknown> = { templateId: "default", params: {} };
  if (opts.designLabels) designSettingsJson.labels = opts.designLabels;
  const reportSettingsJson = opts.reportLabels ? { labels: opts.reportLabels } : null;
  return {
    test: {
      id: TEST_ID, title: "PRD-49 надписи отчёта", description: "",
      mode: "standard", showDifficultyLevel: true,
      overallPassRuleJson: { type: "percent", value: 70 }, webhookUrl: null,
      feedback: null, timeLimitMinutes: null, maxAttempts: null,
      showCorrectAnswers: true, startPageContent: null,
      published: true, status: "published", folderId: null,
      designSettingsJson,
      flowPolicyJson: { mode: "linear_flat" },
      reportSettingsJson,
      createdAt: new Date(), updatedAt: new Date(),
    },
    sections: [
      {
        id: "s-a", testId: TEST_ID, topicId: TOPIC, drawCount: 2, sortOrder: 0,
        required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null,
        topic, questions: [question("qa1"), question("qa2")], courses: [], events: [],
      },
    ],
    adaptiveSettings: null,
    contentPages: [],
    designSettings: { templateId: "default", params: {} },
    telemetry: null,
  };
}

async function pack(opts: Parameters<typeof buildFixture>[0] = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await generateScormPackage(buildFixture(opts) as any);
  return JSZip.loadAsync(buffer);
}

async function readTestData(zip: JSZip) {
  const appjs = await zip.file("app.js")!.async("string");
  const b64 = (appjs.match(/var b64 = "([A-Za-z0-9+/=]+)"/) || [])[1]!;
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

// ─── SCORM-пакет: карта надписей доходит до бейка (server/scorm/index.ts) ────────────

describe("сборка SCORM-пакета доводит словарь надписей до resolveReportBake", () => {
  it("общий слой теста (design_settings_json.labels) доезжает до TEST_DATA", async () => {
    const zip = await pack({
      designLabels: { "results.topics": { on: true, text: "Разделы теста" } },
    });
    const td = await readTestData(zip);
    expect(td.designSettings.report.labels["results.topics"]).toBe("Разделы теста");
    // Ключ, который автор не трогал, остаётся отчётным умолчанием манифеста —
    // проводка не подменяет собой разрешение (то read в report-labels.test.ts).
    expect(td.designSettings.report.labels["results.indicators"]).toBe("Ваш результат");
  });

  it("переопределение отчёта (report_settings_json.labels) побеждает общую формулировку", async () => {
    const zip = await pack({
      designLabels: { "results.topics": { on: true, text: "Разделы теста" } },
      reportLabels: { "results.topics": { on: true, text: "Разделы теста (документ)" } },
    });
    const td = await readTestData(zip);
    expect(td.designSettings.report.labels["results.topics"]).toBe("Разделы теста (документ)");
  });

  it("отсутствие настроек не ломает сборку — заголовки берутся из умолчаний манифеста", async () => {
    const zip = await pack();
    const td = await readTestData(zip);
    const labels = td.designSettings.report.labels as Record<string, string>;
    // Четыре ключа с ОТЧЁТНЫМ умолчанием (`defaults.report` в manifest.json).
    expect(labels["results.topics"]).toBe("Результаты по темам");
    expect(labels["results.indicators"]).toBe("Ваш результат");
    expect(labels["recommendations.courses"]).toBe("Рекомендации по курсам");
    expect(labels["recommendations.events"]).toBe("Рекомендуемые мероприятия");
    // Ключ без отчётного умолчания — общий default (тот же, что на экране итогов).
    expect(labels["results.scales"]).toBe("По шкалам");
  });
});

// ─── Веб-хост: та же карта доходит до readReportRenderPayload ────────────────────────

describe("readReportRenderPayload доводит словарь надписей до отчёта (веб-хост)", () => {
  it("без слоёв печатает умолчания манифеста, включая отчётные (defaults.report)", () => {
    const payload = readReportRenderPayload(DEFAULT_TEMPLATE_DIR, "report", null);
    expect(payload?.labels?.["results.topics"]).toBe("Результаты по темам");
    expect(payload?.labels?.["results.indicators"]).toBe("Ваш результат");
    expect(payload?.labels?.["recommendations.courses"]).toBe("Рекомендации по курсам");
    expect(payload?.labels?.["recommendations.events"]).toBe("Рекомендуемые мероприятия");
    expect(payload?.labels?.["results.scales"]).toBe("По шкалам");
  });

  it("общий слой (design_settings_json.labels) переформулирует надпись", () => {
    const layers: ReportLabelLayers = {
      values: { "results.topics": { on: true, text: "Разделы теста" } },
    };
    const payload = readReportRenderPayload(DEFAULT_TEMPLATE_DIR, "report", null, null, undefined, undefined, layers);
    expect(payload?.labels?.["results.topics"]).toBe("Разделы теста");
  });

  it("переопределение отчёта побеждает общую формулировку — тот же порядок слоёв, что в пакете", () => {
    const layers: ReportLabelLayers = {
      values: { "results.topics": { on: true, text: "Разделы теста" } },
      overrides: { "results.topics": { on: true, text: "Разделы теста (документ)" } },
    };
    const payload = readReportRenderPayload(DEFAULT_TEMPLATE_DIR, "report", null, null, undefined, undefined, layers);
    expect(payload?.labels?.["results.topics"]).toBe("Разделы теста (документ)");
  });

  it("адаптивный вид отчёта читает тот же словарь", () => {
    const layers: ReportLabelLayers = {
      overrides: { "results.topics": { on: true, text: "Разделы (документ)" } },
    };
    const payload = readReportRenderPayload(
      DEFAULT_TEMPLATE_DIR,
      "report.adaptive",
      null,
      null,
      undefined,
      undefined,
      layers,
    );
    expect(payload?.labels?.["results.topics"]).toBe("Разделы (документ)");
  });

  it("отсутствие слоёв (null) не ломает сборку страницы", () => {
    const payload = readReportRenderPayload(DEFAULT_TEMPLATE_DIR, "report", null, null, undefined, undefined, null);
    expect(payload).not.toBeNull();
    expect(payload?.layout).toContain("tb-report");
    expect(payload?.labels?.["results.topics"]).toBe("Результаты по темам");
  });
});

// ─── Рантайм пакета и веб-модуль: карта уходит в опции построителя контекста ─────────

describe("исходники хостов доводят bake.labels до опций построителя (глазами кода)", () => {
  it("pdfExport.js (рантайм пакета) кладёт labels бейка в опции построителя", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "server/scorm/template/app/utils/pdfExport.js"),
      "utf8",
    );
    expect(src).toMatch(/bake\s*&&\s*bake\.labels\)\s*opts\.labels\s*=\s*bake\.labels/);
  });

  it("attempt-report.ts (веб-модуль) кладёт labels ответа сервера в опции построителя", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/features/learner/attempt-report.ts"),
      "utf8",
    );
    expect(src).toMatch(/render\.labels\s*\?\s*\{\s*labels:\s*render\.labels\s*\}/);
  });
});

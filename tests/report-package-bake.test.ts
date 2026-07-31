/**
 * @module tests/report-package-bake
 *
 * PRD-27 Фаза 5 — ВЫГРУЗКА отчёта в SCORM-пакет (FR-22, FR-10).
 *
 * Пакет собирается НАСТОЯЩИМ конвейером и распаковывается: пиннится то, из-за чего
 * отчёт в LMS расходится с тем, что автор выбрал и увидел в предпросмотре — не тот
 * макет, потерянные значения полей и, самое коварное, потерянный стиль (страница
 * собирается, но приезжает без оформления, и заметить это можно только глазами).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import JSZip from "jszip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateScormPackage } from "../server/scorm-exporter";
import { resolveReportBake } from "@shared/report/report-variants";

// Строитель манифеста пишет код теста в отслеживаемый файл — снимок и возврат,
// чтобы прогон не оставлял следов.
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

// ─── Оснастка ────────────────────────────────────────────────────────────────

const TEST_ID = "prd27-bake";
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

function buildFixture(opts: {
  mode?: "standard" | "adaptive";
  templateId?: string;
  /** Каталог шаблона на диске — им подменяется встроенный (как это делает маршрут). */
  templateDir?: string;
  reportSettingsJson?: unknown;
} = {}) {
  const topic = { id: TOPIC, name: "Тема A", description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() };
  const templateId = opts.templateId ?? "default";
  return {
    test: {
      id: TEST_ID, title: "PRD-27 запекание отчёта", description: "",
      mode: opts.mode ?? "standard", showDifficultyLevel: true,
      overallPassRuleJson: { type: "percent", value: 70 }, webhookUrl: null,
      feedback: null, timeLimitMinutes: null, maxAttempts: null,
      showCorrectAnswers: true, startPageContent: null,
      published: true, status: "published", folderId: null,
      designSettingsJson: { templateId, params: {} },
      flowPolicyJson: { mode: "linear_flat" },
      reportSettingsJson: opts.reportSettingsJson ?? null,
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
    designSettings: { templateId, params: {} },
    ...(opts.templateDir ? { templateDir: opts.templateDir } : {}),
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

/** Манифест «Стандартного» — источник ожидаемых ключей варианта. */
function defaultManifest(): unknown {
  return JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "server/scorm/templates/default/manifest.json"), "utf8"),
  );
}

// ─── Разрешение варианта (чистая часть) ──────────────────────────────────────

describe("resolveReportBake", () => {
  const MANIFEST = {
    contentTemplates: [
      { key: "report.plain", kind: "report", layoutFile: "layouts/a.html", styleFile: "styles/a.css", isDefault: true },
      {
        key: "report.cert", kind: "report", layoutFile: "layouts/b.html", styleFile: "styles/b.css",
        settings: [{ key: "headline", type: "text", default: "Итоги" }],
      },
    ],
  };

  it("берёт вариант, выбранный автором", () => {
    const bake = resolveReportBake(MANIFEST, "report", { variantKey: "report.cert", values: null });
    expect(bake.variantKey).toBe("report.cert");
    expect(bake.layoutKey).toBe("layouts/b.html");
    expect(bake.styleFile).toBe("styles/b.css");
  });

  it("без выбора — вариант с isDefault", () => {
    expect(resolveReportBake(MANIFEST, "report", null).variantKey).toBe("report.plain");
  });

  it("сливает значения полей с умолчаниями манифеста", () => {
    expect(resolveReportBake(MANIFEST, "report", { variantKey: "report.cert" }).values).toEqual({
      headline: "Итоги",
    });
    expect(
      resolveReportBake(MANIFEST, "report", { variantKey: "report.cert", values: { headline: "Аттестация" } }).values,
    ).toEqual({ headline: "Аттестация" });
  });

  it("шаблон без вида: канонический ключ и пустой выбор — это и есть деградация", () => {
    const bake = resolveReportBake({ contentTemplates: [] }, "report", { variantKey: "report.cert" });
    expect(bake.variantKey).toBeNull();
    expect(bake.layoutKey).toBe("report");
    expect(bake.styleFile).toBeNull();
  });

  it("вид другого режима не подставляется", () => {
    expect(resolveReportBake(MANIFEST, "report.adaptive", null).variantKey).toBeNull();
  });
});

// ─── Запекание в пакет ───────────────────────────────────────────────────────

describe("выбор варианта запекается в пакет (FR-22)", () => {
  it("TEST_DATA несёт макет, стиль и значения выбранного варианта", async () => {
    const zip = await pack();
    const td = await readTestData(zip);
    // Картинки варианта — файлы шаблона, а он лежит в пакете под `template/` (FR-05),
    // поэтому ожидание строится с той же базой, с какой запекает сборщик.
    const expected = resolveReportBake(defaultManifest(), "report", null, "template/");
    expect(td.designSettings.report).toEqual(expected);
    // Не «какой-нибудь report.css по имени файла», а именно объявленный вариантом.
    expect(td.designSettings.report.styleFile).toBe(expected.styleFile);
  });

  it("картинки варианта запечены путями ВНУТРЬ пакета и эти файлы там есть (FR-05)", async () => {
    const zip = await pack();
    const td = await readTestData(zip);
    const report = td.designSettings.report as {
      imageKeys: string[];
      values: Record<string, string>;
    };
    // Ключи полей-картинок объявляет шаблон, а не продукт.
    expect(report.imageKeys.length).toBeGreaterThan(0);
    for (const key of report.imageKeys) {
      const src = report.values[key];
      expect(src, key).toMatch(/^template\//);
      // Растеризатор дозагружать ничего не станет — файл обязан лежать в пакете.
      expect(zip.file(src), src).toBeTruthy();
    }
    // Прежних путей ядра в пакете больше нет.
    expect(zip.file("assets/media/pdf-bg-1.png")).toBeNull();
    expect(zip.file("assets/media/logo-light.png")).toBeNull();
  });

  it("макет, названный запеканием, ЛЕЖИТ в пакете", async () => {
    const zip = await pack();
    const td = await readTestData(zip);
    expect(zip.file(`template/${td.designSettings.report.layoutKey}`)).toBeTruthy();
  });

  it("CSS варианта попадает в styles.css — иначе страница соберётся без оформления", async () => {
    const zip = await pack();
    const css = await zip.file("styles.css")!.async("string");
    expect(css).toContain(".tb-report");
    // Класс слоя сцены к странице A4 неприменим: стиль отчёта скоуплен своим корнем.
    expect(css).toContain(".tb-report__headline");
  });

  it("адаптивный тест запекает СВОЙ вид (D-5)", async () => {
    const zip = await pack({ mode: "adaptive" });
    const td = await readTestData(zip);
    expect(td.designSettings.report.variantKey).toBe(
      resolveReportBake(defaultManifest(), "report.adaptive", null).variantKey,
    );
    expect(td.designSettings.report.layoutKey).toContain("adaptive");
  });

  it("значения полей автора доезжают до пакета (FR-16)", async () => {
    const variant = (defaultManifest() as { contentTemplates: Array<{ key: string; kind: string }> })
      .contentTemplates.find((c) => c.kind === "report")!;
    const zip = await pack({
      reportSettingsJson: { standard: { variantKey: variant.key, values: { headline: "Аттестация" } } },
    });
    const td = await readTestData(zip);
    expect(td.designSettings.report.variantKey).toBe(variant.key);
    // «Стандартный» полей у отчёта не объявляет, поэтому чужое значение отбрасывается —
    // ровно то же правило, что и при смене варианта (FR-14).
    expect(td.designSettings.report.values.headline).toBeUndefined();
  });
});

describe("деградация, когда шаблон вида не объявил (FR-10)", () => {
  // Настоящий каталог шаблона БЕЗ видов отчёта. Он создаётся, а не берётся из репозитория:
  // единственный встроенный шаблон — «Стандартный», и он вид объявляет, так что тест на нём
  // молча проверял бы не деградацию, а обычный путь.
  let bareDir: string;

  beforeAll(() => {
    bareDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-bare-tpl-"));
    fs.mkdirSync(path.join(bareDir, "layouts"), { recursive: true });
    fs.mkdirSync(path.join(bareDir, "styles"), { recursive: true });
    fs.writeFileSync(
      path.join(bareDir, "manifest.json"),
      JSON.stringify({
        id: "bare",
        name: "Без отчёта",
        version: "1.0.0",
        templateApiVersion: "1.0",
        layouts: { start: "layouts/start.html", results: "layouts/results.html" },
        assets: { styles: ["styles/theme.css"] },
        contentTemplates: [{ key: "results.standard", kind: "results", layoutFile: "layouts/results.html" }],
      }),
    );
    fs.writeFileSync(path.join(bareDir, "layouts/start.html"), "<div class=\"tb-scene\"></div>");
    fs.writeFileSync(path.join(bareDir, "layouts/results.html"), "<div class=\"tb-scene\"></div>");
    fs.writeFileSync(path.join(bareDir, "styles/theme.css"), ".tb-scene { color: #fff }");
  });

  afterAll(() => {
    fs.rmSync(bareDir, { recursive: true, force: true });
  });

  it("шаблон и правда без вида отчёта — иначе проверять нечего", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(bareDir, "manifest.json"), "utf8"));
    expect(resolveReportBake(manifest, "report", null).variantKey).toBeNull();
  });

  it("канонический ключ макета, СТИЛЬ из «Стандартного» и ключ в списке запасных", async () => {
    const zip = await pack({ templateId: "bare", templateDir: bareDir });
    const td = await readTestData(zip);
    expect(td.designSettings.report.variantKey).toBeNull();
    expect(td.designSettings.report.layoutKey).toBe("report");
    // Ключевое: стиль НЕ теряется. Без него страница собирается, но пустая на вид.
    expect(td.designSettings.report.styleFile).toBeTruthy();
    expect(td.designSettings.fallbackLayoutKeys).toContain("report");
    const css = await zip.file("styles.css")!.async("string");
    expect(css).toContain(".tb-report");
    // Макет приезжает из вложенного «Стандартного».
    expect(zip.file("template-default/layouts/report.html")).toBeTruthy();
  });
});

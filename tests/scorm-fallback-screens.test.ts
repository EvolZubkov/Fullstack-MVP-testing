/**
 * @module tests/scorm-fallback-screens
 * @description Acceptance test for the PRD-7 G21 SCORM fallback: when the active
 * template declares no `contentTemplate` of a system kind (start/results) — even
 * if it ships that LAYOUT — the package must bundle the `default` template under
 * `template-default/` + `styles-default.css`, flag `designSettings.fallbackKinds`
 * in TEST_DATA, and inject the `styles-fallback` stylesheet link, so the runtime
 * renders those screens from `default` (matching «Структура» / the editor preview).
 *
 * A template that DOES declare start/results gets none of this.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import JSZip from "jszip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateScormPackage } from "../server/scorm-exporter";

const IDENT = path.resolve(process.cwd(), "uploads", "scorm", "identifiers.json");
let identSnapshot: Buffer | null = null;

const TOPIC_ID = "fb-topic";

/** Writes a minimal on-disk template dir; `kinds` are the declared contentTemplate kinds. */
function writeTemplate(dir: string, id: string, kinds: string[]): void {
  fs.mkdirSync(path.join(dir, "layouts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "styles"), { recursive: true });
  const manifest = {
    id,
    name: id,
    version: "1.0.0",
    templateApiVersion: "1.0",
    // Ships start/results LAYOUTS regardless of what it declares in contentTemplates.
    layouts: {
      shell: "shell.html",
      start: "layouts/start.html",
      question: "layouts/question.html",
      results: "layouts/results.html",
    },
    contentTemplates: kinds.map((kind) => ({ key: kind + ".x", label: kind, kind })),
    params: [],
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "shell.html"), '<main data-slot="page"></main>');
  fs.writeFileSync(path.join(dir, "layouts", "start.html"), "<div>own start</div>");
  fs.writeFileSync(path.join(dir, "layouts", "question.html"), '<div data-slot="question-text"></div>');
  fs.writeFileSync(path.join(dir, "layouts", "results.html"), "<div>own results</div>");
  fs.writeFileSync(path.join(dir, "styles", "theme.css"), ":root{--primary:0 0% 0%;}");
  fs.writeFileSync(path.join(dir, "styles", "base.css"), ".own{display:block;}");
}

function buildFixture(templateDir: string, templateId: string) {
  const questions = [
    {
      id: "q1", topicId: TOPIC_ID, type: "single", prompt: "Q", dataJson: { options: ["A", "B"] },
      correctJson: { correctIndex: 0 }, points: 1, difficulty: 50, mediaUrl: null, mediaType: null,
      feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
      createdAt: new Date(), updatedAt: new Date(),
    },
  ];
  const topic = { id: TOPIC_ID, name: "Тема", description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() };
  const test = {
    id: "fb-test", title: "Fallback тест", description: "", mode: "standard", showDifficultyLevel: false,
    overallPassRuleJson: { type: "percent", value: 70 }, webhookUrl: null, feedback: null,
    timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: true, startPageContent: "",
    published: true, status: "published", folderId: null,
    designSettingsJson: { templateId, params: {} }, createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    test,
    sections: [{ id: "s1", testId: "fb-test", topicId: TOPIC_ID, drawCount: 1, sortOrder: 0, required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null, topic, questions, courses: [], events: [] }],
    adaptiveSettings: null,
    contentPages: [],
    designSettings: { templateId, params: {} },
    templateDir,
    telemetry: null,
  };
}

async function readTestData(zip: JSZip): Promise<any> {
  const appjs = await zip.file("app.js")!.async("string");
  const b64 = (appjs.match(/var b64 = "([A-Za-z0-9+/=]+)"/) || [])[1]!;
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

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

describe("SCORM fallback screens (PRD-7 G21)", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scorm-fb-"));
  });
  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("bundles default + flags fallbackKinds when the template declares no start/results", async () => {
    const dir = path.join(tmpRoot, "no-sysscreens");
    // Declares only intro/questions — NOT start/results (though it ships the layouts).
    writeTemplate(dir, "no-sysscreens", ["intro", "questions"]);

    const buffer = await generateScormPackage(buildFixture(dir, "no-sysscreens") as any);
    const zip = await JSZip.loadAsync(buffer);

    // Default template bundled under template-default/ + its CSS.
    expect(zip.file("template-default/manifest.json"), "default manifest bundled").toBeTruthy();
    expect(zip.file("template-default/layouts/start.html"), "default start layout bundled").toBeTruthy();
    expect(zip.file("styles-default.css"), "default CSS bundled").toBeTruthy();
    // default's base.css is the real component CSS, so it must be non-trivial.
    expect((await zip.file("styles-default.css")!.async("string")).length).toBeGreaterThan(500);

    // index.html toggles in the fallback stylesheet.
    const indexHtml = await zip.file("index.html")!.async("string");
    expect(indexHtml).toContain('id="styles-fallback"');
    expect(indexHtml).toContain('id="styles-main"');

    // TEST_DATA flags both system kinds as fallback.
    const td = await readTestData(zip);
    expect(td.designSettings.fallbackKinds).toEqual(expect.arrayContaining(["start", "results"]));
  });

  it("does NOT bundle default when the template declares start AND results", async () => {
    const dir = path.join(tmpRoot, "has-sysscreens");
    writeTemplate(dir, "has-sysscreens", ["start", "results", "questions"]);

    const buffer = await generateScormPackage(buildFixture(dir, "has-sysscreens") as any);
    const zip = await JSZip.loadAsync(buffer);

    expect(zip.file("template-default/manifest.json"), "no default bundle").toBeNull();
    expect(zip.file("styles-default.css"), "no default CSS").toBeNull();
    const indexHtml = await zip.file("index.html")!.async("string");
    expect(indexHtml).not.toContain("styles-fallback");

    const td = await readTestData(zip);
    expect(td.designSettings.fallbackKinds).toBeUndefined();
  });

  it("bundles only the missing kind when the template declares start but not results", async () => {
    const dir = path.join(tmpRoot, "partial-sysscreens");
    writeTemplate(dir, "partial-sysscreens", ["start", "questions"]);

    const buffer = await generateScormPackage(buildFixture(dir, "partial-sysscreens") as any);
    const zip = await JSZip.loadAsync(buffer);

    const td = await readTestData(zip);
    expect(td.designSettings.fallbackKinds).toEqual(["results"]);
    expect(zip.file("template-default/manifest.json")).toBeTruthy();
  });
});

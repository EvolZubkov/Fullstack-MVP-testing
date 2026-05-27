/**
 * @module tests/scorm-package-acceptance
 * @description Golden / acceptance test for the REAL SCORM generation pipeline
 * ({@link generateScormPackage}). Guards that a generated package is a valid,
 * complete SCORM 2004 package an LMS can run:
 *   - `imsmanifest.xml` declares SCORM 2004 (CAM 1.3) with an organization and a
 *     `scormType="sco"` resource whose launch href exists inside the package;
 *   - the launch HTML, runtime, styles and the selected template are bundled;
 *   - the embedded `TEST_DATA` carries questions of all four mechanics
 *     (single / multiple / matching / ranking) and the content pages;
 *   - richText/html content values are sanitized before packaging.
 *
 * Complements `scorm-export.test.ts` (which mocks the exporter) by exercising the
 * pipeline end-to-end on real template assets.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import { generateScormPackage } from "../server/scorm-exporter";

// The manifest builder persists a code per test id to this tracked file —
// snapshot/restore it so this test leaves no trace.
const IDENT = path.resolve(process.cwd(), "uploads", "scorm", "identifiers.json");
let identSnapshot: Buffer | null = null;

// ─── Fixture ─────────────────────────────────────────────────────────────────────

const TEST_ID = "acceptance-test";
const TOPIC_ID = "acceptance-topic";

function question(id: string, type: string, dataJson: unknown, correctJson: unknown) {
  return {
    id, topicId: TOPIC_ID, type, prompt: `Q ${type}`, dataJson, correctJson,
    points: 1, difficulty: 50, mediaUrl: null, mediaType: null, feedback: null,
    feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function contentPage(id: string, position: string, kind: string, type: string, templateKey: string | null, topicId: string | null, values: Record<string, unknown>) {
  return {
    id, testId: TEST_ID, topicId, position, mode: "template", type, kind, templateKey,
    sortOrder: 0, valuesJson: { values, placeholderStyles: {} }, autoAdvance: false,
    autoAdvanceDelayMs: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

function buildFixture() {
  const questions = [
    question("q1", "single", { options: ["A", "B", "C"] }, { correctIndex: 0 }),
    question("q2", "multiple", { options: ["A", "B", "C"] }, { correctIndices: [0, 2] }),
    question("q3", "matching", { left: ["L1", "L2"], right: ["R1", "R2"] }, { pairs: [{ left: 0, right: 1 }, { left: 1, right: 0 }] }),
    question("q4", "ranking", { items: ["I1", "I2", "I3"] }, { correctOrder: [2, 0, 1] }),
  ];
  const topic = { id: TOPIC_ID, name: "Тема", description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() };
  const test = {
    id: TEST_ID, title: "Acceptance тест", description: "Проверка генерации SCORM", mode: "standard",
    showDifficultyLevel: true, overallPassRuleJson: { type: "percent", value: 70 }, webhookUrl: null,
    feedback: null, timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: true,
    startPageContent: "Старт", published: true, status: "published", folderId: null,
    designSettingsJson: { templateId: "default", params: {} }, createdAt: new Date(), updatedAt: new Date(),
  };
  const contentPages = [
    contentPage("cp-intro", "before", "intro", "intro", "intro.hero", null, { title: "Введение" }),
    contentPage("cp-before", "before_topic", "info", "info", "info.text", TOPIC_ID, { title: "До темы", body: "<p>ok</p><script>alert(1)</script>" }),
    contentPage("cp-after", "after_topic", "info", "info", "info.text", TOPIC_ID, { title: "После темы", body: "<p>после</p>" }),
    contentPage("cp-summary", "after", "summary", "summary", "summary.result", null, { title: "Итоги" }),
  ];
  return {
    test,
    sections: [{ id: "s1", testId: TEST_ID, topicId: TOPIC_ID, drawCount: questions.length, sortOrder: 0, required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null, topic, questions, courses: [], events: [] }],
    adaptiveSettings: null,
    contentPages,
    designSettings: { templateId: "default", params: {} },
    telemetry: null,
  };
}

// ─── Suite ─────────────────────────────────────────────────────────────────────────

describe("SCORM package acceptance (real generateScormPackage)", () => {
  let buffer: Buffer;
  let zip: JSZip;

  beforeAll(async () => {
    identSnapshot = fs.existsSync(IDENT) ? fs.readFileSync(IDENT) : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buffer = await generateScormPackage(buildFixture() as any);
    zip = await JSZip.loadAsync(buffer);
  });

  afterAll(() => {
    if (identSnapshot === null) {
      if (fs.existsSync(IDENT)) fs.rmSync(IDENT);
    } else {
      fs.writeFileSync(IDENT, identSnapshot);
    }
  });

  it("produces a non-trivial zip", () => {
    expect(buffer.length).toBeGreaterThan(100_000);
  });

  it("declares SCORM 2004 with an organization and a resolvable SCO launch", async () => {
    const file = zip.file("imsmanifest.xml");
    expect(file).toBeTruthy();
    const xml = await file!.async("string");
    expect(xml).toContain("2004"); // schemaversion (CAM 1.3 / SCORM 2004)
    expect(xml).toMatch(/<organization/);
    const href =
      (xml.match(/<resource[^>]*adlcp:scormType="sco"[^>]*\bhref="([^"]+)"/i) || [])[1] ||
      (xml.match(/<resource[^>]*\bhref="([^"]+)"/i) || [])[1];
    expect(href, "manifest must declare a launch href").toBeTruthy();
    expect(zip.file(href!), `launch file ${href} must exist in the package`).toBeTruthy();
  });

  it("bundles the launch html, runtime, styles and the selected template", () => {
    for (const f of ["index.html", "app.js", "runtime.js", "styles.css", "template/manifest.json"]) {
      expect(zip.file(f), `${f} must be packaged`).toBeTruthy();
    }
  });

  it("bundles the content-flow runtime (test-scope + post-results handling)", async () => {
    const appjs = await zip.file("app.js")!.async("string");
    // Tripwire: the page-sequence builder and the post-results flow must be bundled
    // so a generated package renders «До теста»/«После теста» pages (PRD-1 §1.9).
    expect(appjs).toContain("rebuildPageSequence");
    expect(appjs).toContain("postResultsPages");
  });

  it("embeds TEST_DATA with all four question mechanics and the content pages", async () => {
    const appjs = await zip.file("app.js")!.async("string");
    const b64 = (appjs.match(/var b64 = "([A-Za-z0-9+/=]+)"/) || [])[1];
    expect(b64, "app.js must embed the base64 TEST_DATA").toBeTruthy();
    const td = JSON.parse(Buffer.from(b64!, "base64").toString("utf8"));

    expect(td.designSettings.templateId).toBe("default");
    const types = new Set((td.sections[0].questions as { type: string }[]).map((q) => q.type));
    for (const t of ["single", "multiple", "matching", "ranking"]) {
      expect(types.has(t), `TEST_DATA must include a ${t} question`).toBe(true);
    }
    expect(Array.isArray(td.contentPages)).toBe(true);
    const positions = (td.contentPages as { position: string }[]).map((p) => p.position).sort();
    expect(positions).toContain("before_topic");
    expect(positions).toContain("after_topic");
  });

  it("sanitizes script injected into content-page richText values", async () => {
    const appjs = await zip.file("app.js")!.async("string");
    const b64 = (appjs.match(/var b64 = "([A-Za-z0-9+/=]+)"/) || [])[1]!;
    const td = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const before = (td.contentPages as { values?: Record<string, unknown> }[]).find(
      (p) => (p.values as Record<string, unknown> | undefined)?.title === "До темы",
    );
    const body = String((before?.values as Record<string, unknown>)?.body ?? "");
    expect(body).toContain("<p>ok</p>");
    expect(body).not.toContain("<script>");
  });
});

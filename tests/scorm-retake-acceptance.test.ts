/**
 * @module tests/scorm-retake-acceptance
 * @description Acceptance for the PRD-6 retake-gate EXPORT path. Builds a REAL
 * package via {@link generateScormPackage} and asserts the embedded `TEST_DATA`
 * carries `retakePolicy` + the resolved `retakePlugin` (runtimeEntry + config
 * from the registry) when a policy is set — and carries NEITHER when it is not
 * (FR-02 byte-identical). The gate's runtime behaviour is verified live in
 * scorm-player; the pure logic by eligibility-engine(-port) tests.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import { generateScormPackage } from "../server/scorm-exporter";

const IDENT = path.resolve(process.cwd(), "uploads", "scorm", "identifiers.json");
let identSnapshot: Buffer | null = null;

const TOPIC_ID = "retake-topic";

function question(id: string) {
  return {
    id, topicId: TOPIC_ID, type: "single", prompt: `Q ${id}`,
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    points: 1, difficulty: 50, mediaUrl: null, mediaType: null, feedback: null,
    feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
    tags: [], createdAt: new Date(), updatedAt: new Date(),
  };
}

function buildFixture(testId: string, retakePolicyJson: unknown) {
  const topic = { id: TOPIC_ID, name: "Тема", description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() };
  const test = {
    id: testId, title: "Retake тест", description: "", mode: "standard",
    showDifficultyLevel: true, overallPassRuleJson: { type: "percent", value: 70 }, webhookUrl: null,
    feedback: null, timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: true,
    startPageContent: null, published: true, status: "published", folderId: null,
    designSettingsJson: { templateId: "default", params: {} }, retakePolicyJson,
    createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    test,
    sections: [{
      id: "s1", testId, topicId: TOPIC_ID, drawCount: 2, sortOrder: 0,
      required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null,
      topic, questions: [question("a"), question("b")], courses: [], events: [],
    }],
    adaptiveSettings: null, contentPages: [], designSettings: { templateId: "default", params: {} }, telemetry: null,
  };
}

async function decodeTestData(retakePolicyJson: unknown, testId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await generateScormPackage(buildFixture(testId, retakePolicyJson) as any);
  const zip = await JSZip.loadAsync(buffer);
  const appjs = await zip.file("app.js")!.async("string");
  const b64 = (appjs.match(/var b64 = "([A-Za-z0-9+/=]+)"/) || [])[1]!;
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

describe("SCORM package — PRD-6 retake policy export", () => {
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

  it("embeds retakePolicy + resolved retakePlugin when a policy is set", async () => {
    const td = await decodeTestData(
      {
        enabled: true,
        cooldownPeriodDays: 30,
        gateMode: "before_internal_start",
        eligibilityPlugin: { key: "webtutor_cooldown", configId: "webtutor_catalog_default", failPolicy: "failOpen" },
        completionReportMode: "scored",
      },
      "retake-on",
    );
    expect(td.retakePolicy).toMatchObject({
      enabled: true,
      cooldownPeriodDays: 30,
      eligibilityPlugin: { key: "webtutor_cooldown", failPolicy: "failOpen" },
    });
    expect(td.retakePlugin).toMatchObject({ key: "webtutor_cooldown", runtimeEntry: "webtutorCooldown" });
    // The resolved config carries the attempt filter the runtime needs.
    expect((td.retakePlugin.config as any).attemptFilter.dateField).toBe("last_usage_date");
  });

  it("omits retakePolicy/retakePlugin when no policy is set (FR-02)", async () => {
    const td = await decodeTestData(null, "retake-off");
    expect(td.retakePolicy).toBeUndefined();
    expect(td.retakePlugin).toBeUndefined();
  });

  it("omits the gate when the policy is present but disabled (FR-02)", async () => {
    const td = await decodeTestData({ enabled: false, cooldownPeriodDays: 30 }, "retake-disabled");
    expect(td.retakePolicy).toBeUndefined();
  });
});

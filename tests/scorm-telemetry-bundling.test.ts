/**
 * @module tests/scorm-telemetry-bundling
 *
 * Guards what a package carries when telemetry is OFF. The runtime module itself is
 * already left out, but the call sites scattered across the render/action code are not:
 * they used to be removed by regex source-mangling, which silently missed forms it did
 * not anticipate (`Telemetry.finish(results)` with a variable instead of an object
 * literal). A missed call site is a `ReferenceError` at runtime — the adaptive results
 * screen is bundled unconditionally, so an adaptive test exported without telemetry hit
 * it. The invariant below is the one that actually matters: if the bundle mentions
 * `Telemetry`, the bundle must also define it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import { generateScormPackage } from "../server/scorm-exporter";

const IDENT = path.resolve(process.cwd(), "uploads", "scorm", "identifiers.json");
let identSnapshot: Buffer | null = null;

const TOPIC_ID = "telemetry-topic";

function question(id: string) {
  return {
    id, topicId: TOPIC_ID, type: "single", prompt: `Q ${id}`,
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    points: 1, difficulty: 50, mediaUrl: null, mediaType: null, feedback: null,
    feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
    tags: [], createdAt: new Date(), updatedAt: new Date(),
  };
}

function buildFixture(testId: string, telemetry: unknown) {
  const topic = { id: TOPIC_ID, name: "Тема", description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() };
  const test = {
    id: testId, title: "Тест", description: "", mode: "standard",
    showDifficultyLevel: true, overallPassRuleJson: { type: "percent", value: 70 }, webhookUrl: null,
    feedback: null, timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: true,
    startPageContent: null, published: true, status: "published", folderId: null,
    designSettingsJson: { templateId: "default", params: {} }, retakePolicyJson: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    test,
    sections: [{
      id: "s1", testId, topicId: TOPIC_ID, drawCount: 2, sortOrder: 0,
      required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null,
      topic, questions: [question("a"), question("b")], courses: [], events: [],
    }],
    adaptiveSettings: null, contentPages: [],
    designSettings: { templateId: "default", params: {} },
    telemetry,
  };
}

async function buildAppJs(telemetry: unknown, testId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await generateScormPackage(buildFixture(testId, telemetry) as any);
  const zip = await JSZip.loadAsync(buffer);
  return await zip.file("app.js")!.async("string");
}

const TELEMETRY_ON = {
  enabled: true,
  packageId: "pkg-1",
  secretKey: "secret",
  apiBaseUrl: "https://telemetry.example",
};

/** Strings that exist only inside the real telemetry runtime. */
const RUNTIME_MARKERS = ["/api/scorm-telemetry/", "offlineBuffer", "sendBeacon", "crypto.subtle"];

describe("SCORM package — telemetry bundling", () => {
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

  it("bundles the telemetry runtime when telemetry is enabled", async () => {
    const appjs = await buildAppJs(TELEMETRY_ON, "telemetry-on");
    for (const marker of RUNTIME_MARKERS) expect(appjs).toContain(marker);
  });

  it("leaves the telemetry runtime out when telemetry is disabled", async () => {
    const appjs = await buildAppJs(null, "telemetry-off");
    for (const marker of RUNTIME_MARKERS) expect(appjs).not.toContain(marker);
  });

  it("leaves the runtime out when telemetry is present but disabled", async () => {
    const appjs = await buildAppJs({ ...TELEMETRY_ON, enabled: false }, "telemetry-flag-off");
    for (const marker of RUNTIME_MARKERS) expect(appjs).not.toContain(marker);
  });

  it("never leaves a Telemetry reference the bundle cannot resolve", async () => {
    const appjs = await buildAppJs(null, "telemetry-off-refs");

    const references = appjs.match(/\bTelemetry\s*\.\s*\w+/g) ?? [];
    const defined = /\bvar\s+Telemetry\s*=/.test(appjs);
    // Either nothing calls it, or something declares it — anything else throws
    // ReferenceError the moment that line runs.
    expect(references.length > 0 && !defined).toBe(false);
  });

  it("says nothing about telemetry in the console when disabled", async () => {
    const appjs = await buildAppJs(null, "telemetry-off-console");

    // These lines used to be deleted along with the call sites by the regex strip.
    // Without it they survive and misreport: a package with telemetry off would print
    // «Телеметрия finish отправлена» although nothing was sent anywhere. The real module
    // already logs its own delivery, so the chatter has no reader either way.
    const chatter = appjs.match(/console\.(log|warn|error)\([^)]*(?:[Тт]елеметри|Telemetry)[^)]*\)/g) ?? [];
    expect(chatter).toEqual([]);
  });

  it("omits the telemetry config from TEST_DATA when disabled", async () => {
    const appjs = await buildAppJs(null, "telemetry-off-testdata");
    const b64 = (appjs.match(/var b64 = "([A-Za-z0-9+/=]+)"/) || [])[1]!;
    const td = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    expect(td.telemetry).toBeUndefined();
  });
});

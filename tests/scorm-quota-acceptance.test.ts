/**
 * @module tests/scorm-quota-acceptance
 * @description End-to-end acceptance for PRD-11 draw quotas in a REAL SCORM
 * package. It builds a package via {@link generateScormPackage} for a test that
 * carries a draw blueprint and tagged questions, then proves the runtime honours
 * the quotas by running the package's OWN `drawSection` (extracted from the
 * bundled `app.js`) over the package's OWN embedded `TEST_DATA`:
 *
 *   - the runtime questions actually carry `tags` (without them the blueprint is
 *     inert — this is the regression guard for the export gap);
 *   - the section carries the `drawBlueprint`;
 *   - across many random draws the selection always satisfies the quota
 *     invariants: an `exact` tag yields exactly `count`, a `min` tag at least
 *     `count`, the total equals `drawCount`, and no question repeats (FR-03a/04/05).
 *
 * This complements the unit-level golden parity (tests/draw-blueprint-port) by
 * exercising the export → embed → runtime-draw chain on a real generated package.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import { generateScormPackage } from "../server/scorm-exporter";
import { tagKey } from "../shared/tags";

const IDENT = path.resolve(process.cwd(), "uploads", "scorm", "identifiers.json");
let identSnapshot: Buffer | null = null;

const TEST_ID = "quota-acceptance-test";
const TOPIC_ID = "quota-acceptance-topic";

function question(id: string, tags: string[]) {
  return {
    id,
    topicId: TOPIC_ID,
    type: "single",
    prompt: `Q ${id}`,
    dataJson: { options: ["A", "B"] },
    correctJson: { correctIndex: 0 },
    points: 1,
    difficulty: 50,
    mediaUrl: null,
    mediaType: null,
    feedback: null,
    feedbackMode: "general",
    feedbackCorrect: null,
    feedbackIncorrect: null,
    tags,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// 3×"A", 3×"B", 2 untagged. Blueprint: A exact 2, B min 1, drawCount 4.
const QUESTIONS = [
  question("a1", ["A"]),
  question("a2", ["A"]),
  question("a3", ["A"]),
  question("b1", ["B"]),
  question("b2", ["B"]),
  question("b3", ["B"]),
  question("u1", []),
  question("u2", []),
];
const DRAW_COUNT = 4;
const BLUEPRINT = {
  strata: [
    { tag: "A", count: 2, mode: "exact" as const },
    { tag: "B", count: 1, mode: "min" as const },
  ],
};

function buildFixture() {
  const topic = { id: TOPIC_ID, name: "Тема", description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() };
  const test = {
    id: TEST_ID, title: "Quota acceptance", description: "", mode: "standard",
    showDifficultyLevel: true, overallPassRuleJson: { type: "percent", value: 70 }, webhookUrl: null,
    feedback: null, timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: true,
    startPageContent: null, published: true, status: "published", folderId: null,
    designSettingsJson: { templateId: "default", params: {} }, createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    test,
    sections: [{
      id: "s1", testId: TEST_ID, topicId: TOPIC_ID, drawCount: DRAW_COUNT, sortOrder: 0,
      required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null,
      drawBlueprintJson: BLUEPRINT,
      topic, questions: QUESTIONS, courses: [], events: [],
    }],
    adaptiveSettings: null,
    contentPages: [],
    designSettings: { templateId: "default", params: {} },
    telemetry: null,
  };
}

/** Random Fisher-Yates — the runtime's real shuffle is also random. */
function rngShuffle<T>(a: T[]): T[] {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface RuntimeQuestion { id: string; tags?: string[] }
type DrawSectionFn = (
  questions: RuntimeQuestion[],
  drawCount: number,
  blueprint: unknown,
  shuffle: <T>(a: T[]) => T[],
) => { selected: RuntimeQuestion[]; warnings: unknown[] };

describe("SCORM package — PRD-11 draw quotas at runtime", () => {
  let td: { sections: Array<{ drawBlueprint?: unknown; questions: RuntimeQuestion[] }> };
  let portDraw: DrawSectionFn;

  beforeAll(async () => {
    identSnapshot = fs.existsSync(IDENT) ? fs.readFileSync(IDENT) : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await generateScormPackage(buildFixture() as any);
    const zip = await JSZip.loadAsync(buffer);
    const appjs = await zip.file("app.js")!.async("string");

    const b64 = (appjs.match(/var b64 = "([A-Za-z0-9+/=]+)"/) || [])[1];
    if (!b64) throw new Error("TEST_DATA base64 not found in app.js");
    td = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

    const match = appjs.match(/function drawSection\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!match) throw new Error("drawSection not found in app.js");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    portDraw = new Function(`${match[0]}\n;return drawSection;`)() as DrawSectionFn;
  });

  afterAll(() => {
    if (identSnapshot === null) {
      if (fs.existsSync(IDENT)) fs.rmSync(IDENT);
    } else {
      fs.writeFileSync(IDENT, identSnapshot);
    }
  });

  it("embeds the draw blueprint on the section", () => {
    expect(td.sections[0].drawBlueprint).toEqual(BLUEPRINT);
  });

  it("embeds question tags into the runtime (without them the blueprint is inert)", () => {
    const byId = new Map(td.sections[0].questions.map((q) => [q.id, q.tags]));
    expect(byId.get("a1")).toEqual(["A"]);
    expect(byId.get("b1")).toEqual(["B"]);
    // Untagged questions stay byte-identical — no tags key.
    expect(byId.get("u1")).toBeUndefined();
  });

  it("honours the quotas across 200 random runtime draws", () => {
    const questions = td.sections[0].questions;
    const blueprint = td.sections[0].drawBlueprint;
    const tagOf = (id: string) => (questions.find((q) => q.id === id)?.tags ?? []).map(tagKey);

    for (let run = 0; run < 200; run++) {
      const { selected, warnings } = portDraw(questions, DRAW_COUNT, blueprint, rngShuffle);
      const ids = selected.map((q) => q.id);

      // No duplicates, total == drawCount, all from the pool.
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(DRAW_COUNT);

      const aCount = ids.filter((id) => tagOf(id).includes("a")).length;
      const bCount = ids.filter((id) => tagOf(id).includes("b")).length;
      // A is `exact 2` → exactly two; B is `min 1` → at least one.
      expect(aCount, `run ${run}: exact tag A must be exactly 2 (got ${aCount})`).toBe(2);
      expect(bCount, `run ${run}: min tag B must be >= 1 (got ${bCount})`).toBeGreaterThanOrEqual(1);
      // Enough questions for every quota → no shortfall warnings.
      expect(warnings).toHaveLength(0);
    }
  });
});

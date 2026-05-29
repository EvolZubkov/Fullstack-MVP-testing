/**
 * @module tests/prd-4-acceptance
 * @description PRD-4 v1.1 Phase 5 — golden acceptance for all 5 valid
 * (mode, flowMode) combinations. Each combo packs a minimal test via the
 * real `generateScormPackage` pipeline and asserts:
 *   - the zip builds without errors;
 *   - TEST_DATA carries the expected flowPolicy shape;
 *   - contentPages are exported with `kind` per PRD-1 §4.3;
 *   - adaptive packs include adaptiveTopics with non-empty levels;
 *   - router packs include a `kind: "router"` content page;
 *   - the runtime bundle includes the modules needed for the combo
 *     (routerFlow.js for router_by_topics; adaptiveSession.js for any
 *     adaptive mode).
 *
 * The legacy `tests/scorm-package-acceptance.test.ts` continues to
 * exercise the default-linear flow end-to-end (manifest, launch href,
 * styles, sanitization etc). This file targets PRD-4 contract surface.
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

// ─── Fixture builder ─────────────────────────────────────────────────────────

type FlowMode = "linear_flat" | "linear_by_topics" | "router_by_topics";
type TestMode = "standard" | "adaptive";

const TEST_ID = "prd4-acceptance";
const TOPIC_A = "topic-a";
const TOPIC_B = "topic-b";

function question(id: string, topicId: string) {
  return {
    id, topicId, type: "single", prompt: `Q ${id}`,
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    points: 1, difficulty: 50, mediaUrl: null, mediaType: null,
    feedback: null, feedbackMode: "general", feedbackCorrect: null,
    feedbackIncorrect: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

function contentPage(id: string, position: string, kind: string, type: string, templateKey: string | null, topicId: string | null, values: Record<string, unknown>) {
  return {
    id, testId: TEST_ID, topicId, position, mode: "template" as const, type, kind, templateKey,
    sortOrder: 0, valuesJson: { values, placeholderStyles: {} }, autoAdvance: false,
    autoAdvanceDelayMs: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

function adaptiveLevel(topicId: string, index: number, name: string, minD: number, maxD: number) {
  return {
    id: `lvl-${topicId}-${index}`,
    topicId,
    levelIndex: index,
    levelName: name,
    minDifficulty: minD,
    maxDifficulty: maxD,
    questionsCount: 2,
    passThreshold: 70,
    passThresholdType: "percent" as const,
    feedback: null,
    links: [],
  };
}

function buildFixture(opts: { mode: TestMode; flowMode: FlowMode }) {
  const topicA = { id: TOPIC_A, name: "Тема A", description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() };
  const topicB = { id: TOPIC_B, name: "Тема B", description: "", feedback: null, createdAt: new Date(), updatedAt: new Date() };

  const test = {
    id: TEST_ID, title: `PRD-4 ${opts.mode}/${opts.flowMode}`, description: "",
    mode: opts.mode, showDifficultyLevel: true,
    overallPassRuleJson: { type: "percent", value: 70 }, webhookUrl: null,
    feedback: null, timeLimitMinutes: null, maxAttempts: null,
    showCorrectAnswers: true, startPageContent: null,
    published: true, status: "published", folderId: null,
    designSettingsJson: { templateId: "default", params: {} },
    flowPolicyJson: { mode: opts.flowMode },
    createdAt: new Date(), updatedAt: new Date(),
  };

  // Two topics with 2 questions each so adaptive levels have something to draw from.
  const sections = [
    {
      id: "s-a", testId: TEST_ID, topicId: TOPIC_A, drawCount: 2, sortOrder: 0,
      required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null,
      topic: topicA,
      questions: [question("qa1", TOPIC_A), question("qa2", TOPIC_A)],
      courses: [], events: [],
    },
    {
      id: "s-b", testId: TEST_ID, topicId: TOPIC_B, drawCount: 2, sortOrder: 1,
      required: true, topicPassRuleJson: null, timeLimitMinutes: null, feedbackJson: null,
      topic: topicB,
      questions: [question("qb1", TOPIC_B), question("qb2", TOPIC_B)],
      courses: [], events: [],
    },
  ];

  const contentPages = [
    contentPage("cp-intro", "before", "intro", "intro", "intro.hero", null, { title: "Старт" }),
    contentPage("cp-a-before", "before_topic", "info", "info", "info.text", TOPIC_A, { title: "До A" }),
    contentPage("cp-a-after", "after_topic", "info", "info", "info.text", TOPIC_A, { title: "После A" }),
    contentPage("cp-b-before", "before_topic", "info", "info", "info.text", TOPIC_B, { title: "До B" }),
    contentPage("cp-b-after", "after_topic", "info", "info", "info.text", TOPIC_B, { title: "После B" }),
  ];

  // Router mode requires a router page (kind=router).
  if (opts.flowMode === "router_by_topics") {
    contentPages.unshift(
      contentPage("cp-router", "before", "router", "info", "router.menu", null, {
        title: "Меню тем",
        instruction: "Выберите тему",
      }),
    );
  }

  // Adaptive mode requires per-section levels — strict gating (Phase 1 L2/L3).
  let adaptiveSettings: unknown = null;
  if (opts.mode === "adaptive") {
    adaptiveSettings = {
      topicSettings: [
        { topicId: TOPIC_A, enabled: true, failureFeedback: null, failureLinks: [] },
        { topicId: TOPIC_B, enabled: true, failureFeedback: null, failureLinks: [] },
      ],
      levels: [
        adaptiveLevel(TOPIC_A, 0, "Базовый", 0, 50),
        adaptiveLevel(TOPIC_A, 1, "Продвинутый", 51, 100),
        adaptiveLevel(TOPIC_B, 0, "Базовый", 0, 50),
        adaptiveLevel(TOPIC_B, 1, "Продвинутый", 51, 100),
      ],
    };
  }

  return {
    test,
    sections,
    adaptiveSettings,
    contentPages,
    designSettings: { templateId: "default", params: {} },
    telemetry: null,
  };
}

async function packFixture(opts: { mode: TestMode; flowMode: FlowMode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await generateScormPackage(buildFixture(opts) as any);
  const zip = await JSZip.loadAsync(buffer);
  return { buffer, zip };
}

async function readTestData(zip: JSZip) {
  const appjs = await zip.file("app.js")!.async("string");
  const b64 = (appjs.match(/var b64 = "([A-Za-z0-9+/=]+)"/) || [])[1]!;
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

// ─── (standard, linear_flat) ─────────────────────────────────────────────────

describe("PRD-4 v1.1 acceptance — (standard, linear_flat)", () => {
  let zip: JSZip;

  beforeAll(async () => {
    ({ zip } = await packFixture({ mode: "standard", flowMode: "linear_flat" }));
  });

  it("exports flowPolicy.mode = 'linear_flat'", async () => {
    const td = await readTestData(zip);
    expect(td.flowPolicy.mode).toBe("linear_flat");
    expect(td.flowPolicy.routerCompletionPolicy).toBeUndefined();
  });

  it("does not include router-mode-only fields", async () => {
    const td = await readTestData(zip);
    expect(td.flowPolicy.sectionUnlockRules).toBeUndefined();
  });

  it("bundles content-flow runtime", async () => {
    const appjs = await zip.file("app.js")!.async("string");
    expect(appjs).toContain("rebuildPageSequence");
  });
});

// ─── (standard, linear_by_topics) ────────────────────────────────────────────

describe("PRD-4 v1.1 acceptance — (standard, linear_by_topics)", () => {
  let zip: JSZip;

  beforeAll(async () => {
    ({ zip } = await packFixture({ mode: "standard", flowMode: "linear_by_topics" }));
  });

  it("exports flowPolicy.mode = 'linear_by_topics'", async () => {
    const td = await readTestData(zip);
    expect(td.flowPolicy.mode).toBe("linear_by_topics");
  });

  it("exports section.required (defaults to true)", async () => {
    const td = await readTestData(zip);
    for (const section of td.sections) {
      expect(section.required).toBe(true);
    }
  });

  it("exports before_topic / after_topic content pages with kind", async () => {
    const td = await readTestData(zip);
    const positions = (td.contentPages as { position: string }[])
      .map((p) => p.position)
      .sort();
    expect(positions).toEqual(
      expect.arrayContaining(["before", "before_topic", "after_topic"]),
    );
    for (const page of td.contentPages) {
      expect(page.kind).toBeTruthy();
    }
  });
});

// ─── (standard, router_by_topics) ────────────────────────────────────────────

describe("PRD-4 v1.1 acceptance — (standard, router_by_topics)", () => {
  let zip: JSZip;

  beforeAll(async () => {
    ({ zip } = await packFixture({ mode: "standard", flowMode: "router_by_topics" }));
  });

  it("exports flowPolicy.mode = 'router_by_topics' with default completionPolicy", async () => {
    const td = await readTestData(zip);
    expect(td.flowPolicy.mode).toBe("router_by_topics");
    expect(td.flowPolicy.routerCompletionPolicy).toBe("all_required_completed");
  });

  it("exports a kind=router content page", async () => {
    const td = await readTestData(zip);
    const routerPage = (td.contentPages as { kind: string }[]).find(
      (p) => p.kind === "router",
    );
    expect(routerPage).toBeDefined();
  });

  it("bundles routerFlow.js into app.js", async () => {
    const appjs = await zip.file("app.js")!.async("string");
    expect(appjs).toContain("RouterFlow");
    expect(appjs).toContain("selectRouterTopic");
    expect(appjs).toContain("returnFromTopic");
  });
});

// ─── (adaptive, linear_by_topics) ────────────────────────────────────────────

describe("PRD-4 v1.1 acceptance — (adaptive, linear_by_topics)", () => {
  let zip: JSZip;

  beforeAll(async () => {
    ({ zip } = await packFixture({ mode: "adaptive", flowMode: "linear_by_topics" }));
  });

  it("exports flowPolicy.mode = 'linear_by_topics' AND test.mode = 'adaptive'", async () => {
    const td = await readTestData(zip);
    expect(td.flowPolicy.mode).toBe("linear_by_topics");
    expect(td.mode).toBe("adaptive");
  });

  it("exports adaptiveTopics with non-empty levels for every section (strict gating)", async () => {
    const td = await readTestData(zip);
    expect(Array.isArray(td.adaptiveTopics)).toBe(true);
    expect(td.adaptiveTopics.length).toBeGreaterThan(0);
    for (const topic of td.adaptiveTopics) {
      expect(topic.levels.length).toBeGreaterThan(0);
    }
  });

  it("bundles adaptiveSession.js into app.js", async () => {
    const appjs = await zip.file("app.js")!.async("string");
    expect(appjs).toContain("AdaptiveSession");
    expect(appjs).toContain("runAdaptiveSession");
  });

  it("bundles per-topic adaptive-session marker support in contentFlow", async () => {
    const appjs = await zip.file("app.js")!.async("string");
    expect(appjs).toContain("adaptive-session");
    expect(appjs).toContain("maybeLaunchAdaptiveSession");
  });
});

// ─── (adaptive, router_by_topics) ────────────────────────────────────────────

describe("PRD-4 v1.1 acceptance — (adaptive, router_by_topics)", () => {
  let zip: JSZip;

  beforeAll(async () => {
    ({ zip } = await packFixture({ mode: "adaptive", flowMode: "router_by_topics" }));
  });

  it("exports both flowPolicy.mode = 'router_by_topics' AND test.mode = 'adaptive'", async () => {
    const td = await readTestData(zip);
    expect(td.flowPolicy.mode).toBe("router_by_topics");
    expect(td.mode).toBe("adaptive");
  });

  it("exports router page + adaptive topics", async () => {
    const td = await readTestData(zip);
    const routerPage = (td.contentPages as { kind: string }[]).find(
      (p) => p.kind === "router",
    );
    expect(routerPage).toBeDefined();
    expect(Array.isArray(td.adaptiveTopics)).toBe(true);
    expect(td.adaptiveTopics.length).toBeGreaterThan(0);
  });

  it("bundles both router and adaptive-session runtimes", async () => {
    const appjs = await zip.file("app.js")!.async("string");
    expect(appjs).toContain("RouterFlow");
    expect(appjs).toContain("AdaptiveSession");
    expect(appjs).toContain("runAdaptiveSession");
  });
});

// ─── Cross-cutting (all combos) ──────────────────────────────────────────────

describe("PRD-4 v1.1 acceptance — runtime bundle includes section timer + recovery", () => {
  it("startSectionTimer / stopSectionTimer are bundled (Phase 4e)", async () => {
    const { zip } = await packFixture({ mode: "standard", flowMode: "router_by_topics" });
    const appjs = await zip.file("app.js")!.async("string");
    expect(appjs).toContain("startSectionTimer");
    expect(appjs).toContain("stopSectionTimer");
  });

  it("restoreRouterSession is bundled (Phase 4f)", async () => {
    const { zip } = await packFixture({ mode: "standard", flowMode: "router_by_topics" });
    const appjs = await zip.file("app.js")!.async("string");
    expect(appjs).toContain("restoreRouterSession");
    expect(appjs).toContain("restore_router");
  });

  // PRD-8 FR-18 — router lifecycle events.
  it("router runtime emits the documented events", async () => {
    const { zip } = await packFixture({ mode: "standard", flowMode: "router_by_topics" });
    const appjs = await zip.file("app.js")!.async("string");
    for (const ev of [
      "router:shown",
      "router:sectionSelected",
      "router:finalResultUnlocked",
      "router:finalResultOpened",
    ]) {
      expect(appjs, `router event "${ev}" must be emitted by routerFlow`).toContain(ev);
    }
  });
});

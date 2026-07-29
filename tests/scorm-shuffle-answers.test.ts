/**
 * @module tests/scorm-shuffle-answers
 *
 * PRD-16 FR-41/FR-42 in the SCORM package: the author's per-question switch
 * «Случайный порядок вариантов» (`questions.shuffle_answers`) must reach the
 * package and be honoured by the runtime.
 *
 * The regression this pins: the switch was never baked into TEST_DATA and the
 * runtime built a shuffle mapping for EVERY question, so a question saved with
 * the switch off was still delivered in random order in the SCORM package and
 * in the PRD-18 debug player (which ships the same runtime), while the web host
 * honoured it — a host divergence invisible to any shared-engine test.
 *
 * FR-42: Ranking is the documented exception — its authored order IS the answer
 * key, so it is always shuffled regardless of the switch.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTestJson } from "../server/scorm/builders/test-json";

const shuffleSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/shuffle.js"),
  "utf8",
);
const appSrc = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");
const adaptiveRenderSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/render/adaptiveRender.js"),
  "utf8",
);

type RuntimeQuestion = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  correct?: Record<string, unknown>;
  shuffleAnswers?: boolean;
};
type Mapping = number[] | { left: number[]; right: number[] } | null;

/**
 * The plain-JS runtime helper, evaluated straight from the shipped source. The
 * question-type traits (`TBQType`, PRD-26) are prepended the way the package build
 * concatenates them, so the scale exception is exercised on the real code.
 */
const qTypeSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/qtype.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const shuffleMappingFor = new Function(
  `${qTypeSrc}\n${shuffleSrc}\n;return shuffleMappingFor;`,
)() as (q: RuntimeQuestion) => Mapping;

const isPermutation = (m: unknown, n: number) =>
  Array.isArray(m) && [...m].sort((a, b) => a - b).join() === Array.from({ length: n }, (_, i) => i).join();

const baseTest: any = {
  id: "test-1",
  title: "T",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  timeLimitMinutes: null,
  maxAttempts: null,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
};

const dbQuestion = (values: Record<string, unknown>): any => ({
  id: "q1",
  topicId: "t1",
  type: "single",
  prompt: "Q",
  dataJson: { options: ["A", "B", "C"] },
  correctJson: { correctIndex: 0 },
  difficulty: 50,
  shuffleAnswers: true,
  mediaUrl: null,
  mediaType: null,
  feedback: null,
  feedbackMode: "general",
  feedbackCorrect: null,
  feedbackIncorrect: null,
  contentHash: "h1",
  tags: [],
  ...values,
});

const exportData = (question: any): any => ({
  test: baseTest,
  sections: [
    {
      id: "s1",
      testId: "test-1",
      topicId: "t1",
      topic: { id: "t1", name: "Topic", feedback: null },
      questions: [question],
      courses: [],
      events: [],
      drawCount: 1,
      topicPassRuleJson: null,
    },
  ],
});

describe("buildTestJson — the shuffle switch reaches the package (FR-41)", () => {
  it("bakes shuffleAnswers: false when the author turned the switch off", () => {
    const q = JSON.parse(buildTestJson(exportData(dbQuestion({ shuffleAnswers: false }))))
      .sections[0].questions[0];
    expect(q.shuffleAnswers).toBe(false);
  });

  it("omits the field for the default (on), so untouched packages stay byte-identical (FR-02)", () => {
    const json = buildTestJson(exportData(dbQuestion({ shuffleAnswers: true })));
    const q = JSON.parse(json).sections[0].questions[0];
    expect(q).not.toHaveProperty("shuffleAnswers");
  });

  it("bakes the switch for adaptive topics too", () => {
    const data = {
      ...exportData(dbQuestion({ shuffleAnswers: false })),
      test: { ...baseTest, mode: "adaptive" },
      adaptiveSettings: { topicSettings: [], levels: [] },
    };
    const q = JSON.parse(buildTestJson(data)).adaptiveTopics[0].questions[0];
    expect(q.shuffleAnswers).toBe(false);
  });
});

describe("shuffleMappingFor — runtime honours the switch (FR-41/FR-42)", () => {
  const options = { options: ["A", "B", "C", "D"] };

  it("delivers choice questions in the authored order when the switch is off", () => {
    expect(shuffleMappingFor({ id: "q", type: "single", data: options, shuffleAnswers: false })).toBeNull();
    expect(shuffleMappingFor({ id: "q", type: "multiple", data: options, shuffleAnswers: false })).toBeNull();
  });

  it("delivers matching in the authored order when the switch is off", () => {
    const data = { left: ["l1", "l2"], right: ["r1", "r2"] };
    expect(shuffleMappingFor({ id: "q", type: "matching", data, shuffleAnswers: false })).toBeNull();
  });

  it("shuffles when the switch is on or absent (legacy state)", () => {
    expect(isPermutation(shuffleMappingFor({ id: "q", type: "single", data: options, shuffleAnswers: true }), 4)).toBe(true);
    expect(isPermutation(shuffleMappingFor({ id: "q", type: "single", data: options }), 4)).toBe(true);
    const m = shuffleMappingFor({ id: "q", type: "matching", data: { left: ["a", "b"], right: ["x", "y"] } }) as {
      left: number[];
      right: number[];
    };
    expect(isPermutation(m.left, 2)).toBe(true);
    expect(isPermutation(m.right, 2)).toBe(true);
  });

  it("always shuffles ranking — the authored order is the answer key (FR-42)", () => {
    const q: RuntimeQuestion = {
      id: "q",
      type: "ranking",
      data: { items: ["1", "2", "3"] },
      correct: { correctOrder: [0, 1, 2] },
      shuffleAnswers: false,
    };
    const order = shuffleMappingFor(q) as number[];
    expect(isPermutation(order, 3)).toBe(true);
    expect(order).not.toEqual([0, 1, 2]);
  });

  it("never shuffles a scale — its graduation order is content (PRD-26 FR-04)", () => {
    const scale = (shuffleAnswers?: boolean): RuntimeQuestion => ({
      id: "q",
      type: "scale",
      data: { options: ["Никогда", "Редко", "Часто", "Постоянно"] },
      correct: {},
      ...(shuffleAnswers === undefined ? {} : { shuffleAnswers }),
    });
    // Absent switch, switch on, switch off — a scale is delivered as authored in all
    // three cases, and «no mapping» is exactly «no shuffle» for the renderers.
    expect(shuffleMappingFor(scale())).toBeNull();
    expect(shuffleMappingFor(scale(true))).toBeNull();
    expect(shuffleMappingFor(scale(false))).toBeNull();
  });

  it("returns null for a question with no options to order", () => {
    expect(shuffleMappingFor({ id: "q", type: "single", data: {} })).toBeNull();
  });
});

describe("both runtime seeds go through the helper", () => {
  it("generateVariant seeds mappings via shuffleMappingFor", () => {
    expect(appSrc).toMatch(/shuffleMappingFor\(q\)/);
  });

  it("the adaptive seed goes through the same helper", () => {
    expect(adaptiveRenderSrc).toMatch(/shuffleMappingFor\(q\)/);
  });
});

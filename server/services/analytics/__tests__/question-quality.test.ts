/**
 * @module server/services/analytics/__tests__/question-quality
 * @description PRD-70 FR-03, FR-04, §3.2: качество вопросов одного теста — признак с эвристиками
 * ревизии, наблюдаемая сложность в шкале редактора и переэкспонированность.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    getTest: vi.fn(),
    getDeliveryCountsForTest: vi.fn(),
  },
  testPsychometrics: vi.fn(),
  reviewHeuristicsOfTest: vi.fn(),
  loadDeliveryPool: vi.fn(),
  loadObservations: vi.fn(),
}));

vi.mock("../../../storage", () => ({ storage: mocks.storage }));
vi.mock("../test-psychometrics", () => ({ testPsychometrics: mocks.testPsychometrics }));
vi.mock("../../delivery-pool", () => ({ loadDeliveryPool: mocks.loadDeliveryPool }));
vi.mock("../observations", () => ({ loadObservations: mocks.loadObservations }));
vi.mock("../review-inputs", () => ({
  reviewHeuristicsOfTest: mocks.reviewHeuristicsOfTest,
  exposureWindowStart: () => new Date("2025-10-01T00:00:00Z"),
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { evaluateTestQuality } from "../question-quality";

/** Психометрика вопроса: здоровый, достаточно данных, если не сказано иное. */
function item(questionId: string, over: Record<string, unknown> = {}) {
  return {
    questionId,
    observations: 120,
    missingShare: 0,
    difficulty: 0.6,
    correctedDifficulty: 0.47,
    itemRest: 0.35,
    discrimination: 0.4,
    timing: null,
    timingFlags: { rushed: false, slow: false },
    difficultyConfidence: "reliable",
    coefficientConfidence: "reliable",
    flags: { negativeDiscrimination: false, atChanceLevel: false, weakDiscrimination: false, tooHard: false, tooEasy: false },
    declaredDifficulty: 30,
    ...over,
  };
}

/** Пул из `size` вопросов одной темы с квотой `drawCount`. */
function quotaSection(ids: string[], drawCount: number, over: Record<string, unknown> = {}) {
  return {
    section: { id: "s1", topicId: "t1", drawAll: false, drawCount, formSetJson: null, ...over },
    pool: ids.map(id => ({ id })),
  };
}

/** `n` прохождений за окно. */
function passages(n: number) {
  return { rows: Array.from({ length: n }, () => ({ startedAt: new Date("2026-09-01T00:00:00Z") })) };
}

const POOL = ["q1", "q2", "q3", "q4", "q5"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.getTest.mockResolvedValue({ id: "test1", mode: "standard" });
  mocks.testPsychometrics.mockResolvedValue({ psychometrics: { items: POOL.map(id => item(id)) } });
  mocks.reviewHeuristicsOfTest.mockResolvedValue(new Map());
  // Квота 2 из 5: ожидаемая доля 40 %, переэкспонирован — от 60 % (1,5 × 40).
  mocks.loadDeliveryPool.mockResolvedValue({ questionIds: POOL, sections: [quotaSection(POOL, 2)] });
  mocks.loadObservations.mockResolvedValue(passages(20));
  mocks.storage.getDeliveryCountsForTest.mockResolvedValue(new Map([["q1", 12], ["q2", 11], ["q3", 9]]));
});

describe("evaluateTestQuality", () => {
  it("нет теста — нет качества", async () => {
    mocks.storage.getTest.mockResolvedValue(undefined);
    expect(await evaluateTestQuality("nope")).toBeNull();
  });

  it("признак — правилом question-flag вместе с эвристиками ревизии (FR-03)", async () => {
    mocks.reviewHeuristicsOfTest.mockResolvedValue(new Map([["q2", {
      kinds: ["hard-and-frequent"], exposurePercent: 80, correctPercent: 30, latencyMedianMs: null,
    }]]));
    mocks.testPsychometrics.mockResolvedValue({ psychometrics: { items: [
      item("q1", { flags: { negativeDiscrimination: true, atChanceLevel: false, weakDiscrimination: false, tooHard: false, tooEasy: false } }),
      item("q2"),
      item("q3"),
    ] } });

    const quality = await evaluateTestQuality("test1");
    const byId = new Map(quality!.items.map(i => [i.questionId, i]));

    expect(byId.get("q1")).toMatchObject({ suspicious: true, rank: 1, flag: { title: "Сильные ошибаются чаще" } });
    // Без эвристики q2 был бы здоров: признак дала именно она.
    expect(byId.get("q2")).toMatchObject({ suspicious: true, rank: 3 });
    expect(byId.get("q3")).toMatchObject({ suspicious: false, flag: null });
    expect(quality).toMatchObject({ suspicious: 2, itemCount: 3, pool: POOL });
  });

  it("наблюдаемая сложность — в шкале редактора; мало данных — пусто", async () => {
    mocks.testPsychometrics.mockResolvedValue({ psychometrics: { items: [
      item("q1", { difficulty: 0.58 }),
      item("q2", { difficulty: 0.9, difficultyConfidence: "insufficient", observations: 6 }),
      item("q3", { difficulty: null }),
    ] } });

    const quality = await evaluateTestQuality("test1");

    expect(quality!.items.map(i => i.hardness)).toEqual([42, null, null]);
  });

  it("переэкспонирован — от 1,5 × ожидаемой доли (§3.2)", async () => {
    const quality = await evaluateTestQuality("test1");
    const byId = new Map(quality!.items.map(i => [i.questionId, i]));

    // 12 из 20 — 60 %: ровно на границе. 11 из 20 — 55 %: ниже.
    expect(byId.get("q1")!.overexposure).toEqual({ sharePercent: 60, expectedPercent: 40 });
    expect(byId.get("q2")!.overexposure).toBeNull();
    expect(byId.get("q1")!.delivered).toBe(12);
    expect(byId.get("q4")!.delivered).toBe(0);
  });

  it("меньше 10 прохождений за окно — признака нет", async () => {
    mocks.loadObservations.mockResolvedValue(passages(9));
    mocks.storage.getDeliveryCountsForTest.mockResolvedValue(new Map([["q1", 9]]));

    const quality = await evaluateTestQuality("test1");

    expect(quality!.items.every(i => i.overexposure === null)).toBe(true);
  });

  it("весь банк, варианты и адаптив признака не дают — ожидаемой доли нет", async () => {
    mocks.storage.getDeliveryCountsForTest.mockResolvedValue(new Map([["q1", 20]]));
    for (const sections of [
      [quotaSection(POOL, 2, { drawAll: true })],
      [quotaSection(POOL, 2, { formSetJson: { forms: [{ id: "f1", label: "А" }] } })],
    ]) {
      mocks.loadDeliveryPool.mockResolvedValue({ questionIds: POOL, sections });
      const quality = await evaluateTestQuality("test1");
      expect(quality!.items.find(i => i.questionId === "q1")!.overexposure).toBeNull();
    }

    mocks.loadDeliveryPool.mockResolvedValue({ questionIds: POOL, sections: [quotaSection(POOL, 2)] });
    mocks.storage.getTest.mockResolvedValue({ id: "test1", mode: "adaptive" });
    const adaptive = await evaluateTestQuality("test1");
    expect(adaptive!.items.find(i => i.questionId === "q1")!.overexposure).toBeNull();
  });

  it("у каждого вопроса — способ выдачи, доля и ожидаемая доля, даже без признака", async () => {
    const quality = await evaluateTestQuality("test1");
    const byId = new Map(quality!.items.map(i => [i.questionId, i]));

    expect(byId.get("q3")).toMatchObject({ drawMode: "quota", sharePercent: 45, expectedPercent: 40, overexposure: null });
    expect(byId.get("q4")).toMatchObject({ drawMode: "quota", sharePercent: 0, expectedPercent: 40 });

    mocks.loadDeliveryPool.mockResolvedValue({ questionIds: POOL, sections: [quotaSection(POOL, 2, { drawAll: true })] });
    const all = await evaluateTestQuality("test1");
    expect(all!.items.find(i => i.questionId === "q1")).toMatchObject({ drawMode: "all", sharePercent: 60, expectedPercent: null });
  });
});

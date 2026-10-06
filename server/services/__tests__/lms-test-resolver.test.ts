/**
 * @module server/services/__tests__/lms-test-resolver
 * @description PRD-54 раздел 6.2: определение теста по вопросам из шапки выгрузки.
 */
import { describe, it, expect } from "vitest";
import { chooseTest, rankCandidates, resolveTestByQuestionIds } from "../lms-test-resolver";

/** Хранилище-заглушка: один тест «test-a» на теме «t1» с двумя вопросами. */
const store = {
  getQuestionsByIds: async (ids: string[]) =>
    [{ id: "q1", topicId: "t1" }, { id: "q2", topicId: "t1" }].filter((q) => ids.includes(q.id)),
  getTestSectionsByTopicIds: async () => [{ testId: "test-a", topicId: "t1" }],
};

describe("resolveTestByQuestionIds", () => {
  it("однозначный тест находится", async () => {
    expect(await resolveTestByQuestionIds(["q1", "q2"], store as never)).toEqual({
      testId: "test-a",
      candidates: [{ testId: "test-a", matched: 2 }],
      foreign: [],
    });
  });

  it("чужие вопросы возвращаются списком, а не роняют разбор", async () => {
    expect(await resolveTestByQuestionIds(["q1", "zzz"], store as never)).toEqual({
      testId: "test-a",
      candidates: [{ testId: "test-a", matched: 1 }],
      foreign: ["zzz"],
    });
  });

  it("ни одного совпадения — теста нет", async () => {
    expect(await resolveTestByQuestionIds(["zzz"], store as never)).toEqual({
      testId: null,
      candidates: [],
      foreign: ["zzz"],
    });
  });

  it("пустой список вопросов — теста нет", async () => {
    expect(await resolveTestByQuestionIds([], store as never)).toEqual({ testId: null, candidates: [], foreign: [] });
  });

  it("вопросы из двух тестов — теста нет, оба названы кандидатами", async () => {
    const two = {
      getQuestionsByIds: async () => [{ id: "q1", topicId: "t1" }, { id: "q3", topicId: "t2" }],
      getTestSectionsByTopicIds: async () => [
        { testId: "test-a", topicId: "t1" },
        { testId: "test-b", topicId: "t2" },
      ],
    };
    const resolved = await resolveTestByQuestionIds(["q1", "q3"], two as never);
    expect(resolved.testId).toBeNull();
    expect(resolved.candidates.map((c) => c.testId).sort()).toEqual(["test-a", "test-b"]);
  });

  it("одна тема в двух тестах (копия, банк) — оба кандидата, больше покрытых первым", async () => {
    // Случай с прода 2026-10-06: тема ЧИЛ стоит в разделах двух тестов, и импорт отказывал.
    const shared = {
      getQuestionsByIds: async () => [
        { id: "q1", topicId: "t1" },
        { id: "q2", topicId: "t1" },
        { id: "q3", topicId: "t2" },
      ],
      getTestSectionsByTopicIds: async () => [
        { testId: "copy", topicId: "t1" },
        { testId: "orig", topicId: "t1" },
        { testId: "orig", topicId: "t2" },
      ],
    };
    const resolved = await resolveTestByQuestionIds(["q1", "q2", "q3"], shared as never);
    expect(resolved).toEqual({
      testId: null,
      candidates: [{ testId: "orig", matched: 3 }, { testId: "copy", matched: 2 }],
      foreign: [],
    });
  });

  it("две темы ОДНОГО теста — тест находится", async () => {
    // Выгрузка теста из двух разделов даёт вопросы двух тем; это норма, а не двусмысленность.
    const twoTopics = {
      getQuestionsByIds: async () => [{ id: "q1", topicId: "t1" }, { id: "q3", topicId: "t2" }],
      getTestSectionsByTopicIds: async () => [
        { testId: "test-a", topicId: "t1" },
        { testId: "test-a", topicId: "t2" },
      ],
    };
    expect((await resolveTestByQuestionIds(["q1", "q3"], twoTopics as never)).testId).toBe("test-a");
  });
});

describe("chooseTest", () => {
  const one = { testId: "a", candidates: [{ testId: "a", matched: 2 }], foreign: [] };
  const two = {
    testId: null,
    candidates: [{ testId: "a", matched: 2 }, { testId: "b", matched: 2 }],
    foreign: [],
  };

  it("однозначный тест берётся без выбора", () => {
    expect(chooseTest(one, null)).toEqual({ ok: true, testId: "a" });
  });

  it("выбор, совпавший с однозначным тестом, принимается", () => {
    expect(chooseTest(one, "a")).toEqual({ ok: true, testId: "a" });
  });

  it("несколько кандидатов без выбора — отказ «ambiguous»", () => {
    expect(chooseTest(two, null)).toEqual({ ok: false, reason: "ambiguous" });
    expect(chooseTest(two, "  ")).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("выбор из кандидатов принимается", () => {
    expect(chooseTest(two, "b")).toEqual({ ok: true, testId: "b" });
  });

  it("тест вне кандидатов не принимается ни при каком числе кандидатов", () => {
    expect(chooseTest(two, "x")).toEqual({ ok: false, reason: "not-candidate" });
    expect(chooseTest(one, "x")).toEqual({ ok: false, reason: "not-candidate" });
  });

  it("без кандидатов выбор не спасает", () => {
    expect(chooseTest({ testId: null, candidates: [], foreign: ["q"] }, "a")).toEqual({
      ok: false,
      reason: "none",
    });
  });
});

describe("rankCandidates", () => {
  const c = (testId: string, status: string, matched: number) => ({ testId, status, matched });

  it("опубликованный идёт первым и рекомендуется, даже если черновик покрывает больше", () => {
    const { ranked, recommendedTestId } = rankCandidates([c("draft", "draft", 14), c("pub", "published", 12)]);
    expect(ranked.map((x) => x.testId)).toEqual(["pub", "draft"]);
    expect(recommendedTestId).toBe("pub");
  });

  it("из опубликованных рекомендуется покрывающий больше вопросов", () => {
    const { ranked, recommendedTestId } = rankCandidates([
      c("p1", "published", 3),
      c("p2", "published", 14),
      c("d", "draft", 14),
    ]);
    expect(ranked.map((x) => x.testId)).toEqual(["p2", "p1", "d"]);
    expect(recommendedTestId).toBe("p2");
  });

  it("два опубликованных с равным покрытием — рекомендации нет", () => {
    expect(rankCandidates([c("p1", "published", 14), c("p2", "published", 14)]).recommendedTestId).toBeNull();
  });

  it("опубликованных нет — рекомендации нет, порядок по покрытию", () => {
    const { ranked, recommendedTestId } = rankCandidates([c("a", "archived", 2), c("d", "draft", 14)]);
    expect(ranked.map((x) => x.testId)).toEqual(["d", "a"]);
    expect(recommendedTestId).toBeNull();
  });

  it("пустой список — пусто и без рекомендации", () => {
    expect(rankCandidates([])).toEqual({ ranked: [], recommendedTestId: null });
  });
});

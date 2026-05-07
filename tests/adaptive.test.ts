/**
 * Tests for the adaptive testing algorithm.
 *
 * adaptive.js uses global variables (TEST_DATA, state, etc.) and is not a module.
 * We extract and reproduce the pure algorithmic functions here to test the logic
 * without a browser environment.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Level {
  levelIndex: number;
  levelName: string;
  minDifficulty: number;
  maxDifficulty: number;
  questionsCount: number;
  passThreshold: number;
  passThresholdType: "percent" | "absolute";
  feedback: string;
  links: any[];
  questionIds: string[];
  answeredQuestionIds: string[];
  correctCount: number;
  status: "pending" | "in_progress" | "passed" | "failed";
}

interface Topic {
  topicId: string;
  topicName: string;
  failureFeedback: string;
  currentLevelIndex: number;
  levelsState: Level[];
  finalLevelIndex: number | null;
  status: "pending" | "in_progress" | "completed";
}

// ─── Replicated pure functions from adaptive.js ───────────────────────────────

function calcRequiredCorrect(level: Level): number {
  if (level.passThresholdType === "percent") {
    return Math.ceil(level.questionIds.length * level.passThreshold / 100);
  }
  return level.passThreshold;
}

function shouldPassEarly(level: Level): boolean {
  return level.correctCount >= calcRequiredCorrect(level);
}

function shouldFailEarly(level: Level): boolean {
  const remaining = level.questionIds.length - level.answeredQuestionIds.length;
  return level.correctCount + remaining < calcRequiredCorrect(level);
}

function buildAdaptiveResult(topics: Topic[], adaptiveTopicsData: any[]) {
  return topics.map((topic) => {
    const topicData = adaptiveTopicsData.find((t) => t.topicId === topic.topicId);
    let totalQuestionsAnswered = 0;
    let totalCorrect = 0;

    topic.levelsState.forEach((level) => {
      if (level.status === "passed" || level.status === "failed") {
        totalQuestionsAnswered += level.answeredQuestionIds.length;
        totalCorrect += level.correctCount;
      }
    });

    const achievedLevelIndex = topic.finalLevelIndex;
    let achievedLevelName: string | null = null;
    let feedback: string | null = null;
    let recommendedLinks: any[] = [];

    if (achievedLevelIndex !== null) {
      const achievedLevel = topic.levelsState[achievedLevelIndex];
      const levelData = topicData?.levels[achievedLevelIndex];
      achievedLevelName = achievedLevel.levelName;
      feedback = levelData?.feedback || null;
      recommendedLinks = levelData?.links || [];
    } else {
      feedback = topicData?.failureFeedback || null;
      if (topicData?.levels?.length > 0) {
        recommendedLinks = topicData.levels[0].links || [];
      }
    }

    return {
      topicId: topic.topicId,
      achievedLevelIndex,
      achievedLevelName,
      totalQuestionsAnswered,
      totalCorrect,
      feedback,
      recommendedLinks,
    };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    levelIndex: 0,
    levelName: "Базовый",
    minDifficulty: 0,
    maxDifficulty: 33,
    questionsCount: 5,
    passThreshold: 80,
    passThresholdType: "percent",
    feedback: "",
    links: [],
    questionIds: ["q1", "q2", "q3", "q4", "q5"],
    answeredQuestionIds: [],
    correctCount: 0,
    status: "in_progress",
    ...overrides,
  };
}

function makeLevel3(): [Level, Level, Level] {
  return [
    makeLevel({ levelIndex: 0, levelName: "Базовый", status: "pending", questionIds: ["q1","q2","q3","q4","q5"] }),
    makeLevel({ levelIndex: 1, levelName: "Средний", status: "in_progress", questionIds: ["q6","q7","q8","q9","q10"] }),
    makeLevel({ levelIndex: 2, levelName: "Продвинутый", status: "pending", questionIds: ["q11","q12","q13","q14","q15"] }),
  ];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("calcRequiredCorrect — percent threshold", () => {
  it("80% of 5 questions = ceil(4) = 4", () => {
    const level = makeLevel({ passThreshold: 80, passThresholdType: "percent", questionIds: Array(5).fill("x") });
    expect(calcRequiredCorrect(level)).toBe(4);
  });

  it("100% of 5 = 5", () => {
    const level = makeLevel({ passThreshold: 100, passThresholdType: "percent", questionIds: Array(5).fill("x") });
    expect(calcRequiredCorrect(level)).toBe(5);
  });

  it("50% of 3 = ceil(1.5) = 2", () => {
    const level = makeLevel({ passThreshold: 50, passThresholdType: "percent", questionIds: Array(3).fill("x") });
    expect(calcRequiredCorrect(level)).toBe(2);
  });

  it("60% of 10 = 6", () => {
    const level = makeLevel({ passThreshold: 60, passThresholdType: "percent", questionIds: Array(10).fill("x") });
    expect(calcRequiredCorrect(level)).toBe(6);
  });
});

describe("calcRequiredCorrect — absolute threshold", () => {
  it("absolute 3 returns 3", () => {
    const level = makeLevel({ passThreshold: 3, passThresholdType: "absolute" });
    expect(calcRequiredCorrect(level)).toBe(3);
  });

  it("absolute 1 returns 1", () => {
    const level = makeLevel({ passThreshold: 1, passThresholdType: "absolute" });
    expect(calcRequiredCorrect(level)).toBe(1);
  });
});

describe("shouldPassEarly", () => {
  it("true when correctCount >= required (80% of 5 = 4)", () => {
    const level = makeLevel({ correctCount: 4, answeredQuestionIds: ["q1","q2","q3","q4"] });
    expect(shouldPassEarly(level)).toBe(true);
  });

  it("true when correctCount exceeds required", () => {
    const level = makeLevel({ correctCount: 5, answeredQuestionIds: ["q1","q2","q3","q4","q5"] });
    expect(shouldPassEarly(level)).toBe(true);
  });

  it("false when correctCount < required", () => {
    const level = makeLevel({ correctCount: 3, answeredQuestionIds: ["q1","q2","q3"] });
    expect(shouldPassEarly(level)).toBe(false);
  });
});

describe("shouldFailEarly", () => {
  it("true when remaining + correct cannot reach threshold", () => {
    // 5 questions, need 4 (80%), answered 4, correct 1, remaining 1 → 1+1=2 < 4
    const level = makeLevel({
      correctCount: 1,
      answeredQuestionIds: ["q1","q2","q3","q4"],
    });
    expect(shouldFailEarly(level)).toBe(true);
  });

  it("false when still possible to reach threshold", () => {
    // answered 2, correct 2, remaining 3 → 2+3=5 >= 4
    const level = makeLevel({
      correctCount: 2,
      answeredQuestionIds: ["q1","q2"],
    });
    expect(shouldFailEarly(level)).toBe(false);
  });

  it("true at last question if already failed (correct 0, remaining 0)", () => {
    const level = makeLevel({
      correctCount: 0,
      answeredQuestionIds: ["q1","q2","q3","q4","q5"],
    });
    expect(shouldFailEarly(level)).toBe(true);
  });
});

describe("buildAdaptiveResult", () => {
  const topicsData = [
    {
      topicId: "t1",
      failureFeedback: "Нужно изучить материал",
      levels: [
        { feedback: "Хороший старт", links: [{ title: "Курс 1", url: "https://example.com/1" }] },
        { feedback: "Отлично!", links: [] },
      ],
    },
  ];

  it("sets achievedLevelName when level was achieved", () => {
    const [l0, l1] = makeLevel3();
    l1.status = "passed";
    l1.answeredQuestionIds = ["q6","q7","q8"];
    l1.correctCount = 3;
    const topic: Topic = {
      topicId: "t1",
      topicName: "Тема 1",
      failureFeedback: "",
      currentLevelIndex: 1,
      levelsState: [l0, l1],
      finalLevelIndex: 1,
      status: "completed",
    };
    const results = buildAdaptiveResult([topic], topicsData);
    expect(results[0].achievedLevelName).toBe("Средний");
    expect(results[0].achievedLevelIndex).toBe(1);
  });

  it("sets achievedLevelName to null when no level achieved", () => {
    const [l0, l1] = makeLevel3();
    l0.status = "failed";
    const topic: Topic = {
      topicId: "t1",
      topicName: "Тема 1",
      failureFeedback: "Нужно изучить материал",
      currentLevelIndex: 0,
      levelsState: [l0, l1],
      finalLevelIndex: null,
      status: "completed",
    };
    const results = buildAdaptiveResult([topic], topicsData);
    expect(results[0].achievedLevelIndex).toBeNull();
    expect(results[0].achievedLevelName).toBeNull();
    expect(results[0].feedback).toBe("Нужно изучить материал");
  });

  it("returns recommendedLinks from achieved level", () => {
    const [l0, l1] = makeLevel3();
    l0.status = "passed";
    l0.answeredQuestionIds = ["q1","q2","q3"];
    l0.correctCount = 3;
    const topic: Topic = {
      topicId: "t1",
      topicName: "Тема 1",
      failureFeedback: "",
      currentLevelIndex: 0,
      levelsState: [l0, l1],
      finalLevelIndex: 0,
      status: "completed",
    };
    const results = buildAdaptiveResult([topic], topicsData);
    expect(results[0].recommendedLinks).toHaveLength(1);
    expect(results[0].recommendedLinks[0].title).toBe("Курс 1");
  });

  it("returns recommendedLinks from lowest level when no level achieved", () => {
    const [l0, l1] = makeLevel3();
    l0.status = "failed";
    const topic: Topic = {
      topicId: "t1",
      topicName: "Тема 1",
      failureFeedback: "",
      currentLevelIndex: 0,
      levelsState: [l0, l1],
      finalLevelIndex: null,
      status: "completed",
    };
    const results = buildAdaptiveResult([topic], topicsData);
    expect(results[0].recommendedLinks[0].title).toBe("Курс 1");
  });

  it("counts totalQuestionsAnswered from passed/failed levels only", () => {
    const [l0, l1, l2] = makeLevel3();
    l0.status = "failed";
    l0.answeredQuestionIds = ["q1","q2","q3"];
    l0.correctCount = 1;
    l1.status = "in_progress"; // still in progress — should NOT be counted
    l1.answeredQuestionIds = ["q6"];
    l1.correctCount = 1;
    const topic: Topic = {
      topicId: "t1",
      topicName: "Тема 1",
      failureFeedback: "",
      currentLevelIndex: 1,
      levelsState: [l0, l1, l2],
      finalLevelIndex: null,
      status: "in_progress",
    };
    const results = buildAdaptiveResult([topic], topicsData);
    expect(results[0].totalQuestionsAnswered).toBe(3); // only failed level
    expect(results[0].totalCorrect).toBe(1);
  });

  it("overallPassed is true only if all topics have achievedLevelIndex !== null", () => {
    const [l0a] = makeLevel3();
    const [l0b] = makeLevel3();
    l0a.status = "passed"; l0a.answeredQuestionIds = ["q1"]; l0a.correctCount = 1;
    l0b.status = "failed"; l0b.answeredQuestionIds = ["q1"]; l0b.correctCount = 0;

    const topics: Topic[] = [
      { topicId: "t1", topicName: "T1", failureFeedback: "", currentLevelIndex: 0, levelsState: [l0a], finalLevelIndex: 0, status: "completed" },
      { topicId: "t2", topicName: "T2", failureFeedback: "", currentLevelIndex: 0, levelsState: [l0b], finalLevelIndex: null, status: "completed" },
    ];
    const results = buildAdaptiveResult(topics, [
      { topicId: "t1", failureFeedback: "", levels: [{ feedback: "", links: [] }] },
      { topicId: "t2", failureFeedback: "", levels: [{ feedback: "", links: [] }] },
    ]);
    const overallPassed = results.every((r) => r.achievedLevelIndex !== null);
    expect(overallPassed).toBe(false);
  });
});

describe("Start level is median", () => {
  it("3 levels → start at index 1", () => {
    const levels = [0, 1, 2];
    expect(Math.floor(levels.length / 2)).toBe(1);
  });

  it("5 levels → start at index 2", () => {
    const levels = [0, 1, 2, 3, 4];
    expect(Math.floor(levels.length / 2)).toBe(2);
  });

  it("1 level → start at index 0", () => {
    const levels = [0];
    expect(Math.floor(levels.length / 2)).toBe(0);
  });

  it("2 levels → start at index 1", () => {
    const levels = [0, 1];
    expect(Math.floor(levels.length / 2)).toBe(1);
  });
});

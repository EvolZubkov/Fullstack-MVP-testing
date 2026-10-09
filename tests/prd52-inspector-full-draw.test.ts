/**
 * @module tests/prd52-inspector-full-draw
 *
 * PRD-52 FR-14..FR-17: что показывает инспектор в режиме полной выдачи.
 *
 * Два правила, которые больше нигде не выражены: вердикт в этом режиме НЕ считается
 * (выдан весь банк, порог настроен на выборку — любой итог был бы ложью), а вопрос
 * адаптивного теста получает справочный уровень, вычисленный по диапазонам сложности.
 * Побочно это ловит вопрос, не попадающий ни в один уровень: ученику он не выдастся
 * никогда, и увидеть это можно только здесь.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Inspector = {
  questionLevel: (
    topics: unknown,
    topicId: string,
    difficulty: number | null | undefined,
  ) => { levelName: string | null; outsideLevels: boolean };
  buildScore: (pkg: unknown) => Record<string, unknown>;
};

let TB: Inspector;

beforeAll(() => {
  const src = readFileSync(
    resolve(process.cwd(), "server/scorm/debug-player/assets/inspector-compute.js"),
    "utf8",
  );
  const win: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("window", src)(win);
  TB = win.TBInspector as Inspector;
});

/** Тема с лестницей из трёх уровней, диапазоны без перекрытий. */
const TOPICS = [
  {
    topicId: "tp1",
    topicName: "Финансы",
    levels: [
      { levelIndex: 0, levelName: "низкий", minDifficulty: 1, maxDifficulty: 30 },
      { levelIndex: 1, levelName: "средний", minDifficulty: 31, maxDifficulty: 70 },
      { levelIndex: 2, levelName: "высокий", minDifficulty: 71, maxDifficulty: 100 },
    ],
  },
];

describe("уровень вопроса по диапазонам сложности", () => {
  it("сложность попадает в свой уровень", () => {
    expect(TB.questionLevel(TOPICS, "tp1", 20).levelName).toBe("низкий");
    expect(TB.questionLevel(TOPICS, "tp1", 50).levelName).toBe("средний");
    expect(TB.questionLevel(TOPICS, "tp1", 90).levelName).toBe("высокий");
  });

  it("границы диапазона принадлежат уровню", () => {
    expect(TB.questionLevel(TOPICS, "tp1", 31).levelName).toBe("средний");
    expect(TB.questionLevel(TOPICS, "tp1", 70).levelName).toBe("средний");
  });

  it("вопрос вне лестницы помечается: ученику он не выдастся никогда", () => {
    const out = TB.questionLevel(TOPICS, "tp1", 0);
    expect(out.levelName).toBeNull();
    expect(out.outsideLevels).toBe(true);
  });

  it("вопрос без сложности не выдаёт себя за уровень", () => {
    expect(TB.questionLevel(TOPICS, "tp1", null).levelName).toBeNull();
    expect(TB.questionLevel(TOPICS, "tp1", undefined).outsideLevels).toBe(true);
  });

  it("тема без лестницы не помечает вопросы вне уровней — их там просто нет", () => {
    const out = TB.questionLevel(TOPICS, "unknown-topic", 50);
    expect(out.levelName).toBeNull();
    expect(out.outsideLevels).toBe(false);
  });
});

describe("вердикт в режиме полной выдачи", () => {
  /** Пакет с рантаймом, который умеет считать результат. */
  function pkg(hash: string) {
    return {
      started: true,
      mode: "standard",
      state: { currentIndex: 2, flatQuestions: [] },
      TEST_DATA: { flowPolicy: { mode: "linear_flat" }, sections: [] },
      w: {
        location: { hash },
        calculateResults: () => ({
          correct: 2, totalQuestions: 4, earnedPoints: 2, possiblePoints: 4,
          percent: 50, passed: false, topicResults: [],
        }),
      },
    };
  }

  it("обычный прогон считает балл и вердикт", () => {
    const score = TB.buildScore(pkg(""));
    expect(score.available).toBe(true);
    expect(score.suppressed).toBe(false);
    expect(score.percent).toBe(50);
  });

  it("в режиме полной выдачи итог не считается", () => {
    const score = TB.buildScore(pkg("#tbfa=1"));
    expect(score.suppressed).toBe(true);
    expect(score.percent).toBeNull();
    expect(score.passed).toBeNull();
  });
});

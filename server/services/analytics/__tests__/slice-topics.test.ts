/**
 * @module server/services/analytics/__tests__/slice-topics
 * @description PRD-56 FR-06: выбор слабейшей темы среза.
 *
 * Проверяется правило отбора, а не арифметика долей — её считает `topic-stats`, и второй
 * проверки того же здесь быть не должно.
 */
import { describe, expect, it } from "vitest";

import { weakestTopic, type SliceTopicRow } from "../slice-topics";

const topic = (
  topicId: string,
  correctShare: number | null,
  inSample: number,
): SliceTopicRow => ({ topicId, topicName: `Тема ${topicId}`, correctShare, inSample });

describe("weakestTopic", () => {
  it("называет тему с наименьшей долей верных", () => {
    const weakest = weakestTopic(
      [topic("a", 82, 40), topic("b", 41, 40), topic("c", 63, 40)],
      10,
    );

    expect(weakest?.topicId).toBe("b");
  });

  it("не берёт тему, не набравшую порога наблюдений", () => {
    // Тема из трёх прохождений регулярно даёт ноль процентов и заняла бы первое место во всех
    // срезах разом, уведя внимание с настоящего провала (то же правило, что у долей, FR-06d).
    const weakest = weakestTopic(
      [topic("мелкая", 0, 3), topic("настоящая", 44, 40)],
      10,
    );

    expect(weakest?.topicId).toBe("настоящая");
  });

  it("молчит, когда ни одна тема не набрала порога", () => {
    expect(weakestTopic([topic("a", 10, 2), topic("b", 20, 4)], 10)).toBeNull();
  });

  it("молчит, когда оценивать было нечего", () => {
    // Измерительный тест: доли верных у него нет вовсе, и «слабейшая» тема — выдумка.
    expect(weakestTopic([topic("a", null, 40), topic("b", null, 40)], 10)).toBeNull();
  });

  it("не путает отсутствие оценки с нулевой долей", () => {
    const weakest = weakestTopic([topic("без оценки", null, 40), topic("ноль", 0, 40)], 10);

    expect(weakest?.topicId).toBe("ноль");
  });
});

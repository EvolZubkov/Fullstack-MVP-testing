/**
 * @module tests/section-groups-context
 * @description PRD-50 FR-25, FR-27, FR-29: `result.topicGroups` в контракте контекста —
 * блоки разделов с готовым счётчиком. Имя именно `topicGroups`: `result.blocks` занято
 * списком блоков итогов PRD-49. Тест без блоков обязан давать ровно прежний контекст.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext, type ResultInput, type TopicInput } from "../shared/template/result-context";

const topic = (topicName: string, passed: boolean | null, groupKey?: string | null): TopicInput => ({
  topicId: topicName,
  topicName,
  correct: passed === true ? 4 : 1,
  total: 5,
  percent: passed === true ? 80 : 20,
  earnedPoints: passed === true ? 4 : 1,
  possiblePoints: 5,
  passed,
  ...(groupKey === undefined ? {} : { groupKey }),
});

const groups = [
  { key: "competencies", label: "Управленческие компетенции", order: 0 },
  { key: "knowledge", label: "Знания", order: 1 },
];

const input = (topicResults: TopicInput[], sectionGroups?: unknown): ResultInput => ({
  passed: false,
  percent: 50,
  totalQuestions: 10,
  correct: 5,
  earnedPoints: 5,
  possiblePoints: 10,
  topicResults,
  ...(sectionGroups === undefined ? {} : { sectionGroups }),
});

describe("buildResultContext + блоки разделов", () => {
  it("собирает блоки с их темами, счётчиком и готовой надписью счётчика", () => {
    const { result } = buildResultContext(
      input(
        [
          topic("Знание 1", true, "knowledge"),
          topic("Знание 2", false, "knowledge"),
          topic("Компетенция", true, "competencies"),
        ],
        groups,
      ),
      "Тест",
    );
    expect(result.topicGroups).toHaveLength(2);
    expect(result.topicGroups![0]).toMatchObject({
      key: "competencies",
      label: "Управленческие компетенции",
      passedCount: 1,
      totalCount: 1,
      counterLabel: "1 / 1",
    });
    expect(result.topicGroups![1]).toMatchObject({ key: "knowledge", passedCount: 1, totalCount: 2, counterLabel: "1 / 2" });
    expect(result.topicGroups![1].topics.map((t) => t.topicName)).toEqual(["Знание 1", "Знание 2"]);
    // Карточка внутри блока — та же самая, что в плоском списке: ядро готовит её один раз.
    expect(result.topicGroups![1].topics[0]).toMatchObject({ passClass: "is-pass", statusLabel: "Пройдено" });
  });

  it("раздел без вердикта не входит в знаменатель счётчика (FR-26)", () => {
    const { result } = buildResultContext(
      input([topic("Знание 1", true, "knowledge"), topic("Знание 2", null, "knowledge")], groups),
      "Тест",
    );
    expect(result.topicGroups![0]).toMatchObject({ passedCount: 1, totalCount: 1, counterLabel: "1 / 1" });
    expect(result.topicGroups![0].topics).toHaveLength(2);
  });

  it("разделы без блока идут отдельным списком — печатать их после блоков (FR-25)", () => {
    const { result } = buildResultContext(
      input(
        [
          topic("Вне блока", true, null),
          topic("Знание", true, "knowledge"),
          // Ссылка на удалённый блок = отсутствие блока (FR-12).
          topic("Осиротевший", false, "нет такого"),
        ],
        groups,
      ),
      "Тест",
    );
    expect(result.topicGroups!.map((g) => g.key)).toEqual(["knowledge"]);
    expect(result.ungroupedTopics!.map((t) => t.topicName)).toEqual(["Вне блока", "Осиротевший"]);
    // Плоский список остаётся полным: шаблон, не знающий блоков, печатает всё как прежде.
    expect((result.topicResults as Array<{ topicName: string }>).map((t) => t.topicName)).toEqual([
      "Вне блока",
      "Знание",
      "Осиротевший",
    ]);
  });

  it("блок, на который не ссылается ни один раздел, не печатается (FR-12)", () => {
    const { result } = buildResultContext(input([topic("Знание", true, "knowledge")], groups), "Тест");
    expect(result.topicGroups!.map((g) => g.key)).toEqual(["knowledge"]);
  });

  it("тест без блоков даёт РОВНО прежний контекст (FR-27, решение 6)", () => {
    const before = buildResultContext(input([topic("A", true), topic("B", false)]), "Тест");
    const withEmptyGroups = buildResultContext(input([topic("A", true), topic("B", false)], []), "Тест");
    expect("topicGroups" in before.result).toBe(false);
    expect("ungroupedTopics" in before.result).toBe(false);
    expect(withEmptyGroups).toEqual(before);
  });

  it("объявленные блоки, но ни одной ссылки — контекст тоже прежний", () => {
    const before = buildResultContext(input([topic("A", true)]), "Тест");
    const declared = buildResultContext(input([topic("A", true)], groups), "Тест");
    expect(declared).toEqual(before);
  });
});

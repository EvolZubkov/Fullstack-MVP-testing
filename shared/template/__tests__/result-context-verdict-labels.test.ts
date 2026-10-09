/**
 * @module shared/template/__tests__/result-context-verdict-labels
 * @description PRD-50 FR-34: topic verdict wording («Пройдено»/«Не пройдено»/no verdict)
 * and the group counter format move from hardcoded strings into the PRD-49 labels
 * dictionary (`topic.verdict.passed`/`.failed`/`.unknown`, `group.counter`). A caller
 * that passes no `labels` option (or a template that has not declared the keys) must
 * keep printing exactly today's words — that is the whole point of resolving through a
 * dictionary with a built-in fallback rather than requiring every caller to be taught
 * the new keys at once.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext, type ResultInput, type TopicInput } from "../result-context";

const topic = (
  name: string,
  passed: boolean | null,
  breakdown?: TopicInput["breakdown"],
  groupKey?: string | null,
): TopicInput => ({
  topicId: name,
  topicName: name,
  correct: 1,
  total: 2,
  percent: 50,
  earnedPoints: 1,
  possiblePoints: 2,
  passed,
  ...(breakdown ? { breakdown } : {}),
  ...(groupKey === undefined ? {} : { groupKey }),
});

const baseResult = (topicResults: TopicInput[], sectionGroups?: unknown): ResultInput => ({
  passed: false,
  percent: 50,
  totalQuestions: 4,
  correct: 2,
  earnedPoints: 2,
  possiblePoints: 4,
  topicResults,
  ...(sectionGroups === undefined ? {} : { sectionGroups }),
});

describe("FR-34: подписи вердикта темы из словаря PRD-49", () => {
  it("без переданного словаря печатает ровно прежние слова", () => {
    const { result } = buildResultContext(baseResult([topic("A", true), topic("B", false), topic("C", null)]), "Тест");
    expect(result.topicResults![0].statusLabel).toBe("Пройдено");
    expect(result.topicResults![1].statusLabel).toBe("Не пройдено");
    expect(result.topicResults![2].statusLabel).toBe("");
  });

  it("автор переопределяет слова через labels опций", () => {
    const labels = {
      "topic.verdict.passed": "Целевой уровень",
      "topic.verdict.failed": "Начальный уровень",
      "topic.verdict.unknown": "Нет данных",
    };
    const { result } = buildResultContext(
      baseResult([topic("A", true), topic("B", false), topic("C", null)]),
      "Тест",
      { labels },
    );
    expect(result.topicResults![0].statusLabel).toBe("Целевой уровень");
    expect(result.topicResults![1].statusLabel).toBe("Начальный уровень");
    expect(result.topicResults![2].statusLabel).toBe("Нет данных");
  });

  it("шаблон, не объявивший ключ, оставляет прежнее слово (labels без topic.verdict.*)", () => {
    const { result } = buildResultContext(baseResult([topic("A", true), topic("B", false)]), "Тест", {
      labels: { "results.heading": "Свой заголовок" },
    });
    expect(result.topicResults![0].statusLabel).toBe("Пройдено");
    expect(result.topicResults![1].statusLabel).toBe("Не пройдено");
  });

  it("строка разреза несёт исход, но СЛОВА не печатает (§16)", () => {
    // Словарь вердиктов обслуживает КАРТОЧКУ ТЕМЫ. У строки исход с §16 есть, но выражен он
    // классом, а не словом: строка узкая, и слово рядом с процентом дублировало бы цвет.
    const labels = { "topic.verdict.passed": "Зачёт", "topic.verdict.failed": "Незачёт" };
    const t = topic("A", false, [
      {
        scope: "section:a",
        axis: "tag",
        key: "K",
        items: 1,
        answered: 1,
        earned: 1,
        possible: 1,
        unitEarned: 1,
        unitPossible: 1,
        percentPoints: 100,
        percentUnits: 100,
        passed: true,
      } as never,
    ]);
    const { result } = buildResultContext(baseResult([t]), "Тест", {
      labels,
      breakdownDisplay: { visibility: "bar_and_value", basis: "units" },
    });
    const row = (result.topicResults![0] as unknown as { breakdown: Array<Record<string, unknown>> }).breakdown[0];
    expect(row).not.toHaveProperty("statusLabel");
    expect(row.passed).toBe(true);
    expect(row.passClass).toBe("is-pass");
    // А карточка темы своё слово печатает по-прежнему.
    expect(result.topicResults![0].statusLabel).toBe("Незачёт");
  });
});

describe("FR-34: формат счётчика блока (group.counter)", () => {
  const groups = [{ key: "g", label: "Группа", order: 0 }];

  it("без словаря использует формат «{passed} / {total}»", () => {
    const { result } = buildResultContext(
      baseResult([topic("A", true, undefined, "g"), topic("B", false, undefined, "g")], groups),
      "Тест",
    );
    expect(result.topicGroups![0].counterLabel).toBe("1 / 2");
  });

  it("автор переопределяет формат счётчика", () => {
    const labels = { "group.counter": "пройдено {passed} из {total}" };
    const { result } = buildResultContext(
      baseResult([topic("A", true, undefined, "g"), topic("B", false, undefined, "g")], groups),
      "Тест",
      { labels },
    );
    expect(result.topicGroups![0].counterLabel).toBe("пройдено 1 из 2");
  });
});

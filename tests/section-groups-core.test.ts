/**
 * @module tests/section-groups-core
 * @description PRD-50 FR-24 - FR-27: блоки разделов и счётчик «пройдено N из M» считает
 * ЯДРО. Знаменатель — разделы с ВЫНЕСЕННЫМ вердиктом (FR-26), ссылка на несуществующий
 * блок означает отсутствие блока, пустой блок не печатается (FR-12), разделы без блока
 * идут после всех блоков в своём порядке (FR-25), а тест без блоков не меняется вовсе
 * (FR-27).
 */
import { describe, it, expect } from "vitest";
import { groupSections, normalizeSectionGroups } from "../shared/scoring/section-groups";
import { aggregateStandardResult, type AggregateSection } from "../shared/scoring/aggregate";

const groups = [
  { key: "competencies", label: "Управленческие компетенции", order: 0 },
  { key: "knowledge", label: "Знания", order: 1 },
];

const sec = (topicId: string, passed: boolean | null, groupKey?: string | null) => ({
  topicId,
  passed,
  ...(groupKey === undefined ? {} : { groupKey }),
});

describe("normalizeSectionGroups", () => {
  it("выстраивает блоки по `order`, а без него — по позиции", () => {
    const list = normalizeSectionGroups([
      { key: "b", label: "Второй", order: 5 },
      { key: "a", label: "Первый", order: 1 },
    ]);
    expect(list.map((g) => g.key)).toEqual(["a", "b"]);
    expect(normalizeSectionGroups([{ key: "x", label: "X" }, { key: "y", label: "Y" }]).map((g) => g.key)).toEqual([
      "x",
      "y",
    ]);
  });

  it("отбрасывает мусор: не список, не объект, пустой ключ, повтор ключа", () => {
    expect(normalizeSectionGroups(null)).toEqual([]);
    expect(normalizeSectionGroups("нет")).toEqual([]);
    expect(normalizeSectionGroups([null, { key: "  " }, { key: "a", label: "A" }, { key: "a", label: "Дубль" }])).toEqual(
      [{ key: "a", label: "A" }],
    );
  });
});

describe("groupSections", () => {
  it("считает пройденные и вынесшие вердикт: раздел без вердикта в знаменатель не входит (FR-26)", () => {
    const { groups: out } = groupSections(groups, [
      sec("t1", true, "knowledge"),
      sec("t2", false, "knowledge"),
      sec("t3", null, "knowledge"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "knowledge", label: "Знания", passedCount: 1, totalCount: 2 });
    expect(out[0].sections.map((s) => s.topicId)).toEqual(["t1", "t2", "t3"]);
  });

  it("ссылка на несуществующий ключ = раздел без блока (FR-12)", () => {
    const { groups: out, ungrouped } = groupSections(groups, [sec("t1", true, "удалённый")]);
    expect(out).toEqual([]);
    expect(ungrouped.map((s) => s.topicId)).toEqual(["t1"]);
  });

  it("пустой блок не печатается (FR-12)", () => {
    const { groups: out } = groupSections(groups, [sec("t1", true, "knowledge")]);
    expect(out.map((g) => g.key)).toEqual(["knowledge"]);
  });

  it("разделы без блока идут после всех блоков в своём порядке (FR-25)", () => {
    const { groups: out, ungrouped } = groupSections(groups, [
      sec("t1", true, null),
      sec("t2", true, "knowledge"),
      sec("t3", false),
      sec("t4", true, "competencies"),
    ]);
    expect(out.map((g) => g.key)).toEqual(["competencies", "knowledge"]);
    expect(ungrouped.map((s) => s.topicId)).toEqual(["t1", "t3"]);
  });

  it("без объявленных блоков всё остаётся плоским списком (FR-27)", () => {
    const { groups: out, ungrouped } = groupSections(undefined, [sec("t1", true, "knowledge")]);
    expect(out).toEqual([]);
    expect(ungrouped.map((s) => s.topicId)).toEqual(["t1"]);
  });
});

// ─── Счётчики в агрегате ─────────────────────────────────────────────────────

const q = (correctIndex: number, answer: number | null, tags: string[] | null = null) => ({
  type: "single" as const,
  correct: { correctIndex },
  scoring: null,
  points: 1,
  answer,
  ...(tags ? { axisKeys: { tag: tags } } : {}),
});

const section = (
  topicId: string,
  qs: AggregateSection["questions"],
  extra: Partial<AggregateSection> = {},
): AggregateSection => ({
  topicId,
  topicName: topicId,
  topicPassRule: { type: "percent", value: 60 },
  questions: qs,
  ...extra,
});

describe("aggregateStandardResult + блоки разделов", () => {
  it("складывает вердикты разделов в счётчик блока", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(0, 0), q(0, 0)], { groupKey: "knowledge" }),
        section("sec", [q(0, 1), q(0, 1)], { groupKey: "knowledge" }),
        section("mgmt", [q(0, 0)], { groupKey: "competencies" }),
      ],
      overallPassRule: { type: "percent", value: 60 },
      sectionGroups: groups,
    });
    expect(agg.sectionGroups).toEqual([
      { key: "competencies", label: "Управленческие компетенции", topicIds: ["mgmt"], passedCount: 1, totalCount: 1 },
      { key: "knowledge", label: "Знания", topicIds: ["law", "sec"], passedCount: 1, totalCount: 2 },
    ]);
    expect(agg.topicResults[0].groupKey).toBe("knowledge");
  });

  it("порог подтемы вердикт раздела НЕ роняет: подтема не судится (Э1)", () => {
    // Раздел набирает 75% и свой порог в 60% берёт. У подтемы «ПДн» в базе остался порог
    // 80%, и отвечена она на 50%, — но с Э1 (решение владельца 2026-09-03) подтема
    // считается и показывается, а не судится: вердикт темы выносит ТОЛЬКО её правило,
    // и счётчик блока берёт именно его. До Э1 такой раздел падал вместе с подтемой.
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(0, 0, ["ПДн"]), q(0, 1, ["ПДн"]), q(0, 0), q(0, 0)], {
          groupKey: "knowledge",
        }),
      ],
      overallPassRule: { type: "percent", value: 60 },
      sectionGroups: groups,
    });
    expect(agg.topicResults[0].percent).toBe(75);
    expect(agg.topicResults[0].passed).toBe(true);
    expect(agg.sectionGroups).toEqual([
      { key: "knowledge", label: "Знания", topicIds: ["law"], passedCount: 1, totalCount: 1 },
    ]);
  });

  it("раздел без вердикта не попадает в знаменатель (FR-26)", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(0, 0)], { groupKey: "knowledge" }),
        // Ни одного оцениваемого вопроса — вердикта нет.
        section("empty", [], { groupKey: "knowledge" }),
      ],
      overallPassRule: { type: "percent", value: 60 },
      sectionGroups: groups,
    });
    expect(agg.topicResults[1].passed).toBe(null);
    expect(agg.sectionGroups).toEqual([
      { key: "knowledge", label: "Знания", topicIds: ["law", "empty"], passedCount: 1, totalCount: 1 },
    ]);
  });

  it("тест без блоков не получает поля вовсе (FR-27, решение 6)", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(0, 0)])],
      overallPassRule: { type: "percent", value: 60 },
    });
    expect("sectionGroups" in agg).toBe(false);
    expect("groupKey" in agg.topicResults[0]).toBe(false);
  });

  it("блок, на который не ссылается ни один раздел, не печатается (FR-12)", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(0, 0)], { groupKey: "knowledge" })],
      overallPassRule: { type: "percent", value: 60 },
      sectionGroups: groups,
    });
    expect(agg.sectionGroups!.map((g) => g.key)).toEqual(["knowledge"]);
  });
});

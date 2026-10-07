/**
 * @module features/tests/editor/__tests__/composition-items
 * @description Общий список «Состава» теста с роутером: пункт-сценарий стоит между темами,
 * перестановка пишет порядок в `router.itemOrder` и переставляет темы в `sections` так же, а
 * без сценариев порядок пунктов не пишется вовсе (тест без сценариев не меняется).
 */
import { describe, it, expect } from "vitest";
import {
  compositionEntries,
  itemOrderForSave,
  moveEntryOnto,
  moveEntryToGroup,
} from "../sections/composition-items";
import type { EditorSection, ScenarioItemDraft, TestEditorModel } from "../test-editor.types";

const section = (topicId: string, groupKey: string | null = null) => ({ topicId, topicName: topicId, groupKey }) as unknown as EditorSection;
const scenario = (id: string, groupKey: string | null = null): ScenarioItemDraft => ({ id, topicId: "bank", topicName: "Банк", questionId: null, title: id, groupKey });

function model(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    mode: "standard",
    flowMode: "router_by_topics",
    flowSettings: { router: { completionPolicy: "all_required_completed", sectionUnlockRules: {} } },
    sections: [section("t1"), section("t2")],
    scenarioItems: [scenario("s1")],
    sectionGroups: [{ key: "g1", label: "Группа" }],
    ...overrides,
  } as TestEditorModel;
}

const keys = (m: TestEditorModel) => compositionEntries(m).map((e) => e.key);

describe("общий список пунктов", () => {
  it("без порядка — темы, затем сценарии; в линейном потоке сценариев в составе нет", () => {
    expect(keys(model())).toEqual(["topic:t1", "topic:t2", "scenario:s1"]);
    expect(keys(model({ flowMode: "linear_flat" }))).toEqual(["topic:t1", "topic:t2"]);
  });

  it("сценарий, поставленный на место темы, встаёт между темами и берёт её группу", () => {
    const start = model({ sections: [section("t1"), section("t2", "g1")] });
    const next = moveEntryOnto(start, "scenario:s1", "topic:t2");
    expect(keys(next)).toEqual(["topic:t1", "scenario:s1", "topic:t2"]);
    expect(next.scenarioItems?.[0].groupKey).toBe("g1");
    expect(itemOrderForSave(next)).toEqual(["topic:t1", "scenario:s1", "topic:t2"]);
  });

  it("перестановка тем при сценариях держит sections в том же порядке", () => {
    const placed = moveEntryOnto(model(), "scenario:s1", "topic:t1");
    const next = moveEntryOnto(placed, "topic:t2", "scenario:s1");
    expect(keys(next)).toEqual(["topic:t2", "scenario:s1", "topic:t1"]);
    expect(next.sections.map((s) => s.topicId)).toEqual(["t2", "t1"]);
  });

  it("без сценариев порядок пунктов не пишется — переставляются только темы", () => {
    const next = moveEntryOnto(model({ scenarioItems: [] }), "topic:t2", "topic:t1");
    expect(next.sections.map((s) => s.topicId)).toEqual(["t2", "t1"]);
    expect(next.flowSettings.router?.itemOrder).toBeUndefined();
    expect(itemOrderForSave(next)).toBeUndefined();
  });

  it("бросок на карточку меняет только группу; удалённый пункт не остаётся в порядке", () => {
    const grouped = moveEntryToGroup(model(), "scenario:s1", "g1");
    expect(grouped.scenarioItems?.[0].groupKey).toBe("g1");
    expect(keys(grouped)).toEqual(keys(model()));
    const placed = moveEntryOnto(model({ scenarioItems: [scenario("s1"), scenario("s2")] }), "scenario:s2", "topic:t1");
    expect(itemOrderForSave({ ...placed, scenarioItems: [scenario("s1")] })).toEqual(["topic:t1", "topic:t2", "scenario:s1"]);
  });
});

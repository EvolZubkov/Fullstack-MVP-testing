/**
 * @module tests/sim-router-items
 * @description «Сценарий в ИС» в роутере (этап Э3): ключ и порядок пункта теста
 * (`shared/test-items`), выдача пунктов-сценариев рядом с темами (`deliverySections`), карточка
 * сценария в хабе (`buildRouterHubHtml`, согласованный эскиз sim-scenario-learner.html, экран 4).
 */
import { describe, it, expect, vi } from "vitest";
import { matchTestItem, orderTestItems, parseItemKey, scenarioItemKey, isScenarioItemKey } from "@shared/test-items";
import { buildRouterHubHtml } from "@shared/flow/router-hub";
import { resolveFlowPolicy } from "@shared/flow/flow-policy";

vi.mock("../server/storage", () => ({ storage: {} }));
const { deliverySections } = await import("../server/services/test-snapshot");

describe("ключ пункта теста", () => {
  it("голый идентификатор — тема; префиксы читаются; сценарий узнаётся по ключу", () => {
    expect(parseItemKey("t1")).toEqual({ kind: "topic", topicId: "t1" });
    expect(parseItemKey("topic:t1")).toEqual({ kind: "topic", topicId: "t1" });
    expect(parseItemKey("scenario:s1")).toEqual({ kind: "scenario", scenarioId: "s1" });
    expect(isScenarioItemKey(scenarioItemKey("s1"))).toBe(true);
    expect(isScenarioItemKey("t1")).toBe(false);
  });

  it("разбор по виду вызывает обработчик своего вида", () => {
    const describe = (key: string) => matchTestItem(parseItemKey(key), { topic: (id) => `тема ${id}`, scenario: (id) => `сценарий ${id}` });
    expect(describe("t1")).toBe("тема t1");
    expect(describe("scenario:s1")).toBe("сценарий s1");
  });

  it("порядок автора; неупомянутые пункты — после, в своём порядке; без порядка — как есть", () => {
    const items = [{ key: "t1" }, { key: "t2" }, { key: "scenario:s1" }];
    expect(orderTestItems(items, ["scenario:s1", "topic:t2"]).map((i) => i.key)).toEqual(["scenario:s1", "t2", "t1"]);
    expect(orderTestItems(items, null).map((i) => i.key)).toEqual(["t1", "t2", "scenario:s1"]);
  });

  it("порядок пунктов читается из политики роутера и только когда задан", () => {
    expect(resolveFlowPolicy({ mode: "router_by_topics", router: { itemOrder: ["scenario:s1"] } }).itemOrder).toEqual(["scenario:s1"]);
    expect(resolveFlowPolicy({ mode: "router_by_topics" })).not.toHaveProperty("itemOrder");
    expect(resolveFlowPolicy({ mode: "linear_flat", router: { itemOrder: ["x"] } })).not.toHaveProperty("itemOrder");
  });
});

describe("разделы выдачи теста с роутером", () => {
  const section = (topicId: string) => ({ topicId }) as never;
  const item = (id: string, topicId = "bank") => ({ id, testId: "t", topicId, questionId: null, title: null, required: true, timeLimitMinutes: null, imageUrl: null, sortOrder: 0 }) as never;

  it("роутер: темы и пункты; пункт на той же теме, что раздел, остаётся отдельным разделом", () => {
    const test = { mode: "standard", flowPolicyJson: { mode: "router_by_topics" } } as never;
    const out = deliverySections(test, [section("bank"), section("t2")], [item("s1")]);
    expect(out.map((s) => s.topicId)).toEqual(["bank", "t2", "scenario:s1"]);
  });

  it("роутер с порядком автора ставит сценарий между темами", () => {
    const test = { mode: "standard", flowPolicyJson: { mode: "router_by_topics", router: { itemOrder: ["topic:t1", "scenario:s1", "topic:t2"] } } } as never;
    expect(deliverySections(test, [section("t1"), section("t2")], [item("s1")]).map((s) => s.topicId)).toEqual(["t1", "scenario:s1", "t2"]);
  });

  it("линейный поток пункты не выдаёт; тест «Сценарий» — только первый пункт", () => {
    const linear = { mode: "standard", flowPolicyJson: { mode: "linear_flat" } } as never;
    expect(deliverySections(linear, [section("t1")], [item("s1")]).map((s) => s.topicId)).toEqual(["t1"]);
    const scenario = { mode: "scenario", flowPolicyJson: null } as never;
    expect(deliverySections(scenario, [section("t1")], [item("s1"), item("s2")]).map((s) => s.topicId)).toEqual(["scenario:s1"]);
  });
});

describe("карточка сценария в хабе", () => {
  const html = buildRouterHubHtml(
    [
      { topicId: "t1", topicName: "Делопроизводство", drawCount: 12, required: true },
      { topicId: "scenario:s1", topicName: "Работа с документами в СЭД", drawCount: 1, required: false },
    ],
    { topicStates: { t1: "completed" }, unlockRules: {} },
  );

  it("метка «Сценарий» вместо числа вопросов, мужской род подписей, своя метка вида", () => {
    const card = html.slice(html.indexOf('data-topic-id="scenario:s1"') - 200);
    expect(card).toContain("router-topic-card--scenario");
    expect(card).toContain('<span class="router-topic-card__chip">Сценарий</span>');
    expect(card).not.toContain("1 вопрос");
    expect(card).toContain("Не начат<");
    expect(card).toContain("(необязательный)");
  });

  it("карточка темы прежняя", () => {
    expect(html).toContain("12 вопросов");
    expect(html).toContain("Завершена");
  });

  it("закрытый правилом сценарий — «Недоступен»", () => {
    const locked = buildRouterHubHtml(
      [{ topicId: "t1", topicName: "Т" }, { topicId: "scenario:s1", topicName: "С" }],
      { topicStates: {}, unlockRules: { "scenario:s1": { mode: "after_sections_completed", sectionIds: ["t1"] } } },
    );
    expect(locked).toContain("Недоступен");
    expect(locked).toContain('data-router-locked="true"');
  });
});

/**
 * @module tests/sim-workbook-router-items
 * @description Книга Excel и пункты-сценарии роутера. Книга сценарии не переносит, а значит не
 * вправе их портить: правила разблокировки пунктов `scenario:<id>` переживают книгу, которая пишет
 * правила целиком, а порядок тем из книги действует, хотя общий `router.itemOrder` уже задан, —
 * места сценариев при этом не меняются.
 */
import { describe, it, expect, vi } from "vitest";
import { reflowItemOrder } from "@shared/test-items";

vi.mock("../server/storage", () => ({ storage: {} }));
const { keepRouterItemsFromBook } = await import("../server/services/workbook-import");

const routerFlow = (router: Record<string, unknown>) => ({ mode: "router_by_topics", router });

describe("перестройка общего порядка под темы книги", () => {
  it("места тем занимают темы книги по порядку, сценарии на своих местах", () => {
    expect(reflowItemOrder(["topic:a", "scenario:s", "topic:b"], ["b", "a"])).toEqual(["topic:b", "scenario:s", "topic:a"]);
  });

  it("новые темы книги — в конец, исчезнувшие — выпадают", () => {
    expect(reflowItemOrder(["scenario:s", "topic:a", "topic:b"], ["a", "c", "d"])).toEqual(["scenario:s", "topic:a", "topic:c", "topic:d"]);
    expect(reflowItemOrder(["topic:a", "scenario:s", "topic:b"], ["b"])).toEqual(["topic:b", "scenario:s"]);
  });
});

describe("книга не портит пункты-сценарии", () => {
  const current = routerFlow({
    completionPolicy: "all_required_completed",
    itemOrder: ["topic:a", "scenario:s", "topic:b"],
    sectionUnlockRules: {
      b: { mode: "after_sections_completed", sectionIds: ["a"] },
      "scenario:s": { mode: "after_sections_completed", sectionIds: ["a"] },
    },
  });

  it("правила книги заменяют правила тем, правило сценария остаётся", () => {
    const patch: Record<string, unknown> = {
      flowPolicyJson: routerFlow({ sectionUnlockRules: { a: { mode: "after_sections_completed", sectionIds: ["b"] } } }),
    };
    keepRouterItemsFromBook(current, patch, null);
    expect((patch.flowPolicyJson as { router: { sectionUnlockRules: unknown } }).router.sectionUnlockRules).toEqual({
      a: { mode: "after_sections_completed", sectionIds: ["b"] },
      "scenario:s": { mode: "after_sections_completed", sectionIds: ["a"] },
    });
  });

  it("книга с разделами без настроек потока перестраивает порядок пунктов", () => {
    const patch: Record<string, unknown> = {};
    keepRouterItemsFromBook(current, patch, ["b", "a"]);
    expect((patch.flowPolicyJson as { router: { itemOrder: string[] } }).router.itemOrder).toEqual(["topic:b", "scenario:s", "topic:a"]);
  });

  it("тест без сценариев и линейный тест книга не трогает", () => {
    const plain: Record<string, unknown> = {};
    keepRouterItemsFromBook(routerFlow({ completionPolicy: "all_required_completed" }), plain, ["a"]);
    expect(plain).toEqual({});
    const toLinear: Record<string, unknown> = { flowPolicyJson: { mode: "linear_flat", router: null } };
    keepRouterItemsFromBook(current, toLinear, ["a"]);
    expect(toLinear.flowPolicyJson).toEqual({ mode: "linear_flat", router: null });
  });
});

/**
 * @module features/analytics/levels/__tests__/use-analytics-tab
 * @description Вкладка уровня аналитики в адресе (Э2) и то, что замена условий отбора её не
 * стирает.
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { useAnalyticsTab } from "../use-analytics-tab";
import { mergeFilterIntoSearch } from "../../registry/use-registry-filter";
import { EMPTY_FILTER } from "../../registry/filter-state";

const TABS = ["overview", "questions", "quality"] as const;

function setup(path: string) {
  const memory = memoryLocation({ path, record: true });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Router hook={memory.hook} searchHook={memory.searchHook}>{children}</Router>
  );
  const hook = renderHook(() => useAnalyticsTab(TABS, "overview"), { wrapper });
  return { memory, hook };
}

describe("useAnalyticsTab", () => {
  it("читает вкладку из адреса; неизвестная и пустая — вкладка по умолчанию", () => {
    expect(setup("/a?tab=quality").hook.result.current[0]).toBe("quality");
    expect(setup("/a?tab=nope").hook.result.current[0]).toBe("overview");
    expect(setup("/a").hook.result.current[0]).toBe("overview");
  });

  it("смена вкладки — новая запись истории; условия отбора в адресе остаются", () => {
    const { memory, hook } = setup("/a?groupId=g1");
    act(() => hook.result.current[1]("questions"));
    expect(memory.history.at(-1)).toBe("/a?groupId=g1&tab=questions");
    expect(hook.result.current[0]).toBe("questions");
  });

  it("вкладка по умолчанию в адрес не пишется", () => {
    const { memory, hook } = setup("/a?tab=quality&groupId=g1");
    act(() => hook.result.current[1]("overview"));
    expect(memory.history.at(-1)).toBe("/a?groupId=g1");
  });
});

describe("mergeFilterIntoSearch", () => {
  it("замена условий сохраняет вкладку", () => {
    expect(mergeFilterIntoSearch("?groupId=g1&tab=quality", { ...EMPTY_FILTER, sources: ["web"] }))
      .toBe("?source=web&tab=quality");
  });

  it("без вкладки и условий — пустая строка", () => {
    expect(mergeFilterIntoSearch("?groupId=g1", EMPTY_FILTER)).toBe("");
  });
});

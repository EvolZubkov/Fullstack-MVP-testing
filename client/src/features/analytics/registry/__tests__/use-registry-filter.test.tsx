/**
 * @module features/analytics/registry/__tests__/use-registry-filter.test
 * @description Э3.1: условия отбора перечитываются, когда меняется только строка запроса.
 *
 * «Прохождения с ошибкой» на уровне теста — переход на ТОТ ЖЕ путь с новым условием и вкладкой.
 * Хук прежде слушал только путь, и условие появлялось в адресе, но не в отборе: вкладка
 * открывалась со всеми прохождениями теста. Ловилось только в браузере.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLocation } from "wouter";
import { useRegistryFilter } from "../use-registry-filter";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("useRegistryFilter", () => {
  it("перечитывает условия, когда меняется только строка запроса", () => {
    window.history.replaceState(null, "", "/author/analytics/tests/t1?tab=questions");
    const { result } = renderHook(() => ({ filter: useRegistryFilter()[0], navigate: useLocation()[1] }));
    expect(result.current.filter.wrongQuestionIds ?? []).toEqual([]);

    act(() => result.current.navigate("/author/analytics/tests/t1?wrongQuestionId=q1&tab=passages"));

    expect(result.current.filter.wrongQuestionIds).toEqual(["q1"]);
  });
});

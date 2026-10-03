/**
 * @module features/analytics/levels/__tests__/use-open-test-level
 * @description Переход с общего уровня на уровень теста (Э2, задача 4): применимые условия едут,
 * адрес общего уровня — в состоянии записи истории для крошки «Аналитика».
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOpenTestLevel } from "../use-open-test-level";
import { returnHrefOf } from "../analytics-routes";
import { EMPTY_FILTER } from "../../registry/filter-state";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("useOpenTestLevel", () => {
  it("ведёт на уровень теста с применимыми условиями и запоминает адрес общего уровня", () => {
    window.history.replaceState(null, "", "/author/analytics?testId=t1&testId=t2&groupId=g1&tab=attention");
    const { result } = renderHook(() => useOpenTestLevel());

    act(() => result.current("t1", { ...EMPTY_FILTER, testIds: ["t1", "t2"], groupIds: ["g1"] }));

    // Тест — в пути; группа едет; отбор по тестам на уровне теста не пишется.
    expect(`${window.location.pathname}${window.location.search}`).toBe("/author/analytics/tests/t1?groupId=g1");
    // Крошка «Аналитика» вернёт ровно туда, откуда ушли, — с отбором по двум тестам и вкладкой.
    expect(returnHrefOf(window.history.state))
      .toBe("/author/analytics?testId=t1&testId=t2&groupId=g1&tab=attention");
  });
});

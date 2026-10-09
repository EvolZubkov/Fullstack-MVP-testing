/**
 * @module features/analytics/levels/__tests__/analytics-routes
 * @description Адреса трёх уровней аналитики (Э2): сборка, перенаправление старого адреса,
 * перенос условий отбора между уровнями и адрес возврата из состояния истории.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, type RegistryFilter } from "../../registry/filter-state";
import {
  filterIntoTest,
  filterOutOfTest,
  generalHref,
  legacyTestRedirect,
  questionHref,
  returnHrefOf,
  testHref,
} from "../analytics-routes";

const filter = (patch: Partial<RegistryFilter>): RegistryFilter => ({ ...EMPTY_FILTER, ...patch });

describe("адреса уровней", () => {
  it("общий уровень: без условий — голый адрес, с условиями и вкладкой — в строке запроса", () => {
    expect(generalHref()).toBe("/author/analytics");
    expect(generalHref({ testIds: ["t1"] })).toBe("/author/analytics?testId=t1");
    expect(generalHref({ groupIds: ["g1"] }, "slices")).toBe("/author/analytics?groupId=g1&tab=slices");
  });

  it("уровень теста: тест — в пути, а не в условиях", () => {
    expect(testHref("t1", { testIds: ["t1"], groupIds: ["g1"] }, "quality"))
      .toBe("/author/analytics/tests/t1?groupId=g1&tab=quality");
  });

  it("уровень вопроса: тест и вопрос — сегменты пути, спецсимволы экранированы", () => {
    expect(questionHref("t 1", "q/2")).toBe("/author/analytics/tests/t%201/questions/q%2F2");
    expect(questionHref("t1", "q1", { from: "2026-09-01" })).toBe("/author/analytics/tests/t1/questions/q1?from=2026-09-01");
  });
});

describe("перенаправление старого адреса /author/tests/:testId/analytics", () => {
  it("условия отбора и вкладка доезжают", () => {
    expect(legacyTestRedirect("t1", "?groupId=g1&source=import&tab=delivery"))
      .toBe("/author/analytics/tests/t1?groupId=g1&source=import&tab=delivery");
  });

  it("ссылка из редактора на разбор вопроса ведёт на адрес вопроса", () => {
    expect(legacyTestRedirect("t1", "?tab=quality&questionId=q1")).toBe("/author/analytics/tests/t1/questions/q1");
  });

  it("без параметров — уровень теста", () => {
    expect(legacyTestRedirect("t1", "")).toBe("/author/analytics/tests/t1");
  });
});

describe("перенос условий между уровнями", () => {
  it("вниз: применимые условия едут, тест и «ошиблись на вопросе» — нет", () => {
    const moved = filterIntoTest(
      filter({ testIds: ["t1", "t2"], groupIds: ["g1"], sources: ["web"], wrongQuestionIds: ["q1"], from: "2026-08-01" }),
      "t1",
    );
    expect(moved.testIds).toEqual([]);
    expect(moved.groupIds).toEqual(["g1"]);
    expect(moved.sources).toEqual(["web"]);
    expect(moved.from).toBe("2026-08-01");
    expect(moved.wrongQuestionIds).toBeUndefined();
  });

  it("вниз: варианты и версии — только когда общий уровень отобран ровно по этому тесту", () => {
    const same = filterIntoTest(filter({ testIds: ["t1"], formIds: ["f1"], snapshotIds: ["s1"] }), "t1");
    expect(same.formIds).toEqual(["f1"]);
    expect(same.snapshotIds).toEqual(["s1"]);

    const other = filterIntoTest(filter({ testIds: ["t2"], formIds: ["f1"], snapshotIds: ["s1"] }), "t1");
    expect(other.formIds).toEqual([]);
    expect(other.snapshotIds).toEqual([]);
  });

  it("вверх без адреса возврата: условия уровня теста, отобранные по этому тесту", () => {
    expect(filterOutOfTest(filter({ groupIds: ["g1"] }), "t1")).toMatchObject({ testIds: ["t1"], groupIds: ["g1"] });
  });

  it("адрес возврата берётся из состояния истории, только если ведёт в аналитику", () => {
    expect(returnHrefOf({ analyticsReturn: "/author/analytics?testId=t2" })).toBe("/author/analytics?testId=t2");
    expect(returnHrefOf({ analyticsReturn: "https://evil.example" })).toBeNull();
    expect(returnHrefOf(null)).toBeNull();
  });
});

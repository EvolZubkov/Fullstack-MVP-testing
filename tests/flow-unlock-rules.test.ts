/**
 * @module tests/flow-unlock-rules
 * @description Правила открытия пунктов роутера как граф («Сценарий в ИС», техдолг №8): что редактор
 * не предлагает в «Каких пунктов», какое кольцо находит сервер, что уносит удалённый пункт и как
 * правило читается в подзаголовке свёрнутой карточки.
 */
import { describe, it, expect } from "vitest";
import {
  findUnlockCycle,
  pruneUnlockRules,
  unlockDependents,
  unlockSummary,
} from "@shared/flow/unlock-rules";

const after = (...ids: string[]) => ({ mode: "after_sections_completed", sectionIds: ids });
const afterPassed = (...ids: string[]) => ({ mode: "after_sections_passed", sectionIds: ids });

describe("unlockDependents — кого нельзя предложить пункту", () => {
  it("прямой зависимый: 2 ждёт сценарий — у сценария нельзя выбрать 2", () => {
    const rules = { t2: after("scenario:s") };
    expect([...unlockDependents(rules, "scenario:s")]).toEqual(["t2"]);
  });

  it("цепочка любой длины: 2 ждёт 3, 3 ждёт 4 — у 4 нельзя ни 3, ни 2", () => {
    const rules = { t2: after("t3"), t3: afterPassed("t4") };
    expect([...unlockDependents(rules, "t4")].sort()).toEqual(["t2", "t3"]);
  });

  it("правило «Сразу» и пункт без правила зависимых не дают", () => {
    const rules = { t2: { mode: "always_available" }, t3: after("t1") };
    expect([...unlockDependents(rules, "t2")]).toEqual([]);
    expect([...unlockDependents(rules, "t3")]).toEqual([]);
  });

  it("сам пункт в ответ не попадает, даже если ждёт сам себя", () => {
    expect([...unlockDependents({ t1: after("t1") }, "t1")]).toEqual([]);
  });
});

describe("findUnlockCycle — кольцо, которое не даст открыться ни одному пункту", () => {
  it("колец нет — null", () => {
    expect(findUnlockCycle({ t2: after("t1"), t3: after("t1", "t2") })).toBeNull();
  });

  it("кольцо из двух пунктов", () => {
    expect(findUnlockCycle({ t1: after("scenario:s"), "scenario:s": afterPassed("t1") })).toEqual(["t1", "scenario:s"]);
  });

  it("кольцо через цепочку", () => {
    const cycle = findUnlockCycle({ t1: after("t2"), t2: after("t3"), t3: after("t1") });
    expect(cycle).toHaveLength(3);
    expect(new Set(cycle)).toEqual(new Set(["t1", "t2", "t3"]));
  });

  it("пункт, что ждёт сам себя, — кольцо из одного", () => {
    expect(findUnlockCycle({ t1: after("t1") })).toEqual(["t1"]);
  });

  it("пункты вне состава в обход не берутся", () => {
    const rules = { t1: after("gone"), gone: after("t1") };
    expect(findUnlockCycle(rules, new Set(["t1"]))).toBeNull();
    expect(findUnlockCycle(rules)).not.toBeNull();
  });
});

describe("pruneUnlockRules — удалённый пункт уносит свои правила", () => {
  it("снимает правило самого пункта и упоминания в чужих", () => {
    const rules = {
      t1: after("t2"),
      t2: after("t3"),
      t3: after("t2", "scenario:s"),
      "scenario:s": { mode: "always_available" },
    };
    expect(pruneUnlockRules(rules, "t2")).toEqual({
      t3: after("scenario:s"),
      "scenario:s": { mode: "always_available" },
    });
  });
});

describe("unlockSummary — хвост подзаголовка карточки", () => {
  const numberOf = (key: string) => ({ t1: 1, t2: 2, "scenario:s": 3 } as Record<string, number>)[key];

  it("условие по номерам в составе, по возрастанию", () => {
    expect(unlockSummary(after("t2", "t1"), numberOf)).toBe("откроется после завершения 1, 2");
    expect(unlockSummary(afterPassed("scenario:s"), numberOf)).toBe("откроется после успешного прохождения 3");
  });

  it("нет правила, «Сразу» или ни одного пункта из состава — хвоста нет", () => {
    expect(unlockSummary(undefined, numberOf)).toBeNull();
    expect(unlockSummary({ mode: "always_available" }, numberOf)).toBeNull();
    expect(unlockSummary(after("gone"), numberOf)).toBeNull();
  });
});

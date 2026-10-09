/**
 * @module features/tests/editor/sections/__tests__/package-scenario-weight
 * @description Вес сценариев в пакете («Сценарий в ИС», техдолг №6; эскиз «роутер: вес сценариев в
 * пакете»): итог считается по объединению сценариев пунктов, а не суммой их тегов, и читается
 * по-русски при любых числах.
 */
import { describe, expect, it } from "vitest";
import {
  packageScenarioWeight,
  packageScenarioWeightText,
  type BankScenario,
  type ScenarioBank,
} from "../scenario-bank-fields";
import type { ScenarioItemDraft } from "../../test-editor.types";

const MB = 1024 * 1024;
const scenario = (questionId: string, mb: number) => ({ questionId, mediaBytes: mb * MB }) as unknown as BankScenario;
const BANKS: ScenarioBank[] = [
  { topicId: "sed", topicName: "СЭД", scenarios: [scenario("a", 2), scenario("b", 3), scenario("c", 1)] },
  { topicId: "crm", topicName: "CRM", scenarios: [scenario("d", 4)] },
];
const item = (topicId: string, questionId: string | null = null): ScenarioItemDraft => ({ topicId, topicName: "", questionId });

describe("packageScenarioWeight", () => {
  it("случайная выдача несёт весь банк, фиксированная — один сценарий", () => {
    expect(packageScenarioWeight([item("sed")], BANKS)).toEqual({ scenarios: 3, banks: 1, bytes: 6 * MB });
    expect(packageScenarioWeight([item("crm"), item("sed", "b")], BANKS)).toEqual({ scenarios: 2, banks: 2, bytes: 7 * MB });
  });

  it("сценарий, который берут два пункта, учитывается один раз", () => {
    expect(packageScenarioWeight([item("sed"), item("sed", "a"), item("sed")], BANKS)).toEqual({ scenarios: 3, banks: 1, bytes: 6 * MB });
  });

  it("пункт без загруженного банка или с исчезнувшим сценарием не учитывается; пунктов нет — null", () => {
    expect(packageScenarioWeight([item("gone"), item("sed", "zzz")], BANKS)).toEqual({ scenarios: 0, banks: 0, bytes: 0 });
    expect(packageScenarioWeight([], BANKS)).toBeNull();
  });
});

describe("packageScenarioWeightText", () => {
  it("согласует числа", () => {
    expect(packageScenarioWeightText({ scenarios: 4, banks: 1, bytes: 9.6 * MB })).toBe(
      "В пакет войдут 4 сценария из 1 банка, изображения — 9,6 МБ",
    );
    expect(packageScenarioWeightText({ scenarios: 1, banks: 1, bytes: MB })).toBe(
      "В пакет войдёт 1 сценарий из 1 банка, изображения — 1,0 МБ",
    );
    expect(packageScenarioWeightText({ scenarios: 11, banks: 2, bytes: 0 })).toBe(
      "В пакет войдут 11 сценариев из 2 банков, изображения — 0,0 МБ",
    );
  });
});

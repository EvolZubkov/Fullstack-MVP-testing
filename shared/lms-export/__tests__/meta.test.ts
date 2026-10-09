/**
 * @module shared/lms-export/__tests__/meta
 * @description PRD-56 FR-19a: служебные блоки выгрузки, которыми пакет сообщает версию
 * публикации и выданные варианты.
 */
import { describe, it, expect } from "vitest";

import {
  TEST_VERSION_INTERACTION_ID,
  VARIANT_INTERACTION_ID,
  encodeVariantForms,
  decodeVariantForms,
  parseTestVersion,
} from "../meta";

describe("идентификаторы служебных блоков", () => {
  it("несут префикс `meta_`, иначе разбор сочтёт их неопознанной колонкой", () => {
    expect(TEST_VERSION_INTERACTION_ID.startsWith("meta_")).toBe(true);
    expect(VARIANT_INTERACTION_ID.startsWith("meta_")).toBe(true);
  });
});

describe("encodeVariantForms / decodeVariantForms", () => {
  it("склеивает и разбирает список вариантов", () => {
    const ids = ["7b3f1c52-0000-4000-8000-000000000001", "7b3f1c52-0000-4000-8000-000000000002"];
    expect(decodeVariantForms(encodeVariantForms(ids))).toEqual(ids);
  });

  it("пустой список даёт пустую строку, а пустая строка — пустой список", () => {
    // Раздел без вариантов — обычное дело: тогда блок несёт пустую ячейку, а не выдуманный ключ.
    expect(encodeVariantForms([])).toBe("");
    expect(decodeVariantForms("")).toEqual([]);
  });

  it("выбрасывает пустые куски и пробелы вокруг идентификаторов", () => {
    expect(decodeVariantForms(" f1 ;; f2 ; ")).toEqual(["f1", "f2"]);
    expect(encodeVariantForms(["f1", "", "f2"])).toBe("f1;f2");
  });
});

describe("parseTestVersion", () => {
  it("читает номер версии", () => {
    expect(parseTestVersion("3")).toBe(3);
    expect(parseTestVersion(" 12 ")).toBe(12);
  });

  it("пустая ячейка и мусор означают «версия не сообщена», а не ноль", () => {
    // Ноль или текущая версия здесь были бы ложью: прохождение попадёт в строку
    // «Версия не указана», и это единственный честный ответ.
    expect(parseTestVersion("")).toBeNull();
    expect(parseTestVersion("нет")).toBeNull();
    expect(parseTestVersion("0")).toBeNull();
    expect(parseTestVersion("2.5")).toBeNull();
  });
});

/**
 * @module server/routes/__tests__/users-external-key
 * @description PRD-54 раздел 5.4: приведение внешнего ключа пользователя к хранимому виду.
 */
import { describe, it, expect } from "vitest";
import { normalizeExternalKey, readExternalKeyColumn } from "../users";

describe("normalizeExternalKey", () => {
  it("обрезает пробелы, регистр сохраняет", () => {
    // Регистр остаётся: ключ показывают человеку в том виде, в каком он его ввёл.
    // Нечувствительность при СВЕРКЕ обеспечивают индекс по lower() и getUserByExternalKey.
    expect(normalizeExternalKey("  AB-12 ")).toBe("AB-12");
  });

  it("пустая строка — это отсутствие ключа, а не пустой ключ", () => {
    // Разница существенная: пустая строка совпала бы с любой другой пустой и связала бы
    // всех безымянных участников с одним пользователем.
    expect(normalizeExternalKey("   ")).toBeNull();
    expect(normalizeExternalKey("")).toBeNull();
    expect(normalizeExternalKey(undefined)).toBeNull();
    expect(normalizeExternalKey(null)).toBeNull();
  });

  it("не строку приводит к строке", () => {
    expect(normalizeExternalKey(12345)).toBe("12345");
  });
});

describe("readExternalKeyColumn", () => {
  it("читает колонку по любому из псевдонимов", () => {
    // Книгу заполняет человек, а не выгружает система: требовать одно точное написание
    // заголовка — способ получить молчаливо пропущенную колонку.
    expect(readExternalKeyColumn({ external_key: "AB-1" })).toBe("AB-1");
    expect(readExternalKeyColumn({ "Внешний ключ": "AB-2" })).toBe("AB-2");
    expect(readExternalKeyColumn({ "внешний ключ": "AB-3" })).toBe("AB-3");
    expect(readExternalKeyColumn({ "ключ": "AB-4" })).toBe("AB-4");
  });

  it("пустая колонка — это отсутствие ключа, а не пустой ключ", () => {
    // Важно для массовой загрузки: пустая клетка НЕ должна затирать уже проставленный ключ.
    expect(readExternalKeyColumn({ external_key: "   " })).toBeNull();
    expect(readExternalKeyColumn({})).toBeNull();
  });

  it("обрезает пробелы", () => {
    expect(readExternalKeyColumn({ external_key: "  AB-5  " })).toBe("AB-5");
  });
});

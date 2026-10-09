/**
 * @module shared/interpretation/__tests__/resolve
 * @description Правило разрешения толкования: текст теста заменяет текст темы, пустой текст
 * равен отсутствию, а пустой ввод не превращается в пустую строку на экране.
 */
import { describe, it, expect } from "vitest";
import {
  resolveTopicInterpretation,
  resolveBreakdownInterpretation,
} from "../resolve";

describe("resolveTopicInterpretation", () => {
  it("берёт текст темы, когда тест молчит", () => {
    const out = resolveTopicInterpretation({ format: "plain", text: "Индикаторы компетенции" }, null);
    expect(out).toEqual({ format: "plain", text: "Индикаторы компетенции", source: "topic" });
  });

  it("текст теста ЗАМЕНЯЕТ текст темы, а не складывается с ним", () => {
    const out = resolveTopicInterpretation(
      { format: "plain", text: "Текст темы" },
      { format: "richText", text: "Текст теста" },
    );
    expect(out).toEqual({ format: "richText", text: "Текст теста", source: "test" });
  });

  it("пустой текст теста не перекрывает тему: стёртая правка возвращает текст темы", () => {
    const out = resolveTopicInterpretation({ text: "Текст темы" }, { text: "   " });
    expect(out?.source).toBe("topic");
    expect(out?.text).toBe("Текст темы");
  });

  it("нет текста нигде — null, а не пустая строка (иначе печатался бы пустой блок)", () => {
    expect(resolveTopicInterpretation(null, null)).toBeNull();
    expect(resolveTopicInterpretation({ text: "" }, { text: "" })).toBeNull();
    expect(resolveTopicInterpretation(undefined, undefined)).toBeNull();
  });

  it("формат по умолчанию — plain: запись без формата приходит из старых данных", () => {
    expect(resolveTopicInterpretation({ text: "Без формата" }, null)?.format).toBe("plain");
  });
});

describe("resolveBreakdownInterpretation", () => {
  const texts = {
    "Стратегия компании": { format: "plain" as const, text: "Понимание целей до 2030 года" },
    "Продукты компании": { format: "plain" as const, text: "   " },
  };

  it("находит текст подтемы по ключу автора", () => {
    expect(resolveBreakdownInterpretation(texts, "Стратегия компании")).toEqual({
      format: "plain",
      text: "Понимание целей до 2030 года",
      source: "test",
    });
  });

  it("пустой текст и отсутствующий ключ одинаково дают null", () => {
    expect(resolveBreakdownInterpretation(texts, "Продукты компании")).toBeNull();
    expect(resolveBreakdownInterpretation(texts, "Корпоративная культура")).toBeNull();
    expect(resolveBreakdownInterpretation(null, "Стратегия компании")).toBeNull();
  });
});

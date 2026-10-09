/**
 * @module shared/recipients/__tests__/parse-recipient-list.test
 * @description PRD-28 раздел 16 (FR-25 — FR-28): чтение набранного вручную списка
 * получателей. Здесь закреплены правила, которых нет больше нигде: что считается
 * разделителем, как из записи достаётся имя, что происходит с нераспознанным
 * куском и с повтором адреса.
 */
import { describe, it, expect } from "vitest";
import { parseRecipientList } from "../parse-recipient-list";

describe("parseRecipientList", () => {
  it("голый адрес даёт строку без имени", () => {
    expect(parseRecipientList("s.kovalev@example.com")).toEqual([
      { index: 0, email: "s.kovalev@example.com", name: null },
    ]);
  });

  it("запись «Имя <адрес>» разносит имя и адрес", () => {
    expect(parseRecipientList("Ирина Петрова <i.petrova@example.com>")).toEqual([
      { index: 0, email: "i.petrova@example.com", name: "Ирина Петрова" },
    ]);
  });

  it("делит по переводу строки, точке с запятой и запятой", () => {
    const rows = parseRecipientList("a@x.ru\nb@x.ru; c@x.ru, d@x.ru");
    expect(rows.map((r) => r.email)).toEqual(["a@x.ru", "b@x.ru", "c@x.ru", "d@x.ru"]);
  });

  it("запятая внутри кавычек не разделяет запись", () => {
    const rows = parseRecipientList('"Петров, Иван" <p@example.com>; Сидорова <s@example.com>');
    expect(rows).toEqual([
      { index: 0, email: "p@example.com", name: "Петров, Иван" },
      { index: 1, email: "s@example.com", name: "Сидорова" },
    ]);
  });

  it("нераспознанную запись отдаёт как есть, а не выбрасывает", () => {
    const rows = parseRecipientList("ivanov.example.com\nb@x.ru");
    expect(rows[0]).toEqual({ index: 0, email: "ivanov.example.com", name: null });
    expect(rows).toHaveLength(2);
  });

  it("схлопывает повтор адреса, оставляя дыру в позициях", () => {
    const rows = parseRecipientList("a@x.ru\nA@X.ru\nb@x.ru");
    expect(rows).toEqual([
      { index: 0, email: "a@x.ru", name: null },
      { index: 2, email: "b@x.ru", name: null },
    ]);
  });

  it("пустые куски и хвостовой разделитель строк не дают", () => {
    expect(parseRecipientList("a@x.ru;\n\n  \n")).toHaveLength(1);
    expect(parseRecipientList("   ")).toEqual([]);
  });

  it("запись из одних угловых скобок — это адрес без имени", () => {
    expect(parseRecipientList("<a@x.ru>")).toEqual([{ index: 0, email: "a@x.ru", name: null }]);
  });
});

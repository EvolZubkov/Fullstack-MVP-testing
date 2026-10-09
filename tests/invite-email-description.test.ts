/**
 * @module tests/invite-email-description
 *
 * PRD-59 FR-20/FR-22: the invite letter prints the description as markup in its HTML
 * part and as plain text — line breaks intact — in its text part.
 *
 * The two parts of one letter are read by different readers and must not be built by
 * two different rules. What is checked here is that pairing: the same source and the
 * same format go through `richTextToHtml` on one side and `richTextToPlain` on the
 * other, and neither side leaks the other's shape.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { richTextToHtml, richTextToPlain } from "../shared/template/rich-text";

describe("описание в письме-приглашении", () => {
  const source = "<p>Курс для новых</p><p>Возьмите паспорт</p>";

  it("в HTML-часть идёт разметка", () => {
    expect(richTextToHtml(source, "richText")).toBe(source);
  });

  it("в текстовую часть идёт плоский текст с переводами строк", () => {
    expect(richTextToPlain(source, "richText")).toBe("Курс для новых\nВозьмите паспорт");
  });

  it("плоское описание в HTML-части экранируется, а не исполняется", () => {
    // До PRD-59 описание подставлялось в разметку письма сырым: символ `<` в нём
    // портил письмо, а `<script>` уезжал получателю как есть.
    expect(richTextToHtml("Сравните a < b", "plain")).toBe("Сравните a &lt; b");
    expect(richTextToHtml("<script>alert(1)</script>", "plain")).toContain("&lt;script&gt;");
  });

  it("плоское описание сохраняет абзацы в обеих частях", () => {
    expect(richTextToHtml("Первый\nВторой", "plain")).toBe("Первый<br>Второй");
    expect(richTextToPlain("Первый\nВторой", "plain")).toBe("Первый\nВторой");
  });

  // Поймано приёмкой: описание с разметкой стояло внутри `<p>`, и получался `<p>`
  // внутри `<p>` — браузер закрывает внешний абзац сам, вёрстка письма едет. Ровно
  // от этого защищены макеты шаблонов; письмо про это не знало.
  it("оборачивает описание блочным элементом, а не абзацем", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "server/email.ts"), "utf-8");
    const line = source
      .split(/\r?\n/)
      .find((l) => l.includes("Описание:") && l.includes("richTextToHtml"));
    expect(line, "строка описания в HTML-части не найдена").toBeDefined();
    expect(line!).toContain("<div>");
    expect(line!).not.toContain("<p>");
  });
});

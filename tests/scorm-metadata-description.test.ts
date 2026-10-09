/**
 * @module tests/scorm-metadata-description
 *
 * PRD-59 FR-20: the package's XML metadata carries the description without tags and
 * with its line breaks intact, and the file stays valid XML.
 *
 * XML is the one carrier that cannot take markup at all — an author's `<p>` inside a
 * `<string>` element would either break the document or arrive at the LMS as escaped
 * tag soup. The plain projection is what goes there, and it must keep the paragraphs
 * the author wrote: this is the LMS catalogue entry a human reads.
 */
import { describe, it, expect } from "vitest";
import type { Test } from "@shared/schema";
import { buildMetadataXml } from "../server/scorm/builders/metadata";

function test(description: string, descriptionFormat: Test["descriptionFormat"]): Test {
  return { id: "t1", title: "Тест", description, descriptionFormat } as Test;
}

/** The `<description>` element's text, as the reader of the manifest sees it. */
function descriptionOf(xml: string): string {
  const block = /<description>\s*<string language="en">([\s\S]*?)<\/string>/.exec(xml);
  return block ? block[1] : "";
}

describe("описание в метаданных пакета", () => {
  it("печатает размеченное описание без тегов, сохраняя абзацы", () => {
    const xml = buildMetadataXml(test("<p>Курс</p><p>Возьмите паспорт</p>", "richText"));
    expect(descriptionOf(xml)).toBe("Курс\nВозьмите паспорт");
    expect(xml).not.toContain("&lt;p&gt;");
  });

  it("разворачивает список в строки", () => {
    const xml = buildMetadataXml(test("<ul><li>паспорт</li><li>доступ</li></ul>", "html"));
    expect(descriptionOf(xml)).toBe("паспорт\nдоступ");
  });

  it("экранирует угловые скобки плоского описания", () => {
    const xml = buildMetadataXml(test("Сравните a < b", "plain"));
    expect(xml).toContain("a &lt; b");
  });

  it("пустое описание уступает место запасной подписи", () => {
    expect(descriptionOf(buildMetadataXml(test("", "plain")))).toBe("Assessment test");
  });
});

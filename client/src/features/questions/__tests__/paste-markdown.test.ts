/**
 * @module client/features/questions/__tests__/paste-markdown
 * @description What happens when an author pastes into a question field.
 *
 * The clipboard of a Word or Google document carries HTML. Dropping it in raw
 * would store tags the learner screen shows as characters; refusing it would lose
 * the author's bold and links. So the paste is converted to the markdown subset
 * the service stores — the same conversion the Excel import uses.
 */
import { describe, it, expect } from "vitest";
import { pasteAsMarkdown } from "../paste-markdown";

describe("pasteAsMarkdown", () => {
  it("converts pasted markup into the stored markdown subset", () => {
    const result = pasteAsMarkdown({
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      html: "<p>Ответ <b>верный</b></p>",
    });
    expect(result).toEqual({ value: "Ответ **верный**", caret: "Ответ **верный**".length });
  });

  it("inserts at the caret, keeping the text around it", () => {
    const result = pasteAsMarkdown({
      value: "начало  конец",
      selectionStart: 7,
      selectionEnd: 7,
      html: "<b>вставка</b>",
    });
    expect(result?.value).toBe("начало **вставка** конец");
    expect(result?.caret).toBe("начало **вставка**".length);
  });

  it("replaces the selection", () => {
    const result = pasteAsMarkdown({
      value: "было старое слово",
      selectionStart: 5,
      selectionEnd: 17,
      html: "<i>новое</i>",
    });
    expect(result?.value).toBe("было *новое*");
  });

  it("declines a paste that carries no markup, so the browser handles it as usual", () => {
    expect(pasteAsMarkdown({ value: "", selectionStart: 0, selectionEnd: 0, html: "" })).toBeNull();
    expect(
      pasteAsMarkdown({ value: "", selectionStart: 0, selectionEnd: 0, html: "просто текст" }),
    ).toBeNull();
  });

  it("declines a paste whose markup carries no formatting worth keeping", () => {
    // A plain-text copy from a browser still arrives wrapped in a <span>; there is
    // nothing to convert, so the default paste gives exactly the same result.
    expect(
      pasteAsMarkdown({
        value: "",
        selectionStart: 0,
        selectionEnd: 0,
        html: '<span style="color:red">просто текст</span>',
      }),
    ).toBeNull();
  });

  it("keeps a multi-line paste as lines, not as a single run", () => {
    const result = pasteAsMarkdown({
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      html: "<p>Первый</p><p>Второй <b>жирный</b></p>",
    });
    expect(result?.value).toBe("Первый\n\nВторой **жирный**");
  });
});

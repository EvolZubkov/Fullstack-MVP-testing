/**
 * @module tests/plain-text-format
 * @description Текст задания СЛОВАМИ, когда он написан разметкой (PRD-57 §4.3).
 *
 * Плоская проекция нужна многим: обзор, PDF, выгрузка, подбор кегля, аналитика. Все они
 * читают одно поле, и если у HTML-задания снять с него теги забыть, читатель увидит
 * `<p>Что выведет`, а подбор кегля посчитает длину вместе с разметкой и выберет не тот
 * размер.
 */
import { describe, it, expect } from "vitest";

import { plainPromptOf, readablePromptOf } from "../shared/questions/prompt-format";

describe("проекция для машин", () => {
  it("у разметки работает как раньше", () => {
    expect(plainPromptOf({ prompt: "Что такое **OIBDA**?" })).toBe("Что такое OIBDA?");
  });

  it("у HTML снимает теги", () => {
    expect(plainPromptOf({ prompt: "<p>Что такое <b>OIBDA</b>?</p>", promptFormat: "html" }))
      .toBe("Что такое OIBDA?");
  });

  it("абзацы HTML не склеиваются в одно слово", () => {
    const text = plainPromptOf({ prompt: "<p>Первый</p><p>Второй</p>", promptFormat: "html" });
    expect(text).toMatch(/Первый\s+Второй/);
  });

  it("листинг остаётся текстом со своими переносами", () => {
    const text = plainPromptOf({
      prompt: '<pre><code class="language-sql">SELECT 1;\nFROM t;</code></pre>',
      promptFormat: "html",
    });
    expect(text).toContain("SELECT 1;");
    expect(text).toContain("FROM t;");
    expect(text).not.toContain("<code");
  });

  it("richText читается так же, как html: данные у них одни", () => {
    const source = "<p>Текст <i>задания</i></p>";
    expect(plainPromptOf({ prompt: source, promptFormat: "richText" }))
      .toBe(plainPromptOf({ prompt: source, promptFormat: "html" }));
  });

  it("сущности превращаются в символы, а не остаются «&amp;nbsp;»", () => {
    expect(plainPromptOf({ prompt: "<p>А&nbsp;Б &amp; В</p>", promptFormat: "html" }))
      .toBe("А Б & В");
  });
});

describe("проекция для читателя", () => {
  it("несёт типографику — как и у разметки", () => {
    expect(readablePromptOf({ prompt: '<p>Он сказал "да" - и ушёл</p>', promptFormat: "html" }))
      .toContain("«да»");
  });

  it("пропуск печатается прочерком, а не именем поля (AC-05e)", () => {
    const text = readablePromptOf({ prompt: "<p>Столица — {{city}}.</p>", promptFormat: "html" });
    expect(text).not.toContain("{{city}}");
    expect(text).toContain("______");
  });
});

describe("пустое и странное", () => {
  it("пустой текст даёт пустую строку", () => {
    expect(plainPromptOf({ prompt: "", promptFormat: "html" })).toBe("");
    expect(plainPromptOf({ prompt: undefined })).toBe("");
  });

  it("текст без разметки в формате HTML остаётся собой", () => {
    expect(plainPromptOf({ prompt: "Просто текст", promptFormat: "html" })).toBe("Просто текст");
  });
});

/**
 * @module tests/blanks-render-host
 * @description Поля пропусков стоят ВНУТРИ текста задания (PRD-57 §6, FR-24). Разметка
 * взята из согласованного эскиза `prd57-question-input.html`, состояние `s-blanks`.
 */
import { describe, it, expect } from "vitest";

import { renderBlanksPrompt } from "../shared/template/question-interaction";
import type { BlankRuleSet } from "../shared/questions/blanks-render";

const BLANKS: BlankRuleSet[] = [
  {
    id: "organ",
    answerKind: "text",
    join: "any",
    rules: [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }],
  },
  { id: "srok", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 15 }] },
];

const HTML = "Надзор осуществляет {{organ}}, наряд действует {{srok}} суток.";

describe("renderBlanksPrompt — поля участника", () => {
  it("ставит поле на место маркера", () => {
    const html = renderBlanksPrompt(HTML, { mode: "input", blanks: BLANKS });
    expect(html).toContain('data-action="short-answer"');
    expect(html).toContain('data-blank="organ"');
    expect(html).toContain('data-blank="srok"');
    expect(html).not.toContain("{{organ}}");
  });

  it("подставляет набранное участником", () => {
    const html = renderBlanksPrompt(HTML, {
      mode: "input",
      blanks: BLANKS,
      answer: { organ: "РТН" },
    });
    expect(html).toContain('value="РТН"');
  });

  it("ширина поля подсказывает, чего ждут: она из эталона", () => {
    const html = renderBlanksPrompt(HTML, { mode: "input", blanks: BLANKS });
    // «Ростехнадзор» — двенадцать знаков, «15» — два: поля обязаны отличаться.
    expect(html).toContain("--tb-blank-w:12ch");
    expect(html).toContain("--tb-blank-w:6ch");
  });

  it("числовой пропуск просит числовую раскладку", () => {
    const html = renderBlanksPrompt(HTML, { mode: "input", blanks: BLANKS });
    expect(html).toContain('inputmode="decimal"');
  });

  it("экранированные скобки печатаются буквально и полем не становятся", () => {
    const html = renderBlanksPrompt(String.raw`Шаблон \{{name}} печатается`, {
      mode: "input",
      blanks: [],
    });
    expect(html).toBe("Шаблон {{name}} печатается");
  });

  it("в режиме только для чтения поля заперты", () => {
    const html = renderBlanksPrompt(HTML, { mode: "input", blanks: BLANKS, readonly: true });
    expect(html.match(/disabled/g)?.length).toBe(2);
  });
});

describe("renderBlanksPrompt — разбор и эталон", () => {
  it("ответ участника помечается верным и неверным", () => {
    const html = renderBlanksPrompt(HTML, {
      mode: "answer",
      blanks: BLANKS,
      answer: { organ: "ростехнадзор", srok: "30" },
    });
    expect(html).toContain("tb-blank-sub correct-answer");
    expect(html).toContain("tb-blank-sub incorrect-answer");
    expect(html).toContain("ростехнадзор");
    expect(html).toContain("30");
    expect(html).not.toContain("<input");
  });

  it("эталон автора показан нейтральным тоном, а не зелёным", () => {
    // Это не «верно» — это «вот что ожидалось»; зелёный читался бы как вердикт.
    const html = renderBlanksPrompt(HTML, { mode: "reference", blanks: BLANKS });
    expect(html).toContain("tb-blank-sub--etalon");
    expect(html).toContain("Ростехнадзор");
    expect(html).not.toContain("correct-answer");
  });

  it("прочерк держит ширину: подставлять там нечего", () => {
    const html = renderBlanksPrompt(HTML, { mode: "dash", blanks: BLANKS });
    expect(html).toContain("tb-blank-sub--dash");
    expect(html).not.toContain("<input");
  });

  it("ответ экранируется, а не исполняется", () => {
    const html = renderBlanksPrompt("Ответ: {{organ}}", {
      mode: "answer",
      blanks: BLANKS,
      answer: { organ: '"><img src=x onerror=alert(1)>' },
    });
    expect(html).not.toContain("<img");
  });
});

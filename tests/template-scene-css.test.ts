/**
 * @module tests/template-scene-css
 * @description Ревизия «Стандартный» на ui-kit: слой сцены в theme.css. Гард на то,
 * что сцена объявлена (флекс-корень, прокручиваемое тело, заполняющие варианты) и что
 * весь файл на токенах DS — без цветовых литералов (#hex / rgb / rgba), чтобы палитра
 * шла только через `--ou-*` и мост.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(
  path.resolve(__dirname, "../server/scorm/templates/default/styles/theme.css"),
  "utf8",
);

describe("scene layer (theme.css)", () => {
  it("declares the scene flex root, scrolling body and fill answers", () => {
    expect(css).toContain("flex-direction: column");
    // тело прокручивается
    expect(css).toMatch(/overflow:\s*auto/);
    // варианты заполняют высоту (flex + min-height)
    expect(css).toContain("min-height: 52px");
  });

  it("styles the class-driven multiple tick and per-component review", () => {
    expect(css).toContain(".ou-radio-card.is-on .ou-check__box");
    expect(css).toContain("correct-answer");
    expect(css).toContain("incorrect-answer");
  });

  it("uses DS tokens only — no colour literals (#hex / rgb / rgba)", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]/);
  });
});

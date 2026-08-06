/**
 * @module server/services/__tests__/template-render.palette
 * @description Веб-payload экрана должен нести мост палитры DS: для брендированного
 * теста в отдаваемом `css` присутствует блок `.ou{…--ou-purple-500…}`, выведенный из
 * --primary теста (см. shared/template/palette-bridge). Так DS-акцент ученических
 * экранов следует за палитрой теста на веб-хосте так же, как в пакете.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { readScreenTemplate } from "../template-render";

const DEFAULT_DIR = path.resolve(__dirname, "../../scorm/templates/default");

describe("template-render palette bridge", () => {
  it("appends the DS palette bridge to the screen CSS", () => {
    // Штатный шаблон задаёт primaryColor по умолчанию (217 91% 42%), поэтому мост
    // выводится даже без явной палитры теста.
    const payload = readScreenTemplate(DEFAULT_DIR, "question.html", null);
    expect(payload).not.toBeNull();
    expect(payload!.css).toContain(".ou{");
    expect(payload!.css).toContain("--ou-purple-500");
    expect(payload!.css).toContain("hsl(var(--primary))");
  });

  it("routes the ramp through --primary (a live reference, not a baked colour)", () => {
    const payload = readScreenTemplate(DEFAULT_DIR, "question.html", null);
    // Значение должно быть ссылкой на --primary, а не запечённым цветом теста.
    expect(payload!.css).toMatch(/--ou-purple-500:\s*hsl\(var\(--primary\)\)/);
  });
});

/**
 * @module tests/section-intro-subtitle
 * @description PRD-22 FR-38 – FR-46: подзаголовок раздела на экране «Введение раздела».
 *
 * Держит три шаблона вместе: макет печатает надпись из `page.sectionSubtitle`, выключенную
 * надпись не печатает, а карточку с авторским текстом при этом сохраняет. Жёсткая строка
 * «Инструкция» в разметке недопустима — она и была тем, что автор не мог изменить.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildSectionIntroContext } from "../shared/template/result-context";
import { buildPageContext } from "../shared/template/page-sequences";
import { TEMPLATE_IDS, templateFile, templateManifest, type TemplateId } from "./helpers/template-roots";

/** Авторский текст инструкции — он обязан пережить выключение надписи. */
const INSTRUCTION = "<p>Авторский текст инструкции</p>";

/** Рендерит экран введения с заданным подзаголовком и возвращает корень разметки. */
function renderIntro(id: TemplateId, sectionSubtitle: string): HTMLElement {
  const layout = readFileSync(templateFile(id, "layouts/section-intro.html"), "utf8");
  const built = buildSectionIntroContext({
    sectionNumber: 1,
    sectionsTotal: 8,
    topicName: "О компании",
    questionCount: 16,
    instruction: INSTRUCTION,
  });
  const root = document.createElement("div");
  renderScreenInto(root, {
    layout,
    context: { ...built, design: {}, page: buildPageContext(null, { sectionSubtitle }) },
    slots: { instruction: INSTRUCTION },
  });
  return root;
}

describe.each(TEMPLATE_IDS)("%s — подзаголовок раздела", (id) => {
  it("печатает авторскую формулировку", () => {
    expect(renderIntro(id, "Как отвечать").textContent).toContain("Как отвечать");
  });

  it("печатает умолчание, пока автор ничего не задал", () => {
    expect(renderIntro(id, "Инструкция").textContent).toContain("Инструкция");
  });

  it("при выключенной надписи не печатает её, но сохраняет текст инструкции", () => {
    const root = renderIntro(id, "");
    expect(root.textContent).not.toContain("Инструкция");
    expect(root.textContent).toContain("Авторский текст инструкции");
  });

  it("не содержит жёсткой строки «Инструкция» в разметке макета", () => {
    const layout = readFileSync(templateFile(id, "layouts/section-intro.html"), "utf8");
    expect(layout).not.toContain(">Инструкция<");
  });

  it("объявляет обе настройки подзаголовка у варианта введения", () => {
    const manifest = JSON.parse(readFileSync(templateManifest(id), "utf8")) as {
      contentTemplates?: Array<{ kind?: string; settings?: Array<{ key: string; default?: unknown }> }>;
    };
    const intro = (manifest.contentTemplates ?? []).find((v) => v.kind === "intro");
    const settings = intro?.settings ?? [];
    expect(settings.find((s) => s.key === "sectionSubtitleShown")?.default).toBe(true);
    expect(settings.find((s) => s.key === "sectionSubtitle")?.default).toBe("Инструкция");
  });
});

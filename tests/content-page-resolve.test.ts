/**
 * @module tests/content-page-resolve
 * @description PRD-22 (plan Э5): which variant a content page RENDERS through
 * when the design template does not declare the one it is bound to. The rule is
 * shared by both learner hosts and the preview, so it lives in
 * `shared/template/content-page` and is locked here. Pure: no DOM, no DB.
 */
import { describe, it, expect } from "vitest";
import {
  buildContentPageRender,
  findContentTemplate,
  findDefaultContentTemplate,
  resolveContentTemplate,
  type ContentTemplateDef,
} from "@shared/template/content-page";

const TEMPLATES: ContentTemplateDef[] = [
  { key: "info.text", kind: "info", layoutFile: "layouts/content.text.html", isDefault: true, placeholders: [{ key: "title", type: "text" }, { key: "body", type: "html" }] },
  { key: "info.image-left", kind: "info", layoutFile: "layouts/content.image-left.html", placeholders: [{ key: "title", type: "text" }, { key: "image", type: "image" }] },
  { key: "summary.result", kind: "summary", placeholders: [{ key: "result", type: "resultField" }] },
];

const page = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  kind: "info",
  type: "info",
  templateKey: "gallery.card",
  valuesJson: { values: { title: "Заголовок", body: "<p>Текст</p>", lead: "Подзаголовок" } },
  ...over,
});

describe("findDefaultContentTemplate", () => {
  it("prefers the variant marked isDefault", () => {
    expect(findDefaultContentTemplate("info", TEMPLATES)?.key).toBe("info.text");
  });

  it("falls back to the first variant of the kind when none is marked", () => {
    const unmarked = TEMPLATES.map((t) => ({ ...t, isDefault: false }));
    expect(findDefaultContentTemplate("info", unmarked)?.key).toBe("info.text");
    expect(findDefaultContentTemplate("summary", unmarked)?.key).toBe("summary.result");
  });

  it("is null for a kind the template declares nothing for, or with no kind at all", () => {
    expect(findDefaultContentTemplate("router", TEMPLATES)).toBeNull();
    expect(findDefaultContentTemplate(undefined, TEMPLATES)).toBeNull();
    expect(findDefaultContentTemplate("info", null)).toBeNull();
  });
});

describe("resolveContentTemplate", () => {
  it("uses the page's own variant when the template declares it", () => {
    const result = resolveContentTemplate(page({ templateKey: "info.image-left" }), TEMPLATES);
    expect(result.template?.key).toBe("info.image-left");
    expect(result.substituted).toBe(false);
  });

  it("stands the kind's default in for an unavailable variant", () => {
    const result = resolveContentTemplate(page(), TEMPLATES);
    expect(result.template?.key).toBe("info.text");
    expect(result.substituted).toBe(true);
  });

  it("falls back on the legacy `type` when the page carries no `kind`", () => {
    const result = resolveContentTemplate(page({ kind: null }), TEMPLATES);
    expect(result.template?.key).toBe("info.text");
  });

  it("resolves nothing when the template declares no variant of the kind", () => {
    const result = resolveContentTemplate(page({ kind: "router", type: "router" }), TEMPLATES);
    expect(result.template).toBeNull();
    expect(result.substituted).toBe(false);
  });

  // The substitution is a RENDERING decision: the binding survives so the author
  // can still map the page, and switching the design template back restores it.
  it("does not touch the page's stored binding", () => {
    const p = page();
    resolveContentTemplate(p, TEMPLATES);
    expect(p.templateKey).toBe("gallery.card");
    expect(findContentTemplate(p, TEMPLATES)).toBeNull();
  });
});

describe("buildContentPageRender — substitution end to end", () => {
  it("renders an unavailable variant through the default's layout and fields", () => {
    const built = buildContentPageRender(page(), TEMPLATES);

    expect(built.substituted).toBe(true);
    expect(built.layoutKey).toBe("layouts/content.text.html");
    // Fields the substitute declares are kept; the rest of the stored values stay
    // untouched but simply have no region to render into.
    expect(built.skeleton).toContain('data-placeholder="title"');
    expect(built.skeleton).toContain('data-placeholder="body"');
    expect(built.skeleton).not.toContain('data-placeholder="lead"');
    expect(built.content.values.lead).toBe("Подзаголовок");
  });

  it("still degrades to the untemplated card when nothing can stand in", () => {
    const built = buildContentPageRender(page({ kind: "router", type: "router" }), TEMPLATES);

    expect(built.substituted).toBe(false);
    expect(built.layoutKey).toBe("content");
    expect(built.skeleton).toContain("content-page--fallback");
  });

  it("a bound variant renders exactly as before", () => {
    const built = buildContentPageRender(page({ templateKey: "info.image-left" }), TEMPLATES);

    expect(built.substituted).toBe(false);
    expect(built.layoutKey).toBe("layouts/content.image-left.html");
    expect(built.skeleton).toContain('data-placeholder="image"');
  });
});

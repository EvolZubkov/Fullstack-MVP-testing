/**
 * @module shared/template/preview-context.test
 *
 * Locks {@link buildContentPageScreen} — the single-page builder behind the
 * unified page preview (FR-44). It must resolve the page's layout + content
 * template and feed the page's saved values into the renderer's content channel,
 * reusing the same primitives as the demo preview (no second renderer).
 */
import { describe, it, expect } from "vitest";
import { buildContentPageScreen, buildScreenInputs, type PreviewManifest } from "./preview-context";

const MANIFEST: PreviewManifest = {
  layouts: { content: "layouts/content.html", question: "layouts/question.html" },
  contentTemplates: [
    {
      key: "intro.hero",
      kind: "intro",
      pageKind: "content.intro",
      placeholders: [
        { key: "title", type: "text" },
        { key: "body", type: "richText" },
      ],
    },
  ],
};

describe("buildContentPageScreen", () => {
  it("renders ONE content page from its saved values", () => {
    const spec = buildContentPageScreen({
      manifest: MANIFEST,
      route: "content.intro",
      templateKey: "intro.hero",
      values: { title: "Привет", body: "<p>Текст</p>" },
      courseTitle: "Курс",
    });

    // Layout resolves to the generic `content` layout (spec §5.3 fallback).
    expect(spec.layoutKey).toBe("content");
    // The page's values flow into the renderer's content channel verbatim.
    expect(spec.input.content?.values).toEqual({ title: "Привет", body: "<p>Текст</p>" });
    // The placeholder skeleton hosts one slot per declared placeholder.
    expect(spec.input.slots?.["page-content"]).toContain('data-placeholder="title"');
    expect(spec.input.slots?.["page-content"]).toContain('data-placeholder="body"');
    // Course title is exposed for layouts that reference it.
    expect((spec.input.context as { course: { title: string } }).course.title).toBe("Курс");
  });

  it("falls back to an empty placeholder set when the template key is unknown", () => {
    const spec = buildContentPageScreen({
      manifest: MANIFEST,
      route: "content.info",
      templateKey: "missing.key",
      values: {},
      courseTitle: "Курс",
    });
    expect(spec.layoutKey).toBe("content");
    expect(spec.input.content?.template.placeholders).toEqual([]);
  });
});

describe("buildScreenInputs — question preview text", () => {
  it("renders the prompt through the author-text pipeline, as the learner screen does", () => {
    const dataset = {
      course: {
        title: "Демо",
        questions: [
          {
            id: "q1",
            type: "single",
            prompt: "Что такое **замыкание**?",
            dataJson: { options: ["А", "Б"] },
          },
        ],
      },
    } as unknown as Parameters<typeof buildScreenInputs>[0];
    const manifest = {
      layouts: { question: "layouts/question.html" },
      preview: { routes: [{ route: "question.single" }] },
    } as unknown as PreviewManifest;

    const question = buildScreenInputs(dataset, manifest).find((s) => s.route.startsWith("question"));
    // «Что» is a hanging word — the typography pass binds it with a non-breaking space.
    expect(question?.input.slots?.["question-text"]).toBe(
      "Что такое <strong>замыкание</strong>?",
    );
  });
});

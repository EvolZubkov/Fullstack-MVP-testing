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

describe("buildScreenInputs — start description format", () => {
  const manifest = {
    layouts: { start: "layouts/start.html" },
    preview: { routes: [{ route: "start" }] },
  } as unknown as PreviewManifest;
  const startHtml = (format?: "plain" | "richText" | "html") => {
    const dataset = {
      course: { title: "Тест", description: "Текст<br><ul><li>Пункт</li></ul>", descriptionFormat: format },
    } as Parameters<typeof buildScreenInputs>[0];
    const start = buildScreenInputs(dataset, manifest).find((s) => s.route === "start");
    return (start?.input.context as { course: { descriptionHtml: string } }).course.descriptionHtml;
  };

  it("keeps a rich description's markup, as the learner start screen does", () => {
    expect(startHtml("richText")).toBe("Текст<br><ul><li>Пункт</li></ul>");
    expect(startHtml("html")).toBe("Текст<br><ul><li>Пункт</li></ul>");
  });

  it("escapes a plain (or format-less demo) description", () => {
    expect(startHtml()).toContain("&lt;br&gt;");
    expect(startHtml("plain")).toContain("&lt;br&gt;");
  });
});

describe("router preview — card pictures follow the variant", () => {
  const routerManifest = {
    layouts: { content: "layouts/content.html" },
    contentTemplates: [
      { key: "router.menu", kind: "router", pageKind: "content.router", isDefault: true, placeholders: [] },
      {
        key: "router.menu-images",
        kind: "router",
        pageKind: "content.router",
        placeholders: [],
        settings: [{ key: "cardImages", type: "itemImages" }],
      },
    ],
  } as unknown as PreviewManifest;

  const items = [
    { id: "t1", title: "О компании", questionCount: 16 },
    { id: "scenario:s1", title: "Работа в CRM" },
  ];
  const settings = { cardImages: { "topic:t1": { url: "/api/media/a", name: "a.png" } } };

  const pageContent = (templateKey: string) =>
    String(
      buildContentPageScreen({
        manifest: routerManifest,
        route: "content.router",
        templateKey,
        values: {},
        settings,
        courseTitle: "Курс",
        routerTopics: items,
      }).input.slots?.["page-content"] ?? "",
    );

  it("shows the page's pictures through the variant with pictures, on the right card", () => {
    const html = pageContent("router.menu-images");
    expect(html).toContain('<img src="/api/media/a" alt="">');
    expect(html.match(/router-topic-card__img/g)).toHaveLength(1);
    // The run's cards: the scenario item keeps its own words and its card is built too.
    expect(html).toContain("router-topic-card--scenario");
    expect(html).toContain("16 вопросов");
  });

  it("shows no picture through the variant without them, though the page holds some", () => {
    const html = pageContent("router.menu");
    expect(html).not.toContain("router-topic-card__img");
  });

  it("dresses the template's demo topics only in the variant with pictures", () => {
    const dataset = {
      course: {
        title: "Демо",
        topics: [
          { id: "topic-1", title: "Базовые угрозы", status: "available", image: "data:image/svg+xml,x" },
          { id: "topic-2", title: "Пароли", status: "locked" },
        ],
      },
    } as unknown as Parameters<typeof buildScreenInputs>[0];
    const specs = buildScreenInputs(dataset, routerManifest);
    const withImages = specs.find((s) => s.variantKey === "router.menu-images");
    const plain = specs.find((s) => s.variantKey === "router.menu");
    expect(String(withImages?.input.slots?.["page-content"])).toContain('<img src="data:image/svg+xml,x" alt="">');
    expect(String(plain?.input.slots?.["page-content"])).not.toContain("router-topic-card__img");
    // A locked demo card stays locked, as before the preview moved to the shared builder.
    expect(String(plain?.input.slots?.["page-content"])).toContain("router-topic-card--locked");
  });
});

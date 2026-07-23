/**
 * @module features/tests/editor/sections/__tests__/start-pages-section.coverage.test
 * @description Extra branch coverage for the «Структура» section (PRD-1 §4 / PRD-7).
 * Complements `start-pages-section.test.tsx` by driving the modal / inline-form
 * paths the smoke suite does not reach:
 *   - AddPageModal: variant search + filter + empty-state + the «Произвольный HTML»
 *     option (→ html edit mode);
 *   - ReplaceVariantModal opened from an AUTHOR row and applied to the draft;
 *   - PageEditForm: every {@link PlaceholderControl} type, html mode, the
 *     missing-variant banner, and the required-field validation banner (system row);
 *   - {@link ImagePlaceholderControl}: upload → chip → remove, and the oversize error;
 *   - the system-row «шаблон» marker + «Из стандартного шаблона» fallback tag;
 *   - the single-page preview wiring ({@link previewTemplateId} + PagePreviewModal).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StructureSection, previewTemplateId } from "../start-pages-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_ID = "te-1";

const TEMPLATE = {
  id: "default",
  name: "Базовый",
  manifest: {
    contentTemplates: [
      // start carries a REQUIRED placeholder so an empty start row surfaces the
      // required-field tag + validation banner on expand.
      {
        key: "start.standard",
        label: "Старт: стандартный",
        kind: "start",
        pageKind: "start",
        placeholders: [{ key: "headline", type: "text", label: "Заголовок", required: true }],
      },
      { key: "results.standard", label: "Итоги теста: стандартные", kind: "results", pageKind: "results", placeholders: [] },
      {
        key: "info.text",
        label: "Материал",
        kind: "info",
        description: "Текстово-медийная страница.",
        placeholders: [
          { key: "title", type: "text", label: "Заголовок", required: true },
          { key: "body", type: "richText", label: "Текст" },
        ],
      },
      { key: "info.title", label: "Только заголовок", kind: "info", description: "Без текстового блока.", placeholders: [{ key: "title", type: "text", label: "Заголовок" }] },
      { key: "info.empty", label: "Готовая инструкция", kind: "info", description: "Содержимое полностью задано шаблоном.", placeholders: [] },
      // A rich info variant exercising every PlaceholderControl branch.
      {
        key: "info.rich",
        label: "Богатый вариант",
        kind: "info",
        description: "Несколько полей.",
        // PRD-22: content types only. `number` / `boolean` / `select` are page
        // PROPERTIES and live in `settings[]`, not among placeholders.
        placeholders: [
          { key: "heading", type: "text", label: "Заголовок" },
          { key: "body", type: "textarea", label: "Текст" },
          { key: "pic", type: "image", label: "Картинка" },
        ],
        settings: [
          { key: "count", type: "number", label: "Число" },
          { key: "flag", type: "boolean", label: "Флаг" },
          { key: "choice", type: "select", label: "Выбор", options: ["A", "B"] },
          { key: "sequenceId", type: "sequence", label: "Последовательность" },
        ],
      },
      { key: "intro.hero", label: "Введение", kind: "intro", placeholders: [{ key: "title", type: "text", label: "Заголовок" }] },
      { key: "question.standard", label: "Стандартный макет вопроса", kind: "questions", placeholders: [] },
    ],
  },
};

function baseModel(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Sample",
      description: "",
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
    ...overrides,
  };
}

function buildSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "top-1",
    topicName: "Основы ИБ",
    maxQuestions: 10,
    drawCount: 3,
    drawAll: false,
    required: false,
    timeLimit: { source: "inherit_test" },
    feedback: { format: "plain", text: "" },
    feedbackLinks: [],
    feedbackAssets: [],
    feedbackEvents: [],
    defaultPoints: null,
    ...over,
  };
}

type RawPage = {
  id: string;
  testId: string;
  topicId: string | null;
  position: string;
  mode: string;
  type: string;
  kind: string;
  templateKey: string | null;
  sortOrder: number;
  valuesJson: Record<string, unknown>;
  autoAdvance: boolean;
  autoAdvanceDelayMs: number | null;
  createdAt: string;
  updatedAt: string;
};

function buildPage(over: Partial<RawPage> = {}): RawPage {
  return {
    id: "pg-1",
    testId: TEST_ID,
    topicId: null,
    position: "before",
    mode: "standard",
    type: "info",
    kind: "info",
    templateKey: null,
    sortOrder: 0,
    valuesJson: { values: { title: "Введение" } },
    autoAdvance: false,
    autoAdvanceDelayMs: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

// ─── Stateful fetch mock ────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

/** Installs a stateful fetch over content-pages + design + templates + media API. */
function installApi(initialPages: RawPage[], template: unknown = TEMPLATE) {
  const pages = [...initialPages];
  let seq = 0;
  const spies = {
    post: vi.fn<(b: any) => void>(),
    put: vi.fn<(b: { id: string; body: any }) => void>(),
    del: vi.fn<(id: string) => void>(),
  };

  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      // Content-page mutations send JSON strings; media upload sends FormData —
      // only parse the former.
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

      if (url.startsWith(`/api/tests/${TEST_ID}/content-pages`) && method === "GET") return jsonResponse(pages);
      if (url === `/api/tests/${TEST_ID}/design`) return jsonResponse({ templateId: "default" });
      if (url.startsWith("/api/templates/default")) return jsonResponse(template);
      if (url === "/api/media/upload" && method === "POST") {
        return jsonResponse({ url: "/uploads/media/pic.png", originalName: "pic.png" });
      }

      if (url.startsWith(`/api/tests/${TEST_ID}/content-pages`) && method === "POST") {
        spies.post(body);
        const created = buildPage({ ...body, id: `pg-new-${++seq}`, valuesJson: body.valuesJson ?? { values: {} } });
        pages.push(created);
        return jsonResponse(created, 201);
      }
      const idMatch = url.match(new RegExp(`/api/tests/${TEST_ID}/content-pages/([^/?]+)`));
      if (idMatch && method === "PUT") {
        spies.put({ id: idMatch[1], body });
        return jsonResponse(pages.find((x) => x.id === idMatch[1]) ?? {});
      }
      if (idMatch && method === "DELETE") {
        spies.del(idMatch[1]);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return jsonResponse({ error: "unexpected " + method + " " + url }, 500);
    }),
  );
  return spies;
}

function renderSection(model: TestEditorModel) {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <StructureSection model={model} testId={TEST_ID} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

// ─── previewTemplateId (pure) ──────────────────────────────────────────────────

describe("previewTemplateId", () => {
  it("returns the draft template when the kind has its own variant, else default", () => {
    const cp = { contentTemplates: [{ kind: "info" }] };
    expect(previewTemplateId(cp, "tpl-1", { kind: "info" })).toBe("tpl-1");
    expect(previewTemplateId(cp, "tpl-1", { kind: "start" })).toBe("default");
    expect(previewTemplateId({ contentTemplates: [] }, "tpl-1", { kind: null })).toBe("default");
  });
});

// ─── Add-page modal: search / filter / empty / html ────────────────────────────

describe("<StructureSection /> — add-page modal", () => {
  it("filters the add options by search and shows the empty state", async () => {
    installApi([]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-zone-before-test")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-insert-before-test-0"));
    // 4 info variants + «Произвольный HTML» → the search box appears (>3 options).
    await waitFor(() => expect(screen.getByTestId("structure-add-search")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("structure-add-search"), { target: { value: "богат" } });
    expect(screen.getByTestId("structure-add-option-tpl:info.rich")).toBeInTheDocument();
    expect(screen.queryByTestId("structure-add-option-tpl:info.text")).toBeNull();

    fireEvent.change(screen.getByTestId("structure-add-search"), { target: { value: "неттакого" } });
    expect(screen.getByTestId("structure-add-empty")).toBeInTheDocument();
  });

  it("adds an «Произвольный HTML» page which opens in html edit mode", async () => {
    installApi([]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-zone-before-test")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-insert-before-test-0"));
    await waitFor(() => expect(screen.getByTestId("structure-add-option-html")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("structure-add-option-html"));
    fireEvent.click(screen.getByTestId("structure-add-confirm"));

    // The created draft auto-expands (onCreated → setExpandedId); html mode → the
    // single `__html` textarea placeholder.
    await waitFor(() => expect(screen.getByTestId("structure-page-field-draft-0-__html")).toBeInTheDocument());
  });
});

// ─── Replace-variant from an author row + apply ────────────────────────────────

describe("<StructureSection /> — author replace-variant apply", () => {
  it("switches an author page to another variant and applies it to the draft", async () => {
    installApi([
      buildPage({ id: "pg-a", kind: "info", position: "before", topicId: null, templateKey: "info.text", valuesJson: { values: { title: "T", body: "<p>x</p>" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-a")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-actions-pg-a"));
    fireEvent.click(screen.getByTestId("structure-page-replace-pg-a"));
    await waitFor(() => expect(screen.getByTestId("structure-replace-option-info.title")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-replace-option-info.title"));
    // Switching to info.title drops `body` → the diff-block lists it.
    expect(await screen.findByTestId("structure-replace-diff")).toHaveTextContent("Текст:");

    fireEvent.click(screen.getByTestId("structure-replace-confirm"));
    // The row badge switches to the new variant label in the local draft.
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-a")).toHaveTextContent("Только заголовок"));
  });

  // ── Plan Э5: an unavailable variant is the author's decision, not a silent one ──

  it("summarizes the pages that need mapping and opens the dialog for one", async () => {
    installApi([
      buildPage({ id: "pg-x", kind: "info", position: "before", topicId: null, templateKey: "info.gone", valuesJson: { values: { title: "Осиротевшая" } } }),
      buildPage({ id: "pg-y", kind: "info", position: "before", topicId: null, templateKey: "info.gone2", valuesJson: { values: { title: "И вторая" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));

    const banner = await screen.findByTestId("structure-unmapped-banner");
    expect(banner).toHaveTextContent("Страниц требуют сопоставления: 2");
    // Each listed page takes the author straight to its mapping dialog.
    fireEvent.click(screen.getByRole("button", { name: "Осиротевшая" }));
    expect(await screen.findByTestId("structure-replace-confirm")).toBeInTheDocument();
  });

  it("preselects the first offered variant when the page's own is unavailable", async () => {
    installApi([
      buildPage({ id: "pg-x", kind: "info", position: "before", topicId: null, templateKey: "info.gone", valuesJson: { values: { title: "T", body: "<p>x</p>" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-missing-pg-x")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-actions-pg-x"));
    fireEvent.click(screen.getByTestId("structure-page-replace-pg-x"));

    // «Применить» must be live: with the stale key preselected it was disabled, so
    // the one page that needs the dialog was the one page it could not fix.
    const confirm = await screen.findByTestId("structure-replace-confirm");
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByTestId("structure-page-missing-pg-x")).toBeNull());
    expect(screen.getByTestId("structure-page-row-pg-x")).toHaveTextContent("Материал");
  });

  it("lists the values at risk even though the current variant is unreachable", async () => {
    installApi([
      buildPage({ id: "pg-x", kind: "info", position: "before", topicId: null, templateKey: "info.gone", valuesJson: { values: { title: "T", legacyField: "Пропадёт" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-missing-pg-x")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-actions-pg-x"));
    fireEvent.click(screen.getByTestId("structure-page-replace-pg-x"));
    // `legacyField` is not declared by any reachable variant, so the stored values
    // themselves are what the warning is computed from.
    expect(await screen.findByTestId("structure-replace-diff")).toHaveTextContent("legacyField");
  });
});

// ─── PageEditForm: control types + html + banners ──────────────────────────────

describe("<StructureSection /> — page edit form", () => {
  it("renders every placeholder control type and persists edits to the draft", async () => {
    installApi([
      buildPage({ id: "pg-rich", kind: "info", position: "before", topicId: null, templateKey: "info.rich", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-rich")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-expand-pg-rich"));
    await screen.findByTestId("structure-page-field-pg-rich-heading"); // text
    expect(screen.getByTestId("structure-page-field-pg-rich-body")).toBeInTheDocument(); // textarea
    expect(screen.getByTestId("structure-page-field-pg-rich-pic")).toBeInTheDocument(); // image
    // PRD-22: page properties render after the content fields, in the same list.
    expect(screen.getByTestId("structure-page-setting-pg-rich-count")).toBeInTheDocument(); // number
    expect(screen.getByTestId("structure-page-setting-pg-rich-flag")).toBeInTheDocument(); // boolean
    expect(screen.getByTestId("structure-page-setting-pg-rich-choice")).toBeInTheDocument(); // select
    expect(screen.getByTestId("structure-page-setting-pg-rich-sequenceId")).toBeInTheDocument(); // sequence

    fireEvent.change(screen.getByTestId("structure-page-field-pg-rich-heading"), { target: { value: "H" } });
    // `textarea` has a plain-text ceiling, so the field shows no mode switch —
    // just the input. Its testid is suffixed by the shared editor component.
    expect(screen.queryByTestId("structure-page-field-pg-rich-body-mode-rich")).toBeNull();
    fireEvent.change(screen.getByTestId("structure-page-field-pg-rich-body-input"), { target: { value: "B" } });
    // Single-save model: edits go straight into the draft, no per-form button.
    expect(screen.queryByTestId("structure-page-edit-save-pg-rich")).toBeNull();

    // Collapse via the chevron and re-expand: the edits are in the draft.
    fireEvent.click(screen.getByTestId("structure-page-expand-pg-rich"));
    await waitFor(() => expect(screen.queryByTestId("structure-page-edit-fields-pg-rich")).toBeNull());
    fireEvent.click(screen.getByTestId("structure-page-expand-pg-rich"));
    const heading = (await screen.findByTestId("structure-page-field-pg-rich-heading")) as HTMLInputElement;
    expect(heading.value).toBe("H");
  });

  it("shows the missing-variant banner for a page bound to an unknown template key", async () => {
    installApi([
      buildPage({ id: "pg-ghost", kind: "info", position: "before", topicId: null, mode: "template", templateKey: "info.ghost", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-ghost")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-expand-pg-ghost"));
    expect(await screen.findByTestId("structure-page-edit-no-variant-pg-ghost")).toBeInTheDocument();
  });

  it("expands a required-empty system row and shows the validation banner", async () => {
    installApi([
      buildPage({ id: "pg-start", kind: "start", position: "before", topicId: null, templateKey: "start.standard", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-system-start")).toBeInTheDocument());

    expect(screen.getByTestId("structure-system-start-required-tag")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("structure-system-start-expand"));
    expect(await screen.findByTestId("structure-page-edit-validation-pg-start")).toBeInTheDocument();
  });
});

// ─── Image placeholder upload / remove / oversize ──────────────────────────────

describe("<StructureSection /> — image placeholder", () => {
  it("uploads an image, shows the chip and removes it", async () => {
    installApi([
      buildPage({ id: "pg-img", kind: "info", position: "before", topicId: null, templateKey: "info.rich", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-img")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-expand-pg-img"));
    const fileInput = await screen.findByTestId("structure-page-field-pg-img-pic-file");
    const file = new File(["x"], "pic.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 1024, configurable: true });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByTestId("structure-page-field-pg-img-pic-chip")).toBeInTheDocument());
    expect(screen.getByText("pic.png")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("structure-page-field-pg-img-pic-remove"));
    await waitFor(() => expect(screen.queryByTestId("structure-page-field-pg-img-pic-chip")).toBeNull());
  });

  it("rejects an oversize image with an inline error", async () => {
    installApi([
      buildPage({ id: "pg-img2", kind: "info", position: "before", topicId: null, templateKey: "info.rich", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-img2")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-expand-pg-img2"));
    const fileInput = await screen.findByTestId("structure-page-field-pg-img2-pic-file");
    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 600 * 1024, configurable: true });
    fireEvent.change(fileInput, { target: { files: [big] } });

    await waitFor(() => expect(screen.getByTestId("structure-page-field-pg-img2-pic-error")).toBeInTheDocument());
  });
});

// ─── System-row markers ─────────────────────────────────────────────────────────

describe("<StructureSection /> — system row markers", () => {
  it("marks an all-empty intro system row with the «шаблон» marker", async () => {
    installApi([
      buildPage({ id: "pg-intro", kind: "intro", position: "before_topic", topicId: "t1", templateKey: "intro.hero", valuesJson: { values: {} } }),
      buildPage({ id: "pg-q", kind: "questions", position: "before_topic", topicId: "t1", templateKey: "question.standard", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_by_topics", sections: [buildSection({ topicId: "t1", topicName: "Тема А" })] }));
    await waitFor(() => expect(screen.getByTestId("structure-system-intro-t1")).toBeInTheDocument());
    expect(screen.getByTestId("structure-system-intro-t1-template-marker")).toBeInTheDocument();
  });

  it("shows the «Из стандартного шаблона» fallback tag when the kind is absent from the template", async () => {
    const noResults = {
      ...TEMPLATE,
      manifest: { contentTemplates: TEMPLATE.manifest.contentTemplates.filter((v) => v.kind !== "results") },
    };
    installApi(
      [buildPage({ id: "pg-res", kind: "results", position: "after", topicId: null, templateKey: "results.standard", valuesJson: { values: {} } })],
      noResults,
    );
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-system-results")).toBeInTheDocument());
    expect(screen.getByTestId("structure-system-results-fallback-tag")).toBeInTheDocument();
  });
});

// ─── Zone layouts: review slot / router / after-zone interleave ────────────────

describe("<StructureSection /> — zone layouts", () => {
  it("dims the «Обзор теста» slot with a comment when return-to-unanswered is OFF", async () => {
    installApi([]);
    renderSection(
      baseModel({
        flowMode: "linear_flat",
        sections: [buildSection()],
        runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: false, allowAnswerChange: false, showSectionResults: true },
      }),
    );
    await waitFor(() => expect(screen.getByTestId("structure-zone-questions")).toBeInTheDocument());
    expect(screen.getByTestId("structure-review-slot")).toHaveAttribute("data-disabled", "true");
    expect(screen.getByTestId("structure-review-slot-comment")).toBeInTheDocument();
  });

  it("hides the «Обзор» slot entirely in adaptive mode", async () => {
    installApi([]);
    renderSection(baseModel({ flowMode: "linear_flat", mode: "adaptive", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-zone-questions")).toBeInTheDocument());
    expect(screen.queryByTestId("structure-review-slot")).toBeNull();
  });

  it("router mode renders the «Внутри теста» container + the router system row", async () => {
    installApi([
      buildPage({ id: "pg-router", kind: "router", position: "before", topicId: null, templateKey: "router.menu", valuesJson: { values: {} } }),
      buildPage({ id: "pg-qt1", kind: "questions", position: "before_topic", topicId: "t1", templateKey: "question.standard", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "router_by_topics", sections: [buildSection({ topicId: "t1", topicName: "Тема А" })] }));
    await waitFor(() => expect(screen.getByTestId("structure-inside-test")).toBeInTheDocument());
    expect(screen.getByTestId("structure-system-router")).toBeInTheDocument();
    expect(screen.getByTestId("structure-zone-topic-t1")).toBeInTheDocument();
  });

  it("interleaves «Итоги теста» with author after-pages and offers inserts in every gap", async () => {
    installApi([
      buildPage({ id: "pg-results", kind: "results", position: "after", topicId: null, templateKey: "results.standard", sortOrder: 1, valuesJson: { values: {} } }),
      buildPage({ id: "pg-after", kind: "info", position: "after", topicId: null, templateKey: "info.text", sortOrder: 0, valuesJson: { values: { title: "Пост-итог" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-zone-after-test")).toBeInTheDocument());
    // Both the system «Итоги теста» row and the author after-page render in the zone.
    expect(screen.getByTestId("structure-system-results")).toBeInTheDocument();
    expect(screen.getByTestId("structure-page-row-pg-after")).toHaveTextContent("Пост-итог");
    // Inserts appear before + between + after the combined list.
    expect(screen.getByTestId("structure-insert-after-test-0")).toBeInTheDocument();
    expect(screen.getByTestId("structure-insert-after-test-2")).toBeInTheDocument();
  });
});

// ─── Single-page preview wiring ────────────────────────────────────────────────

describe("<StructureSection /> — preview modal", () => {
  it("opens the single-page preview modal from the author row menu", async () => {
    installApi([
      buildPage({ id: "pg-p", kind: "info", position: "before", topicId: null, templateKey: "info.text", valuesJson: { values: { title: "T" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-p")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-actions-pg-p"));
    fireEvent.click(screen.getByTestId("structure-page-preview-pg-p"));
    expect(await screen.findByTestId("page-preview-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("page-preview-close"));
    await waitFor(() => expect(screen.queryByTestId("page-preview-modal")).toBeNull());
  });
});

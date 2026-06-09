/**
 * @module features/tests/editor/sections/__tests__/start-pages-section.test
 * @description Tests for the «Структура» tab section (closeout of PRD-1 §4).
 *
 * Coverage:
 *   - flowMode banner, empty state, create-mode notice, no stub
 *   - Kind-aware layout: intro → «До теста», summary → «После теста»,
 *     questions → one row per topic (no synthetic duplicate)
 *   - Author info pages: add (variant modal), inline edit, reorder, delete
 *   - Required-field + missing-template warnings
 *   - «Сменить вариант» on system rows (enabled when >1 variant, replace-variant)
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StructureSection, reorderByDrop, insertIndexFor } from "../start-pages-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_ID = "te-1";

const TEMPLATE = {
  id: "default",
  name: "Базовый",
  manifest: {
    contentTemplates: [
      { key: "start.standard", label: "Старт: стандартный", kind: "start", pageKind: "start", placeholders: [] },
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
      // S13.6 fixtures: info.title only carries `title` (body would be lost on
      // switch), info.empty has zero placeholders (s-replace-no-fields state).
      {
        key: "info.title",
        label: "Только заголовок",
        kind: "info",
        description: "Без текстового блока.",
        placeholders: [{ key: "title", type: "text", label: "Заголовок" }],
      },
      {
        key: "info.empty",
        label: "Готовая инструкция",
        kind: "info",
        description: "Содержимое полностью задано шаблоном.",
        placeholders: [],
      },
      { key: "intro.hero", label: "Введение", kind: "intro", placeholders: [{ key: "title", type: "text", label: "Заголовок" }] },
      // Two summary variants → «Сменить вариант» enabled.
      { key: "summary.result", label: "Итог: результат", kind: "summary", placeholders: [] },
      { key: "summary.ring", label: "Итог: кольцо", kind: "summary", placeholders: [] },
      // One questions variant → «Сменить вариант» disabled.
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
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
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
  templateKeyMissing?: boolean;
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
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

/** Installs a stateful fetch over the content-pages + design + templates API. */
function installApi(initialPages: RawPage[]) {
  const pages = [...initialPages];
  let seq = 0;
  const spies = {
    post: vi.fn<(b: any) => void>(),
    put: vi.fn<(b: { id: string; body: any }) => void>(),
    reorder: vi.fn<(b: any) => void>(),
    replaceVariant: vi.fn<(b: { id: string; body: any }) => void>(),
    del: vi.fn<(id: string) => void>(),
  };

  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : undefined;

      if (url === `/api/tests/${TEST_ID}/content-pages` && method === "GET") return jsonResponse(pages);
      if (url === `/api/tests/${TEST_ID}/design`) return jsonResponse({ templateId: "default" });
      if (url === "/api/templates/default") return jsonResponse(TEMPLATE);

      if (url === `/api/tests/${TEST_ID}/content-pages` && method === "POST") {
        spies.post(body);
        const created = buildPage({ ...body, id: `pg-new-${++seq}`, valuesJson: body.valuesJson ?? { values: {} } });
        pages.push(created);
        return jsonResponse(created, 201);
      }
      if (url === `/api/tests/${TEST_ID}/content-pages/reorder` && method === "PUT") {
        spies.reorder(body);
        return jsonResponse({ ok: true });
      }
      const rvMatch = url.match(new RegExp(`/content-pages/([^/]+)/replace-variant$`));
      if (rvMatch && method === "POST") {
        spies.replaceVariant({ id: rvMatch[1], body });
        const p = pages.find((x) => x.id === rvMatch[1]);
        if (p && body.newTemplateKey) p.templateKey = body.newTemplateKey;
        return jsonResponse({ diff: { preserved: [], removed: [], added: [] }, applied: true });
      }
      const idMatch = url.match(new RegExp(`/api/tests/${TEST_ID}/content-pages/([^/]+)$`));
      if (idMatch && method === "PUT") {
        spies.put({ id: idMatch[1], body });
        const p = pages.find((x) => x.id === idMatch[1]);
        if (p && body.valuesJson) p.valuesJson = body.valuesJson;
        return jsonResponse(p);
      }
      if (idMatch && method === "DELETE") {
        spies.del(idMatch[1]);
        const i = pages.findIndex((x) => x.id === idMatch[1]);
        if (i >= 0) pages.splice(i, 1);
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<StructureSection /> — flow mode + lifecycle", () => {
  beforeEach(() => installApi([]));

  it("shows the current flowMode in the banner", () => {
    renderSection(baseModel({ flowMode: "router_by_topics" }));
    expect(screen.getByTestId("structure-mode-banner")).toHaveTextContent("Через страницу-маршрутизатор");
  });

  it("shows the empty state when there are no sections", async () => {
    renderSection(baseModel());
    await waitFor(() => expect(screen.getByTestId("structure-empty")).toBeInTheDocument());
  });

  it("shows the create-mode notice when testId is undefined", () => {
    const client = makeQueryClient();
    render(
      <QueryClientProvider client={client}>
        <StructureSection model={baseModel()} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("structure-create-notice")).toBeInTheDocument();
  });

  it("no longer renders the «next step» stub (feature is live)", async () => {
    renderSection(baseModel({ sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-zone-before-test")).toBeInTheDocument());
    expect(screen.queryByTestId("structure-content-pages-stub")).toBeNull();
  });
});

describe("<StructureSection /> — kind-aware layout", () => {
  it("linear_flat: no section intro/summary; single flat questions row", async () => {
    installApi([
      buildPage({ id: "pg-q", kind: "questions", position: "before", topicId: null, templateKey: "question.standard", valuesJson: { values: {} } }),
    ]);
    renderSection(
      baseModel({
        flowMode: "linear_flat",
        sections: [
          buildSection({ topicId: "t1", topicName: "Тема А", drawCount: 5, maxQuestions: 12 }),
          buildSection({ topicId: "t2", topicName: "Тема Б", drawCount: 2, maxQuestions: 6 }),
        ],
      }),
    );
    await waitFor(() => expect(screen.getByTestId("structure-zone-before-test")).toBeInTheDocument());
    // A flat test has no section «Введение/Итоги раздела».
    expect(screen.queryByTestId("structure-system-intro")).toBeNull();
    expect(screen.queryByTestId("structure-system-summary")).toBeNull();
    // Single flat questions row with the total count.
    expect(screen.getByTestId("structure-flat-questions-row")).toHaveTextContent("Единый поток: 7 вопросов из 18");
  });

  it("linear_by_topics: exactly one questions row per topic (no synthetic duplicate)", async () => {
    installApi([
      buildPage({ id: "pg-qt1", kind: "questions", position: "before_topic", topicId: "t1", templateKey: "question.standard", valuesJson: { values: {} } }),
      buildPage({ id: "pg-info", kind: "info", position: "before_topic", topicId: "t1", templateKey: "info.text", valuesJson: { values: { title: "Вводная А" } } }),
    ]);
    renderSection(
      baseModel({
        flowMode: "linear_by_topics",
        sections: [buildSection({ topicId: "t1", topicName: "Тема А", drawCount: 4, maxQuestions: 10 })],
      }),
    );
    await waitFor(() => expect(screen.getByTestId("structure-zone-topic-t1")).toBeInTheDocument());
    // The kind:questions page is THE questions row — rendered once, with the count.
    const qRows = screen.getAllByTestId("structure-questions-row-t1");
    expect(qRows).toHaveLength(1);
    expect(qRows[0]).toHaveTextContent("4 вопросов темы «Тема А»");
    // It is NOT also rendered as an author page-row.
    expect(screen.queryByTestId("structure-page-row-pg-qt1")).toBeNull();
    // The author info page renders as an editable row.
    expect(screen.getByTestId("structure-page-row-pg-info")).toHaveTextContent("Вводная А");
  });

  it("renders start in «До теста» and results («Итоги теста») in «После теста»", async () => {
    installApi([
      buildPage({ id: "pg-start", kind: "start", position: "before", topicId: null, templateKey: "start.standard", valuesJson: { values: {} } }),
      buildPage({ id: "pg-results", kind: "results", position: "after", topicId: null, templateKey: "results.standard", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-zone-before-test")).toBeInTheDocument());
    // Start is a test-level system row in «До теста».
    expect(screen.getByTestId("structure-system-start")).toHaveTextContent("Старт");
    // Results («Итоги теста») is a test-level system row in «После теста».
    expect(screen.getByTestId("structure-zone-after-test")).toContainElement(
      screen.getByTestId("structure-system-results"),
    );
    expect(screen.getByTestId("structure-system-results")).toHaveTextContent("Итоги теста");
  });

  it("linear_by_topics: section «Введение раздела»/«Итоги раздела» render inside the topic block", async () => {
    installApi([
      buildPage({ id: "pg-it1", kind: "intro", position: "before_topic", topicId: "t1", templateKey: "intro.hero", valuesJson: { values: { title: "Вступление" } } }),
      buildPage({ id: "pg-st1", kind: "summary", position: "after_topic", topicId: "t1", templateKey: "summary.result", valuesJson: { values: {} } }),
      buildPage({ id: "pg-qt1", kind: "questions", position: "before_topic", topicId: "t1", templateKey: "question.standard", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_by_topics", sections: [buildSection({ topicId: "t1", topicName: "Тема А" })] }));
    await waitFor(() => expect(screen.getByTestId("structure-zone-topic-t1")).toBeInTheDocument());
    const topic = screen.getByTestId("structure-zone-topic-t1");
    expect(topic).toContainElement(screen.getByTestId("structure-system-intro-t1"));
    expect(topic).toContainElement(screen.getByTestId("structure-system-summary-t1"));
    // No test-level intro/summary in «До теста»/«После теста».
    expect(screen.queryByTestId("structure-system-intro")).toBeNull();
  });
});

describe("<StructureSection /> — add page", () => {
  it("insert-row → picks the info variant → adds the page to the local draft (no write yet)", async () => {
    const spies = installApi([]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-zone-before-test")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-insert-before-test-0"));
    await waitFor(() => expect(screen.getByTestId("structure-add-option-tpl:info.text")).toBeInTheDocument());
    expect(screen.queryByTestId("structure-add-option-tpl:intro.hero")).toBeNull();

    fireEvent.click(screen.getByTestId("structure-add-confirm"));
    // The page appears immediately in the local draft (first draft id = draft-0);
    // nothing is written until the drawer's «Сохранить» commits.
    await waitFor(() => expect(screen.getByTestId("structure-page-row-draft-0")).toBeInTheDocument());
    expect(spies.post).not.toHaveBeenCalled();
  });
});

describe("<StructureSection /> — inline edit", () => {
  it("expands a page, edits a field and persists it to the local draft (no write yet)", async () => {
    const spies = installApi([
      buildPage({ id: "pg-1", kind: "info", position: "before", topicId: null, templateKey: "info.text", valuesJson: { values: { title: "Старое" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-expand-pg-1"));
    const titleInput = await screen.findByTestId("structure-page-field-pg-1-title");
    fireEvent.change(titleInput, { target: { value: "Новый заголовок" } });
    fireEvent.click(screen.getByTestId("structure-page-edit-save-pg-1"));

    // Saved into the local draft — the form collapses, but nothing is PUT yet.
    await waitFor(() => expect(screen.queryByTestId("structure-page-edit-fields-pg-1")).toBeNull());
    expect(spies.put).not.toHaveBeenCalled();
    // Re-expand: the locally-saved value is there.
    fireEvent.click(screen.getByTestId("structure-page-expand-pg-1"));
    const reopened = (await screen.findByTestId("structure-page-field-pg-1-title")) as HTMLInputElement;
    expect(reopened.value).toBe("Новый заголовок");
  });
});

describe("reorderByDrop", () => {
  // DnD itself runs through @dnd-kit sensors, which need real DOM measurements
  // (unavailable in jsdom). The reorder math is extracted and tested here; the
  // drag interaction is verified live in the browser.
  it("dropping B before A yields the B,A order with reindexed sortOrder", () => {
    const zone = [
      buildPage({ id: "pg-a", kind: "info", position: "before", topicId: null, sortOrder: 0 }),
      buildPage({ id: "pg-b", kind: "info", position: "before", topicId: null, sortOrder: 1 }),
    ];
    expect(reorderByDrop(zone, "pg-b", "pg-a", "before")).toEqual([
      { id: "pg-b", sortOrder: 0 },
      { id: "pg-a", sortOrder: 1 },
    ]);
  });

  it("supports arbitrary placement (drop the first AFTER the last of three)", () => {
    const zone = ["pg-a", "pg-b", "pg-c"].map((id, i) =>
      buildPage({ id, kind: "info", position: "before", topicId: null, sortOrder: i }),
    );
    expect(reorderByDrop(zone, "pg-a", "pg-c", "after")).toEqual([
      { id: "pg-b", sortOrder: 0 },
      { id: "pg-c", sortOrder: 1 },
      { id: "pg-a", sortOrder: 2 },
    ]);
  });

  it("returns null for no-op moves (same id, not found, already in place)", () => {
    const zone = ["pg-a", "pg-b"].map((id, i) =>
      buildPage({ id, kind: "info", position: "before", topicId: null, sortOrder: i }),
    );
    expect(reorderByDrop(zone, "pg-a", "pg-a", "before")).toBeNull();
    expect(reorderByDrop(zone, "pg-a", "missing", "before")).toBeNull();
    // A dropped before B is exactly where A already sits → no-op.
    expect(reorderByDrop(zone, "pg-a", "pg-b", "before")).toBeNull();
  });
});

describe("insertIndexFor (cross-zone drop position)", () => {
  const zone = ["x", "y", "z"].map((id, i) =>
    buildPage({ id, kind: "info", position: "after", topicId: null, sortOrder: i }),
  );
  it("inserts before / after the hovered row", () => {
    expect(insertIndexFor(zone, "y", "before")).toBe(1);
    expect(insertIndexFor(zone, "y", "after")).toBe(2);
  });
  it("appends to the end when dropping on the zone (no row) or an unknown row", () => {
    expect(insertIndexFor(zone, null, "after")).toBe(3);
    expect(insertIndexFor(zone, "missing", "before")).toBe(3);
  });
});

describe("<StructureSection /> — reorder (DnD wiring)", () => {
  it("renders a drag handle on each author page", async () => {
    installApi([
      buildPage({ id: "pg-a", kind: "info", position: "before", topicId: null, sortOrder: 0, valuesJson: { values: { title: "A" } } }),
      buildPage({ id: "pg-b", kind: "info", position: "before", topicId: null, sortOrder: 1, valuesJson: { values: { title: "B" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-b")).toBeInTheDocument());

    expect(screen.getByTestId("structure-page-grip-pg-a")).toBeInTheDocument();
    expect(screen.getByTestId("structure-page-grip-pg-b")).toBeInTheDocument();
  });
});

describe("<StructureSection /> — delete flow", () => {
  it("confirm + delete removes the page from the local draft (no write yet)", async () => {
    const spies = installApi([
      buildPage({ id: "pg-1", kind: "info", position: "before", topicId: null, valuesJson: { values: { title: "К удалению" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-actions-pg-1"));
    fireEvent.click(screen.getByTestId("structure-page-delete-pg-1"));
    expect(screen.getByTestId("structure-page-delete-confirm-pg-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("structure-page-delete-confirm-pg-1"));

    // Removed from the draft immediately; the DELETE only fires at commit (save).
    await waitFor(() => expect(screen.queryByTestId("structure-page-row-pg-1")).toBeNull());
    expect(spies.del).not.toHaveBeenCalled();
  });

  it("cancel keeps the row and reverts the confirm prompt", async () => {
    installApi([
      buildPage({ id: "pg-1", kind: "info", position: "before", topicId: null, valuesJson: { values: { title: "Не трогаем" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("structure-page-actions-pg-1"));
    fireEvent.click(screen.getByTestId("structure-page-delete-pg-1"));
    fireEvent.click(screen.getByTestId("structure-page-delete-cancel-pg-1"));
    expect(screen.getByTestId("structure-page-actions-pg-1")).toBeInTheDocument();
  });
});

describe("<StructureSection /> — warnings", () => {
  it("renders a warning tag on pages whose templateKey is missing from the template", async () => {
    // `templateKeyMissing` is now derived client-side against the active catalogue:
    // a key absent from the template (here `info.removed`) flags the page.
    installApi([
      buildPage({ id: "pg-stale", kind: "info", position: "before", topicId: null, templateKey: "info.removed", valuesJson: { values: { title: "Старая шапка" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-missing-pg-stale")).toBeInTheDocument());
  });

  it("flags an info page that leaves a required field empty", async () => {
    installApi([
      buildPage({ id: "pg-req", kind: "info", position: "before", topicId: null, templateKey: "info.text", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-required-pg-req")).toBeInTheDocument());
  });

  it("shows the «Доступно вариантов» hint on an info page when the template offers several", async () => {
    // TEMPLATE declares 3 info variants → the author info row surfaces the hint,
    // symmetric with the system row (and «Сменить вариант» lives in its «...» menu).
    installApi([
      buildPage({ id: "pg-info", kind: "info", position: "before", topicId: null, templateKey: "info.text", valuesJson: { values: { title: "T" } } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-info")).toBeInTheDocument());
    expect(screen.getByTestId("structure-page-pg-info-variant-hint")).toHaveTextContent("Доступно вариантов: 3");
  });
});

describe("<StructureSection /> — switch variant of a system page", () => {
  it("section summary has >1 variant → «Сменить вариант» applies the new variant to the local draft", async () => {
    const spies = installApi([
      buildPage({ id: "pg-sum", kind: "summary", position: "after_topic", topicId: "t1", templateKey: "summary.result", valuesJson: { values: {} } }),
      buildPage({ id: "pg-qt1", kind: "questions", position: "before_topic", topicId: "t1", templateKey: "question.standard", valuesJson: { values: {} } }),
    ]);
    renderSection(baseModel({ flowMode: "linear_by_topics", sections: [buildSection({ topicId: "t1", topicName: "Тема А" })] }));
    await waitFor(() => expect(screen.getByTestId("structure-system-summary-t1")).toBeInTheDocument());

    // Two summary variants → the variant hint is shown on the per-topic summary row.
    expect(screen.getByTestId("structure-system-summary-t1-variant-hint")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("structure-system-summary-t1-actions"));
    fireEvent.click(screen.getByTestId("structure-system-summary-t1-replace"));
    await waitFor(() => expect(screen.getByTestId("structure-replace-option-summary.ring")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("structure-replace-option-summary.ring"));
    fireEvent.click(screen.getByTestId("structure-replace-confirm"));

    // The system row's badge switches to the new variant label in the local draft;
    // the replace-variant call only fires at commit (drawer save).
    await waitFor(() =>
      expect(screen.getByTestId("structure-system-summary-t1")).toHaveTextContent("Итог: кольцо"),
    );
    expect(spies.replaceVariant).not.toHaveBeenCalled();
  });

  it("questions has a single variant → no hint, «Сменить вариант» disabled", async () => {
    installApi([
      buildPage({ id: "pg-qt1", kind: "questions", position: "before_topic", topicId: "t1", templateKey: "question.standard", valuesJson: { values: {} } }),
    ]);
    renderSection(
      baseModel({
        flowMode: "linear_by_topics",
        sections: [buildSection({ topicId: "t1", topicName: "Тема А", drawCount: 4, maxQuestions: 10 })],
      }),
    );
    await waitFor(() => expect(screen.getByTestId("structure-questions-row-t1")).toBeInTheDocument());
    // No «Доступно вариантов» hint label and no «Единственный вариант» chip.
    expect(screen.queryByTestId("structure-questions-row-t1-variant-hint")).toBeNull();
    expect(screen.getByTestId("structure-questions-row-t1")).not.toHaveTextContent("Единственный вариант");
    // The command exists but is disabled — clicking it does not open the modal.
    fireEvent.click(screen.getByTestId("structure-questions-row-t1-actions"));
    fireEvent.click(screen.getByTestId("structure-questions-row-t1-replace"));
    expect(screen.queryByTestId("structure-replace-confirm")).toBeNull();
  });
});

// ─── S13.6 — Replace-variant modal: search + diff-block (G28/G29) ──────────────

describe("<StructureSection /> — replace-variant search + diff", () => {
  function openReplaceModal() {
    installApi([
      buildPage({
        id: "pg-info",
        kind: "info",
        position: "before",
        topicId: null,
        templateKey: "info.text",
        valuesJson: { values: { title: "Введение", body: "<p>Привет</p>" } },
      }),
    ]);
    renderSection(baseModel({ flowMode: "linear_flat", sections: [buildSection()] }));
  }

  it("renders the variant-search input and filters the list (G28)", async () => {
    openReplaceModal();
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-info")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("structure-page-actions-pg-info"));
    fireEvent.click(screen.getByTestId("structure-page-replace-pg-info"));

    await waitFor(() => expect(screen.getByTestId("structure-replace-search")).toBeInTheDocument());

    // All three info variants visible before filtering.
    expect(screen.getByTestId("structure-replace-option-info.text")).toBeInTheDocument();
    expect(screen.getByTestId("structure-replace-option-info.title")).toBeInTheDocument();
    expect(screen.getByTestId("structure-replace-option-info.empty")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("structure-replace-search"), {
      target: { value: "только" },
    });

    // Only «Только заголовок» matches.
    expect(screen.queryByTestId("structure-replace-option-info.text")).toBeNull();
    expect(screen.getByTestId("structure-replace-option-info.title")).toBeInTheDocument();
    expect(screen.queryByTestId("structure-replace-option-info.empty")).toBeNull();

    // Empty-state when no matches.
    fireEvent.change(screen.getByTestId("structure-replace-search"), {
      target: { value: "несуществующий" },
    });
    expect(screen.getByTestId("structure-replace-empty")).toBeInTheDocument();
  });

  it("highlights the current variant as disabled with «Текущий» chip (G28)", async () => {
    openReplaceModal();
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-info")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("structure-page-actions-pg-info"));
    fireEvent.click(screen.getByTestId("structure-page-replace-pg-info"));

    await waitFor(() => expect(screen.getByTestId("structure-replace-option-info.text")).toBeInTheDocument());
    const currentOption = screen.getByTestId("structure-replace-option-info.text");
    expect(currentOption.className).toContain("is-current");
    expect(currentOption.getAttribute("aria-disabled")).toBe("true");
    expect(currentOption).toHaveTextContent("Текущий");
  });

  it("shows diff-block listing lost placeholder values (G28)", async () => {
    openReplaceModal();
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-info")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("structure-page-actions-pg-info"));
    fireEvent.click(screen.getByTestId("structure-page-replace-pg-info"));

    // Switch to info.title — drops `body` (no `body` placeholder in new variant).
    await waitFor(() => expect(screen.getByTestId("structure-replace-option-info.title")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("structure-replace-option-info.title"));

    const diff = await screen.findByTestId("structure-replace-diff");
    expect(diff).toHaveTextContent("Часть настроек не переносится");
    expect(diff).toHaveTextContent("Текст:");
    expect(diff).toHaveTextContent("Привет"); // HTML stripped from "<p>Привет</p>"
    // Title is preserved in info.title → not listed.
    expect(diff).not.toHaveTextContent("Заголовок:");
  });

  it("shows «потеряны» variant of diff when new variant has zero placeholders (G29)", async () => {
    openReplaceModal();
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-info")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("structure-page-actions-pg-info"));
    fireEvent.click(screen.getByTestId("structure-page-replace-pg-info"));

    await waitFor(() => expect(screen.getByTestId("structure-replace-option-info.empty")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("structure-replace-option-info.empty"));

    const diff = await screen.findByTestId("structure-replace-diff");
    expect(diff).toHaveTextContent("Текущие настройки страницы будут потеряны");
    expect(diff).toHaveTextContent("Заголовок:");
    expect(diff).toHaveTextContent("Текст:");
    expect(diff).toHaveTextContent("У нового варианта нет редактируемых полей");
  });

  it("does not show diff-block when switching back to current variant", async () => {
    openReplaceModal();
    await waitFor(() => expect(screen.getByTestId("structure-page-row-pg-info")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("structure-page-actions-pg-info"));
    fireEvent.click(screen.getByTestId("structure-page-replace-pg-info"));

    // Modal opens with the page's current variant pre-selected → no diff.
    await waitFor(() => expect(screen.getByTestId("structure-replace-search")).toBeInTheDocument());
    expect(screen.queryByTestId("structure-replace-diff")).toBeNull();
  });
});

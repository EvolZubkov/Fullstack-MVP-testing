/**
 * @module features/tests/editor/sections/__tests__/start-pages-section.test
 * @description Tests for the «Структура» tab section.
 *
 * Coverage:
 *   - flowMode banner with the human-readable label
 *   - Empty state when sections array is empty
 *   - Create-mode notice when testId is undefined
 *   - Loads content_pages from `/api/tests/:id/content-pages`
 *   - linear_flat: «До теста» zone + single questions row + per-test pages
 *   - linear_by_topics: per-topic blocks with before/after groups
 *   - Page delete: requires confirmation, fires DELETE, triggers refetch
 *   - templateKeyMissing flag surfaces a warning tag
 *   - Content-pages «next step» stub is always present
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StructureSection } from "../start-pages-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_ID = "te-1";

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
    passRules: {
      decisionPolicy: "overall_only",
      overall: { type: "percent", value: 70 },
      byTopic: {},
    },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    ...overrides,
  };
}

function buildSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "top-1",
    topicName: "Основы ИБ",
    maxQuestions: 10,
    drawCount: 3,
    required: false,
    timeLimit: { source: "inherit_test" },
    feedback: { format: "plain", text: "" },
    feedbackLinks: [],
    feedbackAssets: [],
    ...over,
  };
}

function buildPage(over: Partial<{ id: string; topicId: string | null; position: string; kind: string; sortOrder: number; valuesJson: Record<string, unknown>; templateKeyMissing: boolean }> = {}) {
  return {
    id: over.id ?? "pg-1",
    testId: TEST_ID,
    topicId: over.topicId ?? null,
    position: over.position ?? "before",
    mode: "standard",
    type: "info",
    kind: over.kind ?? "info",
    templateKey: null,
    sortOrder: over.sortOrder ?? 0,
    valuesJson: over.valuesJson ?? { values: { title: "Введение" } },
    autoAdvance: false,
    autoAdvanceDelayMs: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(over.templateKeyMissing !== undefined
      ? { templateKeyMissing: over.templateKeyMissing }
      : {}),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderWithClient(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function emptyResponse(status = 204): Promise<Response> {
  return Promise.resolve(new Response(null, { status }));
}

beforeEach(() => {
  mockFetch((url) => {
    if (url === `/api/tests/${TEST_ID}/content-pages`) return jsonResponse([]);
    return jsonResponse({ error: "unexpected" }, 500);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<StructureSection /> — flow mode + lifecycle", () => {
  it("shows the current flowMode in the banner", () => {
    renderWithClient(
      <StructureSection
        model={baseModel({ flowMode: "router_by_topics" })}
        testId={TEST_ID}
      />,
    );
    expect(screen.getByTestId("structure-mode-banner")).toHaveTextContent(
      "Маршрутизатор по темам",
    );
  });

  it("shows the empty state when there are no sections", async () => {
    renderWithClient(<StructureSection model={baseModel()} testId={TEST_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId("structure-empty")).toBeInTheDocument(),
    );
  });

  it("shows the create-mode notice when testId is undefined", () => {
    renderWithClient(<StructureSection model={baseModel()} />);
    expect(screen.getByTestId("structure-create-notice")).toBeInTheDocument();
  });

  it("always shows the content-pages «next step» stub", () => {
    renderWithClient(
      <StructureSection
        model={baseModel({ sections: [buildSection()] })}
        testId={TEST_ID}
      />,
    );
    expect(screen.getByTestId("structure-content-pages-stub")).toBeInTheDocument();
  });
});

describe("<StructureSection /> — linear_flat layout", () => {
  it("renders «До теста» pages + single «Внутри теста» questions row", async () => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/content-pages`)
        return jsonResponse([
          buildPage({ id: "pg-before-1", position: "before", topicId: null, kind: "intro", valuesJson: { values: { title: "Правила" } } }),
        ]);
      return jsonResponse({ error: "unexpected" }, 500);
    });
    renderWithClient(
      <StructureSection
        model={baseModel({
          flowMode: "linear_flat",
          sections: [
            buildSection({ topicId: "t1", topicName: "Тема А", drawCount: 5, maxQuestions: 12 }),
            buildSection({ topicId: "t2", topicName: "Тема Б", drawCount: 2, maxQuestions: 6 }),
          ],
        })}
        testId={TEST_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("structure-zone-before-test")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("structure-page-row-pg-before-1")).toHaveTextContent("Правила");
    expect(screen.getByTestId("structure-zone-questions")).toBeInTheDocument();
    expect(screen.getByTestId("structure-flat-questions-row")).toHaveTextContent(
      "Единый поток: 7 вопросов из 18",
    );
  });
});

describe("<StructureSection /> — linear_by_topics layout", () => {
  it("renders one block per topic with before/after groups", async () => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/content-pages`)
        return jsonResponse([
          buildPage({ id: "pg-bt-1", position: "before_topic", topicId: "t1", kind: "info", valuesJson: { values: { title: "Вводная А" } } }),
          buildPage({ id: "pg-at-1", position: "after_topic", topicId: "t1", kind: "summary", valuesJson: { values: { title: "Итог А" } } }),
        ]);
      return jsonResponse({ error: "unexpected" }, 500);
    });
    renderWithClient(
      <StructureSection
        model={baseModel({
          flowMode: "linear_by_topics",
          sections: [
            buildSection({ topicId: "t1", topicName: "Тема А", drawCount: 4, maxQuestions: 10 }),
            buildSection({ topicId: "t2", topicName: "Тема Б", drawCount: 2, maxQuestions: 6 }),
          ],
        })}
        testId={TEST_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("structure-zone-topic-t1")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("structure-zone-topic-t2")).toBeInTheDocument();
    expect(screen.getByTestId("structure-topic-before-t1")).toHaveTextContent("Вводная А");
    expect(screen.getByTestId("structure-topic-after-t1")).toHaveTextContent("Итог А");
    expect(screen.getByTestId("structure-topic-questions-t1")).toHaveTextContent(
      "4 вопросов из 10",
    );
  });
});

describe("<StructureSection /> — content_pages delete flow", () => {
  it("confirm + delete calls DELETE and refetches the list", async () => {
    let deleted = false;
    mockFetch((url, init) => {
      if (url === `/api/tests/${TEST_ID}/content-pages` && (!init || init.method !== "DELETE")) {
        return jsonResponse(
          deleted
            ? []
            : [buildPage({ id: "pg-1", position: "before", topicId: null, valuesJson: { values: { title: "К удалению" } } })],
        );
      }
      if (url === `/api/tests/${TEST_ID}/content-pages/pg-1` && init?.method === "DELETE") {
        deleted = true;
        return emptyResponse(204);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    renderWithClient(
      <StructureSection
        model={baseModel({
          flowMode: "linear_flat",
          sections: [buildSection()],
        })}
        testId={TEST_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("structure-page-row-pg-1")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("structure-page-delete-pg-1"));
    expect(screen.getByTestId("structure-page-delete-confirm-pg-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("structure-page-delete-confirm-pg-1"));
    await waitFor(() =>
      expect(screen.queryByTestId("structure-page-row-pg-1")).toBeNull(),
    );
  });

  it("cancel keeps the row and reverts the confirm prompt", async () => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/content-pages`)
        return jsonResponse([
          buildPage({ id: "pg-1", position: "before", topicId: null, valuesJson: { values: { title: "Не трогаем" } } }),
        ]);
      return jsonResponse({ error: "unexpected" }, 500);
    });
    renderWithClient(
      <StructureSection
        model={baseModel({ flowMode: "linear_flat", sections: [buildSection()] })}
        testId={TEST_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("structure-page-row-pg-1")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("structure-page-delete-pg-1"));
    fireEvent.click(screen.getByTestId("structure-page-delete-cancel-pg-1"));
    expect(screen.getByTestId("structure-page-delete-pg-1")).toBeInTheDocument();
  });
});

describe("<StructureSection /> — missing template flag", () => {
  it("renders a warning tag on pages whose templateKey is missing", async () => {
    mockFetch((url) => {
      if (url === `/api/tests/${TEST_ID}/content-pages`)
        return jsonResponse([
          buildPage({
            id: "pg-stale",
            position: "before",
            topicId: null,
            valuesJson: { values: { title: "Старая шапка" } },
            templateKeyMissing: true,
          }),
        ]);
      return jsonResponse({ error: "unexpected" }, 500);
    });
    renderWithClient(
      <StructureSection
        model={baseModel({ flowMode: "linear_flat", sections: [buildSection()] })}
        testId={TEST_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("structure-page-missing-pg-stale")).toBeInTheDocument(),
    );
  });
});

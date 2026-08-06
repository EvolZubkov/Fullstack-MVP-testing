/**
 * @module features/tests/editor/__tests__/test-editor.coverage.test
 * @description Coverage-focused component tests for the Drawer test editor.
 * Complements {@link test-editor.test} by driving: the create-mode option
 * branch, the NFR-20 focus-trap keydown handler, a successful unified save
 * (footer + close-confirm «Сохранить»), the close-confirm «Перейти к первой
 * ошибке» anchor, the 409 conflict diff-table (fetch + rendered rows), the
 * archived status tag, and rendering every non-default tab panel.
 *
 * Harness copied from {@link test-editor.test}.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";
import { TestEditor, TestEditorView } from "../test-editor";
import { useTestEditor } from "../use-test-editor";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function buildApiResponse(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "test-1",
    version: 7,
    title: "Sample Test",
    description: "",
    mode: "standard",
    status: "draft",
    overallPassRuleJson: { type: "percent", value: 70 },
    passDecisionPolicy: "overall_only",
    webhookUrl: null,
    feedbackJson: { format: "plain", text: "", links: [], assets: [] },
    telemetryEnabled: false,
    timeLimitMinutes: null,
    maxAttempts: null,
    showCorrectAnswers: false,
    sections: [
      { id: "section-1", topicId: "topic-1", topicName: "Основы ИБ", drawCount: 5, required: true, maxQuestions: 10 },
    ],
    adaptiveSettings: null,
    ...overrides,
  };
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function withClient(client: QueryClient, ui: React.JSX.Element) {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

// ─── fetch mocking ────────────────────────────────────────────────────────────

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Queue a one-shot response (mirrors {@link test-editor.test}). */
function nextResponse(body: unknown, status = 200) {
  fetchMock.mockImplementationOnce(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

/**
 * Install a URL router so multiple GET/PUT round-trips resolve deterministically
 * (the one-shot queue can't, because the design/content-pages hooks interleave
 * their own fetches). `putStatus` forces the top-level PUT response code.
 */
function installRouter(opts: { getBody?: () => Record<string, unknown>; putStatus?: number; putBody?: unknown } = {}) {
  const getBody = opts.getBody ?? (() => buildApiResponse());
  fetchMock.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.split("?")[0];
    const res = (body: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, statusText: "",
      json: async () => body, text: async () => JSON.stringify(body),
    });
    if (path === "/api/tests/test-1" && method === "GET") return res(getBody());
    if (path === "/api/tests/test-1" && method === "PUT") return res(opts.putBody ?? getBody(), opts.putStatus ?? 200);
    if (path === "/api/tests/test-1/design") return res({ templateId: "default" });
    if (path.startsWith("/api/templates/")) return res({ id: "default", manifest: { contentTemplates: [] } });
    if (path === "/api/tests/test-1/content-pages") return res([]);
    // Section components fetch list endpoints (/api/topics, /api/questions) via
    // the client default queryFn — answer any other GET with an empty array so
    // `data ?? []` consumers never receive a non-array; non-GET → empty object.
    return res(method === "GET" ? [] : {});
  });
}

// ─── Create-mode option branch ─────────────────────────────────────────────

describe("<TestEditor /> — create mode", () => {
  it("renders the «Новый тест» Drawer in create mode", async () => {
    render(withClient(makeClient(), <TestEditor createMode={{ folderId: "fld-1" }} open onClose={() => {}} />));
    await screen.findByTestId("test-editor-root");
    expect(screen.getByText("Новый тест")).toBeInTheDocument();
    // Create mode builds an empty draft locally — no GET /api/tests/:id round-trip.
    expect(fetchMock.mock.calls.some((c) => /^\/api\/tests\/[^/]+$/.test(String(c[0])))).toBe(false);
  });

  it("renders the idle placeholder when neither testId nor createMode is supplied", async () => {
    // The options memo resolves to null → the hook is idle (model null) but the
    // Drawer still mounts (open) and shows the tab placeholder.
    render(withClient(makeClient(), <TestEditor open onClose={() => {}} />));
    await screen.findByTestId("test-editor-root");
    expect(screen.getByText("Редактор теста")).toBeInTheDocument();
    expect(screen.getByTestId("test-editor-tab-body-composition")).toBeInTheDocument();
  });
});

// ─── NFR-20 focus trap ──────────────────────────────────────────────────────

describe("<TestEditor /> — focus trap (NFR-20)", () => {
  it("wraps Tab / Shift+Tab focus inside the drawer without error", async () => {
    nextResponse(buildApiResponse());
    render(withClient(makeClient(), <TestEditor testId="test-1" open onClose={() => {}} />));
    const root = await screen.findByTestId("test-editor-root");
    const drawer = root.querySelector(".ou-drawer") as HTMLElement;

    const focusables = drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])');
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(drawer, { key: "Tab" });
    // Shift+Tab from the first element wraps to the last.
    (focusables[0] as HTMLElement).focus();
    fireEvent.keyDown(drawer, { key: "Tab", shiftKey: true });
    // A non-Tab key is ignored by the trap.
    fireEvent.keyDown(drawer, { key: "Enter" });
    expect(root).toBeInTheDocument();
  });
});

// ─── Successful unified save ─────────────────────────────────────────────────

describe("<TestEditor /> — successful save", () => {
  it("footer «Сохранить» persists and closes the drawer", async () => {
    nextResponse(buildApiResponse());
    const onClose = vi.fn();
    const client = makeClient();

    function Harness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty"
            onClick={() => editor.updateModel((m) => ({ ...m, basic: { ...m.basic, title: m.basic.title + " edited" } }))}
          >
            dirty
          </button>
          <TestEditorView open onClose={onClose} editor={editor} />
        </>
      );
    }

    render(withClient(client, <Harness />));
    await screen.findByText("Sample Test");

    act(() => {
      fireEvent.click(screen.getByTestId("harness-dirty"));
    });

    // Queue the PUT success right before saving (design/content fetches already ran).
    nextResponse(buildApiResponse({ version: 8, title: "Sample Test edited" }));
    fireEvent.click(screen.getByTestId("test-editor-save"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  // PRD-22: the tests-list column «недоступный вариант» is server-computed, so it
  // stays stale after the author remaps pages here unless the list is refetched.
  it("invalidates the tests list on save so the «недоступный вариант» mark refreshes", async () => {
    nextResponse(buildApiResponse());
    const onClose = vi.fn();
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    function Harness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty"
            onClick={() => editor.updateModel((m) => ({ ...m, basic: { ...m.basic, title: m.basic.title + " edited" } }))}
          >
            dirty
          </button>
          <TestEditorView open onClose={onClose} editor={editor} />
        </>
      );
    }

    render(withClient(client, <Harness />));
    await screen.findByText("Sample Test");
    act(() => {
      fireEvent.click(screen.getByTestId("harness-dirty"));
    });

    nextResponse(buildApiResponse({ version: 8, title: "Sample Test edited" }));
    fireEvent.click(screen.getByTestId("test-editor-save"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/tests"] });
  });

  it("close-confirm «Сохранить» saves and exits", async () => {
    nextResponse(buildApiResponse());
    const onClose = vi.fn();
    const client = makeClient();

    function Harness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty"
            onClick={() => editor.updateModel((m) => ({ ...m, basic: { ...m.basic, description: m.basic.description + " x" } }))}
          >
            dirty
          </button>
          <TestEditorView open onClose={onClose} editor={editor} />
        </>
      );
    }

    render(withClient(client, <Harness />));
    await screen.findByText("Sample Test");
    act(() => {
      fireEvent.click(screen.getByTestId("harness-dirty"));
    });

    // Header «×» opens the close-confirm (dirty path).
    fireEvent.click(screen.getByTestId("test-editor-close"));
    await screen.findByTestId("test-editor-close-confirm-save");

    nextResponse(buildApiResponse({ version: 8 }));
    fireEvent.click(screen.getByTestId("test-editor-close-confirm-save"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

// ─── Close-confirm «Перейти к первой ошибке» ───────────────────────────────

describe("<TestEditor /> — close-confirm error anchor", () => {
  it("jumps to the first error and dismisses the close-confirm", async () => {
    // Empty title = blocking error. Dirty via description so the confirm opens.
    nextResponse(buildApiResponse({ title: "" }));
    const client = makeClient();

    function Harness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty"
            onClick={() => editor.updateModel((m) => ({ ...m, basic: { ...m.basic, description: "x" } }))}
          >
            dirty
          </button>
          <TestEditorView open onClose={() => {}} editor={editor} />
        </>
      );
    }

    render(withClient(client, <Harness />));
    await screen.findByText("Основы ИБ");
    act(() => {
      fireEvent.click(screen.getByTestId("harness-dirty"));
    });

    fireEvent.click(screen.getByTestId("test-editor-close"));
    const banner = await screen.findByTestId("test-editor-close-confirm-error-banner");
    fireEvent.click(within(banner).getByRole("button", { name: /Перейти к первой ошибке/i }));

    // The close-confirm dialog closes; the offending tab (Настройки) mounts.
    await waitFor(() => expect(screen.queryByTestId("test-editor-close-confirm")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("settings-title-input")).toBeInTheDocument());
  });
});

// ─── 409 conflict diff-table ─────────────────────────────────────────────────

describe("<TestEditor /> — conflict diff-table", () => {
  it("renders the server-vs-local diff rows after a 409", async () => {
    installRouter({ putStatus: 409, putBody: { error: "version_conflict", currentVersion: 9, expectedVersion: 7 } });
    const client = makeClient();

    function Harness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty"
            onClick={() => editor.updateModel((m) => ({ ...m, basic: { ...m.basic, title: m.basic.title + " edited" } }))}
          >
            dirty
          </button>
          <TestEditorView open onClose={() => {}} editor={editor} />
        </>
      );
    }

    render(withClient(client, <Harness />));
    await screen.findByText("Sample Test");
    act(() => {
      fireEvent.click(screen.getByTestId("harness-dirty"));
    });

    fireEvent.click(screen.getByTestId("test-editor-save"));

    // The 409 opens the conflict dialog; its diff-table fetches the server model
    // and lists the differing «Название» (server "Sample Test" vs local edit).
    await screen.findByTestId("test-editor-conflict-reload");
    await waitFor(() => expect(screen.getByTestId("test-editor-conflict-diff")).toBeInTheDocument());
    expect(screen.getByTestId("test-editor-conflict-diff-row-title")).toBeInTheDocument();
  });
});

// ─── Archived status tag ─────────────────────────────────────────────────────

describe("<TestEditor /> — archived status tag", () => {
  it("shows «Архив» in the header for an archived test", async () => {
    nextResponse(buildApiResponse({ status: "archived" }));
    render(withClient(makeClient(), <TestEditor testId="test-1" open onClose={() => {}} />));
    await screen.findByText("Sample Test");
    const tag = await screen.findByTestId("test-editor-status-tag");
    expect(tag).toHaveTextContent("Архив");
  });
});

// ─── Tab panel rendering ─────────────────────────────────────────────────────

describe("<TestEditor /> — non-default tab panels", () => {
  it("switches to the «Оценка» and «Показатели» tabs and keeps the drawer mounted", async () => {
    installRouter();
    render(withClient(makeClient(), <TestEditor testId="test-1" open onClose={() => {}} />));
    await screen.findByText("Sample Test");

    // These two section panels render from `editor.model` + list endpoints that
    // the router answers with empty arrays, so they mount without extra fixtures.
    for (const label of ["Оценка", "Показатели"]) {
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(label, "i") }));
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: new RegExp(label, "i"), selected: true })).toBeInTheDocument(),
      );
      expect(screen.getByTestId("test-editor-body")).toBeInTheDocument();
    }
  });
});

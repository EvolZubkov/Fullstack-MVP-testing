/**
 * @module features/tests/editor/__tests__/test-editor.branches.test
 * @description Branch-coverage tests for the wide Drawer test editor.
 * Complements {@link test-editor.test} and {@link test-editor.coverage.test} by
 * driving the still-uncovered branches: the ConflictDialog resolution actions
 * («Обновить данные» reload / «Сохранить поверх» overwrite / «Отмена» dismiss),
 * the conflict diff-table empty + load-error states, the `saveAll` design-dirty
 * branch (design draft persisted through the unified footer save), the status-tag
 * error/dirty derivations, the changes-popover structural line + close button,
 * the close-confirm «Продолжить редактирование», the composition-error anchor and
 * the «Структура» tab panel.
 *
 * Harness copied from {@link test-editor.coverage.test}.
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
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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

function nextResponse(body: unknown, status = 200) {
  fetchMock.mockImplementationOnce(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

function res(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/**
 * URL router (mirrors the coverage file) so the design / content-pages hooks'
 * interleaved fetches resolve deterministically. `putStatus` forces the top-level
 * PUT response code; `design` / `template` seed the design-settings round-trip.
 */
function installRouter(opts: {
  getBody?: () => Record<string, unknown>;
  putStatus?: number;
  putBody?: unknown;
  design?: unknown;
  template?: unknown;
} = {}) {
  const getBody = opts.getBody ?? (() => buildApiResponse());
  fetchMock.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.split("?")[0];
    if (path === "/api/tests/test-1" && method === "GET") return res(getBody());
    if (path === "/api/tests/test-1" && method === "PUT") return res(opts.putBody ?? getBody(), opts.putStatus ?? 200);
    if (path === "/api/tests/test-1/design") return res(opts.design ?? { templateId: "default" });
    if (path.startsWith("/api/templates/")) {
      return res(
        opts.template ?? { id: "default", name: "Default", version: "1", templateApiVersion: "1", isBuiltin: true, isActive: true, manifest: { id: "default", name: "Default", version: "1", templateApiVersion: "1", params: [] }, previewPath: null },
      );
    }
    if (path === "/api/tests/test-1/content-pages") return res([]);
    return res(method === "GET" ? [] : {});
  });
}

// ─── Conflict dialog resolution actions ──────────────────────────────────────

describe("<TestEditor /> — conflict resolution", () => {
  function DirtyHarness({ onClose = () => {} }: { onClose?: () => void }) {
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

  it("«Обновить данные» reloads from the server and closes the conflict dialog", async () => {
    installRouter({ putStatus: 409, putBody: { error: "version_conflict", currentVersion: 9, expectedVersion: 7 } });
    render(withClient(makeClient(), <DirtyHarness />));
    await screen.findByText("Sample Test");
    act(() => fireEvent.click(screen.getByTestId("harness-dirty")));
    fireEvent.click(screen.getByTestId("test-editor-save"));

    await screen.findByTestId("test-editor-conflict-reload");
    fireEvent.click(screen.getByTestId("test-editor-conflict-reload"));
    // resolveConflictReload clears the conflict → dialog unmounts.
    await waitFor(() => expect(screen.queryByTestId("test-editor-conflict")).toBeNull());
  });

  it("«Сохранить поверх» re-saves against the new version and closes the dialog", async () => {
    // First PUT 409, second PUT (overwrite) succeeds → conflict resolves.
    let putCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.split("?")[0];
      if (path === "/api/tests/test-1" && method === "GET") return res(buildApiResponse());
      if (path === "/api/tests/test-1" && method === "PUT") {
        putCount += 1;
        return putCount === 1
          ? res({ error: "version_conflict", currentVersion: 9, expectedVersion: 7 }, 409)
          : res(buildApiResponse({ version: 9 }));
      }
      if (path === "/api/tests/test-1/design") return res({ templateId: "default" });
      if (path.startsWith("/api/templates/")) return res({ id: "default", manifest: { params: [] } });
      if (path === "/api/tests/test-1/content-pages") return res([]);
      return res(method === "GET" ? [] : {});
    });

    render(withClient(makeClient(), <DirtyHarness />));
    await screen.findByText("Sample Test");
    act(() => fireEvent.click(screen.getByTestId("harness-dirty")));
    fireEvent.click(screen.getByTestId("test-editor-save"));

    await screen.findByTestId("test-editor-conflict-overwrite");
    fireEvent.click(screen.getByTestId("test-editor-conflict-overwrite"));
    await waitFor(() => expect(screen.queryByTestId("test-editor-conflict")).toBeNull());
    expect(putCount).toBe(2);
  });

  it("«Отмена» dismisses the conflict dialog without retrying", async () => {
    installRouter({ putStatus: 409, putBody: { error: "version_conflict", currentVersion: 9, expectedVersion: 7 } });
    render(withClient(makeClient(), <DirtyHarness />));
    await screen.findByText("Sample Test");
    act(() => fireEvent.click(screen.getByTestId("harness-dirty")));
    fireEvent.click(screen.getByTestId("test-editor-save"));

    await screen.findByTestId("test-editor-conflict-cancel");
    fireEvent.click(screen.getByTestId("test-editor-conflict-cancel"));
    await waitFor(() => expect(screen.queryByTestId("test-editor-conflict")).toBeNull());
    // The editor is still open (dismiss keeps the dirty draft).
    expect(screen.getByTestId("test-editor-root")).toBeInTheDocument();
  });

  it("renders the «no comparable fields» diff message when only an uncompared field changed", async () => {
    // telemetryEnabled is dirtied but is NOT in the conflict diff candidate set,
    // so the diff-table produces zero rows → the empty message renders.
    installRouter({ putStatus: 409, putBody: { error: "version_conflict", currentVersion: 9, expectedVersion: 7 } });

    function TelemetryHarness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty"
            onClick={() => editor.updateModel((m) => ({ ...m, basic: { ...m.basic, telemetryEnabled: !m.basic.telemetryEnabled } }))}
          >
            dirty
          </button>
          <TestEditorView open onClose={() => {}} editor={editor} />
        </>
      );
    }

    render(withClient(makeClient(), <TelemetryHarness />));
    await screen.findByText("Sample Test");
    act(() => fireEvent.click(screen.getByTestId("harness-dirty")));
    fireEvent.click(screen.getByTestId("test-editor-save"));

    await screen.findByTestId("test-editor-conflict-reload");
    await waitFor(() => expect(screen.getByTestId("test-editor-conflict-diff-empty")).toBeInTheDocument());
  });

  it("shows the diff-table load error when the server comparison fetch fails", async () => {
    // First GET (model load) succeeds; the diff-table's later GET to the same
    // path fails → the diff-table surfaces its error banner.
    let getCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.split("?")[0];
      if (path === "/api/tests/test-1" && method === "GET") {
        getCount += 1;
        return getCount === 1 ? res(buildApiResponse()) : res({ error: "boom" }, 500);
      }
      if (path === "/api/tests/test-1" && method === "PUT") return res({ error: "version_conflict", currentVersion: 9, expectedVersion: 7 }, 409);
      if (path === "/api/tests/test-1/design") return res({ templateId: "default" });
      if (path.startsWith("/api/templates/")) return res({ id: "default", manifest: { params: [] } });
      if (path === "/api/tests/test-1/content-pages") return res([]);
      return res(method === "GET" ? [] : {});
    });

    render(withClient(makeClient(), <DirtyHarness />));
    await screen.findByText("Sample Test");
    act(() => fireEvent.click(screen.getByTestId("harness-dirty")));
    fireEvent.click(screen.getByTestId("test-editor-save"));

    await screen.findByTestId("test-editor-conflict-reload");
    await waitFor(() => expect(screen.getByTestId("test-editor-conflict-diff-error")).toBeInTheDocument());
  });
});

// ─── saveAll: design draft persisted through the unified footer ───────────────

describe("<TestEditor /> — unified save persists a dirty design draft", () => {
  it("footer «Сохранить» commits the design draft (design.isDirty branch)", async () => {
    const onClose = vi.fn();
    let designPut = false;
    fetchMock.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.split("?")[0];
      if (path === "/api/tests/test-1" && method === "GET") return res(buildApiResponse());
      if (path === "/api/tests/test-1/design" && method === "GET") return res({ templateId: "default", params: { primaryColor: "#fff" } });
      if (path === "/api/tests/test-1/design" && method === "PUT") { designPut = true; return res({ templateId: "default", params: {} }); }
      if (path.startsWith("/api/templates/")) return res({ id: "default", name: "Default", version: "1", templateApiVersion: "1", isBuiltin: true, isActive: true, manifest: { id: "default", name: "Default", version: "1", templateApiVersion: "1", params: [] }, previewPath: null });
      if (path === "/api/tests/test-1/content-pages") return res([]);
      return res(method === "GET" ? [] : {});
    });

    render(withClient(makeClient(), <TestEditor testId="test-1" open onClose={onClose} />));
    await screen.findByText("Sample Test");

    // Open the «Оформление» tab and clear the persisted params → design is dirty.
    fireEvent.click(screen.getByRole("tab", { name: /Оформление/i }));
    const reset = await screen.findByTestId("design-template-reset");
    fireEvent.click(reset);

    // The footer save now covers ONLY the design draft (editor draft untouched).
    await waitFor(() => expect(screen.getByTestId("test-editor-save")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("test-editor-save"));

    await waitFor(() => expect(designPut).toBe(true));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

// ─── Status-tag derivations ───────────────────────────────────────────────────

describe("<TestEditor /> — header status tag", () => {
  it("shows «Есть ошибки» when the model has blocking validation errors", async () => {
    nextResponse(buildApiResponse({ title: "" }));
    render(withClient(makeClient(), <TestEditor testId="test-1" open onClose={() => {}} />));
    await screen.findByText("Основы ИБ");
    await waitFor(() =>
      expect(screen.getByTestId("test-editor-status-tag")).toHaveTextContent("Есть ошибки"),
    );
  });

  it("shows «Изменено» when the draft is dirty but valid", async () => {
    nextResponse(buildApiResponse());

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
          <TestEditorView open onClose={() => {}} editor={editor} />
        </>
      );
    }

    render(withClient(makeClient(), <Harness />));
    await screen.findByText("Sample Test");
    act(() => fireEvent.click(screen.getByTestId("harness-dirty")));
    await waitFor(() =>
      expect(screen.getByTestId("test-editor-status-tag")).toHaveTextContent("Изменено"),
    );
  });
});

// ─── Changes-popover: structural line + close ────────────────────────────────

describe("<TestEditor /> — changes-popover", () => {
  it("shows the «Структурные изменения» line for a dirty composition and closes on ×", async () => {
    nextResponse(buildApiResponse());

    function Harness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty-sections"
            onClick={() =>
              editor.updateModel((m) => ({
                ...m,
                sections: [
                  ...m.sections,
                  {
                    topicId: "topic-2",
                    topicName: "Второй",
                    maxQuestions: 5,
                    drawCount: 1,
                    drawAll: false,
                    required: true,
                    timeLimit: { source: "inherit_test" },
                    feedback: { format: "plain", text: "" },
                    feedbackLinks: [],
                    feedbackAssets: [],
                    feedbackEvents: [],
                    defaultPoints: null,
                  },
                ],
              }))
            }
          >
            dirty
          </button>
          <TestEditorView open onClose={() => {}} editor={editor} />
        </>
      );
    }

    render(withClient(makeClient(), <Harness />));
    await screen.findByText("Sample Test");
    act(() => fireEvent.click(screen.getByTestId("harness-dirty-sections")));

    fireEvent.click(screen.getByTestId("test-editor-show-changes"));
    const popover = await screen.findByTestId("test-editor-changes-popover");
    // Scope to the «Состав» group — a structural change can dirty more than one
    // tab, so match the composition group's own «Структурные изменения» line.
    const group = within(popover).getByTestId("test-editor-changes-group-composition");
    expect(within(group).getByText(/Структурные изменения/i)).toBeInTheDocument();

    fireEvent.click(within(popover).getByRole("button", { name: "Закрыть список изменений" }));
    await waitFor(() => expect(screen.queryByTestId("test-editor-changes-popover")).toBeNull());
  });
});

// ─── Close-confirm «Продолжить редактирование» ───────────────────────────────

describe("<TestEditor /> — close-confirm cancel", () => {
  it("«Продолжить редактирование» keeps the drawer open", async () => {
    nextResponse(buildApiResponse());

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
          <TestEditorView open onClose={() => {}} editor={editor} />
        </>
      );
    }

    render(withClient(makeClient(), <Harness />));
    await screen.findByText("Sample Test");
    act(() => fireEvent.click(screen.getByTestId("harness-dirty")));

    fireEvent.click(screen.getByTestId("test-editor-close"));
    const cancel = await screen.findByTestId("test-editor-close-confirm-cancel");
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Есть несохранённые изменения/i })).toBeNull(),
    );
    expect(screen.getByTestId("test-editor-root")).toBeInTheDocument();
  });
});

// ─── Composition-error anchor + «Структура» tab ──────────────────────────────

describe("<TestEditor /> — error anchor to composition + structure tab", () => {
  it("anchors a sections error to the «Состав» tab (tabForField composition branch)", async () => {
    // No topics → a blocking `sections` error whose anchor lives in Состав.
    nextResponse(buildApiResponse({ sections: [] }));
    render(withClient(makeClient(), <TestEditor testId="test-1" open onClose={() => {}} />));

    await screen.findByTestId("test-editor-error-summary");
    fireEvent.click(screen.getByRole("button", { name: /Перейти к ошибкам/i }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Состав/i, selected: true })).toBeInTheDocument(),
    );
  });

  it("renders the «Структура» tab panel", async () => {
    installRouter();
    render(withClient(makeClient(), <TestEditor testId="test-1" open onClose={() => {}} />));
    await screen.findByText("Sample Test");

    fireEvent.click(screen.getByRole("tab", { name: /Структура/i }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Структура/i, selected: true })).toBeInTheDocument(),
    );
    expect(screen.getByTestId("test-editor-body")).toBeInTheDocument();
  });
});

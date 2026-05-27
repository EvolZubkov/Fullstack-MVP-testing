/**
 * @module features/tests/editor/__tests__/test-editor.test
 * @description Component + hook tests for the wide Drawer test editor.
 *
 * Coverage:
 *   - DS Drawer markup (FR-43): `ou-drawer-root`, `ou-drawer--xl --right`,
 *     `ou-tabs--underline --m`, four tab triggers, `ou-drawer__foot` with a
 *     single primary `Сохранить` action.
 *   - NFR-19: focus the first interactive element on open.
 *   - FR-05: closing while dirty opens the FR-05 confirmation dialog; closing
 *     while clean calls `onClose` directly.
 *   - FR-25k: a 409 response surfaces the optimistic conflict dialog.
 *   - 422 `required_fields_missing`: the hook exposes the violations so the UI
 *     can anchor to the missing field.
 *
 * Strategy:
 *   - The hook is driven directly via `renderHook` for state mutation paths
 *     (the domain Состав section is not yet implemented, so the UI lacks an
 *     editable input that would dirty the draft).
 *   - The Drawer component is driven by combining the hook into a tiny
 *     harness so we can call `updateModel` from a test button.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { TestEditor, TestEditorView } from "../test-editor";
import { useTestEditor } from "../use-test-editor";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function buildApiResponse(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
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
      {
        id: "section-1",
        topicId: "topic-1",
        topicName: "Основы ИБ",
        drawCount: 5,
        required: true,
        maxQuestions: 10,
      },
    ],
    adaptiveSettings: null,
    ...overrides,
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function withClient(client: QueryClient, ui: JSX.Element) {
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

// ─── Component tests ──────────────────────────────────────────────────────────

describe("<TestEditor /> DOM and focus", () => {
  it("renders the DS Drawer with the four tabs and a single Сохранить action", async () => {
    nextResponse(buildApiResponse());
    const client = makeClient();
    render(
      withClient(
        client,
        <TestEditor testId="test-1" open onClose={() => {}} />,
      ),
    );

    const root = await screen.findByTestId("test-editor-root");
    expect(root.classList.contains("ou-drawer-root")).toBe(true);
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-modal")).toBe("true");
    expect(root.querySelector(".ou-drawer__backdrop")).not.toBeNull();
    expect(
      root.querySelector(".ou-drawer.ou-drawer--xl.ou-drawer--right"),
    ).not.toBeNull();
    expect(root.querySelector(".ou-tabs.ou-tabs--underline.ou-tabs--m")).not.toBeNull();
    expect(root.querySelector(".ou-drawer__foot")).not.toBeNull();

    for (const label of ["Состав", "Настройки", "Оформление", "Структура"]) {
      expect(screen.getByRole("tab", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }

    await waitFor(() => expect(screen.getByText("Sample Test")).toBeInTheDocument());

    const save = screen.getByTestId("test-editor-save");
    expect(save.getAttribute("aria-disabled")).toBe("true");
  });

  it("focuses the first interactive tab on open (NFR-19)", async () => {
    nextResponse(buildApiResponse());
    const client = makeClient();
    render(
      withClient(
        client,
        <TestEditor testId="test-1" open onClose={() => {}} />,
      ),
    );

    const firstTab = await screen.findByRole("tab", { name: /Состав/i });
    await waitFor(() => expect(document.activeElement).toBe(firstTab));
  });

  it("closes immediately when the editor is clean", async () => {
    nextResponse(buildApiResponse());
    const onClose = vi.fn();
    const client = makeClient();
    render(
      withClient(client, <TestEditor testId="test-1" open onClose={onClose} />),
    );

    await screen.findByText("Sample Test");
    fireEvent.click(screen.getByTestId("test-editor-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: /Есть несохранённые изменения/i })).toBeNull();
  });

  it("opens the FR-05 confirmation dialog when closing with dirty changes", async () => {
    nextResponse(buildApiResponse());
    const onClose = vi.fn();
    const client = makeClient();

    function Harness() {
      const [open, setOpen] = useState(true);
      const editor = useTestEditor(open ? { mode: "edit", testId: "test-1" } : null);
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty"
            aria-label="harness: dirty the draft"
            onClick={() =>
              editor.updateModel((m) => ({
                ...m,
                basic: { ...m.basic, title: m.basic.title + " edited" },
              }))
            }
          >
            dirty
          </button>
          <TestEditorView
            open={open}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            editor={editor}
          />
        </>
      );
    }

    render(withClient(client, <Harness />));
    await screen.findByText("Sample Test");

    act(() => {
      fireEvent.click(screen.getByTestId("harness-dirty"));
    });

    fireEvent.click(screen.getByTestId("test-editor-close"));

    expect(screen.getByRole("dialog", { name: /Есть несохранённые изменения/i })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("test-editor-close-confirm-discard"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─── FR-20c: error summary + anchor navigation ────────────────────────────────

describe("<TestEditor /> FR-20c — error summary anchor navigation", () => {
  it("surfaces the summary and focuses the offending field via «Перейти к ошибкам»", async () => {
    // Empty title is a blocking error (FR-11); the field lives in the Настройки
    // tab while the editor opens on Состав, so the anchor must switch tabs.
    nextResponse(buildApiResponse({ title: "" }));
    const client = makeClient();
    render(withClient(client, <TestEditor testId="test-1" open onClose={() => {}} />));

    await screen.findByTestId("test-editor-error-summary");

    fireEvent.click(screen.getByRole("button", { name: /Перейти к ошибкам/i }));

    // The Настройки tab activates (so the title input mounts) and gets focus.
    await waitFor(() => {
      const input = screen.getByTestId("settings-title-input");
      expect(input).toHaveFocus();
      expect(input.closest('[data-field="basic.title"]')).not.toBeNull();
    });
  });

  it("does not render the error summary when the model is valid", async () => {
    nextResponse(buildApiResponse());
    const client = makeClient();
    render(withClient(client, <TestEditor testId="test-1" open onClose={() => {}} />));

    await screen.findByText("Sample Test");
    expect(screen.queryByTestId("test-editor-error-summary")).toBeNull();
  });
});

// ─── Hook-level conflict / 422 tests ──────────────────────────────────────────

describe("useTestEditor — optimistic conflict and required-fields", () => {
  it("returns a structured 409 conflict via the `conflict` field (FR-25k)", async () => {
    nextResponse(buildApiResponse());
    nextResponse(
      { error: "version_conflict", currentVersion: 9, expectedVersion: 7 },
      409,
    );

    const client = makeClient();
    const { result } = renderHook(() => useTestEditor({ mode: "edit", testId: "test-1" }), {
      wrapper: ({ children }) => withClient(client, <>{children}</>),
    });

    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: m.basic.title + " edited" },
      }));
    });
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.conflict).toEqual({
      currentVersion: 9,
      expectedVersion: 7,
    });
  });

  it("exposes 422 violations on `requiredFieldsMissing`", async () => {
    nextResponse(buildApiResponse());
    nextResponse(
      {
        error: "required_fields_missing",
        fields: [
          { pageId: "page-1", templateKey: "intro", fieldName: "title" },
        ],
      },
      422,
    );

    const client = makeClient();
    const { result } = renderHook(() => useTestEditor({ mode: "edit", testId: "test-1" }), {
      wrapper: ({ children }) => withClient(client, <>{children}</>),
    });

    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: m.basic.title + " edited" },
      }));
    });

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.requiredFieldsMissing).toEqual([
      { pageId: "page-1", templateKey: "intro", fieldName: "title" },
    ]);
  });
});

// ─── Create mode ──────────────────────────────────────────────────────────────

describe("useTestEditor — create mode", () => {
  it("initialises an empty draft without fetching", async () => {
    const client = makeClient();
    const { result } = renderHook(
      () => useTestEditor({ mode: "create", folderId: "fld-ib" }),
      { wrapper: ({ children }) => withClient(client, <>{children}</>) },
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());
    expect(result.current.mode).toBe("create");
    expect(result.current.model?.basic.title).toBe("");
    expect(result.current.model?.folderId).toBe("fld-ib");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to /api/tests on save and surfaces the new id via createdId", async () => {
    nextResponse(
      { ...buildApiResponse({ id: "te-new", title: "Свежий", folderId: "fld-ib" }) },
      201,
    );

    const client = makeClient();
    const { result } = renderHook(
      () => useTestEditor({ mode: "create", folderId: "fld-ib" }),
      { wrapper: ({ children }) => withClient(client, <>{children}</>) },
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());

    // Дoт title + одна секция, чтобы validation пропустила save.
    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: "Свежий" },
        sections: [
          {
            topicId: "top-1",
            topicName: "Topic",
            maxQuestions: 10,
            drawCount: 1,
            required: true,
            timeLimit: { source: "inherit_test" },
            feedback: { format: "plain", text: "" },
            feedbackLinks: [],
            feedbackAssets: [],
          },
        ],
      }));
    });

    await act(async () => {
      await result.current.save();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tests",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.createdId).toBe("te-new");
  });
});

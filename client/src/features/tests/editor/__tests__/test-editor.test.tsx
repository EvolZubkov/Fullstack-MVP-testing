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
import type * as React from "react";
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

  it("wires the body as the active tab's panel (a11y: tab aria-controls resolves)", async () => {
    // `Tabs` runs with `hidePanel`, so the body div is the panel. It must carry
    // role=tabpanel + id=panel-<activeKey> + aria-labelledby=tab-<activeKey> so
    // the tab's `aria-controls` resolves (regression for axe aria-valid-attr-value).
    nextResponse(buildApiResponse());
    const client = makeClient();
    render(
      withClient(client, <TestEditor testId="test-1" open onClose={() => {}} />),
    );

    await screen.findByTestId("test-editor-root");
    const body = screen.getByTestId("test-editor-body");
    const activeTab = screen.getByRole("tab", { selected: true });

    expect(body.getAttribute("role")).toBe("tabpanel");
    expect(body.id).toBe(activeTab.getAttribute("aria-controls"));
    expect(body.getAttribute("aria-labelledby")).toBe(activeTab.id);
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

// ─── PRD-15 block D: per-question scoring overrides are draft-managed ───────────

describe("useTestEditor — question scoring overrides (PRD-15 block D)", () => {
  const withOverride = () =>
    buildApiResponse({
      questionScoring: [
        {
          id: "ov1", testId: "test-1", questionId: "q1",
          points: 3, scoringJson: null, difficulty: null, pinnedContentHash: "h1",
        },
      ],
    });

  it("seeds overrides into the draft and reconciles a change with a PUT on save", async () => {
    nextResponse(withOverride());          // initial GET seeds the draft
    nextResponse(buildApiResponse());      // putTest PUT
    nextResponse({ id: "ov1" });           // question-scoring upsert PUT
    nextResponse(withOverride());          // fetchTest refresh (overrides changed)

    const client = makeClient();
    const { result } = renderHook(() => useTestEditor({ mode: "edit", testId: "test-1" }), {
      wrapper: ({ children }) => withClient(client, <>{children}</>),
    });
    await waitFor(() => expect(result.current.model).not.toBeNull());
    expect(result.current.model?.scoring.questionOverrides).toHaveLength(1);

    // Mirror what the «Оценка» tab does on «Применить» — mutate the draft only.
    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        scoring: {
          ...m.scoring,
          questionOverrides: m.scoring.questionOverrides.map((o) =>
            o.questionId === "q1" ? { ...o, points: 5 } : o,
          ),
        },
      }));
    });
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      await result.current.save();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tests/test-1/question-scoring/q1",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("does not touch the scoring endpoint when overrides are unchanged", async () => {
    nextResponse(withOverride());          // initial GET
    nextResponse(buildApiResponse());      // putTest PUT (only the title changed)

    const client = makeClient();
    const { result } = renderHook(() => useTestEditor({ mode: "edit", testId: "test-1" }), {
      wrapper: ({ children }) => withClient(client, <>{children}</>),
    });
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({ ...m, basic: { ...m.basic, title: m.basic.title + " edited" } }));
    });

    await act(async () => {
      await result.current.save();
    });

    const touchedScoring = fetchMock.mock.calls.some((c) =>
      String(c[0]).includes("/question-scoring/"),
    );
    expect(touchedScoring).toBe(false);
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

// ─── Gap 4: Create adaptive happy path ──────────────────────────────────────────

describe("useTestEditor — create adaptive mode (Gap 4)", () => {
  it("creates a test in adaptive mode with levels and links", async () => {
    // API response with adaptive settings as array (topics directly).
    nextResponse(
      {
        ...buildApiResponse({
          id: "te-adaptive-new",
          mode: "adaptive",
          title: "Adaptive Test",
          folderId: "fld-ib",
          adaptiveSettings: [
            {
              topicId: "topic-1",
              topicName: "Topic A",
              failureFeedback: null,
              levels: [
                {
                  levelIndex: 0,
                  levelName: "Easy",
                  minDifficulty: 0,
                  maxDifficulty: 3,
                  questionsCount: 5,
                  passThreshold: 60,
                  passThresholdType: "percent",
                  links: [
                    { id: "link-1", title: "More info", url: "https://example.com" },
                  ],
                },
              ],
            },
          ],
        }),
      },
      201,
    );

    const client = makeClient();
    const { result } = renderHook(
      () => useTestEditor({ mode: "create", folderId: "fld-ib" }),
      { wrapper: ({ children }) => withClient(client, <>{children}</>) },
    );

    await waitFor(() => expect(result.current.model).not.toBeNull());

    // Set up adaptive mode with title, sections, and levels.
    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        mode: "adaptive",
        basic: { ...m.basic, title: "Adaptive Test" },
        sections: [
          {
            topicId: "topic-1",
            topicName: "Topic A",
            maxQuestions: 10,
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
        adaptive: {
          showDifficultyLevel: true,
          testSettings: { showDifficultyLevel: true },
          topics: [
            {
              topicId: "topic-1",
              topicName: "Topic A",
              failureFeedback: null,
              levels: [
                {
                  levelIndex: 0,
                  levelName: "Easy",
                  minDifficulty: 0,
                  maxDifficulty: 3,
                  questionsCount: 5,
                  passThreshold: 60,
                  passThresholdType: "percent",
                  links: [{ title: "More info", url: "https://example.com" }],
                },
              ],
              enabled: true,
            },
          ],
        },
      }));
    });

    await act(async () => {
      await result.current.save();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tests",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.createdId).toBe("te-adaptive-new");
  });

  it("edits an existing adaptive test with saved levels and links loaded from API", async () => {
    // Load an existing adaptive test with saved levels.
    // NOTE: adaptiveSettings in the API response is an array of topics directly.
    nextResponse(buildApiResponse({
      id: "test-adaptive-1",
      mode: "adaptive",
      title: "Existing Adaptive",
      adaptiveSettings: [
        {
          topicId: "topic-1",
          topicName: "Topic A",
          failureFeedback: null,
          levels: [
            {
              id: "level-1",
              levelIndex: 0,
              levelName: "Easy",
              minDifficulty: 0,
              maxDifficulty: 3,
              questionsCount: 5,
              passThreshold: 60,
              passThresholdType: "percent",
              links: [
                { id: "link-1", title: "Resources", url: "https://resources.example.com" },
              ],
            },
            {
              id: "level-2",
              levelIndex: 1,
              levelName: "Hard",
              minDifficulty: 7,
              maxDifficulty: 10,
              questionsCount: 8,
              passThreshold: 75,
              passThresholdType: "percent",
              links: [],
            },
          ],
        },
      ],
      sections: [
        {
          id: "section-1",
          topicId: "topic-1",
          topicName: "Topic A",
          drawCount: 5,
          required: true,
          maxQuestions: 10,
        },
      ],
    }));

    const client = makeClient();
    const { result } = renderHook(() => useTestEditor({ mode: "edit", testId: "test-adaptive-1" }), {
      wrapper: ({ children }) => withClient(client, <>{children}</>) },
    );

    await waitFor(() => expect(result.current.model).not.toBeNull());

    // Verify the model was loaded with adaptive settings.
    expect(result.current.model?.mode).toBe("adaptive");
    expect(result.current.model?.adaptive.topics.length).toBeGreaterThan(0);
    const firstTopic = result.current.model?.adaptive.topics[0];
    expect(firstTopic?.levels.length).toBe(2);
    expect(firstTopic?.levels[0].links.length).toBe(1);
    expect(firstTopic?.levels[0].links[0].title).toBe("Resources");
  });
});

// ─── Gap 5: Close-confirmation dialog with blocking errors disables Save button ──

describe("<TestEditor /> — close-confirmation with blocking errors (Gap 5)", () => {
  it("disables «Сохранить» in the close-confirm dialog while there are blocking errors", async () => {
    // Empty title is a blocking error. Dirty the draft via the DESCRIPTION so the
    // title stays invalid; closing then opens the confirm dialog with Save disabled.
    nextResponse(buildApiResponse({ title: "" }));
    const client = makeClient();

    function Harness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty"
            onClick={() =>
              editor.updateModel((m) => ({
                ...m,
                basic: { ...m.basic, description: m.basic.description + " edited" },
              }))
            }
          >
            dirty
          </button>
          <TestEditorView open onClose={() => {}} editor={editor} />
        </>
      );
    }

    render(withClient(client, <Harness />));
    // Title is empty, so wait for a loaded-model marker (the default section topic).
    await screen.findByText("Основы ИБ");

    act(() => {
      fireEvent.click(screen.getByTestId("harness-dirty"));
    });

    fireEvent.click(screen.getByTestId("test-editor-close"));

    // The confirm dialog opens (dirty); validation is debounced, so poll until
    // the error gate disables its «Сохранить» button.
    await waitFor(() =>
      expect(screen.getByTestId("test-editor-close-confirm-save")).toBeDisabled(),
    );
  });
});

// ─── Footer «Отменить»: discard + close, no save prompt ───────────────────────

describe("<TestEditor /> — footer «Отменить» discards and closes without a save prompt", () => {
  it("calls onClose and shows NO «Есть несохранённые изменения» dialog when dirty", async () => {
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
            onClick={() =>
              editor.updateModel((m) => ({
                ...m,
                basic: { ...m.basic, description: m.basic.description + " edited" },
              }))
            }
          >
            dirty
          </button>
          <TestEditorView open onClose={onClose} editor={editor} />
        </>
      );
    }

    render(withClient(client, <Harness />));
    await screen.findByText("Основы ИБ");

    act(() => {
      fireEvent.click(screen.getByTestId("harness-dirty"));
    });

    // Footer secondary button is «Отменить» when dirty. It must discard + close
    // immediately — the save-confirm dialog is reserved for the ambiguous header «×».
    const cancel = await screen.findByTestId("test-editor-cancel");
    expect(cancel).toHaveTextContent("Отменить");
    fireEvent.click(cancel);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", { name: /Есть несохранённые изменения/i }),
    ).toBeNull();
  });
});

// ─── Read-only footer when test is published (G19, wf s-readonly) ─────────────

describe("<TestEditor /> — published test renders single «Закрыть» footer", () => {
  it("hides Save / Cancel / «Показать изменения» when status === 'published'", async () => {
    // s-readonly per docs/wireframes/approved/prd7-structure-linear-by-topics.html
    // (footer line 847-849): footer collapses to a single ghost «Закрыть» button.
    nextResponse(buildApiResponse({ status: "published" }));
    const client = makeClient();
    render(
      withClient(
        client,
        <TestEditor testId="test-1" open onClose={() => {}} />,
      ),
    );

    await screen.findByText("Sample Test");

    const foot = await screen.findByTestId("test-editor-foot");
    expect(foot.getAttribute("data-state")).toBe("readonly");
    expect(screen.queryByTestId("test-editor-save")).toBeNull();
    expect(screen.queryByTestId("test-editor-show-changes")).toBeNull();

    const closeBtn = screen.getByTestId("test-editor-cancel");
    expect(closeBtn).toHaveTextContent("Закрыть");
  });

  it("closes immediately without confirm when published and clean", async () => {
    nextResponse(buildApiResponse({ status: "published" }));
    const onClose = vi.fn();
    const client = makeClient();
    render(
      withClient(client, <TestEditor testId="test-1" open onClose={onClose} />),
    );

    await screen.findByText("Sample Test");

    fireEvent.click(screen.getByTestId("test-editor-cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", { name: /Есть несохранённые изменения/i }),
    ).toBeNull();
  });
});

// ─── Gap 6: API save error keeps editor open and shows error banner ────────────

describe("<TestEditor /> — API save error (Gap 6)", () => {
  it("keeps the editor open and shows saveError banner on 500", async () => {
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

    // Dirty the draft.
    act(() => {
      fireEvent.click(screen.getByTestId("harness-dirty"));
    });

    // Queue a 500 error response for the save.
    nextResponse({ error: "Internal server error" }, 500);

    // Attempt to save.
    fireEvent.click(screen.getByTestId("test-editor-save"));

    // Verify the error banner appears.
    await waitFor(() => {
      expect(screen.getByTestId("test-editor-save-error")).toBeInTheDocument();
    });

    // Verify the editor is still open (onClose was NOT called).
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─── Gap 7: Conflict dialog at component level with reload and overwrite buttons ─

describe("<TestEditor /> — optimistic conflict dialog (Gap 7)", () => {
  it("renders the conflict dialog with «Обновить данные» / «Сохранить поверх» on a 409", async () => {
    nextResponse(buildApiResponse());
    const client = makeClient();

    function Harness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty"
            onClick={() =>
              editor.updateModel((m) => ({
                ...m,
                basic: { ...m.basic, title: m.basic.title + " edited" },
              }))
            }
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

    // The save PUT returns a version conflict; the Drawer must surface the dialog.
    nextResponse({ error: "version_conflict", currentVersion: 9, expectedVersion: 7 }, 409);
    fireEvent.click(screen.getByTestId("test-editor-save"));

    // The 409 surfaces ConflictDialog with both resolution actions.
    await screen.findByTestId("test-editor-conflict-reload");
    expect(screen.getByTestId("test-editor-conflict-overwrite")).toBeInTheDocument();
  });
});

// ─── Gap 9: Validation is debounced ~300ms (NFR-18) ──────────────────────────────

describe("useTestEditor — debounced validation (Gap 9, NFR-18)", () => {
  it("debounces validation for ~300ms after model updates", async () => {
    nextResponse(buildApiResponse());

    const client = makeClient();
    const { result } = renderHook(() => useTestEditor({ mode: "edit", testId: "test-1" }), {
      wrapper: ({ children }) => withClient(client, <>{children}</>) },
    );

    await waitFor(() => expect(result.current.model).not.toBeNull());

    // Initial validation should have no errors (valid model).
    expect(result.current.validation.errors.length).toBe(0);

    // Update the model: empty the title (causes a blocking error).
    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: "" },
      }));
    });

    // Immediately after the update, validation should still be stale.
    // The debounce delay is 300ms, so wait less than that to see no errors yet.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(result.current.validation.errors.length).toBe(0);

    // Now wait for the debounce to fire (300ms from the last update).
    await waitFor(
      () => {
        expect(result.current.validation.errors.length).toBeGreaterThan(0);
      },
      { timeout: 500 },
    );

    // Verify the error is for the title field.
    const titleError = result.current.validation.errors.find((e) =>
      e.field.includes("title"),
    );
    expect(titleError).toBeDefined();
  });
});

// ─── Gap 10: Smoke test for 20-topic Drawer performance (NFR-17) ────────────────

describe("<TestEditor /> — NFR-17 smoke test with 20 topics", () => {
  it("renders without error given a test with 20 topics (smoke test)", async () => {
    // Build a response with 20 topics in sections.
    const manyTopics = Array.from({ length: 20 }, (_, i) => ({
      id: `section-${i + 1}`,
      topicId: `topic-${i + 1}`,
      topicName: `Topic ${i + 1}`,
      drawCount: 5,
      required: i % 2 === 0,
      maxQuestions: 10,
    }));

    nextResponse(buildApiResponse({ sections: manyTopics }));

    const client = makeClient();
    render(
      withClient(
        client,
        <TestEditor testId="test-1" open onClose={() => {}} />,
      ),
    );

    // Verify the drawer renders and loads data without error.
    // Extended timeout to allow for larger payload processing.
    await waitFor(
      () => {
        expect(screen.getByTestId("test-editor-root")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Verify the title appears (model was loaded).
    await waitFor(
      () => {
        expect(screen.getByText("Sample Test")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Smoke test passes: no crash with 20 topics.
  });
});

// ─── S13.7 — Close-confirm chips + inline error-banner (G30/G31) ─────────────

describe("<TestEditor /> — close-confirm chips + error banner", () => {
  it("renders dirty-tab chips inside the close-confirm modal (G30)", async () => {
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
            onClick={() =>
              editor.updateModel((m) => ({
                ...m,
                basic: { ...m.basic, description: m.basic.description + " edited" },
              }))
            }
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

    // Click the header «×» to open the close-confirm (dirty path).
    fireEvent.click(screen.getByTestId("test-editor-close"));

    await waitFor(() =>
      expect(screen.getByTestId("test-editor-close-confirm-chips")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("test-editor-close-confirm-chip-settings")).toBeInTheDocument();
  });

  it("shows the goToError banner inside close-confirm when there are validation errors (G31)", async () => {
    // Clearing the title triggers a validation error (required).
    nextResponse(buildApiResponse({ title: "" }));
    const onClose = vi.fn();
    const client = makeClient();

    function Harness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty"
            onClick={() =>
              editor.updateModel((m) => ({
                ...m,
                basic: { ...m.basic, description: "x" },
              }))
            }
          >
            dirty
          </button>
          <TestEditorView open onClose={onClose} editor={editor} />
        </>
      );
    }

    render(withClient(client, <Harness />));
    // Title is empty → wait for the loaded section marker instead of "Sample Test".
    await screen.findByText("Основы ИБ");

    act(() => {
      fireEvent.click(screen.getByTestId("harness-dirty"));
    });

    fireEvent.click(screen.getByTestId("test-editor-close"));

    await waitFor(() =>
      expect(screen.getByTestId("test-editor-close-confirm-error-banner")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("test-editor-close-confirm-error-banner")).toHaveTextContent(
      /Перейти к первой ошибке/i,
    );
  });
});

// ─── S13.7 — Saving overlay (G1) ─────────────────────────────────────────────

describe("<TestEditor /> — saving overlay", () => {
  it("does NOT render the saving overlay while idle", async () => {
    nextResponse(buildApiResponse());
    const client = makeClient();
    render(
      withClient(client, <TestEditor testId="test-1" open onClose={() => {}} />),
    );
    await screen.findByText("Sample Test");
    expect(screen.queryByTestId("test-editor-saving-overlay")).toBeNull();
  });
});

// ─── S13.7 — Changes-popover per-field diff (G2) ─────────────────────────────

describe("<TestEditor /> — changes-popover per-field diff", () => {
  it("lists changed top-level Settings fields when the popover opens", async () => {
    nextResponse(buildApiResponse({ description: "old description" }));
    const client = makeClient();

    function Harness() {
      const editor = useTestEditor({ mode: "edit", testId: "test-1" });
      return (
        <>
          <button
            type="button"
            data-testid="harness-dirty-desc"
            onClick={() =>
              editor.updateModel((m) => ({
                ...m,
                basic: { ...m.basic, description: "new description" },
              }))
            }
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
      fireEvent.click(screen.getByTestId("harness-dirty-desc"));
    });

    fireEvent.click(screen.getByTestId("test-editor-show-changes"));

    await waitFor(() =>
      expect(screen.getByTestId("test-editor-changes-popover")).toBeInTheDocument(),
    );
    const item = await screen.findByTestId("test-editor-changes-item-description");
    expect(item).toHaveTextContent("Описание");
    expect(item).toHaveTextContent("old description");
    expect(item).toHaveTextContent("new description");
  });
});

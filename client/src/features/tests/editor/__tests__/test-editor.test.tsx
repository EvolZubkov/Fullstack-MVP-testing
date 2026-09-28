/**
 * @module features/tests/editor/__tests__/test-editor.test
 * @description Component + hook tests for the wide Drawer test editor.
 *
 * Coverage:
 *   - DS Drawer markup (FR-43): `ou-drawer-root`, `ou-drawer--xl --right`,
 *     `ou-tabs--underline --m`, four tab triggers, `ou-drawer__foot` with a
 *     three footer actions: «Отменить» / «Применить» / «Закрыть».
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
import { ToastProvider } from "@skillum/ui-kit";

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
  return <QueryClientProvider client={client}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>;
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
  it("renders the DS Drawer with the seven tabs and the three footer actions", async () => {
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

    for (const label of [
      "Основное",
      "Состав и сценарий",
      "Правила прохождения",
      "Оценка результата",
      "Обратная связь и итоги",
      "Оформление",
      "Комментарии",
    ]) {
      expect(screen.getByRole("tab", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }

    await waitFor(() => expect(screen.getByText("Sample Test")).toBeInTheDocument());

    const save = screen.getByTestId("test-editor-save");
    expect(save).toHaveTextContent("Применить");
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("test-editor-cancel")).toHaveTextContent("Отменить");
    expect(screen.getByTestId("test-editor-foot-close")).toHaveTextContent("Закрыть");
  });

  // Решение владельца 2026-09-22: ящик открывается на «Основном». Прежде он открывался
  // на «Составе и сценарии», и автор нового теста читал баннер «Название обязательно»,
  // не видя ни поля названия, ни пометки рядом с ним: и поле, и точка — на соседней
  // вкладке, а единственная видимая точка стояла у «Состава».
  it("по умолчанию открывается вкладка «Основное»", async () => {
    nextResponse(buildApiResponse());
    const client = makeClient();
    render(withClient(client, <TestEditor testId="test-1" open onClose={() => {}} />));

    await screen.findByTestId("settings-pane-main");
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("Основное");
  });

  it("`initialTab` перебивает умолчание", async () => {
    nextResponse(buildApiResponse());
    const client = makeClient();
    render(
      withClient(
        client,
        <TestEditor testId="test-1" open initialTab="rules" onClose={() => {}} />,
      ),
    );

    await screen.findByTestId("test-editor-root");
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
      "Правила прохождения",
    );
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

  it("фокус при открытии уходит в ТЕЛО ящика (NFR-19)", async () => {
    // На первой вкладке фокус читался как «вы здесь», и стрелки листали вкладки
    // вместо прокрутки содержимого. Эскиз держит фокус на теле.
    nextResponse(buildApiResponse());
    const client = makeClient();
    const { container } = render(
      withClient(
        client,
        <TestEditor testId="test-1" open onClose={() => {}} />,
      ),
    );

    await screen.findByRole("tab", { name: /Основное/i });
    const body = container.querySelector(".ou-drawer__body");
    await waitFor(() => expect(document.activeElement).toBe(body));
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
    // Empty title is a blocking error (FR-11); the anchor has to scroll to the
    // field and focus it, whichever tab the editor happens to be showing.
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

  // Контракт «Индикация проблем»: баннер говорит, СКОЛЬКО проблем И В ЧЁМ ОНИ.
  // Один счётчик оставлял автора со свёрнутой карточкой наедине с «Поля с ошибками: 1».
  it("баннер называет саму ошибку, а не только их число", async () => {
    nextResponse(buildApiResponse({ title: "" }));
    const client = makeClient();
    render(withClient(client, <TestEditor testId="test-1" open onClose={() => {}} />));

    const banner = await screen.findByTestId("test-editor-error-summary");
    expect(banner).toHaveTextContent("Название обязательно.");
  });

  // Ошибка внутри темы: точного якоря в DOM нет, пока карточка свёрнута, а общий
  // `data-field="sections"` висит на кнопке «Добавить тему» — переход уводил на неё,
  // и автор оставался без подсветки и без сообщения.
  it("переход к ошибке темы раскрывает карточку и ведёт к полю, а не к «Добавить тему»", async () => {
    nextResponse(
      buildApiResponse({
        sections: [
          {
            id: "section-1",
            topicId: "topic-1",
            topicName: "Основы ИБ",
            drawCount: 50,
            required: true,
            maxQuestions: 10,
          },
        ],
      }),
    );
    const client = makeClient();
    render(withClient(client, <TestEditor testId="test-1" open onClose={() => {}} />));

    await screen.findByTestId("test-editor-error-summary");
    // Ящик открыт на «Основном», а виноватое поле — в «Составе». Заглядываем туда,
    // убеждаемся, что карточка темы свёрнута, и возвращаемся: переход обязан и вкладку
    // сменить, и карточку раскрыть.
    fireEvent.click(screen.getByRole("tab", { name: /Состав и сценарий/i }));
    expect(screen.getByTestId("topic-toggle-topic-1")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("tab", { name: /Основное/i }));

    fireEvent.click(screen.getByRole("button", { name: /Перейти к ошибкам/i }));

    await waitFor(() => {
      // Карточка раскрыта: её тело остаётся в разметке и в свёрнутом виде, поэтому
      // проверяем именно состояние свёртки, а не присутствие поля в DOM.
      expect(screen.getByTestId("topic-toggle-topic-1")).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("topic-drawcount-topic-1")).toHaveFocus();
    });
    expect(screen.getByTestId("composition-add-topic")).not.toHaveFocus();
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

  /** Минимальный состав, без которого сохранение заблокировано валидацией. */
  const oneSection = () => [
    {
      topicId: "top-1",
      topicName: "Topic",
      maxQuestions: 10,
      drawCount: 1,
      drawAll: false,
      required: true,
      timeLimit: { source: "inherit_test" as const },
      feedback: { format: "plain" as const, text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      defaultPoints: null,
    },
  ];

  // Оформление нового теста едет в ДВА приёма: шаблон — телом создания (системные
  // страницы связывает с ним та же транзакция, позже поздно), а всё прочее — своим
  // маршрутом сразу после INSERT, где эта проверка против манифеста уже написана.
  it("шаблон кладёт в тело создания, а параметры дописывает после INSERT", async () => {
    nextResponse({ ...buildApiResponse({ id: "te-new", title: "Свежий" }) }, 201);

    const client = makeClient();
    const { result } = renderHook(
      () => useTestEditor({ mode: "create", folderId: null }),
      { wrapper: ({ children }) => withClient(client, <>{children}</>) },
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());
    // Новый тест начинает со «Стандартного» — того же, чем его обслужит выдача.
    expect(result.current.model?.design).toEqual({ templateId: "default", params: {} });

    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: "Свежий" },
        design: { templateId: "corporate", params: { companyName: "Ромашка" } },
        sections: oneSection(),
      }));
    });
    // Правка оформления зажигает точку своей вкладки, а не чужой.
    expect(result.current.tabStatuses.design.dirty).toBe(true);

    nextResponse({ templateId: "corporate", params: { companyName: "Ромашка" } });
    nextResponse(buildApiResponse({ id: "te-new" }));
    await act(async () => {
      await result.current.save();
    });

    const post = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/tests" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(JSON.parse(String((post?.[1] as RequestInit).body)).designSettingsJson).toEqual({
      templateId: "corporate",
    });

    const designPut = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/tests/te-new/design",
    );
    expect(designPut).toBeDefined();
    expect(JSON.parse(String((designPut?.[1] as RequestInit).body))).toEqual({
      templateId: "corporate",
      params: { companyName: "Ромашка" },
    });
  });

  it("выбрали только шаблон — лишнего запроса за оформлением нет", async () => {
    nextResponse({ ...buildApiResponse({ id: "te-new", title: "Свежий" }) }, 201);

    const client = makeClient();
    const { result } = renderHook(
      () => useTestEditor({ mode: "create", folderId: null }),
      { wrapper: ({ children }) => withClient(client, <>{children}</>) },
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: "Свежий" },
        design: { templateId: "corporate", params: {} },
        sections: oneSection(),
      }));
    });
    await act(async () => {
      await result.current.save();
    });

    // Шаблон уже записан телом создания; повторять его отдельным PUT незачем.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/design"))).toBe(false);
  });

  it("переопределения оценки дописываются после INSERT", async () => {
    nextResponse({ ...buildApiResponse({ id: "te-new", title: "Свежий" }) }, 201);

    const client = makeClient();
    const { result } = renderHook(
      () => useTestEditor({ mode: "create", folderId: null }),
      { wrapper: ({ children }) => withClient(client, <>{children}</>) },
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: "Свежий" },
        sections: oneSection(),
        scoring: {
          defaultQuestionPoints: null,
          questionOverrides: [
            {
              id: "",
              testId: "",
              questionId: "q-1",
              points: 5,
              scoringJson: null,
              difficulty: null,
              pinnedContentHash: "hash-1",
            },
          ],
        },
      }));
    });

    nextResponse({ ok: true });
    nextResponse(buildApiResponse({ id: "te-new" }));
    await act(async () => {
      await result.current.save();
    });

    const scoringPut = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/tests/te-new/question-scoring/q-1",
    );
    expect(scoringPut).toBeDefined();
    expect(JSON.parse(String((scoringPut?.[1] as RequestInit).body))).toEqual({
      points: 5,
      scoringJson: null,
      difficulty: null,
    });
  });

  // Ловушка пути создания: тест создаётся одним POST, а набранное до создания
  // дописывается следом отдельными запросами. Сбой любого из них роняет мутацию, но
  // тест в базе УЖЕ есть — и повтор не имеет права создать второй.
  it("повтор после сбоя дозаписи не создаёт второй тест", async () => {
    nextResponse({ ...buildApiResponse({ id: "te-new", title: "Свежий" }) }, 201); // POST — успех
    nextResponse({ error: "boom" }, 500); // дозапись оформления — 500

    const client = makeClient();
    const { result } = renderHook(
      () => useTestEditor({ mode: "create", folderId: null }),
      { wrapper: ({ children }) => withClient(client, <>{children}</>) },
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: "Свежий" },
        sections: oneSection(),
        design: { templateId: "corporate", params: { companyName: "Ромашка" } },
      }));
    });

    await act(async () => {
      await result.current.save();
    });
    // Сохранение не удалось, ящик остаётся открытым — но тест уже создан.
    expect(result.current.createdId).toBeNull();
    expect(result.current.getCreatedId()).toBe("te-new");
    expect(
      fetchMock.mock.calls.filter(
        (c) => String(c[0]) === "/api/tests" && (c[1] as RequestInit)?.method === "POST",
      ),
    ).toHaveLength(1);

    // Повтор: чтение версии → PUT тела по тому же идентификатору → дозапись заново.
    nextResponse(buildApiResponse({ id: "te-new", version: 1 })); // GET версии
    nextResponse(buildApiResponse({ id: "te-new", version: 2 })); // PUT тела
    nextResponse({ templateId: "corporate", params: { companyName: "Ромашка" } }); // PUT оформления
    nextResponse(buildApiResponse({ id: "te-new", version: 2 })); // финальный GET
    await act(async () => {
      await result.current.save();
    });

    // Второго создания не случилось.
    expect(
      fetchMock.mock.calls.filter(
        (c) => String(c[0]) === "/api/tests" && (c[1] as RequestInit)?.method === "POST",
      ),
    ).toHaveLength(1);
    // Тело ушло PUT'ом по созданному идентификатору, с ТЕКУЩЕЙ версией строки.
    const put = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/tests/te-new" && (c[1] as RequestInit)?.method === "PUT",
    );
    expect(put).toBeDefined();
    expect(JSON.parse(String((put![1] as RequestInit).body)).expectedVersion).toBe(1);
    // Дозапись прогналась заново и на этот раз удалась.
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]) === "/api/tests/te-new/design"),
    ).toBe(true);
    expect(result.current.createdId).toBe("te-new");
  });

  it("следующее создание не дописывается в тест прошлой попытки", async () => {
    nextResponse({ ...buildApiResponse({ id: "te-first", title: "Первый" }) }, 201);
    nextResponse({ error: "boom" }, 500);

    const client = makeClient();
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useTestEditor(open ? { mode: "create", folderId: null } : null),
      {
        wrapper: ({ children }) => withClient(client, <>{children}</>),
        initialProps: { open: true },
      },
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());

    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: "Первый" },
        sections: oneSection(),
        design: { templateId: "corporate", params: { companyName: "Ромашка" } },
      }));
    });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.getCreatedId()).toBe("te-first");

    // Ящик закрыли и открыли снова: сеанс создания начинается чисто.
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(result.current.model).not.toBeNull());
    expect(result.current.getCreatedId()).toBeNull();

    nextResponse({ ...buildApiResponse({ id: "te-second", title: "Второй" }) }, 201);
    act(() => {
      result.current.updateModel((m) => ({
        ...m,
        basic: { ...m.basic, title: "Второй" },
        sections: oneSection(),
      }));
    });
    await act(async () => {
      await result.current.save();
    });

    // Второй тест создан СВОИМ POST, а не дописан в первый.
    expect(result.current.createdId).toBe("te-second");
    expect(
      fetchMock.mock.calls.filter(
        (c) => String(c[0]) === "/api/tests/te-first" && (c[1] as RequestInit)?.method === "PUT",
      ),
    ).toHaveLength(0);
  });

  it("правка существующего теста об оформлении не сообщает", async () => {
    nextResponse(buildApiResponse());
    const client = makeClient();
    const { result } = renderHook(() => useTestEditor({ mode: "edit", testId: "test-1" }), {
      wrapper: ({ children }) => withClient(client, <>{children}</>),
    });
    await waitFor(() => expect(result.current.model).not.toBeNull());
    // У открытого на правку теста среза нет вовсе: оформление правит свой ресурс
    // (`PUT /api/tests/:id/design`), и второй писатель затёр бы его параметры.
    expect(result.current.model?.design).toBeUndefined();

    nextResponse(buildApiResponse({ version: 8 }));
    act(() => {
      result.current.updateModel((m) => ({ ...m, basic: { ...m.basic, title: "Другое" } }));
    });
    await act(async () => {
      await result.current.save();
    });

    const put = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit)?.method === "PUT",
    );
    const body = JSON.parse(String((put?.[1] as RequestInit).body));
    expect(body.designSettingsJson).toBeUndefined();
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
    // Title is empty, so wait for a loaded-model marker: the «Основное» pane, which
    // mounts only once the draft is in hand.
    await screen.findByTestId("settings-pane-main");

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
    await screen.findByTestId("settings-pane-main");

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

// ─── Опубликованный тест остаётся редактируемым (BRD 4.7, BRC-20) ─────────────

describe("<TestEditor /> — публикация не запирает редактор", () => {
  it("опубликованный тест открывается в обычном режиме, а не в «только чтение»", async () => {
    // Публикуется СНАПШОТ: доставка идёт из него, поэтому рабочая версия правится
    // всегда. Прежний замок пришёл из PRD-7 (`s-readonly`) — эскиза, нарисованного
    // до снапшотов, — и отбирал у автора правку методики после публикации.
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
    expect(foot.getAttribute("data-state")).toBe("default");
    // Три действия стоят всегда; без правок откатывать и применять нечего.
    expect(screen.getByTestId("test-editor-foot-close")).toHaveTextContent("Закрыть");
    expect(screen.getByTestId("test-editor-cancel")).toBeDisabled();
    expect(screen.getByTestId("test-editor-save")).toBeDisabled();
  });

  it("«Закрыть» без правок закрывает сразу, без вопроса", async () => {
    nextResponse(buildApiResponse({ status: "published" }));
    const onClose = vi.fn();
    const client = makeClient();
    render(
      withClient(client, <TestEditor testId="test-1" open onClose={onClose} />),
    );

    await screen.findByText("Sample Test");

    fireEvent.click(screen.getByTestId("test-editor-foot-close"));

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
    expect(screen.getByTestId("test-editor-close-confirm-chip-main")).toBeInTheDocument();
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
    // Title is empty → wait for the «Основное» pane instead of "Sample Test".
    await screen.findByTestId("settings-pane-main");

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

/**
 * @module features/questions/__tests__/question-editor-drawer.test
 * @description Component tests for {@link QuestionEditorDrawer} — the reusable,
 * prop-driven question editor mounted in a design-system Drawer. Coverage:
 *   - Per-type builders render (single / multiple / matching / ranking), driven
 *     by the `question` prop and by the type SegmentedControl.
 *   - Field editing: prompt text, topic Select, option add / remove, marking the
 *     correct answer (single radio, multiple checkbox).
 *   - Live validation: the error banner appears (empty prompt) and blocks save;
 *     a valid form enables save.
 *   - Save paths: create routes through the create mutation (POST /api/questions,
 *     onSaved/onClose fire); edit routes through the PRD-15 content guard (PUT).
 *
 * The content guard is mocked so edit saves are asserted on the captured spy
 * rather than the network; `apiRequest` uses the global `fetch`, which is stubbed.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";

// The content guard owns the edit-save path; mock it so we can assert the guarded
// operation without going to the network. `vi.hoisted` exposes the spy to the
// hoisted `vi.mock` factory and to the test bodies.
const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const topics = [
  { id: "t1", name: "Тема A" },
  { id: "t2", name: "Тема B" },
] as unknown as Topic[];

/** Build a Question fixture; only the fields the editor reads are provided. */
function makeQuestion(over: Partial<Question> & Pick<Question, "type" | "dataJson" | "correctJson">): Question {
  return {
    id: "q1",
    topicId: "t1",
    prompt: "Столица Франции?",
    mediaUrl: null,
    mediaType: null,
    shuffleAnswers: true,
    difficulty: null,
    feedbackMode: "general",
    feedback: null,
    feedbackCorrect: null,
    feedbackIncorrect: null,
    tags: [],
    ...over,
  } as unknown as Question;
}

const singleQuestion = makeQuestion({
  id: "q-single",
  type: "single",
  dataJson: { options: ["Париж", "Лондон", "Берлин", "Мадрид"] } as unknown as Question["dataJson"],
  correctJson: { correctIndex: 0 } as unknown as Question["correctJson"],
});

const multipleQuestion = makeQuestion({
  id: "q-multi",
  type: "multiple",
  prompt: "Выберите чётные числа",
  dataJson: { options: ["Два", "Три", "Четыре"] } as unknown as Question["dataJson"],
  correctJson: { correctIndices: [0] } as unknown as Question["correctJson"],
});

const matchingQuestion = makeQuestion({
  id: "q-match",
  type: "matching",
  prompt: "Сопоставьте звуки",
  dataJson: { left: ["Кошка", "Собака"], right: ["Мяу", "Гав"] } as unknown as Question["dataJson"],
  correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] } as unknown as Question["correctJson"],
});

const rankingQuestion = makeQuestion({
  id: "q-rank",
  type: "ranking",
  prompt: "Расположите по возрастанию",
  dataJson: { items: ["Один", "Два", "Три"] } as unknown as Question["dataJson"],
  correctJson: { correctOrder: [0, 1, 2] } as unknown as Question["correctJson"],
});

// ─── Fetch stub (create mutation → POST /api/questions) ─────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  guardMock.mockReset();
  fetchMock = vi.fn(async (url: string) => {
    // Media upload returns the stored URL + MIME; everything else is a plain ok.
    const body = String(url).includes("/api/media/upload")
      ? { url: "/uploads/media/photo.png", mime: "image/png" }
      : { id: "new-id" };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

// ─── Render helper ──────────────────────────────────────────────────────────────

function renderDrawer(overrides: Partial<QuestionEditorDrawerProps> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const props: QuestionEditorDrawerProps = {
    open: true,
    question: null,
    topics,
    onClose,
    onSaved,
    ...overrides,
  };
  // useMutation requires a QueryClientProvider regardless of create/edit mode.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <QuestionEditorDrawer {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose: props.onClose, onSaved: props.onSaved };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<QuestionEditorDrawer />", () => {
  it("does not render when closed", () => {
    renderDrawer({ open: false });
    expect(screen.queryByTestId("input-question-prompt")).toBeNull();
  });

  it("renders the single-choice builder (create default)", () => {
    renderDrawer();
    expect(screen.getByTestId("seg-question-type")).toBeInTheDocument();
    expect(screen.getByTestId("input-option-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-option-3")).toBeInTheDocument();
    // Single choice exposes a "correct answer" radio per option.
    expect(screen.getByRole("radio", { name: "Правильный ответ 1" })).toBeInTheDocument();
  });

  it("renders the multiple-choice builder in edit mode with values prefilled", async () => {
    renderDrawer({ question: multipleQuestion });
    const opt0 = (await screen.findByTestId("input-multi-option-0")) as HTMLInputElement;
    expect(opt0.value).toBe("Два");
    expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value).toBe(
      "Выберите чётные числа",
    );
    expect(screen.getByRole("checkbox", { name: "Вариант ответа 1" })).toBeChecked();
  });

  it("renders the matching builder in edit mode (left + right columns)", async () => {
    renderDrawer({ question: matchingQuestion });
    expect((await screen.findByTestId("input-matching-left-0") as HTMLInputElement).value).toBe("Кошка");
    expect((screen.getByTestId("input-matching-right-0") as HTMLInputElement).value).toBe("Мяу");
    expect((screen.getByTestId("input-matching-right-1") as HTMLInputElement).value).toBe("Гав");
  });

  it("renders the ranking builder in edit mode and hides the shuffle switch", async () => {
    renderDrawer({ question: rankingQuestion });
    expect((await screen.findByTestId("input-ranking-0") as HTMLInputElement).value).toBe("Один");
    expect(screen.getByTestId("input-ranking-2")).toBeInTheDocument();
    // Ranking is always shuffled — no per-question shuffle toggle.
    expect(screen.queryByTestId("switch-shuffle-answers")).toBeNull();
  });

  it("switches the question type via the SegmentedControl (single → ranking)", () => {
    renderDrawer();
    expect(screen.getByTestId("input-option-0")).toBeInTheDocument();
    expect(screen.getByTestId("switch-shuffle-answers")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ранжирование" }));

    expect(screen.getByTestId("input-ranking-0")).toBeInTheDocument();
    expect(screen.queryByTestId("input-option-0")).toBeNull();
    expect(screen.queryByTestId("switch-shuffle-answers")).toBeNull();
  });

  it("edits the question prompt text", () => {
    renderDrawer();
    const prompt = screen.getByTestId("input-question-prompt") as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: "Новый вопрос?" } });
    expect(prompt.value).toBe("Новый вопрос?");
  });

  it("adds an answer option", () => {
    renderDrawer();
    expect(screen.queryByTestId("input-option-4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Добавить вариант" }));
    expect(screen.getByTestId("input-option-4")).toBeInTheDocument();
  });

  it("removes an answer option", () => {
    renderDrawer();
    // 4 options initially → 4 delete buttons.
    expect(screen.getByTestId("input-option-3")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить вариант" })[0]);
    expect(screen.queryByTestId("input-option-3")).toBeNull();
    expect(screen.getByTestId("input-option-2")).toBeInTheDocument();
  });

  it("marks the correct answer in single choice (radio)", () => {
    renderDrawer();
    const radio2 = screen.getByRole("radio", { name: "Правильный ответ 2" }) as HTMLInputElement;
    expect(radio2).not.toBeChecked();
    fireEvent.click(radio2);
    expect(screen.getByRole("radio", { name: "Правильный ответ 2" })).toBeChecked();
  });

  it("toggles a correct answer in multiple choice (checkbox)", async () => {
    renderDrawer({ question: multipleQuestion });
    const box3 = (await screen.findByRole("checkbox", { name: "Вариант ответа 3" })) as HTMLInputElement;
    expect(box3).not.toBeChecked();
    fireEvent.click(box3);
    expect(screen.getByRole("checkbox", { name: "Вариант ответа 3" })).toBeChecked();
  });

  it("selecting a topic clears the topic-required validation error", () => {
    renderDrawer();
    expect(screen.getByText("Тема обязательна")).toBeInTheDocument();

    const trigger = within(screen.getByTestId("select-question-topic")).getByRole("button");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Тема A" }));

    expect(screen.queryByText("Тема обязательна")).toBeNull();
  });

  it("shows the validation banner and blocks save when the prompt is emptied", async () => {
    renderDrawer({ question: singleQuestion });
    // A valid question → no banner, save enabled.
    await screen.findByTestId("input-question-prompt");
    expect(screen.queryByTestId("banner-question-validation")).toBeNull();
    expect(screen.getByTestId("button-submit-question")).not.toBeDisabled();

    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "" } });

    const banner = await screen.findByTestId("banner-question-validation");
    expect(banner).toHaveTextContent("Текст вопроса обязателен");
    expect(screen.getByTestId("button-submit-question")).toBeDisabled();
  });

  it("creates a question through the mutation and calls onSaved/onClose", async () => {
    const { onSaved, onClose } = renderDrawer({ defaultTopicId: "t1" });

    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Столица Франции?" },
    });
    fireEvent.change(screen.getByTestId("input-option-0"), { target: { value: "Париж" } });
    fireEvent.change(screen.getByTestId("input-option-1"), { target: { value: "Лондон" } });

    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/questions", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(body).toMatchObject({ topicId: "t1", type: "single", prompt: "Столица Франции?" });
    expect(body.dataJson.options).toEqual(["Париж", "Лондон"]);
    expect(body.correctJson).toEqual({ correctIndex: 0 });
  });

  it("routes an edit save through the content guard (PUT), not the create mutation", async () => {
    renderDrawer({ question: singleQuestion });
    const submit = await screen.findByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(guardMock).toHaveBeenCalled());
    expect(guardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/questions/q-single",
        method: "PUT",
        body: expect.objectContaining({ prompt: "Столица Франции?", type: "single" }),
      }),
    );
    // The create mutation must NOT fire for an edit.
    expect(fetchMock).not.toHaveBeenCalledWith("/api/questions", expect.anything());
  });

  it("adds and removes options in the multiple-choice builder", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Несколько ответов" }));

    expect(screen.queryByTestId("input-multi-option-4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Добавить вариант" }));
    expect(screen.getByTestId("input-multi-option-4")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Удалить вариант" })[0]);
    expect(screen.queryByTestId("input-multi-option-4")).toBeNull();
  });

  it("adds and removes items in the ranking builder", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Ранжирование" }));

    expect(screen.queryByTestId("input-ranking-4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Добавить вариант" }));
    expect(screen.getByTestId("input-ranking-4")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Удалить элемент" })[0]);
    expect(screen.queryByTestId("input-ranking-4")).toBeNull();
  });

  it("adds a pair and auto-links it when the left cell is filled (matching)", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Соответствие" }));

    // Options carried over from single choice (4) → 4 rows; «Добавить пару» grows both columns.
    expect(screen.getByTestId("input-matching-left-3")).toBeInTheDocument();
    expect(screen.queryByTestId("input-matching-left-4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Добавить пару" }));
    expect(screen.getByTestId("input-matching-left-4")).toBeInTheDocument();
    expect(screen.getByTestId("input-matching-right-4")).toBeInTheDocument();

    const left0 = screen.getByTestId("input-matching-left-0") as HTMLInputElement;
    fireEvent.change(left0, { target: { value: "Кошка" } });
    expect(left0.value).toBe("Кошка");
  });

  it("reveals the difficulty slider when «Не задано» is turned off", () => {
    renderDrawer();
    expect(screen.queryByTestId("slider-question-difficulty")).toBeNull();

    fireEvent.click(screen.getByTestId("switch-question-difficulty-unset"));

    expect(screen.getByTestId("slider-question-difficulty")).toBeInTheDocument();
    const num = screen.getByTestId("input-question-difficulty") as HTMLInputElement;
    expect(num.value).toBe("50");
    fireEvent.change(num, { target: { value: "80" } });
    expect((screen.getByTestId("input-question-difficulty") as HTMLInputElement).value).toBe("80");
  });

  it("switches feedback to conditional mode and reveals the two message fields", () => {
    renderDrawer();
    expect(screen.getByTestId("input-question-feedback")).toBeInTheDocument();
    expect(screen.queryByTestId("input-question-feedback-correct")).toBeNull();

    fireEvent.click(screen.getByTestId("switch-feedback-mode"));

    expect(screen.queryByTestId("input-question-feedback")).toBeNull();
    fireEvent.change(screen.getByTestId("input-question-feedback-correct"), {
      target: { value: "Верно!" },
    });
    fireEvent.change(screen.getByTestId("input-question-feedback-incorrect"), {
      target: { value: "Неверно" },
    });
    expect((screen.getByTestId("input-question-feedback-correct") as HTMLTextAreaElement).value).toBe(
      "Верно!",
    );
  });

  it("uploads a media file and renders the image preview", async () => {
    renderDrawer();
    const file = new File(["x"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Выбор файлов"), { target: { files: [file] } });

    const img = await screen.findByAltText("Превью медиа вопроса");
    expect(img).toHaveAttribute("src", "/uploads/media/photo.png");
    expect(fetchMock).toHaveBeenCalledWith("/api/media/upload", expect.objectContaining({ method: "POST" }));
  });
});

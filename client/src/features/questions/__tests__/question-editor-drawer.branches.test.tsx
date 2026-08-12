/**
 * @module features/questions/__tests__/question-editor-drawer.branches.test
 * @description Branch-coverage companion to {@link question-editor-drawer.test}.
 * Extends (does not replace) the baseline suite by driving the alternative
 * branches the happy-path suite skips:
 *   - media type inference ({@link guessMediaType}) for audio / video / an empty
 *     MIME / an unsupported MIME, plus the audio and video preview renderers and
 *     the upload-failure catch;
 *   - the matching builder `updateRight`, and the `updateLeft` auto-link
 *     false-branch (a left cell that already owns a pair);
 *   - the `onSubmit` base64/data-url guard, and the feedback ternaries (general
 *     text vs. the conditional correct/incorrect messages) on save;
 *   - option removal index-remap branches (single radio and multiple checkbox)
 *     and the type-switch carried-answer branches.
 *
 * The content guard and the toast hook are mocked so save routing and the guard
 * toasts can be asserted on spies rather than the network. `fetch` is stubbed.
 * Drag-reorder is intentionally NOT exercised — it is unreachable in jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";

// The edit-save path goes through the content guard; mock it so we can assert the
// guarded PUT body (and its absence) without hitting the network.
const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

// Capture toast calls so the destructive guard toasts (base64 / unsupported /
// upload failure) can be asserted.
const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const topics = [
  { id: "t1", name: "Тема A" },
  { id: "t2", name: "Тема B" },
] as unknown as Topic[];

/** Build a Question fixture; only the fields the editor reads are provided. */
function makeQuestion(
  over: Partial<Question> & Pick<Question, "type" | "dataJson" | "correctJson">,
): Question {
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

// ─── fetch stub (media upload + create mutation) ────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;
/** Configurable /api/media/upload response for the current test. */
let uploadResponse: { url: string; mime?: string };
/** When false the upload endpoint answers non-2xx (drives the catch branch). */
let uploadOk: boolean;
/** When false the create POST answers non-2xx (drives the createMutation onError branch). */
let createOk: boolean;

beforeEach(() => {
  guardMock.mockReset();
  toastMock.mockReset();
  uploadResponse = { url: "/uploads/media/photo.png", mime: "image/png" };
  uploadOk = true;
  createOk = true;
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/api/media/upload")) {
      return {
        ok: uploadOk,
        status: uploadOk ? 200 : 500,
        json: async () => uploadResponse,
        text: async () => JSON.stringify(uploadResponse),
      };
    }
    const body = { id: "new-id" };
    return {
      ok: createOk,
      status: createOk ? 200 : 500,
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

/** Upload a file through the FileUploader's hidden input. */
function uploadFile(file: File) {
  fireEvent.change(screen.getByLabelText("Выбор файлов"), { target: { files: [file] } });
}

// ─── Media type inference + preview ─────────────────────────────────────────────

describe("<QuestionEditorDrawer /> — media type inference & preview", () => {
  it("infers audio from the MIME and renders the audio preview", async () => {
    uploadResponse = { url: "/uploads/media/sound.mp3", mime: "audio/mpeg" };
    // The Drawer renders into a portal, so query the whole document, not the
    // render container (mirrors the baseline suite's `screen` queries).
    renderDrawer();

    uploadFile(new File(["x"], "sound.mp3", { type: "audio/mpeg" }));

    await waitFor(() => expect(document.querySelector("audio")).toBeTruthy());
    expect(document.querySelector("audio source")).toHaveAttribute("src", "/uploads/media/sound.mp3");
    expect(document.querySelector("img")).toBeNull();
  });

  it("infers video from the MIME and renders the video preview", async () => {
    uploadResponse = { url: "/uploads/media/clip.mp4", mime: "video/mp4" };
    renderDrawer();

    uploadFile(new File(["x"], "clip.mp4", { type: "video/mp4" }));

    await waitFor(() => expect(document.querySelector("video")).toBeTruthy());
    expect(document.querySelector("video source")).toHaveAttribute("src", "/uploads/media/clip.mp4");
  });

  it("rejects an unsupported MIME (application/pdf) before uploading", async () => {
    renderDrawer();

    uploadFile(new File(["x"], "doc.pdf", { type: "application/pdf" }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Поддерживаются только image/audio/video." }),
      ),
    );
    // The unsupported guard returns before any network call to the upload endpoint.
    expect(fetchMock).not.toHaveBeenCalledWith("/api/media/upload", expect.anything());
  });

  it("rejects an empty MIME (guessMediaType !mime branch)", async () => {
    renderDrawer();

    uploadFile(new File(["x"], "mystery.bin", { type: "" }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Поддерживаются только image/audio/video." }),
      ),
    );
  });

  it("surfaces a toast when the upload request fails", async () => {
    uploadOk = false;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderDrawer();

    uploadFile(new File(["x"], "photo.png", { type: "image/png" }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Не удалось загрузить файл. Проверь права (author) и размер.",
        }),
      ),
    );
    errSpy.mockRestore();
  });
});

// ─── Matching builder — updateRight / updateLeft auto-link ───────────────────────

describe("<QuestionEditorDrawer /> — matching builder", () => {
  it("edits a right-column cell (updateRight)", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Соответствие" }));

    const right0 = screen.getByTestId("input-matching-right-0") as HTMLInputElement;
    fireEvent.change(right0, { target: { value: "Мяу" } });
    expect((screen.getByTestId("input-matching-right-0") as HTMLInputElement).value).toBe("Мяу");
  });

  it("auto-links a left cell once, then skips when it already owns a pair", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Соответствие" }));

    const left0 = screen.getByTestId("input-matching-left-0") as HTMLInputElement;
    // First edit creates the {left:0,right:0} pair (auto-link true branch)…
    fireEvent.change(left0, { target: { value: "Кошка" } });
    // …second edit hits the pairs.some(p => p.left === idx) false-branch (no dup pair).
    fireEvent.change(left0, { target: { value: "Кошки" } });
    expect(left0.value).toBe("Кошки");
  });
});

// ─── onSubmit guards & feedback ternaries ───────────────────────────────────────

describe("<QuestionEditorDrawer /> — save guards & feedback", () => {
  const validSingle = makeQuestion({
    id: "q-valid",
    type: "single",
    dataJson: { options: ["Париж", "Лондон"] } as unknown as Question["dataJson"],
    correctJson: { correctIndex: 0 } as unknown as Question["correctJson"],
  });

  it("blocks save with a base64/data-url media and never calls the guard", async () => {
    renderDrawer({
      question: makeQuestion({
        ...validSingle,
        mediaUrl: "data:image/png;base64,AAAA",
        mediaType: "image",
      }),
    });
    const submit = await screen.findByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          description:
            'Нельзя сохранять медиа как base64 в JSON. Используй кнопку "Загрузить файл".',
        }),
      ),
    );
    expect(guardMock).not.toHaveBeenCalled();
  });

  it("saves conditional feedback (correct/incorrect set, general feedback null)", async () => {
    renderDrawer({
      question: makeQuestion({
        ...validSingle,
        feedbackMode: "conditional",
        feedbackCorrect: "Верно!",
        feedbackIncorrect: "Неверно",
      }),
    });
    const submit = await screen.findByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(guardMock).toHaveBeenCalled());
    expect(guardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        body: expect.objectContaining({
          feedback: null,
          feedbackCorrect: "Верно!",
          feedbackIncorrect: "Неверно",
        }),
      }),
    );
  });

  it("saves general feedback text (conditional fields null) with the persisted media url", async () => {
    renderDrawer({
      question: makeQuestion({
        ...validSingle,
        feedbackMode: "general",
        feedback: "Молодец",
        mediaUrl: "/uploads/media/pic.png",
        mediaType: "image",
      }),
    });
    const submit = await screen.findByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(guardMock).toHaveBeenCalled());
    expect(guardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          feedback: "Молодец",
          feedbackCorrect: null,
          feedbackIncorrect: null,
          mediaUrl: "/uploads/media/pic.png",
          mediaType: "image",
        }),
      }),
    );
  });
});

// ─── Option removal index-remap & type-switch carried answers ────────────────────

describe("<QuestionEditorDrawer /> — option removal & type switching", () => {
  it("shifts the single correct index down when an earlier option is removed", () => {
    renderDrawer();
    // Mark option 3 (index 2) correct, then delete option 1 (index 0).
    fireEvent.click(screen.getByRole("radio", { name: "Правильный ответ 3" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить вариант" })[0]);
    // correctIndex 2 > removed idx 0 → decremented to 1 → radio 2 now correct.
    expect(screen.getByRole("radio", { name: "Правильный ответ 2" })).toBeChecked();
  });

  it("clamps the single correct index when the last (correct) option is removed", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("radio", { name: "Правильный ответ 4" }));
    // Delete the last option (index 3, which is the correct one).
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить вариант" })[3]);
    // correctIndex 3 >= newLength 3 → clamped to 2 → radio 3 now correct.
    expect(screen.getByRole("radio", { name: "Правильный ответ 3" })).toBeChecked();
  });

  it("remaps multiple-choice correct indices when a middle option is removed", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Несколько ответов" }));
    // Carried [0] from single; also mark option 3 (index 2) → [0, 2].
    fireEvent.click(screen.getByRole("checkbox", { name: "Вариант ответа 3" }));
    // Delete option 2 (index 1): [0,2] → filter 1 out → map i>1?i-1 → [0,1].
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить вариант" })[1]);
    expect(screen.getByRole("checkbox", { name: "Вариант ответа 1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Вариант ответа 2" })).toBeChecked();
  });

  it("carries the single correct index into multiple choice (prev === single)", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("radio", { name: "Правильный ответ 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Несколько ответов" }));
    expect(screen.getByRole("checkbox", { name: "Вариант ответа 3" })).toBeChecked();
  });

  it("carries the first multiple index back into single choice (prev === multiple)", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Несколько ответов" }));
    // Reset carried [0] → select only index 2.
    fireEvent.click(screen.getByRole("checkbox", { name: "Вариант ответа 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Вариант ответа 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Один ответ" }));
    expect(screen.getByRole("radio", { name: "Правильный ответ 3" })).toBeChecked();
  });

  it("falls back to index 0 switching from ranking to single (prev neither)", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Ранжирование" }));
    fireEvent.click(screen.getByRole("button", { name: "Один ответ" }));
    expect(screen.getByRole("radio", { name: "Правильный ответ 1" })).toBeChecked();
  });
});

// ─── Create-save per type (buildQuestionData multiple / matching / ranking) ──────

describe("<QuestionEditorDrawer /> — create save builds per-type payload", () => {
  it("POSTs a multiple-choice payload with correctIndices", async () => {
    const { onSaved } = renderDrawer({ defaultTopicId: "t1" });
    fireEvent.click(screen.getByRole("button", { name: "Несколько ответов" }));
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Чётные?" } });
    fireEvent.change(screen.getByTestId("input-multi-option-0"), { target: { value: "Два" } });
    fireEvent.change(screen.getByTestId("input-multi-option-1"), { target: { value: "Четыре" } });

    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(body.type).toBe("multiple");
    expect(body.dataJson.options).toEqual(["Два", "Четыре"]);
    expect(body.correctJson.correctIndices).toEqual([0]);
  });

  it("POSTs a matching payload with left/right columns and pairs", async () => {
    const { onSaved } = renderDrawer({ defaultTopicId: "t1" });
    fireEvent.click(screen.getByRole("button", { name: "Соответствие" }));
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Сопоставьте" } });
    // Filling the first left cell auto-links pair {0,0}.
    fireEvent.change(screen.getByTestId("input-matching-left-0"), { target: { value: "Кошка" } });
    fireEvent.change(screen.getByTestId("input-matching-right-0"), { target: { value: "Мяу" } });

    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(body.type).toBe("matching");
    expect(body.dataJson.left).toEqual(["Кошка"]);
    expect(body.dataJson.right).toEqual(["Мяу"]);
    expect(body.correctJson.pairs).toEqual([{ left: 0, right: 0 }]);
  });

  it("POSTs a ranking payload with a derived correctOrder", async () => {
    const { onSaved } = renderDrawer({ defaultTopicId: "t1" });
    fireEvent.click(screen.getByRole("button", { name: "Ранжирование" }));
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Порядок" } });
    fireEvent.change(screen.getByTestId("input-ranking-0"), { target: { value: "Один" } });
    fireEvent.change(screen.getByTestId("input-ranking-1"), { target: { value: "Два" } });

    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(body.type).toBe("ranking");
    expect(body.dataJson.items).toEqual(["Один", "Два"]);
    expect(Array.isArray(body.correctJson.correctOrder)).toBe(true);
  });

  it("shows an error toast when the create mutation fails", async () => {
    createOk = false;
    renderDrawer({ defaultTopicId: "t1" });
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Вопрос?" } });
    fireEvent.change(screen.getByTestId("input-option-0"), { target: { value: "А" } });
    fireEvent.change(screen.getByTestId("input-option-1"), { target: { value: "Б" } });

    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })),
    );
  });
});

// ─── Misc field interactions (shuffle toggle, general feedback) ──────────────────

describe("<QuestionEditorDrawer /> — misc interactions", () => {
  it("toggles the shuffle switch and edits the general feedback textarea", () => {
    renderDrawer();
    const shuffle = screen.getByTestId("switch-shuffle-answers") as HTMLInputElement;
    expect(shuffle.checked).toBe(true);
    fireEvent.click(shuffle);
    expect((screen.getByTestId("switch-shuffle-answers") as HTMLInputElement).checked).toBe(false);

    fireEvent.change(screen.getByTestId("input-question-feedback"), { target: { value: "Подсказка" } });
    expect((screen.getByTestId("input-question-feedback") as HTMLTextAreaElement).value).toBe("Подсказка");
  });
});

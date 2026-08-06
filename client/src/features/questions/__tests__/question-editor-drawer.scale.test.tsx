/**
 * @module features/questions/__tests__/question-editor-drawer.scale.test
 * @description PRD-26 scale in the question editor.
 *
 * The behaviour that matters to the author: the correct-answer switch is OFF by
 * default (an inventory has no right answers), turning it on reveals the graduation
 * radios, turning it back off forgets the mark, and the saved `correctJson` is an
 * EMPTY object in measurement mode — not `null`, which the NOT NULL column would
 * reject, and not a stale `correctIndex`, which would silently make every survey item
 * gradeable.
 *
 * Switching single ↔ scale keeps the typed texts: both types store the same
 * `dataJson`, so losing them would be a pure regression for the author.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";

const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";

const topics = [{ id: "t1", name: "Выгорание" }] as unknown as Topic[];

function makeQuestion(over: Partial<Question> & Pick<Question, "type" | "dataJson" | "correctJson">): Question {
  return {
    id: "q1",
    topicId: "t1",
    prompt: "После работы я чувствую себя как «выжатый лимон»",
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

const GRADES = ["Никогда", "Редко", "Часто", "Постоянно"];

const measurementScale = makeQuestion({
  id: "q-scale-measure",
  type: "scale",
  dataJson: { options: GRADES } as unknown as Question["dataJson"],
  correctJson: {} as unknown as Question["correctJson"],
});

const checkedScale = makeQuestion({
  id: "q-scale-checked",
  type: "scale",
  dataJson: { options: GRADES } as unknown as Question["dataJson"],
  correctJson: { correctIndex: 2 } as unknown as Question["correctJson"],
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "new-id" }),
    text: async () => JSON.stringify({ id: "new-id" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderDrawer(overrides: Partial<QuestionEditorDrawerProps> = {}) {
  const props: QuestionEditorDrawerProps = {
    open: true,
    question: null,
    topics,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QuestionEditorDrawer {...props} />
    </QueryClientProvider>,
  );
}

/** Switch the editor to the scale type through the type control. */
function pickScale() {
  fireEvent.click(screen.getByRole("button", { name: "Шкала" }));
}

const switchScaleCorrect = () => screen.getByTestId("switch-scale-has-correct") as HTMLInputElement;

/** The body sent to POST /api/questions. */
function postedBody(): any {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/questions"));
  return JSON.parse((call![1] as any).body);
}

describe("<QuestionEditorDrawer /> — scale (PRD-26)", () => {
  it("offers «Шкала» among the question types", () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: "Шкала" })).toBeInTheDocument();
  });

  it("starts in measurement mode: the switch is off and no graduation is markable", () => {
    renderDrawer();
    pickScale();
    expect(switchScaleCorrect().checked).toBe(false);
    expect(screen.queryByRole("radio", { name: /Правильный ответ/ })).toBeNull();
    expect(screen.getByText("Градации шкалы · по порядку")).toBeInTheDocument();
  });

  it("reveals the graduation radios once the switch is on", () => {
    renderDrawer();
    pickScale();
    fireEvent.click(switchScaleCorrect());
    expect(screen.getByRole("radio", { name: "Правильный ответ 1" })).toBeInTheDocument();
    expect(screen.getByText("Градации шкалы · отметьте правильную")).toBeInTheDocument();
  });

  it("hides the shuffle switch for a scale — its order is content", () => {
    renderDrawer();
    expect(screen.getByTestId("switch-shuffle-answers")).toBeInTheDocument();
    pickScale();
    expect(screen.queryByTestId("switch-shuffle-answers")).toBeNull();
  });

  it("keeps the typed texts when switching single → scale and back", () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId("input-option-0"), { target: { value: "Никогда" } });
    fireEvent.change(screen.getByTestId("input-option-1"), { target: { value: "Постоянно" } });
    pickScale();
    expect((screen.getByTestId("input-option-0") as HTMLInputElement).value).toBe("Никогда");
    expect((screen.getByTestId("input-option-1") as HTMLInputElement).value).toBe("Постоянно");
    fireEvent.click(screen.getByRole("button", { name: "Один ответ" }));
    expect((screen.getByTestId("input-option-0") as HTMLInputElement).value).toBe("Никогда");
  });

  it("does not turn the correct-answer switch on by itself when coming from single choice", () => {
    // FR-30: single choice always HAS a correct answer; carrying that over would make
    // every converted question gradeable behind the author's back.
    renderDrawer();
    pickScale();
    expect(switchScaleCorrect().checked).toBe(false);
  });

  it("saves an EMPTY correctJson in measurement mode", async () => {
    renderDrawer({ defaultTopicId: "t1" });
    pickScale();
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "После работы я чувствую себя опустошённым" },
    });
    GRADES.forEach((g, i) => {
      const input = screen.queryByTestId(`input-option-${i}`);
      if (input) fireEvent.change(input, { target: { value: g } });
    });
    fireEvent.click(screen.getByTestId("button-submit-question"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = postedBody();
    expect(body.type).toBe("scale");
    expect(body.correctJson).toEqual({});
    expect(body.dataJson.options).toContain("Никогда");
  });

  it("saves the marked graduation when the switch is on", async () => {
    renderDrawer({ defaultTopicId: "t1" });
    pickScale();
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Утверждение" } });
    GRADES.forEach((g, i) => {
      const input = screen.queryByTestId(`input-option-${i}`);
      if (input) fireEvent.change(input, { target: { value: g } });
    });
    fireEvent.click(switchScaleCorrect());
    fireEvent.click(screen.getByRole("radio", { name: "Правильный ответ 3" }));
    fireEvent.click(screen.getByTestId("button-submit-question"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(postedBody().correctJson).toEqual({ correctIndex: 2 });
  });

  it("forgets the mark when the switch is turned back off", async () => {
    renderDrawer({ defaultTopicId: "t1" });
    pickScale();
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Утверждение" } });
    GRADES.forEach((g, i) => {
      const input = screen.queryByTestId(`input-option-${i}`);
      if (input) fireEvent.change(input, { target: { value: g } });
    });
    fireEvent.click(switchScaleCorrect());
    fireEvent.click(screen.getByRole("radio", { name: "Правильный ответ 2" }));
    fireEvent.click(switchScaleCorrect());
    fireEvent.click(screen.getByTestId("button-submit-question"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(postedBody().correctJson).toEqual({});
  });

  it("prefills a measurement scale in edit mode with the switch off", async () => {
    renderDrawer({ question: measurementScale });
    const first = (await screen.findByTestId("input-option-0")) as HTMLInputElement;
    expect(first.value).toBe("Никогда");
    expect(switchScaleCorrect().checked).toBe(false);
    expect(screen.queryByRole("radio", { name: /Правильный ответ/ })).toBeNull();
  });

  it("prefills a checked scale in edit mode with the switch on and the mark set", async () => {
    renderDrawer({ question: checkedScale });
    await screen.findByTestId("input-option-0");
    expect(switchScaleCorrect().checked).toBe(true);
    expect(screen.getByRole("radio", { name: "Правильный ответ 3" })).toBeChecked();
  });

  it("requires at least two graduations", () => {
    renderDrawer({ defaultTopicId: "t1" });
    pickScale();
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Утверждение" } });
    // Two of the four default rows filled → valid; clearing one drops below the floor.
    fireEvent.change(screen.getByTestId("input-option-0"), { target: { value: "Никогда" } });
    expect(screen.getByText("Добавьте не менее двух градаций")).toBeInTheDocument();
  });

  it("requires the mark only while the switch is on", () => {
    renderDrawer({ defaultTopicId: "t1" });
    pickScale();
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Утверждение" } });
    fireEvent.change(screen.getByTestId("input-option-0"), { target: { value: "Никогда" } });
    fireEvent.change(screen.getByTestId("input-option-1"), { target: { value: "Постоянно" } });
    // Measurement mode: no mark needed, the form is valid.
    expect(screen.queryByText("Отметьте правильную градацию")).toBeNull();
    // With the switch on and the mark pointing at an EMPTY row, the error appears.
    fireEvent.click(switchScaleCorrect());
    fireEvent.click(screen.getByRole("radio", { name: "Правильный ответ 3" }));
    expect(screen.getByText("Отметьте правильную градацию")).toBeInTheDocument();
  });
});

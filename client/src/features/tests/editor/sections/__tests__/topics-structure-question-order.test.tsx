/**
 * @module features/tests/editor/sections/__tests__/topics-structure-question-order.test
 * @description PRD-30 Э5: the topic card's delivery-order switch («Случайный
 * порядок вопросов») and its hints.
 *
 * Wireframe: docs/wireframes/approved/prd30-question-order.html (states fixed /
 * random / variants / flat). The switch reads «Случайный порядок вопросов», so
 * ON = `random` (today's behaviour) and OFF = `fixed` — the inversion between
 * label and stored value is exactly what these tests pin.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompositionSection } from "../topics-structure-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

function baseModel(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_by_topics",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Sample",
      description: "",
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: {
      timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false,
      allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true, quickAdvance: false,
      copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
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
    feedbackEvents: [],
    defaultPoints: null,
    ...over,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [{ id: "top-1", name: "Основы ИБ", questionCount: 10 }],
    text: async () => "[]",
  })));
});
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: React.JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const ORDER = "topic-question-order-top-1";
const RESET = "topic-question-order-reset-top-1";
const TEST_ORDER = "test-question-order";

/** Текущее значение контрола: DS Select держит его в подписи триггера. */
const valueOf = (testId: string) => screen.getByTestId(testId).textContent;

/**
 * Открыть список: DS Select вешает testid на обёртку, а кликать надо по
 * внутренней кнопке-триггеру.
 */
function open(testId: string) {
  fireEvent.click(within(screen.getByTestId(testId)).getByRole("button"));
}

/** Открыть список и выбрать значение по подписи. */
function pick(testId: string, label: string) {
  open(testId);
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("правило теста (PRD-30 FR-16/FR-17)", () => {
  it("по умолчанию — «Перемешивание»: сегодняшнее поведение всех тестов", () => {
    renderWithClient(<CompositionSection model={baseModel()} updateModel={() => {}} />);

    expect(valueOf(TEST_ORDER)).toContain("Перемешивание");
    expect(screen.getByText(/вопросы перемешиваются внутри темы/)).toBeInTheDocument();
  });

  it("в сплошном режиме предлагает «Полное перемешивание»", () => {
    renderWithClient(
      <CompositionSection model={baseModel({ flowMode: "linear_flat" })} updateModel={() => {}} />,
    );
    open(TEST_ORDER);

    expect(screen.getByRole("option", { name: "Полное перемешивание" })).toBeInTheDocument();
  });

  it.each(["linear_by_topics", "router_by_topics"] as const)(
    "в режиме %s третьей позиции нет — границу темы держит сам режим",
    (flowMode) => {
      renderWithClient(<CompositionSection model={baseModel({ flowMode })} updateModel={() => {}} />);
      open(TEST_ORDER);

      expect(screen.queryByRole("option", { name: "Полное перемешивание" })).not.toBeInTheDocument();
    },
  );

  it("выбор значения кладётся в модель", () => {
    const updateModel = vi.fn();
    const model = baseModel({ flowMode: "linear_flat" });

    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    pick(TEST_ORDER, "Полное перемешивание");

    const patched = updateModel.mock.calls[0][0](model) as TestEditorModel;
    expect(patched.questionOrder).toBe("shuffle_all");
  });

  it("хвост строки объясняет «полное перемешивание»", () => {
    renderWithClient(
      <CompositionSection
        model={baseModel({ flowMode: "linear_flat", questionOrder: "shuffle_all" })}
        updateModel={() => {}}
      />,
    );

    expect(screen.getByText(/вопросы всех тем идут одним перемешанным потоком/)).toBeInTheDocument();
  });
});

describe("порядок в теме — наследование (PRD-30 FR-18)", () => {
  it("по умолчанию тема стоит на «Как в тесте», и сбрасывать нечего", () => {
    const model = baseModel({ sections: [buildSection()] });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(valueOf(ORDER)).toContain("Как в тесте");
    expect(screen.queryByTestId(RESET)).not.toBeInTheDocument();
  });

  it("хвост показывает, ЧТО именно тема унаследовала", () => {
    const fixed = baseModel({ questionOrder: "fixed", sections: [buildSection()] });
    const { unmount } = renderWithClient(<CompositionSection model={fixed} updateModel={() => {}} />);
    // Ищем внутри карточки темы: тот же текст стоит и в хвосте правила теста.
    expect(
      within(screen.getByTestId("topic-row-top-1")).getByText(/по индексу, заданному в теме/),
    ).toBeInTheDocument();
    unmount();

    const mixed = baseModel({
      flowMode: "linear_flat",
      questionOrder: "shuffle_all",
      sections: [buildSection()],
    });
    renderWithClient(<CompositionSection model={mixed} updateModel={() => {}} />);
    expect(screen.getByText(/вопросы темы уходят в общий поток/)).toBeInTheDocument();
  });

  it("переопределение показывает пиктограмму сброса — она и есть признак", () => {
    const model = baseModel({ sections: [buildSection({ questionOrder: "fixed" })] });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(valueOf(ORDER)).toContain("Фиксированный порядок");
    expect(screen.getByTestId(RESET)).toBeInTheDocument();
  });

  it("сброс возвращает тему к значению теста", () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [buildSection({ questionOrder: "fixed" })] });

    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId(RESET));

    const patched = updateModel.mock.calls[0][0](model) as TestEditorModel;
    expect(patched.sections[0].questionOrder).toBeNull();
  });

  it("в режиме вариантов фиксированный порядок ссылается на список варианта (FR-07)", () => {
    const model = baseModel({
      sections: [buildSection({
        questionOrder: "fixed",
        formSet: { forms: [
          { id: "f1", label: "Вариант 1", questionIds: ["q1"] },
          { id: "f2", label: "Вариант 2", questionIds: ["q2"] },
        ] },
      })],
    });

    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    expect(screen.getByText(/в порядке списка варианта/)).toBeInTheDocument();
  });
});

describe("порядок в теме — редактирование", () => {
  it("выбор «Фиксированный порядок» кладёт переопределение", () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [buildSection()] });

    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    pick(ORDER, "Фиксированный порядок");

    const patched = updateModel.mock.calls[0][0](model) as TestEditorModel;
    expect(patched.sections[0].questionOrder).toBe("fixed");
  });

  it("выбор «Как в тесте» снимает переопределение", () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [buildSection({ questionOrder: "fixed" })] });

    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    pick(ORDER, "Как в тесте");

    const patched = updateModel.mock.calls[0][0](model) as TestEditorModel;
    expect(patched.sections[0].questionOrder).toBeNull();
  });
});

describe("настройка работает во всех режимах прохождения (PRD-30 FR-12)", () => {
  // У строки был баннер «порядок не сохранится» в сплошном режиме. Он был верен
  // только для пакета и по неверной причине: рантайм перемешивал собранный поток
  // вторым проходом поверх уже выстроенного порядка. Перемешивание живёт в одном
  // месте, настройка действует везде, предупреждения нет.
  it.each(["linear_flat", "linear_by_topics", "router_by_topics"] as const)(
    "в режиме %s предупреждения под контролом нет",
    (flowMode) => {
      const model = baseModel({ flowMode, sections: [buildSection({ questionOrder: "fixed" })] });

      renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

      expect(screen.queryByTestId("topic-question-order-flat-warning-top-1")).not.toBeInTheDocument();
      expect(screen.queryByText(/не сохранится/)).not.toBeInTheDocument();
    },
  );
});

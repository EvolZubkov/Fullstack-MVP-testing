/**
 * @module features/tests/editor/sections/__tests__/topics-structure-section.test
 * @description Component tests for the «Состав» tab content.
 *
 * Coverage:
 *   - Renders one tb-topic-row per section with name, count, draw-count input.
 *   - Empty state shown when sections array is empty.
 *   - Draw-count input clamps to [1, maxQuestions] and calls `updateModel`.
 *   - Remove icon drops the section from the model.
 *   - «+ Добавить тему» opens the topic picker; clicking a topic appends a
 *     section with the default drawCount.
 *   - Clicking tb-feedback-preview opens FeedbackEditorModal.
 *   - Saving in FeedbackEditorModal patches the section feedback via updateModel.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CompositionSection,
  moveTopicOnto,
  moveTopicToGroup,
  reorderGroups,
} from "../topics-structure-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import { buildFieldErrorIndex } from "../../field-errors";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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
      descriptionFormat: "plain",
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: { timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false, allowReturnToUnanswered: true, allowFreeSectionNavigation: false, allowAnswerChange: false, showSectionResults: true, skipReviewWhenComplete: false, closeSectionOnLeave: false, quickAdvance: false, copyProtection: true, protectionWatermark: false, protectionHideOnBlur: false, lmsAttemptResult: "best" as const },
    passRules: {
      decisionPolicy: "overall_only",
      overall: { type: "percent", value: 70 },
      byTopic: {},
    },
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

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [
      { id: "top-1", name: "Основы ИБ", questionCount: 10 },
      { id: "top-2", name: "Сетевая безопасность", questionCount: 6 },
    ],
    text: async () => "[]",
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: React.JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<CompositionSection />", () => {
  it("shows empty placeholder when sections array is empty", () => {
    renderWithClient(
      <CompositionSection model={baseModel()} updateModel={() => {}} />,
    );
    expect(screen.getByTestId("composition-empty")).toBeInTheDocument();
  });

  // Контракт «Индикация проблем»: ошибка, о которой сказал баннер, обязана быть
  // видна на месте. Тело карточки темы существует только в развёрнутом виде, и
  // свёрнутая карточка молчала: автор видел «Поля с ошибками: 1» и пустой экран.
  it("свёрнутая карточка темы несёт точку ошибки и якорь перехода", () => {
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", topicName: "Основы ИБ", drawCount: 4 })],
    });
    const fieldErrors = buildFieldErrorIndex([
      {
        field: "sections[0].formSetJson",
        code: "range",
        message: "Тема «Основы ИБ»: нужно не менее 2 вариантов теста.",
        severity: "error",
      },
    ]);
    renderWithClient(
      <CompositionSection model={model} updateModel={() => {}} fieldErrors={fieldErrors} />,
    );

    const row = screen.getByTestId("topic-row-top-1");
    expect(row.getAttribute("aria-expanded")).not.toBe("true");
    expect(row.getAttribute("data-field")).toBe("sections[0]");
    const dot = screen.getByTestId("topic-issue-top-1");
    expect(dot.className).toContain("tb-status-dot--err");
  });

  it("у темы без ошибок точки в шапке нет", () => {
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", topicName: "Основы ИБ", drawCount: 4 })],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.queryByTestId("topic-issue-top-1")).toBeNull();
  });

  // Якоря блоков внутри темы: без них «Перейти к ошибкам» некуда вести — путь
  // `sections[0].formSetJson` совпадал лишь с общим `sections` на кнопке «Добавить тему».
  it("блоки квот и вариантов несут собственные якоря", () => {
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", topicName: "Основы ИБ", drawCount: 4 })],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    fireEvent.click(screen.getByTestId("topic-chev-top-1"));

    const row = screen.getByTestId("topic-row-top-1");
    expect(row.querySelector('[data-field="sections[0].drawBlueprintJson"]')).not.toBeNull();
    expect(row.querySelector('[data-field="sections[0].formSetJson"]')).not.toBeNull();
  });

  it("шеврон строки темы разворачивает её, а не молчит", () => {
    // Шеврон — привычная мишень разворота, и в дизайн-системе он ЧАСТЬ кнопки-триггера.
    // В этой карточке шапка собрана вручную (кнопку удаления нельзя вкладывать в кнопку
    // раскрытия), шеврон оказался снаружи и кликов не принимал: выглядел живым, а не был.
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", topicName: "Основы ИБ", drawCount: 4 })],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);

    const row = screen.getByTestId("topic-row-top-1");
    const trigger = screen.getByTestId("topic-toggle-top-1");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByTestId("topic-chev-top-1"));

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(row.className).toContain("is-open");

    // И обратно: второй клик сворачивает.
    fireEvent.click(screen.getByTestId("topic-chev-top-1"));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders a tb-topic-row per section", () => {
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", topicName: "Основы ИБ", drawCount: 4 })],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    const row = screen.getByTestId("topic-row-top-1");
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent("Основы ИБ");
    expect((screen.getByTestId("topic-drawcount-top-1") as HTMLInputElement).value).toBe("4");
  });

  // PRD-15 E-11: a section whose topic is no longer in the visibility-scoped
  // /api/topics is flagged «Тема недоступна»; a visible one is not.
  it("flags a section whose topic the author can no longer see (E-11)", async () => {
    const model = baseModel({
      sections: [
        buildSection({ topicId: "top-1", topicName: "Основы ИБ" }),
        buildSection({ topicId: "gone", topicName: "Скрытая тема" }),
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("topic-unavailable-gone")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("topic-unavailable-top-1")).not.toBeInTheDocument();
  });

  function runUpdater(
    updateModel: ReturnType<typeof vi.fn>,
    model: TestEditorModel,
    call = 0,
  ): TestEditorModel {
    const updater = updateModel.mock.calls[call][0] as (
      m: TestEditorModel,
    ) => TestEditorModel;
    return updater(model);
  }

  it("clamps draw count above maxQuestions down to maxQuestions", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", maxQuestions: 5, drawCount: 3 })],
    });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );
    fireEvent.change(screen.getByTestId("topic-drawcount-top-1"), { target: { value: "99" } });
    expect(runUpdater(updateModel, model).sections[0].drawCount).toBe(5);
  });

  it("clamps draw count below 1 up to 1", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", maxQuestions: 5, drawCount: 3 })],
    });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );
    fireEvent.change(screen.getByTestId("topic-drawcount-top-1"), { target: { value: "0" } });
    expect(runUpdater(updateModel, model).sections[0].drawCount).toBe(1);
  });

  it("passes through valid draw count within range", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ topicId: "top-1", maxQuestions: 5, drawCount: 3 })],
    });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );
    fireEvent.change(screen.getByTestId("topic-drawcount-top-1"), { target: { value: "4" } });
    expect(runUpdater(updateModel, model).sections[0].drawCount).toBe(4);
  });

  it("toggles section.required via the Switch in the topic-row header", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        buildSection({ topicId: "top-1", required: false }),
        buildSection({ topicId: "top-2", topicName: "T2", required: true }),
      ],
    });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );
    fireEvent.click(screen.getByTestId("topic-required-top-1"));
    const result = runUpdater(updateModel, model);
    expect(result.sections[0].required).toBe(true);
    expect(result.sections[1].required).toBe(true);
  });

  it("remove icon drops the section from the model", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        buildSection({ topicId: "top-1" }),
        buildSection({ topicId: "top-2", topicName: "T2" }),
      ],
    });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );
    fireEvent.click(screen.getByTestId("topic-remove-top-1"));
    expect(runUpdater(updateModel, model).sections.map((s) => s.topicId)).toEqual(["top-2"]);
  });

  it("«+ Добавить тему» opens the picker and clicking a topic appends a section", async () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [] });
    renderWithClient(
      <CompositionSection model={model} updateModel={updateModel} />,
    );

    fireEvent.click(screen.getByTestId("composition-add-topic"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /Добавить тему/i })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("topic-picker-item-top-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("topic-picker-item-top-1"));
    const result = runUpdater(updateModel, model);
    expect(result.sections.map((s) => s.topicId)).toEqual(["top-1"]);
    expect(result.sections[0].drawCount).toBe(5);
    expect(result.sections[0].topicName).toBe("Основы ИБ");
    expect(result.sections[0].maxQuestions).toBe(10);
  });

  // Обратная связь темы правится не здесь: с Э2.3 она живёт на вкладке «Обратная связь и
  // итоги», карточкой «По темам», где показана РАЗРЕШЁННОЙ — с источником и сбросом.
  // Её проверки переехали в `topic-feedback-card.test.tsx`.
});

describe("<CompositionSection />: группы тем", () => {
  const runUpdater = (fn: ReturnType<typeof vi.fn>, model: TestEditorModel) =>
    (fn.mock.calls[0][0] as (m: TestEditorModel) => TestEditorModel)(model);

  /** Тест с двумя темами: одна в группе, одна вне групп. */
  function grouped(): TestEditorModel {
    return baseModel({
      sectionGroups: [{ key: "group-1", label: "Управленческие компетенции" }],
      sections: [
        buildSection({ topicId: "top-1", topicName: "Основы ИБ", groupKey: "group-1" }),
        buildSection({ topicId: "top-2", topicName: "Сетевая безопасность", groupKey: null }),
      ],
    });
  }

  it("без групп список плоский, а кнопки заводят РАЗНЫЕ сущности", () => {
    const model = baseModel({ sections: [buildSection()] });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("composition-topics")).toBeInTheDocument();
    expect(screen.getByTestId("composition-add-topic")).toBeInTheDocument();
    expect(screen.getByTestId("composition-add-group")).toBeInTheDocument();
    expect(screen.queryByTestId("composition-group-__ungrouped__")).toBeNull();
  });

  it("первая заведённая группа переводит список в сгруппированный вид", () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [buildSection()] });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("composition-add-group"));
    const next = runUpdater(updateModel, model);
    expect(next.sectionGroups).toEqual([{ key: "group-1", label: "Новая группа" }]);
    // Темы при этом никуда не уезжают: группа пустая, тема осталась вне групп.
    expect(next.sections[0].groupKey ?? null).toBeNull();
  });

  it("темы разложены по карточкам, у каждой свой счётчик", () => {
    renderWithClient(<CompositionSection model={grouped()} updateModel={() => {}} />);
    expect(screen.getByTestId("composition-group-count-group-1")).toHaveTextContent("1 тема");
    expect(screen.getByTestId("composition-group-count-__ungrouped__")).toHaveTextContent("1 тема");
    expect(screen.getByTestId("composition-group-topics-group-1")).toHaveTextContent("Основы ИБ");
    expect(screen.getByTestId("composition-group-topics-__ungrouped__")).toHaveTextContent(
      "Сетевая безопасность",
    );
  });

  it("«Добавить тему» есть и в группе, и под группами — и в общей панели её больше нет", () => {
    renderWithClient(<CompositionSection model={grouped()} updateModel={() => {}} />);
    expect(screen.getByTestId("composition-group-add-topic-group-1")).toBeInTheDocument();
    expect(screen.getByTestId("composition-group-add-topic-__ungrouped__")).toBeInTheDocument();
    expect(screen.queryByTestId("composition-add-topic")).toBeNull();
  });

  it("тема, добавленная из карточки группы, попадает В ЭТУ группу", async () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sectionGroups: [{ key: "group-1", label: "Компетенции" }],
      sections: [],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("composition-group-add-topic-group-1"));
    await waitFor(() => expect(screen.getByTestId("topic-picker-item-top-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("topic-picker-item-top-1"));
    expect(runUpdater(updateModel, model).sections[0].groupKey).toBe("group-1");
  });

  it("удаление группы уводит её темы «вне групп», а не удаляет их", () => {
    const updateModel = vi.fn();
    const model = grouped();
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("composition-group-remove-group-1"));
    const next = runUpdater(updateModel, model);
    expect(next.sectionGroups).toEqual([]);
    expect(next.sections.map((s) => s.topicId)).toEqual(["top-1", "top-2"]);
    expect(next.sections[0].groupKey).toBeNull();
  });

  it("пустая группа остаётся: сама по себе она не исчезает", () => {
    const model = baseModel({
      sectionGroups: [{ key: "group-1", label: "Пока пусто" }],
      sections: [buildSection({ groupKey: null })],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("composition-group-group-1")).toBeInTheDocument();
    expect(screen.getByTestId("composition-group-count-group-1")).toHaveTextContent("0 тем");
    expect(screen.getByTestId("composition-group-empty-group-1")).toBeInTheDocument();
  });

  it("имя группы правится на месте", () => {
    const updateModel = vi.fn();
    const model = grouped();
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.change(screen.getByTestId("composition-group-name-group-1"), {
      target: { value: "Знания" },
    });
    expect(runUpdater(updateModel, model).sectionGroups?.[0].label).toBe("Знания");
  });

  it("раздел с ключом несуществующей группы считается «вне групп» (FR-12)", () => {
    const model = baseModel({
      sectionGroups: [{ key: "group-1", label: "Компетенции" }],
      sections: [buildSection({ groupKey: "group-99" })],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("composition-group-count-__ungrouped__")).toHaveTextContent("1 тема");
    expect(screen.getByTestId("composition-group-count-group-1")).toHaveTextContent("0 тем");
  });

  it("у каждой темы есть ручка перемещения — и в группе, и без групп", () => {
    renderWithClient(<CompositionSection model={grouped()} updateModel={() => {}} />);
    expect(screen.getByTestId("topic-grip-top-1")).toBeInTheDocument();
    expect(screen.getByTestId("topic-grip-top-2")).toBeInTheDocument();
    // У служебной карточки «вне групп» ручки нет: это не группа, её не переставляют.
    expect(screen.getByTestId("composition-group-grip-group-1")).toBeInTheDocument();
    expect(screen.queryByTestId("composition-group-grip-__ungrouped__")).toBeNull();
  });
});

describe("перетаскивание: правила перестановки", () => {
  /** Тест с двумя группами и четырьмя темами — минимум, на котором видны все три случая. */
  function model(): TestEditorModel {
    return baseModel({
      sectionGroups: [
        { key: "g1", label: "Компетенции" },
        { key: "g2", label: "Знания" },
      ],
      sections: [
        buildSection({ topicId: "a", groupKey: "g1" }),
        buildSection({ topicId: "b", groupKey: "g1" }),
        buildSection({ topicId: "c", groupKey: "g2" }),
        buildSection({ topicId: "d", groupKey: null }),
      ],
    });
  }

  it("группы меняются местами, и `order` переписывается местом в списке", () => {
    const next = reorderGroups(model(), "g2", "g1");
    expect(next.sectionGroups).toEqual([
      { key: "g2", label: "Знания", order: 0 },
      { key: "g1", label: "Компетенции", order: 1 },
    ]);
  });

  it("бросок на ЗОНУ меняет только группу — порядок выдачи остаётся", () => {
    const next = moveTopicToGroup(model(), "d", "g2");
    expect(next.sections.map((s) => s.topicId)).toEqual(["a", "b", "c", "d"]);
    expect(next.sections.find((s) => s.topicId === "d")?.groupKey).toBe("g2");
  });

  it("бросок на ЗОНУ «вне групп» вынимает тему из группы", () => {
    const next = moveTopicToGroup(model(), "a", null);
    expect(next.sections.find((s) => s.topicId === "a")?.groupKey).toBeNull();
  });

  it("бросок на ТЕМУ берёт и её место, и её группу", () => {
    const next = moveTopicOnto(model(), "d", "a");
    expect(next.sections.map((s) => s.topicId)).toEqual(["d", "a", "b", "c"]);
    expect(next.sections[0].groupKey).toBe("g1");
  });

  it("бросок на тему с ключом несуществующей группы даёт «вне групп», а не чужой ключ", () => {
    const m = baseModel({
      sectionGroups: [{ key: "g1", label: "Компетенции" }],
      sections: [
        buildSection({ topicId: "a", groupKey: "g1" }),
        buildSection({ topicId: "b", groupKey: "ghost" }),
      ],
    });
    expect(moveTopicOnto(m, "a", "b").sections.find((s) => s.topicId === "a")?.groupKey).toBeNull();
  });

  it("бросок темы на саму себя модель не меняет", () => {
    const m = model();
    expect(moveTopicOnto(m, "a", "a")).toBe(m);
    expect(reorderGroups(m, "g1", "g1")).toBe(m);
  });
});

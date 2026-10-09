/**
 * @module features/tests/editor/sections/__tests__/band-feedback-section
 * @description Решение владельца 2026-09-07: «Обратная связь» — группа рейла с четырьмя
 * дочерними пунктами. Проверяется главное следствие правила: пункт показывается ТОЛЬКО
 * когда в нём есть что перечислять, а текст уровня правится в тех же полях модели, что
 * правит конструктор уровней в «Оценке результата».
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { FeedbackTab } from "../editor-tabs";
import { emptyEditorModel } from "../../test-editor.mappers";
import type { ResultVariableModel, ScaleBandModel, ScaleModel, TestEditorModel } from "../../test-editor.types";

function band(over: Partial<ScaleBandModel> = {}): ScaleBandModel {
  return { min: "0", max: "50", label: "Базовый", level: "basic", text: "", tone: "", ...over };
}

function scale(over: Partial<ScaleModel> = {}): ScaleModel {
  return {
    clientKey: "s1",
    key: "company_culture",
    label: "Корпоративная культура",
    // PRD-53 §4.4: описание шкалы — обязательное поле модели; пустая строка = «не задано».
    description: "",
    type: "number",
    aggregation: "sum",
    normalization: "none",
    direction: "positive",
    bands: [],
    domainMin: null,
    domainMax: null,
    displayMax: null,
    valence: "none",
    learnerVisibility: "hidden",
    scormTarget: "none",
    sortOrder: 0,
    ...over,
  };
}

function metric(over: Partial<ResultVariableModel> = {}): ResultVariableModel {
  return {
    clientKey: "m1",
    name: "burnout_index",
    label: "Индекс выгорания",
    type: "number",
    formula: "",
    learnerVisibility: "hidden",
    scormTarget: "none",
    controlsStatus: "none",
    bands: [],
    outcomes: [],
    domainMin: null,
    domainMax: null,
    valence: "none",
    sortOrder: 0,
    ...over,
  } as ResultVariableModel;
}

function baseModel(over: Partial<TestEditorModel> = {}): TestEditorModel {
  const base = emptyEditorModel({ folderId: null });
  return { ...base, basic: { ...base.basic, title: "Тест" }, ...over };
}

function renderTab(model: TestEditorModel) {
  const updateModel = vi.fn();
  // Реестр обратной связи вопросов («Во время теста») ходит запросом — вкладке нужен клиент.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <FeedbackTab model={model} updateModel={updateModel} />
    </QueryClientProvider>,
  );
  return { updateModel };
}

/** Прогнать мутатор, отданный вкладкой, по исходной модели. */
function applied(updateModel: ReturnType<typeof vi.fn>, model: TestEditorModel): TestEditorModel {
  const updater = updateModel.mock.calls.at(-1)?.[0] as (m: TestEditorModel) => TestEditorModel;
  return updater(model);
}

describe("рейл «Обратная связь и итоги» — дочерние пункты", () => {
  it("без уровней шкал и показателей и без адаптива видна только «Общее»", () => {
    renderTab(baseModel({ scales: [scale()], resultVariables: [metric()] }));
    expect(screen.getByTestId("feedback-rail-texts")).toHaveTextContent("Общее");
    // Пункт ПРЯЧЕТСЯ, а не гаснет: раздел из одних тегов «уровни не заданы» сообщал бы
    // о настройке, которой автор ещё не делал.
    expect(screen.queryByTestId("feedback-rail-scale-levels")).toBeNull();
    expect(screen.queryByTestId("feedback-rail-metric-levels")).toBeNull();
    expect(screen.queryByTestId("feedback-rail-difficulty-levels")).toBeNull();
  });

  it("«По темам» — свой пункт, и только когда темы есть", () => {
    // Тексты тем и подтем пишут не в один присест с общим текстом теста.
    renderTab(baseModel());
    expect(screen.queryByTestId("feedback-rail-topics")).toBeNull();

    const withTopic = baseModel({
      sections: [
        {
          topicId: "top-1",
          topicName: "Финансы",
          maxQuestions: 10,
          drawCount: 5,
          drawAll: false,
          required: true,
          timeLimit: { source: "inherit_test" },
          feedback: { format: "plain", text: "" },
          feedbackLinks: [],
          feedbackAssets: [],
          feedbackEvents: [],
          defaultPoints: null,
        },
      ] as TestEditorModel["sections"],
    });
    renderTab(withTopic);
    expect(screen.getByTestId("feedback-rail-topics")).toHaveTextContent("По темам");
  });

  it("уровни шкалы открывают «По уровням шкал»", () => {
    renderTab(baseModel({ scales: [scale({ bands: [band()] })] }));
    expect(screen.getByTestId("feedback-rail-scale-levels")).toHaveTextContent("По уровням шкал");
  });

  it("уровни числового показателя открывают «По уровням показателей»", () => {
    renderTab(baseModel({ resultVariables: [metric({ bands: [band()] })] }));
    expect(screen.getByTestId("feedback-rail-metric-levels")).toBeInTheDocument();
  });

  it("строковый показатель уровней не даёт: у него исходы, а не уровни", () => {
    renderTab(baseModel({ resultVariables: [metric({ type: "string", bands: [band()] })] }));
    expect(screen.queryByTestId("feedback-rail-metric-levels")).toBeNull();
  });

  it("«По уровням сложности» есть только у адаптивного теста", () => {
    renderTab(baseModel({ mode: "adaptive" }));
    expect(screen.getByTestId("feedback-rail-difficulty-levels")).toHaveTextContent(
      "По уровням сложности",
    );
  });

  it("пункты — второй уровень рейла под подписью «Обратная связь»", () => {
    renderTab(baseModel({ scales: [scale({ bands: [band()] })] }));
    const label = screen.getByText("Обратная связь");
    expect(label).toHaveClass("ou-drawer__rail-grouplbl");
    expect(screen.getByTestId("feedback-rail-scale-levels")).toHaveClass(
      "ou-drawer__rail-item--child",
    );
  });
});

describe("«По уровням шкал» — тексты уровней", () => {
  const model = baseModel({
    scales: [
      scale({ bands: [band(), band({ label: "", level: "high", min: "51", max: "100" })] }),
      scale({ clientKey: "s2", key: "leadership", label: "Лидерство", sortOrder: 1 }),
    ],
  });

  it("перечисляет шкалы: с уровнями и без", () => {
    renderTab(model);
    fireEvent.click(screen.getByTestId("feedback-rail-scale-levels"));
    expect(screen.getByText("COMPANY_CULTURE — Корпоративная культура")).toBeInTheDocument();
    expect(screen.getByText("2 уровня")).toBeInTheDocument();
    // Шкала без уровней остаётся в списке — тегом она говорит, чего у неё нет.
    expect(screen.getByText("LEADERSHIP — Лидерство")).toBeInTheDocument();
    expect(screen.getByText("уровни не заданы")).toBeInTheDocument();
  });

  it("уровень без подписи назван кодом — как в конструкторе уровней", () => {
    renderTab(model);
    fireEvent.click(screen.getByTestId("feedback-rail-scale-levels"));
    expect(screen.getByText("Уровень «Базовый»")).toBeInTheDocument();
    expect(screen.getByText("Уровень «high»")).toBeInTheDocument();
  });

  it("правка уходит в bands[].feedback той же шкалы", () => {
    const { updateModel } = renderTab(model);
    fireEvent.click(screen.getByTestId("feedback-rail-scale-levels"));
    fireEvent.click(screen.getByLabelText("Редактировать рекомендации уровня «Базовый»"));
    fireEvent.change(screen.getByTestId("feedback-editor-text"), {
      target: { value: "Начните с курса" },
    });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));

    const next = applied(updateModel, model);
    expect(next.scales[0].bands[0].feedback?.text).toBe("Начните с курса");
    // Соседний уровень и соседняя шкала не тронуты.
    expect(next.scales[0].bands[1].feedback).toBeUndefined();
    expect(next.scales[1].bands).toHaveLength(0);
  });
});

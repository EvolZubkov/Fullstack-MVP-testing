/**
 * @module features/tests/editor/sections/__tests__/scales-prd29
 * @description PRD-29 acceptance for the «Шкалы» editor tab: the learner-visibility
 * control is no longer hidden and offers THREE positions, the scale domain is an
 * explicit opt-in (so that 0 stays a legal bound rather than a "not set" signal),
 * the favourable direction (`valence`) is authorable, and the domain can be
 * pre-filled from the question contributions.
 *
 * The card renders its form only when expanded, so every case opens it first.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ScalesSection } from "../scales-section";
import { emptyEditorModel } from "../../test-editor.mappers";
import type {
  QuestionMeasurementModel,
  ScaleModel,
  TestEditorModel,
} from "../../test-editor.types";
import { loadContributionQuestions } from "../../scales-api";

vi.mock("../../scales-api", async () => {
  const actual = await vi.importActual<typeof import("../../scales-api")>("../../scales-api");
  return { ...actual, loadContributionQuestions: vi.fn().mockResolvedValue([]) };
});

const loadQuestionsMock = vi.mocked(loadContributionQuestions);

function scale(overrides: Partial<ScaleModel> = {}): ScaleModel {
  return {
    clientKey: "k1",
    key: "ee",
    label: "Эмоциональное истощение",
    type: "number",
    aggregation: "sum",
    normalization: "none",
    direction: "positive",
    bands: [],
    learnerVisibility: "hidden",
    scormTarget: "none",
    sortOrder: 0,
    domainMin: null,
    domainMax: null,
    valence: "none",
    ...overrides,
  };
}

function modelWithScale(overrides: Partial<ScaleModel> = {}): TestEditorModel {
  return { ...emptyEditorModel({ folderId: null }), scales: [scale(overrides)] };
}

/** Controlled host: the section is a draft editor, so patches must round-trip. */
function Harness({ initial }: { initial: TestEditorModel }) {
  const [model, setModel] = useState(initial);
  return <ScalesSection model={model} updateModel={(updater) => setModel((m) => updater(m))} />;
}

/** Render the section and expand the single scale card (collapsed by default). */
function renderExpanded(model: TestEditorModel) {
  render(<Harness initial={model} />);
  fireEvent.click(screen.getByLabelText("Развернуть шкалу"));
}

beforeEach(() => {
  loadQuestionsMock.mockReset();
  loadQuestionsMock.mockResolvedValue([]);
});

describe("ScalesSection (PRD-29)", () => {
  it("показывает выбор видимости — тогл больше не скрыт", () => {
    renderExpanded(modelWithScale());
    expect(screen.getByTestId("scales-visibility-0")).toBeInTheDocument();
  });

  it("предлагает три позиции видимости, включая «уровень без значения»", () => {
    renderExpanded(modelWithScale());
    fireEvent.click(screen.getByText("Не показывать"));
    expect(screen.getByText("Уровень и толкование")).toBeInTheDocument();
    expect(screen.getByText("Уровень, толкование и значение")).toBeInTheDocument();
  });

  it("по умолчанию поля домена скрыты — он выводится из интервалов", () => {
    renderExpanded(modelWithScale());
    expect(screen.getByTestId("scales-domain-manual-0")).toBeInTheDocument();
    expect(screen.queryByTestId("scales-domain-min-0")).toBeNull();
  });

  it("показывает поля домена, когда границы заданы вручную", () => {
    renderExpanded(modelWithScale({ domainMin: 0, domainMax: 45 }));
    expect(screen.getByTestId("scales-domain-min-0")).toBeInTheDocument();
    expect(screen.getByTestId("scales-domain-max-0")).toBeInTheDocument();
  });

  it("ноль остаётся законным значением границы, а не признаком «не задано»", () => {
    renderExpanded(modelWithScale({ domainMin: 0, domainMax: 45 }));
    // NumberInput — текстовое поле со степпером, поэтому значение сравнивается строкой.
    expect(screen.getByTestId("scales-domain-min-0")).toHaveValue("0");
    expect(screen.getByTestId("scales-domain-manual-0")).toBeChecked();
  });

  it("переключатель ручных границ работает в обе стороны", () => {
    renderExpanded(modelWithScale({ bands: [{ min: "0", max: "45", label: "", level: "low" }] }));
    const toggle = screen.getByTestId("scales-domain-manual-0");
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    // Засеяно охватом интервалов, ровно как это делает parseScaleInterpretation.
    expect(screen.getByTestId("scales-domain-min-0")).toHaveValue("0");
    expect(screen.getByTestId("scales-domain-max-0")).toHaveValue("45");

    fireEvent.click(screen.getByTestId("scales-domain-manual-0"));
    expect(screen.queryByTestId("scales-domain-min-0")).toBeNull();
  });

  it("показывает выбор благоприятного направления", () => {
    renderExpanded(modelWithScale());
    expect(screen.getByTestId("scales-valence-0")).toBeInTheDocument();
  });

  it("сохраняет выбранное направление в модели", () => {
    renderExpanded(modelWithScale());
    fireEvent.click(screen.getByText("Без оценки"));
    fireEvent.click(screen.getByText("Чем больше, тем хуже"));
    expect(screen.getByTestId("scales-valence-0")).toHaveTextContent("Чем больше, тем хуже");
  });

  it("предзаполняет домен расчётом по вкладам: девять вопросов по шесть градаций 0..5 → 45", async () => {
    loadQuestionsMock.mockResolvedValue(
      Array.from({ length: 9 }, (_, q) => ({
        id: `q${q + 1}`,
        topicId: "t1",
        prompt: `Вопрос ${q + 1}`,
        type: "scale" as const,
        units: [],
      })),
    );
    const measurements: QuestionMeasurementModel[] = [];
    for (let q = 1; q <= 9; q += 1) {
      for (let grade = 0; grade <= 5; grade += 1) {
        measurements.push({
          questionId: `q${q}`,
          scaleKey: "ee",
          sourceType: "option",
          sourceKey: String(grade),
          value: grade,
          weight: 1,
        });
      }
    }
    renderExpanded({ ...modelWithScale({ domainMin: 1, domainMax: 2 }), measurements });

    const suggest = screen.getByTestId("scales-domain-suggest-0");
    await waitFor(() => expect(suggest).toBeEnabled());
    fireEvent.click(suggest);

    expect(screen.getByTestId("scales-domain-min-0")).toHaveValue("0");
    expect(screen.getByTestId("scales-domain-max-0")).toHaveValue("45");
  });

  it("предупреждает, когда сохранённый домен расходится с расчётным, но не пересчитывает молча", async () => {
    loadQuestionsMock.mockResolvedValue([
      { id: "q1", topicId: "t1", prompt: "Вопрос", type: "scale" as const, units: [] },
    ]);
    const measurements: QuestionMeasurementModel[] = [
      { questionId: "q1", scaleKey: "ee", sourceType: "option", sourceKey: "0", value: 0, weight: 1 },
      { questionId: "q1", scaleKey: "ee", sourceType: "option", sourceKey: "1", value: 5, weight: 1 },
    ];
    renderExpanded({ ...modelWithScale({ domainMin: 0, domainMax: 45 }), measurements });

    expect(await screen.findByTestId("scales-domain-drift-0")).toBeInTheDocument();
    expect(screen.getByTestId("scales-domain-max-0")).toHaveValue("45");
  });
});

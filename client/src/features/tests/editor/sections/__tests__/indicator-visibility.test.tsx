/**
 * @module features/tests/editor/sections/__tests__/indicator-visibility.test
 * @description PRD-29 acceptance (defect D-1) for the «Показатели» editor tab:
 * an indicator must expose the learner-visibility control, otherwise
 * `learnerVisibility` stays `hidden` forever and the methodology verdict — the
 * whole point of a measurement test — can never be shown to the learner.
 *
 * The control must exist for EVERY indicator type (string / number / boolean),
 * carry the SAME three positions as the scales tab (one shared option list), and
 * the chosen position must round-trip into the editor model.
 *
 * The indicator card renders its form only when expanded, so every case opens it
 * first. The DS `Select` is a listbox over a button trigger (not a native
 * `<select>`), so a choice is made by clicking the trigger and then the option.
 */

import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { ResultVariablesSection } from "../result-variables-section";
import { emptyEditorModel } from "../../test-editor.mappers";
import type { ResultVariableModel, TestEditorModel } from "../../test-editor.types";

function variable(overrides: Partial<ResultVariableModel> = {}): ResultVariableModel {
  return {
    clientKey: "v1",
    name: "burnout_level",
    label: "Состояние",
    type: "string",
    formula: '"growing"',
    learnerVisibility: "hidden",
    scormTarget: "both",
    controlsStatus: "none",
    bands: [],
    outcomes: [],
    domainMin: null,
    domainMax: null,
    valence: "none",
    sortOrder: 0,
    ...overrides,
  };
}

function modelWithVariable(overrides: Partial<ResultVariableModel> = {}): TestEditorModel {
  return { ...emptyEditorModel({ folderId: null }), resultVariables: [variable(overrides)] };
}

/** Controlled host: the section edits a draft, so patches must round-trip. */
function Harness({ initial, seen }: { initial: TestEditorModel; seen: TestEditorModel[] }) {
  const [model, setModel] = useState(initial);
  seen[0] = model;
  return (
    <ResultVariablesSection
      model={model}
      updateModel={(updater) =>
        setModel((m) => {
          const next = updater(m);
          seen[0] = next;
          return next;
        })
      }
    />
  );
}

/** Render the section and expand the single indicator card (collapsed by default). */
function renderExpanded(model: TestEditorModel): TestEditorModel[] {
  const seen: TestEditorModel[] = [];
  render(<Harness initial={model} seen={seen} />);
  fireEvent.click(screen.getByLabelText("Развернуть показатель"));
  return seen;
}

describe("видимость показателя (PRD-29, D-1)", () => {
  it("контрол есть в форме строкового показателя", () => {
    renderExpanded(modelWithVariable());
    expect(screen.getByTestId("metrics-visibility-0")).toBeInTheDocument();
  });

  it("контрол есть в форме числового показателя", () => {
    renderExpanded(modelWithVariable({ type: "number", formula: "1" }));
    expect(screen.getByTestId("metrics-visibility-0")).toBeInTheDocument();
  });

  it("контрол есть в форме булева показателя — рядом с управлением статусом", () => {
    renderExpanded(modelWithVariable({ type: "boolean", formula: "true" }));
    expect(screen.getByTestId("metrics-visibility-0")).toBeInTheDocument();
    expect(screen.getByTestId("metrics-status-0")).toBeInTheDocument();
  });

  it("предлагает те же три позиции, что и шкала", () => {
    renderExpanded(modelWithVariable());
    fireEvent.click(screen.getByText("Не показывать"));
    expect(screen.getByText("Уровень и толкование")).toBeInTheDocument();
    expect(screen.getByText("Уровень, толкование и значение")).toBeInTheDocument();
  });

  it("выбор кладётся в модель", () => {
    const seen = renderExpanded(modelWithVariable());
    fireEvent.click(screen.getByText("Не показывать"));
    fireEvent.click(screen.getByText("Уровень и толкование"));
    expect(seen[0].resultVariables[0].learnerVisibility).toBe("level");
  });

  it("в режиме просмотра контрол заблокирован", () => {
    render(<ResultVariablesSection model={modelWithVariable()} updateModel={() => {}} readOnly />);
    fireEvent.click(screen.getByLabelText("Развернуть показатель"));
    expect(screen.getByTestId("metrics-visibility-0")).toHaveClass("is-disabled");
  });
});

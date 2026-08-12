/**
 * @module features/tests/editor/sections/__tests__/measure-slot-toggles.test
 * @description PRD-49 §6: the results card is four slots (name, value, level,
 * explanation), and each of them gets its own control. «Показывать обучающемуся»
 * already governs the VALUE slot; these tests cover the two new switches — name and
 * level — in the indicator card and in the scale card.
 *
 * Two things are checked, and both matter:
 *   1. the switch reaches the editor draft, and
 *   2. the draft reaches `config_json` — the switches introduce NO new column, so a
 *      value that never lands in the config is a value that is never saved.
 *
 * Both cards render their form only when expanded, so every case opens it first.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { ResultVariablesSection } from "../result-variables-section";
import { ScalesSection } from "../scales-section";
import { emptyEditorModel } from "../../test-editor.mappers";
import { saveResultVariables } from "../../result-variables-api";
import { saveScales, loadContributionQuestions } from "../../scales-api";
import type {
  ResultVariableModel,
  ScaleModel,
  TestEditorModel,
} from "../../test-editor.types";

vi.mock("../../scales-api", async () => {
  const actual = await vi.importActual<typeof import("../../scales-api")>("../../scales-api");
  return { ...actual, loadContributionQuestions: vi.fn().mockResolvedValue([]) };
});

const loadQuestionsMock = vi.mocked(loadContributionQuestions);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function variable(overrides: Partial<ResultVariableModel> = {}): ResultVariableModel {
  return {
    id: "v1",
    name: "burnout_level",
    label: "Состояние",
    type: "string",
    formula: '"growing"',
    learnerVisibility: "level",
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

function scale(overrides: Partial<ScaleModel> = {}): ScaleModel {
  return {
    id: "s1",
    key: "ee",
    label: "Эмоциональное истощение",
    type: "number",
    aggregation: "sum",
    normalization: "none",
    direction: "positive",
    bands: [],
    learnerVisibility: "level",
    scormTarget: "none",
    sortOrder: 0,
    domainMin: null,
    domainMax: null,
    displayMax: null,
    valence: "none",
    ...overrides,
  };
}

// ─── Harnesses ────────────────────────────────────────────────────────────────

/** Controlled host: both sections edit a draft, so patches must round-trip. */
function IndicatorHarness({ initial, seen }: { initial: TestEditorModel; seen: TestEditorModel[] }) {
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

function ScaleHarness({ initial, seen }: { initial: TestEditorModel; seen: TestEditorModel[] }) {
  const [model, setModel] = useState(initial);
  seen[0] = model;
  return (
    <ScalesSection
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

function renderIndicator(v: ResultVariableModel): TestEditorModel[] {
  const seen: TestEditorModel[] = [];
  const model = { ...emptyEditorModel({ folderId: null }), resultVariables: [v] };
  render(<IndicatorHarness initial={model} seen={seen} />);
  fireEvent.click(screen.getByLabelText("Развернуть показатель"));
  return seen;
}

function renderScale(s: ScaleModel): TestEditorModel[] {
  const seen: TestEditorModel[] = [];
  const model = { ...emptyEditorModel({ folderId: null }), scales: [s] };
  render(<ScaleHarness initial={model} seen={seen} />);
  fireEvent.click(screen.getByLabelText("Развернуть шкалу"));
  return seen;
}

/** Bodies of every non-GET call the save orchestrators made, in order. */
function stubMutations(): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return bodies;
}

beforeEach(() => {
  loadQuestionsMock.mockReset();
  loadQuestionsMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Indicator card ───────────────────────────────────────────────────────────

describe("слоты карточки показателя (PRD-49 §6)", () => {
  it("оба переключателя стоят в форме показателя и открыты", () => {
    renderIndicator(variable());
    expect((screen.getByLabelText("Показывать название") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Показывать уровень") as HTMLInputElement).checked).toBe(true);
  });

  it("выключение названия кладёт showName: false в черновик", () => {
    const seen = renderIndicator(variable());
    fireEvent.click(screen.getByLabelText("Показывать название"));
    expect(seen[0].resultVariables[0].showName).toBe(false);
    // Второй слот не задет: у слотов независимое управление.
    expect(seen[0].resultVariables[0].showLevel).toBeUndefined();
  });

  it("выключение уровня кладёт showLevel: false в черновик", () => {
    const seen = renderIndicator(variable());
    fireEvent.click(screen.getByLabelText("Показывать уровень"));
    expect(seen[0].resultVariables[0].showLevel).toBe(false);
  });

  it("выключенный слот уезжает в config_json показателя", async () => {
    const bodies = stubMutations();
    await saveResultVariables(
      "t1",
      [variable({ showName: false, showLevel: true })],
      [variable()],
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0].configJson).toMatchObject({ showName: false });
    // Включённый слот НЕ пишется: «показывать» — это отсутствие флага, поэтому
    // шкала/показатель, которых никто не трогал, сохраняют прежний config.
    expect(bodies[0].configJson).not.toHaveProperty("showLevel");
  });
});

// ─── Scale card ───────────────────────────────────────────────────────────────

describe("слоты карточки шкалы (PRD-49 §6)", () => {
  it("оба переключателя стоят в форме шкалы и открыты", () => {
    renderScale(scale());
    expect((screen.getByLabelText("Показывать название") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Показывать уровень") as HTMLInputElement).checked).toBe(true);
  });

  it("выключение названия кладёт showName: false в черновик", () => {
    const seen = renderScale(scale());
    fireEvent.click(screen.getByLabelText("Показывать название"));
    expect(seen[0].scales[0].showName).toBe(false);
  });

  it("выключение уровня кладёт showLevel: false в черновик", () => {
    const seen = renderScale(scale());
    fireEvent.click(screen.getByLabelText("Показывать уровень"));
    expect(seen[0].scales[0].showLevel).toBe(false);
  });

  it("выключенные слоты уезжают в config_json шкалы", async () => {
    const bodies = stubMutations();
    await saveScales("t1", [scale({ showName: false, showLevel: false })], [scale()]);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].configJson).toMatchObject({ showName: false, showLevel: false });
  });

  it("повторное включение возвращает config_json к прежнему виду", async () => {
    const bodies = stubMutations();
    await saveScales("t1", [scale({ showName: true, showLevel: true })], [scale()]);
    // Ничего не изменилось — диффер сравнивает config_json целиком и запроса не шлёт.
    expect(bodies).toHaveLength(0);
  });
});

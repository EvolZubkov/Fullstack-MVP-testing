/**
 * @module features/tests/editor/sections/__tests__/interpretation-editor
 * @description PRD-29 acceptance for authoring INTERPRETATIONS: the outcome list
 * of a string/boolean indicator (`OutcomesEditor`), the tone + explanatory text
 * added to the existing band table (`BandsEditor`), and — the load-bearing part —
 * the round trip of those fields through `config_json`.
 *
 * The round trip is tested end to end (save orchestrator -> stored config -> load
 * mapper) because saving rebuilds `config_json` from scratch: a one-sided change
 * would silently erase every interpretation on the next save, and the author would
 * only notice after reloading the page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { collectStringLiterals, findUnknownOutcomes } from "@shared/formula/outcome-literals";
import { OutcomesEditor } from "../outcomes-editor";
import { apiToEditorModel } from "../../test-editor.mappers";
import { saveScales } from "../../scales-api";
import { saveResultVariables } from "../../result-variables-api";
import type {
  OutcomeModel,
  ResultVariableModel,
  ScaleBandModel,
  ScaleModel,
} from "../../test-editor.types";

describe("OutcomesEditor", () => {
  const OUTCOMES = [{ clientKey: "o1", code: "engaged", label: "Вовлечённость", text: "", tone: "" as const }];

  it("рисует строку на каждый исход", () => {
    render(<OutcomesEditor outcomes={OUTCOMES} index={0} readOnly={false} onChange={() => {}} />);
    expect(screen.getByLabelText("код исхода 1")).toHaveValue("engaged");
    expect(screen.getByLabelText("метка исхода 1")).toHaveValue("Вовлечённость");
  });

  it("добавляет исход по кнопке", () => {
    const onChange = vi.fn();
    render(<OutcomesEditor outcomes={[]} index={0} readOnly={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Добавить исход/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
  });

  it("удаляет исход", () => {
    const onChange = vi.fn();
    render(<OutcomesEditor outcomes={OUTCOMES} index={0} readOnly={false} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Удалить исход 1"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("в режиме только для чтения не показывает удаление и добавление", () => {
    render(<OutcomesEditor outcomes={OUTCOMES} index={0} readOnly onChange={() => {}} />);
    expect(screen.queryByLabelText("Удалить исход 1")).toBeNull();
    expect(screen.queryByRole("button", { name: /Добавить исход/i })).toBeNull();
  });

  it("подсказывает коды, найденные в формуле, и добавляет их одним нажатием", () => {
    const onChange = vi.fn();
    render(
      <OutcomesEditor
        outcomes={[]}
        index={0}
        readOnly={false}
        onChange={onChange}
        suggestedCodes={["engaged", "burnout"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "burnout" }));
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ code: "burnout", label: "burnout" });
  });

  it("не показывает блок подсказок, когда неизвестных кодов нет", () => {
    render(<OutcomesEditor outcomes={OUTCOMES} index={0} readOnly={false} onChange={() => {}} />);
    expect(screen.queryByText(/В формуле встречаются коды/i)).toBeNull();
  });

  it("правит толкование и оценку строки", () => {
    const onChange = vi.fn();
    render(<OutcomesEditor outcomes={OUTCOMES} index={0} readOnly={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("толкование исхода 1"), {
      target: { value: "Ресурс восстанавливается" },
    });
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ text: "Ресурс восстанавливается" });
  });
});

// ─── Round trip: model -> config_json -> model ────────────────────────────────

function scale(overrides: Partial<ScaleModel> = {}): ScaleModel {
  return {
    key: "ee",
    label: "Истощение",
    type: "number",
    aggregation: "sum",
    normalization: "none",
    direction: "positive",
    bands: [],
    domainMin: null,
    domainMax: null,
    valence: "none",
    learnerVisibility: "hidden",
    scormTarget: "none",
    sortOrder: 0,
    ...overrides,
  };
}

function variable(overrides: Partial<ResultVariableModel> = {}): ResultVariableModel {
  return {
    name: "burnout",
    label: "Выгорание",
    type: "string",
    formula: 'IF(scale.ee.raw > 27, "burnout", "engaged")',
    learnerVisibility: "level",
    scormTarget: "both",
    controlsStatus: "none",
    bands: [],
    outcomes: [],
    sortOrder: 0,
    ...overrides,
  };
}

const RICH_BAND: ScaleBandModel = {
  min: "28",
  max: "45",
  label: "Высокий",
  level: "high",
  text: "Ресурс расходуется быстрее, чем восстанавливается",
  tone: "critical",
  feedback: {
    format: "plain",
    text: "Начните с восстановления режима сна",
    links: [{ title: "Курс «Ресурс»", url: "https://example.test/course" }],
    events: [{ title: "Вебинар о выгорании" }],
    assets: [],
  },
};

const RICH_OUTCOME: OutcomeModel = {
  code: "burnout",
  label: "Выгорание",
  text: "Показатель говорит об истощении",
  tone: "attention",
  feedback: {
    format: "plain",
    text: "Обратитесь к наставнику",
    links: [],
    events: [],
    assets: [],
  },
};

describe("круговой обход толкований через config_json", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "new" }) }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** The config_json the save orchestrator actually sent for the first row. */
  function sentConfig(): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[0][1].body).configJson;
  }

  it("шкала: толкование, оценка и рекомендации переживают сохранение и перезагрузку", async () => {
    await saveScales("t1", [scale({ bands: [RICH_BAND] })], []);
    const configJson = sentConfig();

    const reloaded = apiToEditorModel({
      id: "t1",
      title: "T",
      scales: [{ id: "s1", key: "ee", label: "Истощение", type: "number", configJson, sortOrder: 0 }],
    });
    expect(reloaded.scales[0].bands).toEqual([RICH_BAND]);
  });

  it("шкала: пустые толкование и оценка в конфиг не пишутся", async () => {
    await saveScales("t1", [scale({ bands: [{ min: "0", max: "10", label: "", level: "low", text: "", tone: "" }] })], []);
    expect((sentConfig().bands as unknown[])[0]).toEqual({ min: 0, max: 10, level: "low" });
  });

  it("показатель: перечень исходов переживает сохранение и перезагрузку", async () => {
    await saveResultVariables("t1", [variable({ outcomes: [RICH_OUTCOME] })], []);
    const configJson = sentConfig();

    const reloaded = apiToEditorModel({
      id: "t1",
      title: "T",
      resultVariables: [
        { id: "v1", name: "burnout", label: "Выгорание", type: "string", formula: "x", configJson, sortOrder: 0 },
      ],
    });
    expect(reloaded.resultVariables[0].outcomes).toEqual([RICH_OUTCOME]);
  });

  it("показатель: интервалы числового показателя переживают сохранение и перезагрузку", async () => {
    await saveResultVariables("t1", [variable({ type: "number", bands: [RICH_BAND] })], []);
    const configJson = sentConfig();

    const reloaded = apiToEditorModel({
      id: "t1",
      title: "T",
      resultVariables: [
        { id: "v1", name: "burnout", label: "Выгорание", type: "number", formula: "x", configJson, sortOrder: 0 },
      ],
    });
    expect(reloaded.resultVariables[0].bands).toEqual([RICH_BAND]);
  });

  it("правка толкования показателя видна диффу сохранения", async () => {
    const snapshot = [variable({ id: "v1", outcomes: [RICH_OUTCOME] })];
    const draft = [
      variable({ id: "v1", outcomes: [{ ...RICH_OUTCOME, text: "Другое толкование" }] }),
    ];
    await saveResultVariables("t1", draft, snapshot);
    expect(fetchMock.mock.calls.map((c) => c[1]?.method)).toEqual(["PUT"]);
  });
});

describe("подсказка кодов из формулы", () => {
  it("предлагает коды, когда перечень исходов ещё пуст", () => {
    // Главный сценарий PRD-29 §5.1: методику импортировали с готовой формулой,
    // перечень исходов не заполнен, и подсказка засевает его одним нажатием.
    // Предупреждение в этот момент молчит намеренно — автор ещё не ошибся.
    render(
      <OutcomesEditor
        outcomes={[]}
        index={0}
        readOnly={false}
        onChange={() => {}}
        suggestedCodes={collectStringLiterals('IF(percent >= 0, "growing", "burnout")').sort()}
      />,
    );
    expect(screen.getByRole("button", { name: "burnout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "growing" })).toBeInTheDocument();
  });

  it("предупреждение молчит на пустом перечне, а подсказка — нет", () => {
    const formula = 'IF(percent >= 0, "growing", "burnout")';
    expect(findUnknownOutcomes(formula, [])).toEqual([]);
    expect(collectStringLiterals(formula).sort()).toEqual(["burnout", "growing"]);
  });
});

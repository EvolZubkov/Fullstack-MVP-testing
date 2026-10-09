/**
 * @module features/tests/editor/sections/__tests__/profile-template.test
 * @description PRD-53 acceptance for the «Профиль по группе шкал» template in the
 * «Показатели» tab: the group form, the matrix generator, the form-level diagnostics
 * and the «scales outside the profile» block.
 *
 * The card renders its form only when expanded, so every case opens it first.
 * Источник разметки — docs/wireframes/approved/prd53-profile-indicator.html.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";

import { ResultVariablesSection } from "../result-variables-section";
import { emptyEditorModel } from "../../test-editor.mappers";
import type {
  OutcomeModel,
  ResultVariableModel,
  ScaleModel,
  TestEditorModel,
} from "../../test-editor.types";

const GROUP = 'topGroup(["cel","vdo","kom","pro"], 5).code';

function scale(key: string, label: string, sortOrder: number): ScaleModel {
  return {
    clientKey: `s-${key}`,
    key,
    label,
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
    sortOrder,
  };
}

function variable(over: Partial<ResultVariableModel> = {}): ResultVariableModel {
  return {
    clientKey: "v1",
    name: "lead_style",
    label: "Описание ваших результатов",
    type: "string",
    formula: GROUP,
    learnerVisibility: "hidden",
    scormTarget: "both",
    controlsStatus: "none",
    bands: [],
    outcomes: [],
    domainMin: null,
    domainMax: null,
    valence: "none",
    sortOrder: 0,
    ...over,
  };
}

function outcome(code: string, label = code): OutcomeModel {
  return { code, label, text: "", tone: "" };
}

function model(over: Partial<ResultVariableModel> = {}, keys = ["cel", "vdo", "kom", "pro"]): TestEditorModel {
  return {
    ...emptyEditorModel({ folderId: null }),
    scales: keys.map((k, i) => scale(k, k.toUpperCase(), i)),
    resultVariables: [variable(over)],
  };
}

function Harness({ initial, seen }: { initial: TestEditorModel; seen: TestEditorModel[] }) {
  const [m, setM] = useState(initial);
  seen[0] = m;
  return (
    <ResultVariablesSection
      model={m}
      updateModel={(updater) =>
        setM((prev) => {
          const next = updater(prev);
          seen[0] = next;
          return next;
        })
      }
    />
  );
}

function renderExpanded(initial: TestEditorModel): TestEditorModel[] {
  const seen: TestEditorModel[] = [];
  render(<Harness initial={initial} seen={seen} />);
  fireEvent.click(screen.getByLabelText("Развернуть показатель"));
  return seen;
}

const outcomesOf = (seen: TestEditorModel[]) => seen[0].resultVariables[0].outcomes;

describe("генератор матрицы наборов (PRD-53 §5.2)", () => {
  it("«Собрать наборы» заводит пятнадцать исходов для четырёх шкал", () => {
    const seen = renderExpanded(model());
    fireEvent.click(screen.getByTestId("metrics-profile-build-0"));
    expect(outcomesOf(seen)).toHaveLength(15);
    expect(outcomesOf(seen)[0]).toMatchObject({ code: "cel", label: "Сфокусированный: CEL" });
  });

  // Правило PRD-53 §5.2: генератор ДОБАВЛЯЕТ недостающее и не трогает заполненное.
  it("повторное нажатие ничего не затирает и не удваивает", () => {
    const seen = renderExpanded(model({ outcomes: [{ ...outcome("cel", "Мой текст"), text: "Толкование" }] }));
    fireEvent.click(screen.getByTestId("metrics-profile-build-0"));
    fireEvent.click(screen.getByTestId("metrics-profile-build-0"));
    const rows = outcomesOf(seen);
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({ code: "cel", label: "Мой текст", text: "Толкование" });
  });

  // Сопоставление по НАБОРУ: иначе генератор завёл бы дубль cel+pro, который никогда
  // не сработает — в списке первым стоял бы авторский pro+cel.
  it("исход, набранный в другом порядке, считается заведённым", () => {
    const seen = renderExpanded(model({ outcomes: [outcome("pro+cel")] }));
    fireEvent.click(screen.getByTestId("metrics-profile-build-0"));
    expect(outcomesOf(seen).filter((o) => o.code === "cel+pro")).toHaveLength(0);
  });

  it("«Заготовки по размеру набора» заводят четыре исхода count:N", () => {
    const seen = renderExpanded(model());
    fireEvent.click(screen.getByTestId("metrics-profile-build-counts-0"));
    expect(outcomesOf(seen).map((o) => o.code)).toEqual(["count:1", "count:2", "count:3", "count:4"]);
  });
});

describe("диагностика формы (PRD-53 §5.3.2)", () => {
  it("непокрытые наборы перечислены, с «и ещё N» после пятого", () => {
    renderExpanded(model({ outcomes: [outcome("cel")] }));
    const banner = screen.getByTestId("metrics-profile-uncovered-0");
    expect(banner).toHaveTextContent("Не для всех наборов есть текст");
    expect(banner).toHaveTextContent("и ещё 9");
  });

  // Подавление на пустом перечне: автор ещё не начал заполнять.
  it("на пустом перечне исходов предупреждения нет", () => {
    renderExpanded(model());
    expect(screen.queryByTestId("metrics-profile-uncovered-0")).toBeNull();
  });

  it("заготовки по размеру набора закрывают все наборы", () => {
    renderExpanded(model({ outcomes: ["count:1", "count:2", "count:3", "count:4"].map((c) => outcome(c)) }));
    expect(screen.queryByTestId("metrics-profile-uncovered-0")).toBeNull();
  });

  it("при пяти шкалах подсказывает число наборов", () => {
    const keys = ["cel", "vdo", "kom", "pro", "cli"];
    renderExpanded(model({ formula: 'topGroup(["cel","vdo","kom","pro","cli"], 5).code' }, keys));
    expect(screen.getByTestId("metrics-profile-many-0")).toHaveTextContent("31");
  });
});

describe("блок «шкалы вне профиля» (PRD-53 §4.4)", () => {
  it("тумблер пишет ключи группы из формулы", () => {
    const seen = renderExpanded(model());
    fireEvent.click(screen.getByTestId("metrics-rest-show-0"));
    expect(seen[0].resultVariables[0].restScales).toEqual({
      show: true,
      label: "",
      keys: ["cel", "vdo", "kom", "pro"],
    });
  });

  it("заголовок блока виден только при включённом тумблере", () => {
    renderExpanded(model());
    expect(screen.queryByTestId("metrics-rest-label-0")).toBeNull();
    fireEvent.click(screen.getByTestId("metrics-rest-show-0"));
    expect(screen.getByTestId("metrics-rest-label-0")).toBeInTheDocument();
  });

  it("у показателя без профиля блока нет", () => {
    renderExpanded(model({ formula: '"growing"' }));
    expect(screen.queryByTestId("metrics-rest-show-0")).toBeNull();
  });
});

describe("форма шаблона (PRD-53 §5.1)", () => {
  it("показатель-профиль открывается на своём шаблоне, а не на «Пороге»", () => {
    renderExpanded(model());
    expect(screen.getByTestId("metrics-profile-group")).toBeInTheDocument();
    expect(screen.getByTestId("metrics-profile-threshold")).toHaveValue("5");
  });

  it("шкалы группы отмечены тумблерами, лишние выключены", () => {
    renderExpanded(model({ formula: 'topGroup(["cel","vdo"], 0).code' }));
    expect(screen.getByTestId("metrics-profile-scale-cel")).toBeChecked();
    expect(screen.getByTestId("metrics-profile-scale-pro")).not.toBeChecked();
  });

  // FR-33: иначе автор видит ошибку про ключ и не может его снять.
  it("удалённая из теста шкала группы остаётся видимой строкой", () => {
    renderExpanded(model({ formula: 'topGroup(["cel","vdo","eng"], 5).code' }));
    expect(screen.getByTestId("metrics-profile-missing-eng")).toBeInTheDocument();
  });

  it("снятие шкал до одной даёт ошибку у поля", () => {
    renderExpanded(model({ formula: 'topGroup(["cel","vdo"], 5).code' }));
    fireEvent.click(screen.getByTestId("metrics-profile-scale-vdo"));
    expect(screen.getByTestId("metrics-profile-group-error")).toHaveTextContent("хотя бы две шкалы");
  });

  it("отрицательный порог помечается ошибкой у поля", () => {
    renderExpanded(model());
    fireEvent.change(screen.getByTestId("metrics-profile-threshold"), { target: { value: "-1" } });
    expect(screen.getByText(/Порог верхней зоны — неотрицательное число/)).toBeInTheDocument();
  });

  it("правка группы переписывает формулу в авторском порядке шкал", () => {
    const seen = renderExpanded(model({ formula: 'topGroup(["vdo"], 5).code' }));
    fireEvent.click(screen.getByTestId("metrics-profile-scale-cel"));
    expect(seen[0].resultVariables[0].formula).toBe('topGroup(["cel","vdo"], 5).code');
  });
});

describe("пустое описание шкалы (PRD-53 §5.3.2)", () => {
  const withDesc = (over: Partial<ResultVariableModel>, described: string[]) => {
    const m = model(over);
    return {
      ...m,
      scales: m.scales.map((s) => (described.includes(s.key) ? { ...s, description: "Текст" } : s)),
    };
  };

  // Проверять есть смысл только при включённом блоке: без него описание участнику
  // не показывается вовсе, и упрекать автора не в чем.
  it("молчит, пока блок «вне профиля» выключен", () => {
    renderExpanded(withDesc({}, []));
    expect(screen.queryByTestId("metrics-profile-bare-rest-0")).toBeNull();
  });

  it("при включённом блоке называет шкалы без описания", () => {
    renderExpanded(withDesc({ restScales: { show: true, label: "", keys: ["cel", "vdo", "kom", "pro"] } }, ["cel", "vdo"]));
    const banner = screen.getByTestId("metrics-profile-bare-rest-0");
    expect(banner).toHaveTextContent("KOM, PRO");
    expect(banner).not.toHaveTextContent("CEL");
  });

  it("когда описания заполнены у всех, предупреждения нет", () => {
    renderExpanded(
      withDesc({ restScales: { show: true, label: "", keys: ["cel", "vdo", "kom", "pro"] } }, ["cel", "vdo", "kom", "pro"]),
    );
    expect(screen.queryByTestId("metrics-profile-bare-rest-0")).toBeNull();
  });
});

// ─── Памятка про коды исходов (PRD-53 FR-27) ─────────────────────────────────
//
// Валидатор формулы видит только строку источника и потому вместо проверки печатает
// правило. В конструкторе коды заводит генератор, и памятка там навсегда занимает
// единственную строку баннера, не давая автору увидеть «синтаксис корректен».

describe("памятка scale-group-code (PRD-53 FR-27)", () => {
  const validation = (warnings: Array<{ code?: string; message: string }>) => ({
    valid: true,
    returnType: "string" as const,
    errors: [],
    warnings,
  });

  const renderWithValidation = async (mode: "builder" | "dsl") => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        json: async () =>
          validation([
            { code: "scale-group-code", message: "Коды исходов должны быть наборами ключей шкал через «+»" },
          ]),
      }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const initial = model();
    // Показатель с ПУСТОЙ формулой открывается в конструкторе, с непустой не-профильной — в DSL.
    if (mode === "dsl") initial.resultVariables[0].formula = 'IF(percent >= 70, "a", "b")';
    render(<ResultVariablesSection model={initial} testId="t1" updateModel={() => {}} />);
    fireEvent.click(screen.getByLabelText("Развернуть показатель"));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("в конструкторе памятки нет", async () => {
    await renderWithValidation("builder");
    expect(screen.queryByText(/Коды исходов должны быть наборами/)).toBeNull();
  });

  it("в режиме DSL памятка остаётся", async () => {
    await renderWithValidation("dsl");
    expect(screen.getByText(/Коды исходов должны быть наборами/)).toBeInTheDocument();
  });
});

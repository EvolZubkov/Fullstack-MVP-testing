/**
 * @module features/tests/editor/sections/__tests__/error-highlighting.test
 * @description Контракт «Индикация проблем», строка «Сам элемент»: КАЖДАЯ ошибка
 * обязана быть видна на месте, а не только числом в сводном баннере
 * (`docs/architecture/test-editor-contracts.md`).
 *
 * Баннер вверху формы называет ОДНУ ошибку — первую по порядку проверки — и считает
 * остальные («Ещё N полей»). Значит остальные автор ищет по пометкам, и адрес без
 * пометки означает ошибку, которая блокирует сохранение и нигде не написана. Ровно это
 * и случилось с «Добавьте хотя бы одну тему»: у нового теста баннер говорил про
 * название, а вторая ошибка жила одной точкой в рейле.
 *
 * Каждый случай прогоняется через НАСТОЯЩУЮ проверку: модель -> `validateTestEditor` ->
 * `buildFieldErrorIndex` -> секция. Поэтому тест ломается и когда пропала пометка, и
 * когда у проверки сменился адрес, — а расхождение адресов не видно ничем другим.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";
import {
  AdaptivePane,
  ScenarioSettingsPane,
  VerdictPane,
} from "../basic-settings-section";
import { CompositionSection } from "../topics-structure-section";
import { ResultVariablesSection } from "../result-variables-section";
import { buildFieldErrorIndex } from "../../field-errors";
import { validateTestEditor } from "../../test-editor.validation";
import { emptyEditorModel } from "../../test-editor.mappers";
import type { TestEditorModel } from "../../test-editor.types";

function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Пустой черновик с правками под конкретный случай. */
function model(patch: (m: TestEditorModel) => TestEditorModel): TestEditorModel {
  const base = emptyEditorModel({ folderId: null });
  return patch({ ...base, basic: { ...base.basic, title: "Тест" } });
}

/**
 * Сообщение проверки по адресу — и заодно доказательство, что случай СОБРАН верно:
 * пустое место здесь значит, что модель не вызвала ожидаемую ошибку, а не то, что
 * подсветка на месте.
 */
function errorAt(m: TestEditorModel, field: string): string {
  const message = buildFieldErrorIndex(validateTestEditor(m).errors).get(field);
  expect(message, `проверка не дала ошибки по адресу ${field}`).toBeTruthy();
  return message as string;
}

function indexOf(m: TestEditorModel) {
  return buildFieldErrorIndex(validateTestEditor(m).errors);
}

const noop = () => {};

describe("ошибка видна на месте, а не только в сводном баннере", () => {
  it("«нет тем» — текст стоит у пустого состава", () => {
    const m = model((x) => x);
    const message = errorAt(m, "sections");
    render(
      <CompositionSection model={m} updateModel={noop} fieldErrors={indexOf(m)} />,
    );
    expect(screen.getByTestId("composition-empty-error")).toHaveTextContent(message);
  });

  it("«Тест пройден, если» — пометка у самого переключателя", () => {
    const m = model((x) => ({
      ...x,
      passRules: { ...x.passRules, decisionPolicy: "нет такого" as never },
    }));
    const message = errorAt(m, "passRules.decisionPolicy");
    render(<VerdictPane model={m} updateModel={noop} fieldErrors={indexOf(m)} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("«По вариантам» у темы без вариантов — пометка у самого правила темы", () => {
    const m = model((x) => ({
      ...x,
      sections: [section("top-1", "Основы")],
      passRules: {
        ...x.passRules,
        byTopic: { "top-1": { source: "by_variant", byForm: {} } as never },
      },
    }));
    const message = errorAt(m, "passRules.byTopic[top-1]");
    render(<VerdictPane model={m} updateModel={noop} fieldErrors={indexOf(m)} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("сценарий — пометка у выбора сценария", () => {
    const m = model((x) => ({ ...x, mode: "adaptive", flowMode: "linear_flat" }));
    const message = errorAt(m, "flowMode");
    render(
      <ScenarioSettingsPane model={m} updateModel={noop} fieldErrors={indexOf(m)} />,
    );
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("границы уровня адаптивной лестницы — пометка у самого поля", () => {
    const m = model((x) => ({
      ...x,
      mode: "adaptive",
      flowMode: "linear_by_topics",
      sections: [section("top-1", "Основы")],
      adaptive: {
        ...x.adaptive,
        topics: [
          {
            topicId: "top-1",
            topicName: "Основы",
            failureFeedback: null,
            enabled: true,
            levels: [
              {
                levelIndex: 0,
                levelName: "Уровень 1",
                // Нижняя граница выше верхней — ошибка адресована `minDifficulty`.
                minDifficulty: 80,
                maxDifficulty: 20,
                questionsCount: 1,
                passThreshold: 50,
                passThresholdType: "percent",
                feedback: null,
                links: [],
              },
            ],
          },
        ],
      },
    }));
    const message = errorAt(m, "adaptive.topics[0].levels[0].minDifficulty");
    render(<AdaptivePane model={m} updateModel={noop} fieldErrors={indexOf(m)} />);

    // Тема открывается свёрнутой, и тело её в разметке отсутствует. Пока она свёрнута,
    // об ошибке говорит ТОЧКА в шапке — иначе тема выглядит исправной.
    const toggle = screen.getByTestId("adaptive-topic-toggle-top-1");
    expect(toggle.querySelector(".tb-status-dot--err")).not.toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("пустая формула показателя — пометка в карточке", () => {
    const m = model((x) => ({
      ...x,
      resultVariables: [variable({ name: "score", formula: "" })],
    }));
    const message = errorAt(m, "resultVariables[0].formula");
    render(
      <ResultVariablesSection model={m} updateModel={noop} fieldErrors={indexOf(m)} />,
    );

    // Свёрнутая карточка показателя говорит об ошибке точкой — тела у неё нет.
    expect(screen.getByTestId("metrics-card-dot-0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Развернуть показатель/i }));
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("управление статусом у небулева показателя — сообщение есть, хотя поля на экране нет", () => {
    const m = model((x) => ({
      ...x,
      resultVariables: [
        variable({ name: "score", formula: "percent", type: "number", controlsStatus: "success" }),
      ],
    }));
    const message = errorAt(m, "resultVariables[0].controlsStatus");
    render(
      <ResultVariablesSection model={m} updateModel={noop} fieldErrors={indexOf(m)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Развернуть показатель/i }));
    // Селектор «Управление статусом» показывается ТОЛЬКО булеву показателю, поэтому
    // пометке не на чем сидеть — текст обязан появиться сам по себе.
    expect(screen.queryByTestId("metrics-status-0")).toBeNull();
    expect(screen.getByTestId("metrics-status-error-0")).toHaveTextContent(message);
  });
});

/** Тема теста с минимальным набором полей. */
function section(topicId: string, topicName: string): TestEditorModel["sections"][number] {
  return {
    topicId,
    topicName,
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
  };
}

/** Показатель с минимальным набором полей. */
function variable(
  patch: Partial<TestEditorModel["resultVariables"][number]>,
): TestEditorModel["resultVariables"][number] {
  return {
    name: "v",
    label: "",
    type: "string",
    formula: '"ok"',
    learnerVisibility: "hidden",
    scormTarget: "none",
    controlsStatus: "none",
    outcomes: [],
    bands: [],
    ...patch,
  } as TestEditorModel["resultVariables"][number];
}

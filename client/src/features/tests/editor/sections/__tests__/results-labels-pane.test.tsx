/**
 * @module features/tests/editor/sections/__tests__/results-labels-pane.test
 * @description PRD-49 §7 — подраздел «Заголовки и подписи» и порядок подблоков итогов.
 *
 * Проверяется ровно то, ради чего панель существует: автор видит объявления ШАБЛОНА,
 * его правка ложится в черновик теста как ОТКЛОНЕНИЕ от них, а три состояния надписи
 * («не трогал», «своя формулировка», «надписи нет») различимы в сохранённом значении.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ResultsLabelsPane } from "../results-labels-pane";
import { DesignSection } from "../design-section";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import type { TestEditorModel } from "../../test-editor.types";
import type { LabelDeclaration } from "@shared/template/labels";

const DECLS: LabelDeclaration[] = [
  {
    key: "results.heading",
    group: "Первый уровень",
    label: "Заголовок итогов",
    default: "Ваш результат",
  },
  {
    key: "results.summary",
    group: "Второй уровень",
    label: "Подзаголовок сводки баллов",
    default: "Общий балл",
  },
  {
    key: "results.scales",
    group: "Второй уровень",
    label: "Подзаголовок шкал",
    default: "По шкалам",
  },
  {
    key: "results.indicators",
    group: "Второй уровень",
    label: "Подзаголовок показателей",
    default: "По показателям",
  },
  {
    key: "results.topics",
    group: "Второй уровень",
    label: "Подзаголовок тем",
    default: "По темам",
  },
  {
    key: "recommendations.courses",
    group: "Группы рекомендаций",
    label: "Подпись группы курсов",
    default: "Пройти обучение",
    defaults: { report: "Рекомендации по курсам" },
  },
];

describe("ResultsLabelsPane — надписи", () => {
  it("подсказкой поля стоит текст шаблона", () => {
    render(<ResultsLabelsPane declarations={DECLS} labels={{}} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Подзаголовок шкал")).toHaveAttribute("placeholder", "По шкалам");
  });

  it("группы идут в порядке первого появления объявлений", () => {
    render(<ResultsLabelsPane declarations={DECLS} labels={{}} onChange={vi.fn()} />);
    const titles = screen
      .getAllByRole("heading")
      .map((h) => h.textContent)
      .filter((t) => t !== null);
    expect(titles.slice(0, 3)).toEqual(["Первый уровень", "Второй уровень", "Группы рекомендаций"]);
  });

  it("своя формулировка сохраняется как { on: true, text }", () => {
    const onChange = vi.fn();
    render(<ResultsLabelsPane declarations={DECLS} labels={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Подзаголовок шкал"), {
      target: { value: "Профиль стилей" },
    });
    expect(onChange).toHaveBeenCalledWith({
      "results.scales": { on: true, text: "Профиль стилей" },
    });
  });

  it("выключение надписи сохраняется как { on: false }", () => {
    const onChange = vi.fn();
    render(<ResultsLabelsPane declarations={DECLS} labels={{}} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Показывать надпись «Подзаголовок шкал»"));
    expect(onChange).toHaveBeenCalledWith({ "results.scales": { on: false } });
  });

  it("поле выключенной надписи заблокировано", () => {
    render(
      <ResultsLabelsPane
        declarations={DECLS}
        labels={{ "results.scales": { on: false } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Подзаголовок шкал")).toBeDisabled();
    expect(screen.getByLabelText("Подзаголовок тем")).not.toBeDisabled();
  });

  it("очищенное поле возвращает надпись шаблону — ключ пропадает", () => {
    const onChange = vi.fn();
    render(
      <ResultsLabelsPane
        declarations={DECLS}
        labels={{ "results.scales": { on: true, text: "Профиль" } }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Подзаголовок шкал"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("правка одной надписи не трогает остальные", () => {
    const onChange = vi.fn();
    render(
      <ResultsLabelsPane
        declarations={DECLS}
        labels={{ "results.topics": { on: false } }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Подзаголовок шкал"), { target: { value: "Профиль" } });
    expect(onChange).toHaveBeenCalledWith({
      "results.topics": { on: false },
      "results.scales": { on: true, text: "Профиль" },
    });
  });

  it("шаблон без объявлений списка не показывает", () => {
    render(<ResultsLabelsPane declarations={[]} labels={{}} onChange={vi.fn()} />);
    expect(screen.getByTestId("results-labels-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("results-block-order")).toBeNull();
  });

  it("на стороне отчёта подсказкой стоит текст экрана итогов", () => {
    render(
      <ResultsLabelsPane
        declarations={DECLS}
        labels={{}}
        screen="report"
        baseLabels={{ "recommendations.courses": "Что пройти" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Подпись группы курсов")).toHaveAttribute(
      "placeholder",
      "Что пройти",
    );
  });
});

describe("ResultsLabelsPane — порядок подблоков", () => {
  it("без обработчика порядка блок не рисуется", () => {
    render(<ResultsLabelsPane declarations={DECLS} labels={{}} onChange={vi.fn()} />);
    expect(screen.queryByTestId("results-block-order")).toBeNull();
  });

  it("по умолчанию порядок — тот, что печатал экран до этой настройки", () => {
    render(
      <ResultsLabelsPane
        declarations={DECLS}
        labels={{}}
        onChange={vi.fn()}
        onOrderChange={vi.fn()}
      />,
    );
    const names = screen
      .getByTestId("results-block-order")
      .querySelectorAll("[data-testid^='results-block-order-']");
    expect(Array.from(names).map((n) => n.getAttribute("data-testid"))).toEqual([
      "results-block-order-summary",
      "results-block-order-scales",
      "results-block-order-indicators",
      "results-block-order-topics",
    ]);
  });

  it("перестановка подблока отдаёт новый порядок целиком", () => {
    const onOrderChange = vi.fn();
    render(
      <ResultsLabelsPane
        declarations={DECLS}
        labels={{}}
        onChange={vi.fn()}
        onOrderChange={onOrderChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Переместить «По шкалам» выше"));
    expect(onOrderChange).toHaveBeenCalledWith(["scales", "summary", "indicators", "topics"]);
  });

  it("подписи подблоков берутся из формулировки автора", () => {
    render(
      <ResultsLabelsPane
        declarations={DECLS}
        labels={{ "results.scales": { on: true, text: "Профиль стилей" } }}
        onChange={vi.fn()}
        onOrderChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Переместить «Профиль стилей» ниже")).toBeInTheDocument();
  });

  it("состав списка объявляет шаблон: сводки нет — её нет и в списке", () => {
    const onOrderChange = vi.fn();
    render(
      <ResultsLabelsPane
        declarations={DECLS}
        labels={{}}
        templateOrder={["scales", "indicators", "topics"]}
        onChange={vi.fn()}
        onOrderChange={onOrderChange}
      />,
    );
    expect(screen.queryByTestId("results-block-order-summary")).toBeNull();
    fireEvent.click(screen.getByLabelText("Переместить «По темам» выше"));
    expect(onOrderChange).toHaveBeenCalledWith(["scales", "topics", "indicators"]);
  });

  it("сохранённый порядок показывается как задан", () => {
    render(
      <ResultsLabelsPane
        declarations={DECLS}
        labels={{}}
        order={["topics", "scales"]}
        onChange={vi.fn()}
        onOrderChange={vi.fn()}
      />,
    );
    const rows = screen
      .getByTestId("results-block-order")
      .querySelectorAll("[data-testid^='results-block-order-']");
    // Ключи, которых автор не переставлял, дописываются в конец по порядку шаблона.
    expect(Array.from(rows).map((n) => n.getAttribute("data-testid"))).toEqual([
      "results-block-order-topics",
      "results-block-order-scales",
      "results-block-order-summary",
      "results-block-order-indicators",
    ]);
  });
});

// ─── Вкладка «Оформление» ─────────────────────────────────────────────────────

const TEST_ID = "te-49";

function templateRow(labels: LabelDeclaration[] | undefined, reportLabelKeys?: string[]) {
  return {
    id: "default",
    name: "Стандартный",
    description: null,
    version: "1.5.0",
    templateApiVersion: "1.0",
    isBuiltin: true,
    isActive: true,
    previewPath: null,
    // PRD-49: перечень надписей, которые печатает ДОКУМЕНТ, — считает сервер по макетам
    // отчёта и кладёт РЯДОМ с манифестом, а не в него: манифест объявляет надписи на все
    // экраны сразу.
    ...(reportLabelKeys ? { reportLabelKeys } : {}),
    manifest: {
      id: "default",
      name: "Стандартный",
      version: "1.5.0",
      templateApiVersion: "1.0",
      params: [],
      ...(labels ? { labels } : {}),
    },
  };
}

function renderDesignTab(
  labels: LabelDeclaration[] | undefined,
  reportLabelKeys?: string[],
  /** Модель теста нужна панели «Отчёт»: её карточки правят `model.report`. */
  model?: TestEditorModel,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url === `/api/tests/${TEST_ID}/design`
              ? { templateId: "default", params: {} }
              : templateRow(labels, reportLabelKeys),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <DesignSection testId={TEST_ID} model={model} updateModel={model ? vi.fn() : undefined} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("«Оформление» → «Итоги»", () => {
  it("пункт «Итоги» есть у шаблона, объявившего надписи, и открывает панель", async () => {
    renderDesignTab(DECLS);
    // Ждём ЗАГРУЖЕННОГО состояния: пункт рейки появляется вместе с манифестом, но панель
    // до конца загрузки показывает баннер «Загружаем настройки оформления…».
    await waitFor(() => expect(screen.getByTestId("design-template-pane")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("design-rail-results"));
    expect(screen.getByTestId("design-results-pane")).toBeInTheDocument();
    expect(screen.getByTestId("results-block-order")).toBeInTheDocument();
    expect(screen.getByLabelText("Подзаголовок шкал")).toHaveAttribute("placeholder", "По шкалам");
  });

  it("шаблон без объявлений пункта не показывает", async () => {
    renderDesignTab(undefined);
    await waitFor(() => expect(screen.getByTestId("design-template-pane")).toBeInTheDocument());
    expect(screen.queryByTestId("design-rail-results")).toBeNull();
  });
});

/**
 * Приёмка: панель отчёта предлагала все объявленные надписи, а документ печатает свои
 * шесть. Включённый «Заголовок итогов» не давал в PDF ничего — зонтика у документа нет
 * вовсе. Перечень строк панели приходит теперь с сервера (`reportLabelKeys`), посчитанный
 * по макетам вариантов отчёта.
 */
describe("«Оформление» → «Отчёт» → надписи документа", () => {
  /** Карточки отчёта живут в модели теста, поэтому панель без неё не разворачивается. */
  function reportModel(): TestEditorModel {
    return {
      id: TEST_ID,
      version: 1,
      mode: "standard",
      flowMode: "linear_flat",
      flowSettings: {},
      folderId: null,
      basic: {
        title: "Опросник", description: "", status: "draft",
        feedback: { format: "plain", text: "" },
        feedbackLinks: [], feedbackAssets: [], feedbackEvents: [],
        webhookUrl: "", telemetryEnabled: false,
      },
      runtime: {
        timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false,
        allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true,
        skipReviewWhenComplete: false, quickAdvance: false, copyProtection: true,
        protectionWatermark: false, protectionHideOnBlur: false,
      },
      passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
      sections: [],
      adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
      resultVariables: [],
      scales: [],
      measurements: [],
      retakePolicy: defaultRetakePolicy(),
      scoring: { defaultQuestionPoints: null, questionOverrides: [] },
    };
  }

  function renderReportTab(reportLabelKeys?: string[]) {
    renderDesignTab(DECLS, reportLabelKeys, reportModel());
  }

  async function openReportPane() {
    await waitFor(() => expect(screen.getByTestId("design-template-pane")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("design-rail-report"));
    await waitFor(() => expect(screen.getByTestId("design-report-labels")).toBeInTheDocument());
  }

  it("показывает только надписи, которые печатает документ", async () => {
    renderReportTab(["results.scales", "recommendations.courses"]);
    await openReportPane();

    expect(screen.getByLabelText("Подзаголовок шкал")).toBeInTheDocument();
    expect(screen.getByLabelText("Подпись группы курсов")).toBeInTheDocument();
    // Этих в документе нет — и строки быть не должно.
    expect(screen.queryByLabelText("Заголовок итогов")).toBeNull();
    expect(screen.queryByLabelText("Подзаголовок сводки баллов")).toBeNull();
  });

  it("без перечня (старый сервер) показывает все объявления, как раньше", async () => {
    renderReportTab();
    await openReportPane();

    expect(screen.getByLabelText("Заголовок итогов")).toBeInTheDocument();
    expect(screen.getByLabelText("Подзаголовок шкал")).toBeInTheDocument();
  });

  it("документ, не печатающий ни одной надписи, карточки не получает", async () => {
    renderReportTab([]);
    await waitFor(() => expect(screen.getByTestId("design-template-pane")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("design-rail-report"));
    expect(screen.queryByTestId("design-report-labels")).toBeNull();
  });
});

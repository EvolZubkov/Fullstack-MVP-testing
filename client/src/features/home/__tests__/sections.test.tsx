/**
 * @module features/home/__tests__/sections.test
 * @description PRD-25: the home-page sections carry rules that are easy to break
 * silently — an empty attention panel must vanish instead of reassuring the user,
 * a closed cooldown must not offer a start button, an empty «Мне назначено» must
 * not offer an action that leads nowhere, and «Сводка» must never grow a chart.
 * Each test below pins one of those rules.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  AssignedTestItem,
  AttentionItem,
  MyTestItem,
  MyTopicItem,
} from "@shared/home/contract";
import { AttentionPanel } from "../sections/attention-panel";
import { AssignedTestsSection } from "../sections/assigned-tests-section";
import { RecentResultsSection } from "../sections/recent-results-section";
import { MyTestsSection } from "../sections/my-tests-section";
import { MyTopicsSection } from "../sections/my-topics-section";
import { SummaryStrip } from "../sections/summary-strip";
import { MaterialsSection } from "../sections/materials-section";

const attention = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: "test-empty-draft:t1",
  kind: "test-empty-draft",
  severity: "warning",
  title: "Черновик без вопросов",
  subtitle: "Пожарная безопасность: базовый курс",
  href: "/author/tests",
  action: "Открыть редактор",
  ...over,
});

const assigned = (over: Partial<AssignedTestItem> = {}): AssignedTestItem => ({
  testId: "t1",
  title: "Информационная безопасность",
  description: null,
  questionCount: 20,
  completedAttempts: 0,
  maxAttempts: 3,
  inProgressAttemptId: null,
  blockedUntil: null,
  ...over,
});

const myTest = (over: Partial<MyTestItem> = {}): MyTestItem => ({
  testId: "t1",
  title: "Сертификация руководителей 2026",
  status: "published_with_changes",
  sectionCount: 4,
  questionCount: 56,
  updatedAt: "2026-07-28T10:00:00.000Z",
  owned: true,
  flags: [],
  canEdit: true,
  canDebug: true,
  canExport: true,
  ...over,
});

const myTopic = (over: Partial<MyTopicItem> = {}): MyTopicItem => ({
  topicId: "tp1",
  name: "Информационная безопасность",
  code: "IB",
  questionCount: 128,
  updatedAt: "2026-07-28T10:00:00.000Z",
  owned: true,
  ...over,
});

describe("AttentionPanel", () => {
  it("renders nothing at all when there is nothing to act on", () => {
    const { container } = render(<AttentionPanel items={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("home-attention")).not.toBeInTheDocument();
  });

  it("renders a row per item with its action", () => {
    render(<AttentionPanel items={[attention(), attention({ id: "x", severity: "info", title: "Незавершённая попытка", action: "Продолжить" })]} />);
    expect(screen.getByTestId("home-attention")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Открыть редактор" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeInTheDocument();
  });
});

describe("AssignedTestsSection", () => {
  it("offers «Продолжить» for an unfinished attempt and «Начать» otherwise", () => {
    render(
      <AssignedTestsSection
        items={[
          assigned({ testId: "a", inProgressAttemptId: "att-1" }),
          assigned({ testId: "b" }),
        ]}
        total={2}
      />,
    );
    expect(screen.getByTestId("home-assigned-start-a")).toHaveTextContent("Продолжить");
    expect(screen.getByTestId("home-assigned-start-b")).toHaveTextContent("Начать");
  });

  it("replaces the button with the retake date while the cooldown is closed", () => {
    render(<AssignedTestsSection items={[assigned({ blockedUntil: "2026-08-05" })]} total={1} />);
    expect(screen.queryByTestId("home-assigned-start-t1")).not.toBeInTheDocument();
    expect(screen.getByTestId("home-assigned-blocked-t1")).toHaveTextContent("05.08.2026");
  });

  it("links to the full list only when there are more assignments than shown", () => {
    const { rerender } = render(<AssignedTestsSection items={[assigned()]} total={1} />);
    expect(screen.queryByTestId("home-assigned-all")).not.toBeInTheDocument();

    rerender(<AssignedTestsSection items={[assigned()]} total={7} />);
    expect(screen.getByTestId("home-assigned-all")).toBeInTheDocument();
    expect(screen.getByText("Показаны 1 из 7")).toBeInTheDocument();
  });

  it("shows the empty state WITHOUT an action — an assignment is created by somebody else", () => {
    render(<AssignedTestsSection items={[]} total={0} />);
    expect(screen.getByText("Тестов пока не назначено")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("RecentResultsSection", () => {
  it("shows percent, the pass label, the date and a link to the result", () => {
    render(
      <RecentResultsSection
        items={[
          {
            attemptId: "at-1",
            testTitle: "Охрана труда",
            finishedAt: "2026-07-02T09:30:00.000Z",
            percent: 95,
            passed: true,
          },
        ]}
      />,
    );
    expect(screen.getByText("95 %")).toBeInTheDocument();
    expect(screen.getByText("Зачёт")).toBeInTheDocument();
    expect(screen.getByText("02.07.2026")).toBeInTheDocument();
    expect(screen.getByTestId("home-result-open-at-1")).toBeInTheDocument();
    expect(screen.getByTestId("home-results-history")).toBeInTheDocument();
  });

  it("shows the empty state without an action but keeps the history link", () => {
    render(<RecentResultsSection items={[]} />);
    expect(screen.getByText("Вы ещё не проходили тестов")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByTestId("home-results-history")).toBeInTheDocument();
  });
});

describe("MyTestsSection", () => {
  it("stacks the publication chips and marks a granted test", () => {
    render(<MyTestsSection items={[myTest({ owned: false, canExport: false })]} total={1} />);
    expect(screen.getByText("Опубликован")).toBeInTheDocument();
    expect(screen.getByText("Есть изменения")).toBeInTheDocument();
    expect(screen.getByText("Доступ выдан")).toBeInTheDocument();
    expect(screen.getByText(/4 раздела · 56 вопросов/)).toBeInTheDocument();
    expect(screen.queryByTestId("home-test-export-t1")).not.toBeInTheDocument();
  });

  it("renders only the actions the rights allow", () => {
    render(<MyTestsSection items={[myTest({ canEdit: false, canDebug: true })]} total={1} />);
    expect(screen.queryByTestId("home-test-edit-t1")).not.toBeInTheDocument();
    expect(screen.getByTestId("home-test-debug-t1")).toBeInTheDocument();
  });

  it("shows the empty state WITH the «Создать тест» action", () => {
    render(<MyTestsSection items={[]} total={0} />);
    expect(screen.getByText("Тестов пока нет")).toBeInTheDocument();
    expect(screen.getByTestId("home-my-tests-create")).toHaveTextContent("Создать тест");
  });

  it("links to the full list only when there are more tests than shown", () => {
    const { rerender } = render(<MyTestsSection items={[myTest()]} total={1} />);
    expect(screen.queryByTestId("home-my-tests-all")).not.toBeInTheDocument();

    rerender(<MyTestsSection items={[myTest()]} total={14} />);
    expect(screen.getByTestId("home-my-tests-all")).toBeInTheDocument();
  });
});

describe("MyTopicsSection", () => {
  it("shows the code, the question count and both row actions", () => {
    render(<MyTopicsSection items={[myTopic()]} total={1} />);
    expect(screen.getByText("IB")).toBeInTheDocument();
    expect(screen.getByText(/128 вопросов/)).toBeInTheDocument();
    expect(screen.getByTestId("home-topic-open-tp1")).toBeInTheDocument();
    expect(screen.getByTestId("home-topic-add-question-tp1")).toBeInTheDocument();
    expect(screen.queryByText("Доступ выдан")).not.toBeInTheDocument();
  });

  it("shows the empty state WITH an action", () => {
    render(<MyTopicsSection items={[]} total={0} />);
    expect(screen.getByTestId("home-my-topics-create")).toBeInTheDocument();
  });
});

describe("SummaryStrip", () => {
  it("shows four numbers and no chart at all", () => {
    const { container } = render(
      <SummaryStrip data={{ attempts30d: 1284, passRate: 78, avgPercent: 71, activeUsers: 342 }} />,
    );
    expect(screen.getByTestId("home-summary-attempts")).toHaveTextContent("1284");
    expect(screen.getByTestId("home-summary-pass-rate")).toHaveTextContent("78%");
    expect(screen.getByTestId("home-summary-avg")).toHaveTextContent("71%");
    expect(screen.getByTestId("home-summary-users")).toHaveTextContent("342");
    // Risk R-1: trends live in «Аналитика». No canvas, no charting library root.
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector('[class*="recharts"]')).toBeNull();
    expect(container.querySelector('[class*="ou-chart"]')).toBeNull();
    expect(screen.getByTestId("home-summary-analytics")).toBeInTheDocument();
  });
});

describe("MaterialsSection", () => {
  it("lists every active template and both documents as plain anchors", () => {
    render(
      <MaterialsSection
        data={{
          activeTemplates: ["Стандартный", "Сертификация (РТК)"],
          docs: [
            { id: "guide", label: "Руководство", href: "/api/admin/templates/docs/guide" },
            { id: "spec", label: "Спецификация", href: "/api/admin/templates/docs/spec" },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("home-material-template-Стандартный")).toBeInTheDocument();
    expect(screen.getByTestId("home-material-template-Сертификация (РТК)")).toBeInTheDocument();
    const guide = screen.getByTestId("home-material-doc-guide");
    expect(guide.tagName).toBe("A");
    expect(guide).toHaveAttribute("href", "/api/admin/templates/docs/guide");
  });

  it("says so when no template is active", () => {
    render(<MaterialsSection data={{ activeTemplates: [], docs: [] }} />);
    expect(screen.getByText("Активных шаблонов нет")).toBeInTheDocument();
  });
});

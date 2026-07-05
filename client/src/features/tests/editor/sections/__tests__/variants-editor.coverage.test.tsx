/**
 * @module features/tests/editor/sections/__tests__/variants-editor.coverage.test
 * @description Coverage-oriented component tests for the PRD-17 fixed-variant
 * editor (`variants-editor.tsx`). Drives the toggle, the summary block
 * (coverage + balance lines), and the «Настроить варианты…» modal (tab add /
 * remove, TransferList assignment, done button) which the base editor suite
 * does not exercise.
 *
 * Coverage:
 *   - Switch on/off: seeds a 2-variant set / clears variants mode.
 *   - Disabled (adaptive) and off states show their explanatory copy.
 *   - Summary table: per-variant size + the «0» empty tag.
 *   - Coverage line: orphan > 0 warning vs «все задействованы».
 *   - Balance line: balanced vs «неравные варианты», hidden until all filled.
 *   - Error prop rendering.
 *   - Modal: add variant (add tab), remove variant (>2 forms), TransferList
 *     «Назначить всех», membership tag for a shared question, done → close.
 */
import type * as React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FormSet } from "@shared/schema";
import { VariantsEditor } from "../variants-editor";

// crypto.randomUUID is used by makeForm; ensure it exists in the test env.
beforeAll(() => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (!g.crypto) g.crypto = {};
  if (typeof g.crypto.randomUUID !== "function") {
    let n = 0;
    g.crypto.randomUUID = () => `uuid-${++n}` as `${string}-${string}-${string}-${string}-${string}`;
  }
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const QUESTIONS = [
  { id: "q1", topicId: "t1", type: "single", prompt: "Вопрос 1" },
  { id: "q2", topicId: "t1", type: "multiple", prompt: "Вопрос 2" },
  { id: "q3", topicId: "t1", type: "matching", prompt: "Вопрос 3" },
  { id: "q4", topicId: "t1", type: "ranking", prompt: "Вопрос 4" },
  { id: "qX", topicId: "t2", type: "single", prompt: "Чужой" },
];

function form(id: string, label: string, questionIds: string[]) {
  return { id, label, questionIds };
}

function renderVE(
  ui: React.JSX.Element,
  questions: unknown[] = QUESTIONS,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["/api/questions"], questions);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// ─── Toggle + state copy ──────────────────────────────────────────────────────

describe("<VariantsEditor /> — toggle & state copy", () => {
  it("shows the disabled (adaptive) copy and a disabled, still-checked toggle", () => {
    const formSet: FormSet = { forms: [form("f1", "Вариант 1", ["q1"])] };
    renderVE(
      <VariantsEditor topicId="t1" topicName="Тема А" formSet={formSet} onChange={() => {}} disabled />,
    );
    expect(screen.getByTestId("topic-variants-disabled-t1")).toBeInTheDocument();
    const toggle = screen.getByTestId("topic-variants-toggle-t1") as HTMLInputElement;
    expect(toggle).toBeDisabled();
    expect(toggle.checked).toBe(true);
    // active === false → no summary block.
    expect(screen.queryByTestId("topic-variants-block-t1")).toBeNull();
  });

  it("shows the off copy and no block when variants mode is off", () => {
    renderVE(
      <VariantsEditor topicId="t1" topicName="Тема А" formSet={null} onChange={() => {}} />,
    );
    expect(screen.getByText(/Выключено — выдача из всего банка темы/i)).toBeInTheDocument();
    expect(screen.queryByTestId("topic-variants-block-t1")).toBeNull();
  });

  it("turning the switch ON seeds two variants and would open the modal", () => {
    const onChange = vi.fn();
    renderVE(
      <VariantsEditor topicId="t1" topicName="Тема А" formSet={null} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("topic-variants-toggle-t1"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as FormSet;
    expect(next.forms).toHaveLength(2);
    expect(next.forms.map((f) => f.label)).toEqual(["Вариант 1", "Вариант 2"]);
  });

  it("turning the switch OFF clears the variant set (null)", () => {
    const onChange = vi.fn();
    const formSet: FormSet = { forms: [form("f1", "Вариант 1", ["q1"]), form("f2", "Вариант 2", ["q2"])] };
    renderVE(
      <VariantsEditor topicId="t1" topicName="Тема А" formSet={formSet} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("topic-variants-toggle-t1"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

// ─── Summary block: sizes, coverage, balance ──────────────────────────────────

describe("<VariantsEditor /> — summary block", () => {
  it("renders a per-variant size table with a «0» tag for an empty variant", () => {
    const formSet: FormSet = {
      forms: [form("f1", "Вариант 1", ["q1", "q2"]), form("f2", "Вариант 2", [])],
    };
    renderVE(
      <VariantsEditor topicId="t1" topicName="Тема А" formSet={formSet} onChange={() => {}} />,
    );
    const block = screen.getByTestId("topic-variants-block-t1");
    expect(within(block).getByText("0")).toBeInTheDocument();
    // Not all variants filled → the balance line is hidden.
    expect(screen.queryByTestId("topic-variants-balance-t1")).toBeNull();
  });

  it("coverage line warns about orphan questions and flags unequal sizes", () => {
    const formSet: FormSet = {
      forms: [form("f1", "Вариант 1", ["q1", "q2"]), form("f2", "Вариант 2", ["q3"])],
    };
    renderVE(
      <VariantsEditor topicId="t1" topicName="Тема А" formSet={formSet} onChange={() => {}} />,
    );
    // Exact match targets the warning Tag, not the longer coverage sentence.
    expect(screen.getByText("1 не используются")).toBeInTheDocument();
    const balance = screen.getByTestId("topic-variants-balance-t1");
    expect(balance).toHaveTextContent(/неравные/i);
  });

  it("coverage line reports full usage and a balanced set", () => {
    const formSet: FormSet = {
      forms: [form("f1", "Вариант 1", ["q1", "q2"]), form("f2", "Вариант 2", ["q3", "q4"])],
    };
    renderVE(
      <VariantsEditor topicId="t1" topicName="Тема А" formSet={formSet} onChange={() => {}} />,
    );
    expect(screen.getByText(/все задействованы/i)).toBeInTheDocument();
    expect(screen.getByTestId("topic-variants-balance-t1")).toHaveTextContent(/сбалансировано/i);
  });

  it("renders the validation error when the error prop is set", () => {
    const formSet: FormSet = { forms: [form("f1", "Вариант 1", ["q1"]), form("f2", "Вариант 2", ["q2"])] };
    renderVE(
      <VariantsEditor
        topicId="t1"
        topicName="Тема А"
        formSet={formSet}
        onChange={() => {}}
        error="Нужно минимум 2 непустых варианта"
      />,
    );
    expect(screen.getByTestId("topic-variants-error-t1")).toHaveTextContent(
      /минимум 2 непустых/i,
    );
  });
});

// ─── Modal ────────────────────────────────────────────────────────────────────

describe("<VariantsEditor /> — configure modal", () => {
  function openModal(formSet: FormSet, onChange = vi.fn()) {
    renderVE(
      <VariantsEditor topicId="t1" topicName="Тема А" formSet={formSet} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("topic-variants-configure-t1"));
    return onChange;
  }

  it("opens the modal from «Настроить варианты…»", async () => {
    const formSet: FormSet = { forms: [form("f1", "Вариант 1", ["q1"]), form("f2", "Вариант 2", ["q2"])] };
    openModal(formSet);
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Варианты теста/i })).toBeInTheDocument(),
    );
  });

  it("adds a variant via the «Вариант» add tab", async () => {
    const formSet: FormSet = { forms: [form("f1", "Вариант 1", ["q1"]), form("f2", "Вариант 2", ["q2"])] };
    const onChange = openModal(formSet);
    await waitFor(() => screen.getByRole("dialog", { name: /Варианты теста/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Вариант" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as FormSet;
    expect(next.forms).toHaveLength(3);
  });

  it("removes a variant (enabled only when > 2) and renumbers labels", async () => {
    const formSet: FormSet = {
      forms: [
        form("f1", "Вариант 1", ["q1"]),
        form("f2", "Вариант 2", ["q2"]),
        form("f3", "Вариант 3", ["q3"]),
      ],
    };
    const onChange = openModal(formSet);
    await waitFor(() => screen.getByRole("dialog", { name: /Варианты теста/i }));
    const removeBtn = screen.getByTestId("variants-modal-remove");
    expect(removeBtn).not.toBeDisabled();
    fireEvent.click(removeBtn);
    const next = onChange.mock.calls.at(-1)![0] as FormSet;
    expect(next.forms).toHaveLength(2);
    expect(next.forms.map((f) => f.label)).toEqual(["Вариант 1", "Вариант 2"]);
  });

  it("assigns the whole bank into the active variant via «Назначить всех»", async () => {
    // A shared question (q1 in both forms) also exercises the membership tag.
    const formSet: FormSet = {
      forms: [form("f1", "Вариант 1", ["q1"]), form("f2", "Вариант 2", ["q1"])],
    };
    const onChange = openModal(formSet);
    await waitFor(() => screen.getByRole("dialog", { name: /Варианты теста/i }));
    fireEvent.click(screen.getByRole("button", { name: "Назначить всех" }));
    const next = onChange.mock.calls.at(-1)![0] as FormSet;
    // Active tab is variant 1; every unassigned bank question is now in it.
    const active = next.forms.find((f) => f.id === "f1")!;
    expect(active.questionIds).toEqual(expect.arrayContaining(["q1", "q2", "q3", "q4"]));
  });

  it("«Готово» closes the modal", async () => {
    const formSet: FormSet = { forms: [form("f1", "Вариант 1", ["q1"]), form("f2", "Вариант 2", ["q2"])] };
    openModal(formSet);
    await waitFor(() => screen.getByRole("dialog", { name: /Варианты теста/i }));
    fireEvent.click(screen.getByTestId("variants-modal-done"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Варианты теста/i })).toBeNull(),
    );
  });
});

/**
 * @module features/analytics/slices/__tests__/test-slices-tab
 * @description Э3.2: вкладка «Срезы» уровня теста — сохранённые срезы этого теста и сравнение.
 *
 * Тест задан страницей: рамка — только период, и пустой период сказан словами (PRD-56 FR-07j).
 * Строка среза ведёт в «Прохождения» этого теста с условиями среза; «Сравнить с другим срезом»
 * открывает сравнение, где этот срез уже стоит в первом слоте. Сравнение одно на две метрики:
 * «Результат и темы» и «Качество вопросов» — выбор срезов при переключении не сбрасывается.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestSlicesTab } from "../test-slices-tab";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      slices: [{
        id: "s1", name: "Розница, первый поток", conditions: { groupIds: ["g1"], testIds: ["t1"] },
        started: 170, completed: 163, passed: 139, participants: 160,
        passRate: 85, avgPercent: 81, enoughData: true,
      }],
      minObservations: 10,
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

/** Адреса запросов, содержащие `part`. */
function asked(part: string): string[] {
  return fetchMock.mock.calls.map(call => String(call[0])).filter(url => url.includes(part));
}

/** Условия последнего запроса сравнения к ручке срезов. */
function lastConditions(): unknown {
  const url = asked("/api/analytics/slices?").at(-1) ?? "";
  return JSON.parse(new URLSearchParams(url.split("?")[1]).get("conditions") ?? "null");
}

describe("TestSlicesTab", () => {
  it("показывает сохранённые срезы этого теста, без колонок разбивки", async () => {
    render(<TestSlicesTab testId="t1" onOpenPassages={vi.fn()} />);

    expect(await screen.findByText("Розница, первый поток")).toBeTruthy();
    const query = new URLSearchParams(asked("/api/analytics/slices?")[0].split("?")[1]);
    expect(query.get("testId")).toBe("t1");
    expect(query.get("axis")).toBeNull();
    expect(screen.getByText("Сохранённые срезы")).toBeTruthy();
    expect(await screen.findByText("1 срез этого теста · считаются заново при каждом открытии")).toBeTruthy();
    // «Назначено» и «Начато» — величины разбивки по людям, у сохранённого среза их нет (эскиз).
    expect(screen.queryByText("Назначено")).toBeNull();
    expect(screen.queryByText("Начато")).toBeNull();
    // Рамка — только период, и пустой сказан словами.
    expect(screen.queryByLabelText("Тест")).toBeNull();
    expect(screen.getAllByText("не ограничен").length).toBeGreaterThan(0);
  });

  it("строка среза ведёт в «Прохождения» теста с условиями среза", async () => {
    const onOpenPassages = vi.fn();
    render(<TestSlicesTab testId="t1" onOpenPassages={onOpenPassages} />);

    await userEvent.click(await screen.findByRole("button", { name: "Действия со срезом: Розница, первый поток" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Открыть прохождения" }));

    expect(onOpenPassages).toHaveBeenCalledWith(expect.objectContaining({ groupIds: ["g1"] }));
  });

  it("«Сравнить с другим срезом» открывает сравнение с этим срезом в первом слоте", async () => {
    render(<TestSlicesTab testId="t1" onOpenPassages={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Действия со срезом: Розница, первый поток" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Сравнить с другим срезом" }));

    expect(await screen.findByText("Сравнение срезов")).toBeTruthy();
    await waitFor(() => expect(lastConditions()).toEqual({ groupIds: ["g1"], testIds: ["t1"] }));
  });

  it("отбор из фильтра теста открывает вкладку сразу в сравнении", async () => {
    render(<TestSlicesTab testId="t1" adhoc={{ sources: ["web"] }} onOpenPassages={vi.fn()} />);

    expect(await screen.findByText("Сравнение срезов")).toBeTruthy();
    await waitFor(() => expect(lastConditions()).toEqual({ sources: ["web"] }));
  });

  it("сравнение одно на две метрики: «Качество вопросов» считает психометрика", async () => {
    render(<TestSlicesTab testId="t1" onOpenPassages={vi.fn()} />);
    await screen.findByText("Розница, первый поток");

    await userEvent.click(screen.getByRole("button", { name: "Сравнение" }));
    await userEvent.click(await screen.findByRole("button", { name: "Качество вопросов" }));

    await waitFor(() => expect(asked("/api/analytics/psychometrics/t1/slices").length).toBeGreaterThan(0));
  });

  it("отбор из фильтра теста не теряется при переключении на «Качество вопросов»", async () => {
    render(<TestSlicesTab testId="t1" adhoc={{ sources: ["web"] }} onOpenPassages={vi.fn()} />);
    expect(await screen.findByText("Сравнение срезов")).toBeTruthy();

    await userEvent.click(await screen.findByRole("button", { name: "Качество вопросов" }));

    await waitFor(() => expect(asked("/api/analytics/psychometrics/t1/slices").length).toBeGreaterThan(0));
    const url = asked("/api/analytics/psychometrics/t1/slices").at(-1) ?? "";
    expect(JSON.parse(new URLSearchParams(url.split("?")[1]).get("conditions") ?? "null"))
      .toEqual({ sources: ["web"] });
  });
});

/**
 * @module features/analytics/slices/__tests__/results-by-axis
 * @description Э3.2: «Результаты по группам» на «Обзоре» теста — разбивка по полю участника.
 *
 * Это не срез: заголовок и первая колонка следуют оси, выборку задаёт фильтр уровня теста, а из
 * строки открываются её прохождения — с условиями фильтра и строки вместе.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResultsByAxis } from "../results-by-axis";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      axis: "group",
      slices: [{
        id: "group:g1", name: "Розница", conditions: { groupIds: ["g1"] },
        started: 20, completed: 18, passed: 15, participants: 18,
        passRate: 83, avgPercent: 78, enoughData: true, assigned: 25,
      }],
      minObservations: 10,
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

/** Параметры последнего запроса к ручке срезов. */
function lastSlicesQuery(): URLSearchParams {
  const url = fetchMock.mock.calls.map(call => String(call[0]))
    .filter(candidate => candidate.includes("/api/analytics/slices")).at(-1) ?? "";
  return new URLSearchParams(url.slice(url.indexOf("?")));
}

describe("ResultsByAxis", () => {
  it("разбивает выборку уровня теста по группе и называет это результатами, а не срезом", async () => {
    render(
      <ResultsByAxis testId="t1" conditions={{ sources: ["web"] }} completed={486} onOpenPassages={vi.fn()} onCompare={vi.fn()} />,
    );

    expect(await screen.findByText("Розница")).toBeTruthy();
    expect(screen.getByText("Результаты по группам")).toBeTruthy();
    expect(screen.getByText("486 завершённых прохождений теста · строку можно сохранить срезом")).toBeTruthy();
    expect(lastSlicesQuery().get("axis")).toBe("group");
    expect(lastSlicesQuery().get("testId")).toBe("t1");
    expect(JSON.parse(lastSlicesQuery().get("conditions") ?? "null")).toEqual({ sources: ["web"] });
    // Первая колонка — имя оси, а не «Срез»; величины разбивки по людям на месте.
    expect(screen.getAllByText("Группа").length).toBeGreaterThan(0);
    expect(screen.getByText("Назначено")).toBeTruthy();
  });

  it("следует оси: заголовок меняется вместе с ней (FR-06b)", async () => {
    render(<ResultsByAxis testId="t1" conditions={{}} completed={10} onOpenPassages={vi.fn()} onCompare={vi.fn()} />);
    await screen.findByText("Розница");

    await userEvent.click(screen.getByLabelText("Разбить по"));
    const options = (await screen.findAllByRole("option")).map(option => option.textContent);
    expect(options.slice(0, 4)).toEqual(["Группа", "Подразделение", "Должность", "Организация"]);
    await userEvent.click(screen.getByRole("option", { name: "Подразделение" }));

    await waitFor(() => expect(lastSlicesQuery().get("axis")).toBe("unit"));
    expect(await screen.findByText("Результаты по подразделениям")).toBeTruthy();
  });

  it("строка открывает прохождения с условиями фильтра и строки вместе", async () => {
    const onOpenPassages = vi.fn();
    render(
      <ResultsByAxis testId="t1" conditions={{ sources: ["web"] }} completed={10} onOpenPassages={onOpenPassages} onCompare={vi.fn()} />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Действия со срезом: Розница" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Открыть прохождения" }));

    expect(onOpenPassages).toHaveBeenCalledWith({ sources: ["web"], groupIds: ["g1"] });
  });
});

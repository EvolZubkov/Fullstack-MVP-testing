/**
 * @module features/analytics/slices/__tests__/slices-tab
 * @description PRD-56 FR-06a, FR-07e, FR-07i, FR-07j: вкладка срезов и её рамка расчёта.
 *
 * Рамка — тест и период — общая для списка срезов и для сравнения: у разных тестов разные пороги
 * и шкалы, поэтому средние законны только внутри одного теста, а период отвечает на «когда»,
 * которое иначе пришлось бы держать в голове. Пустой период означает «за всё время» (FR-07j) —
 * это сказано на экране, а не подразумевается.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SlicesTab } from "../slices-tab";

const TESTS = [
  { id: "t1", title: "Сертификация руководителей" },
  { id: "t2", title: "Охрана труда" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      axis: "group",
      slices: [{
        id: "group:g1", name: "Розница", conditions: { groupIds: ["g1"] },
        started: 20, completed: 18, passed: 15, participants: 18,
        passRate: 83, avgPercent: 78, enoughData: true,
      }],
      minObservations: 10,
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

/** Условия последнего запроса к ручке срезов. */
function lastSlicesQuery(): URLSearchParams {
  const url = fetchMock.mock.calls
    .map(call => String(call[0]))
    .filter(candidate => candidate.includes("/api/analytics/slices"))
    .at(-1) ?? "";
  return new URLSearchParams(url.slice(url.indexOf("?")));
}

/** Выбрать тест в рамке расчёта. */
async function pickTest(title: string) {
  await userEvent.click(screen.getByLabelText("Тест"));
  await userEvent.click(await screen.findByText(title));
}

describe("SlicesTab", () => {
  it("не считает ничего, пока тест не выбран, и говорит почему", () => {
    render(<SlicesTab tests={TESTS} />);

    expect(screen.getByText(/Срезы считаются внутри одного теста/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("считает срезы выбранного теста", async () => {
    render(<SlicesTab tests={TESTS} />);

    await pickTest("Сертификация руководителей");

    await waitFor(() => expect(lastSlicesQuery().get("testId")).toBe("t1"));
    expect(await screen.findByText("Розница")).toBeTruthy();
  });

  it("говорит, что пустой период означает «за всё время»", async () => {
    render(<SlicesTab tests={TESTS} />);

    await pickTest("Сертификация руководителей");

    // FR-07j: молчаливое «за всё время» читатель принимает за «за последний месяц» и делает
    // из среза вывод о периоде, которого никто не задавал.
    expect(await screen.findByText(/за всё время/)).toBeTruthy();
  });

  it("переключает список срезов и сравнение одним переключателем", async () => {
    render(<SlicesTab tests={TESTS} />);
    await pickTest("Сертификация руководителей");
    await screen.findByText("Розница");

    await userEvent.click(screen.getByRole("button", { name: "Сравнение" }));

    expect(await screen.findByText(/Выберите срезы/i)).toBeTruthy();
  });

  it("разбивает по выбранной оси", async () => {
    render(<SlicesTab tests={TESTS} />);
    await pickTest("Сертификация руководителей");
    await waitFor(() => expect(lastSlicesQuery().get("axis")).toBe("group"));

    await userEvent.click(screen.getByLabelText("Разбить по"));
    await userEvent.click(await screen.findByText("Источник"));

    await waitFor(() => expect(lastSlicesQuery().get("axis")).toBe("source"));
  });

  it("разбивает по подразделению и называет срез по оси (FR-06b)", async () => {
    render(<SlicesTab tests={TESTS} />);
    await pickTest("Сертификация руководителей");

    await userEvent.click(screen.getByLabelText("Разбить по"));
    // Оргоси стоят сразу за группой; должность и организация — рядом.
    const options = (await screen.findAllByRole("option")).map(option => option.textContent);
    expect(options.slice(0, 4)).toEqual(["Группа", "Подразделение", "Должность", "Организация"]);
    await userEvent.click(screen.getByRole("option", { name: "Подразделение" }));

    await waitFor(() => expect(lastSlicesQuery().get("axis")).toBe("unit"));
    expect(await screen.findByText("Срез по подразделениям")).toBeTruthy();
  });

  it("добавляет к условиям среза тест рамки при переходе в реестр", async () => {
    const onOpenRegistry = vi.fn();
    render(<SlicesTab tests={TESTS} onOpenRegistry={onOpenRegistry} />);
    await pickTest("Сертификация руководителей");

    await userEvent.click(await screen.findByRole("button", { name: "Действия со срезом: Розница" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Открыть прохождения" }));

    // У среза своего теста нет: он общий для всей вкладки (FR-07e). Реестр без него показал бы
    // прохождения всех тестов разом — другую выборку под именем среза.
    expect(onOpenRegistry).toHaveBeenCalledWith(
      expect.objectContaining({ groupIds: ["g1"], testIds: ["t1"] }),
    );
  });

  // Дельта 6.3 эскиза: «Сравнить с другим срезом» из меню строки открывает сравнение, где этот
  // срез уже стоит в первом слоте, — выбирать его заново из списка незачем.
  it("«Сравнить с другим срезом» открывает сравнение с этим срезом", async () => {
    render(<SlicesTab tests={TESTS} />);
    await pickTest("Сертификация руководителей");

    await userEvent.click(await screen.findByRole("button", { name: "Действия со срезом: Розница" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Сравнить с другим срезом" }));

    expect(await screen.findByText("Сравнение срезов")).toBeTruthy();
    await waitFor(() => expect(JSON.parse(lastSlicesQuery().get("conditions") ?? "null"))
      .toEqual({ groupIds: ["g1"] }));
  });

  it("называет в заголовке, по какому признаку разбита выборка", async () => {
    render(<SlicesTab tests={TESTS} />);

    await pickTest("Сертификация руководителей");

    expect(await screen.findByText("Срез по группам")).toBeTruthy();
  });
});

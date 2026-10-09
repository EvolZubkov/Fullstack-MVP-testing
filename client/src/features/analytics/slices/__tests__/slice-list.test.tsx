/**
 * @module features/analytics/slices/__tests__/slice-list
 * @description PRD-56 FR-06, FR-06c, FR-06d, FR-08: список срезов.
 *
 * Список показывает ФАКТЫ: объёмы, долю сдавших, средний результат. Отклонений от невидимой на
 * экране величины в нём нет — из-за них понятие «база» из продукта и убрали. Ниже порога
 * наблюдений процент не печатается вовсе: «33 % сдали» на трёх прохождениях — шум, по которому
 * принимают решения о людях.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SliceList } from "../slice-list";

const SLICE = {
  id: "s1",
  name: "Отдел продаж",
  conditions: { groupIds: ["g1"] },
  started: 14,
  completed: 12,
  passed: 9,
  participants: 12,
  passRate: 75,
  avgPercent: 71.5,
  enoughData: true,
};

const SCARCE = {
  ...SLICE,
  id: "s2",
  name: "Информационная безопасность",
  started: 3, completed: 3, passed: 1, participants: 3,
  passRate: null, avgPercent: null, enoughData: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

function answer(slices: unknown[]) {
  return { ok: true, json: async () => ({ slices, minObservations: 10 }) };
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(answer([SLICE]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

/** Условия последнего запроса к ручке срезов. */
function lastQuery(): URLSearchParams {
  const url = String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
  return new URLSearchParams(url.slice(url.indexOf("?")));
}

/** Открыть меню «⋯» строки среза. */
async function openRowMenu(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: `Действия со срезом: ${name}` }));
}

/** Пункты открытого меню строки — по порядку. */
function menuItems(): string[] {
  return screen.getAllByRole("menuitem").map(item => item.textContent ?? "");
}

describe("SliceList", () => {
  it("показывает объёмы и проценты строки разбивки", async () => {
    render(<SliceList testId="test1" axis="group" />);

    expect(await screen.findByText("Отдел продаж")).toBeTruthy();
    expect(screen.getByText("75 %")).toBeTruthy();
    expect(screen.getByText("72 %")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("14")).toBeTruthy();
  });

  // FR-06 называет «назначено» и слабейшую тему наравне с объёмами. Обе величины бывают
  // неопределимы, и тогда экран обязан сказать прочерк, а не выдумать ноль или «первую попавшуюся
  // тему»: по оси номера попытки назначать нечего, а тема ниже порога наблюдений — шум.
  it("показывает «Назначено» и слабейшую тему, а где их нет — прочерк", async () => {
    fetchMock.mockResolvedValue(answer([
      {
        ...SLICE,
        assigned: 18,
        weakest: { topicId: "t2", topicName: "Право", correctShare: 46, inSample: 12 },
      },
      { ...SLICE, id: "s3", name: "Вторая попытка", assigned: null, weakest: null },
    ]));

    render(<SliceList testId="test1" axis="group" />);

    expect(await screen.findByText("Назначено")).toBeTruthy();
    expect(screen.getByText("Слабейшая тема")).toBeTruthy();
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText("Право · 46 %")).toBeTruthy();
    // Строка без обеих величин: два прочерка, а не «0» и не пустая ячейка.
    expect(screen.getAllByText("—").length).toBe(2);
  });

  // Эскиз PRD-56: колонки «Участников» в списке нет — число людей среза видно в реестре по
  // переходу, а рядом с «Начато» и «Завершено» оно читалось как третий объём того же рода.
  it("не показывает колонку «Участников»", async () => {
    render(<SliceList testId="test1" />);

    await screen.findByText("Отдел продаж");
    expect(screen.queryByText("Участников")).toBeNull();
  });

  it("ниже порога говорит «мало данных» и оставляет объём", async () => {
    fetchMock.mockResolvedValue(answer([SCARCE]));

    render(<SliceList testId="test1" />);

    expect((await screen.findAllByText(/мало данных/i)).length).toBeGreaterThan(0);
    // Объём виден: он и есть то, что читатель должен увидеть вместо процента.
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.queryByText("33 %")).toBeNull();
  });

  it("не показывает отклонений: сравнивать здесь не с чем", async () => {
    render(<SliceList testId="test1" />);

    await screen.findByText("Отдел продаж");
    expect(screen.queryByText(/Разница|Отклонение|к базе/i)).toBeNull();
  });

  it("передаёт рамку расчёта: тест и период", async () => {
    render(<SliceList testId="test1" from="2026-09-01" to="2026-09-30" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastQuery().get("testId")).toBe("test1");
    expect(lastQuery().get("from")).toBe("2026-09-01");
    expect(lastQuery().get("to")).toBe("2026-09-30");
  });

  it("разбивает по выбранной оси", async () => {
    render(<SliceList testId="test1" axis="group" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastQuery().get("axis")).toBe("group");
  });

  it("ведёт из строки в реестр с условиями этого среза", async () => {
    const onOpenRegistry = vi.fn();
    render(<SliceList testId="test1" onOpenRegistry={onOpenRegistry} />);

    await openRowMenu("Отдел продаж");
    await userEvent.click(screen.getByRole("menuitem", { name: "Открыть прохождения" }));

    expect(onOpenRegistry).toHaveBeenCalledWith(SLICE.conditions);
  });

  // FR-24: реестр отвечает «кто эти люди», аналитика теста — «что у них не получилось».
  // Условия среза едут в оба перехода, иначе на той стороне их пришлось бы набирать заново.
  it("ведёт из строки в аналитику теста с условиями этого среза", async () => {
    const onOpenTestAnalytics = vi.fn();
    fetchMock.mockResolvedValue(answer([SLICE]));

    render(
      <SliceList testId="test1" axis="group" onOpenTestAnalytics={onOpenTestAnalytics} />,
    );

    await openRowMenu("Отдел продаж");
    await userEvent.click(screen.getByRole("menuitem", { name: "Аналитика теста" }));

    expect(onOpenTestAnalytics).toHaveBeenCalledWith({ groupIds: ["g1"] });
  });

  it("говорит, когда срезов ещё нет", async () => {
    fetchMock.mockResolvedValue(answer([]));

    render(<SliceList testId="test1" />);

    expect(await screen.findByText(/Срезов пока нет/i)).toBeTruthy();
  });

  it("сообщает об ошибке, а не показывает пустой список как «данных нет»", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    render(<SliceList testId="test1" />);

    expect(await screen.findByText(/Не удалось загрузить срезы/i)).toBeTruthy();
  });
});

describe("SliceList — разворот строки по темам (FR-06e)", () => {
  /** Ответ ручки тем: её зовут вторым запросом, при развороте. */
  const topicsAnswer = (topics: unknown[]) => ({ ok: true, json: async () => ({ topics }) });

  it("грузит темы только при развороте, а не вместе со списком", async () => {
    // Платить за темы всех срезов при каждом показе списка незачем: развёрнут за раз один.
    fetchMock.mockResolvedValueOnce(answer([SLICE]));
    render(<SliceList testId="t1" axis="group" />);
    await screen.findByText("Отдел продаж");

    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(topicsAnswer([
      { topicId: "tp-1", topicName: "Бюджет", correctShare: 64, inSample: 12 },
    ]));
    await userEvent.click(screen.getByRole("button", { name: "Развернуть" }));

    await waitFor(() => expect(screen.getByText("Бюджет")).toBeTruthy());
    expect(screen.getByText("64 %")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Срез адресуется осью и ключом: условия реестра покрывают не всякую ось.
    expect(String(fetchMock.mock.calls[1][0])).toContain("axis=group");
  });

  it("повторный разворот той же строки второй раз не грузит", async () => {
    fetchMock.mockResolvedValueOnce(answer([SLICE]));
    render(<SliceList testId="t1" axis="group" />);
    await screen.findByText("Отдел продаж");
    fetchMock.mockResolvedValueOnce(topicsAnswer([
      { topicId: "tp-1", topicName: "Бюджет", correctShare: 64, inSample: 12 },
    ]));

    const chevron = screen.getByRole("button", { name: "Развернуть" });
    await userEvent.click(chevron);
    await waitFor(() => expect(screen.getByText("Бюджет")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Свернуть" }));
    await userEvent.click(screen.getByRole("button", { name: "Развернуть" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("срез без завершённых прохождений не разворачивается вовсе", async () => {
    // Раскрытие в пустоту читается как поломка, а не как «данных нет».
    fetchMock.mockResolvedValueOnce(answer([
      { ...SLICE, started: 2, completed: 0, passed: 0, participants: 2, enoughData: false },
    ]));
    render(<SliceList testId="t1" axis="group" />);
    await screen.findByText("Отдел продаж");

    expect(screen.queryByRole("button", { name: "Развернуть" })).toBeNull();
  });

  it("сбой расчёта тем говорит словами, а не пустой таблицей", async () => {
    fetchMock.mockResolvedValueOnce(answer([SLICE]));
    render(<SliceList testId="t1" axis="group" />);
    await screen.findByText("Отдел продаж");
    fetchMock.mockRejectedValueOnce(new Error("сеть"));

    await userEvent.click(screen.getByRole("button", { name: "Развернуть" }));

    await waitFor(() => expect(screen.getByText(/по темам считать нечего/i)).toBeTruthy());
  });
});

/**
 * Эскиз PRD-56 (задача 2.3 плана сверки): колонки фактов сортируются, «Слабейшая тема» — нет.
 * «Мало данных» и неприменимое «Назначено» уходят в конец в обоих направлениях: пустое не
 * меньше и не больше числа.
 */
describe("SliceList — сортировка", () => {
  const ROWS = [
    { ...SLICE, id: "a", name: "Бета", passRate: 60, assigned: 30 },
    { ...SLICE, id: "b", name: "Альфа", passRate: 90, assigned: null },
    { ...SCARCE, id: "c", name: "Гамма", assigned: 5 },
    { ...SLICE, id: "d", name: "Вега", passRate: 40, assigned: 10 },
  ];
  const order = () => screen.getAllByText(/^(Альфа|Бета|Вега|Гамма)$/).map(el => el.textContent);
  const clickHeader = async (title: string) => {
    const header = screen.getAllByText(title).find(el => el.closest(".ou-grid__th")) as HTMLElement;
    await userEvent.click(header);
  };

  beforeEach(() => fetchMock.mockResolvedValue(answer(ROWS)));

  it("по умолчанию — порядок сервера", async () => {
    render(<SliceList testId="test1" />);
    await screen.findByText("Альфа");
    expect(order()).toEqual(["Бета", "Альфа", "Гамма", "Вега"]);
  });

  // Э3.2 (эскиз approved/e3-test-and-question.html): у сохранённых срезов теста «назначено» и
  // «начато» не показываются — это величины разбивки по людям; под именем — условия среза.
  it("сохранённые срезы: четыре сортируемые колонки, под именем — условия", async () => {
    render(<SliceList testId="test1" />);
    await screen.findByText("Альфа");
    const sortable = [...document.querySelectorAll(".ou-grid__th.is-sortable")].map(el => el.textContent);
    expect(sortable).toEqual(["Срез", "Завершено", "Сдали", "Средний результат"]);
    expect(screen.queryByText("Назначено")).toBeNull();
    expect(screen.queryByText("Начато")).toBeNull();
  });

  it("шесть колонок разбивки сортируемы, «Слабейшая тема» — нет", async () => {
    render(<SliceList testId="test1" axis="group" />);
    await screen.findByText("Альфа");
    const sortable = [...document.querySelectorAll(".ou-grid__th.is-sortable")].map(el => el.textContent);
    expect(sortable).toEqual(["Срез", "Назначено", "Начато", "Завершено", "Сдали", "Средний результат"]);
  });

  it("«Сдали» — по доле, «мало данных» последним в обоих направлениях", async () => {
    render(<SliceList testId="test1" />);
    await screen.findByText("Альфа");

    await clickHeader("Сдали");
    expect(order()).toEqual(["Вега", "Бета", "Альфа", "Гамма"]);
    await clickHeader("Сдали");
    expect(order()).toEqual(["Альфа", "Бета", "Вега", "Гамма"]);
  });

  it("«Срез» — по алфавиту, «Назначено» — прочерк последним", async () => {
    render(<SliceList testId="test1" axis="group" />);
    await screen.findByText("Альфа");

    await clickHeader("Срез");
    expect(order()).toEqual(["Альфа", "Бета", "Вега", "Гамма"]);
    await clickHeader("Назначено");
    expect(order()).toEqual(["Гамма", "Вега", "Бета", "Альфа"]);
  });
});

/**
 * Эскиз PRD-56, состояние `slice-gap` (дельта 6.3): действия строки — под троеточием. Две кнопки
 * с именем среза в подписи вылезали за правый край таблицы; меню занимает узкую колонку.
 */
describe("SliceList — меню «⋯» строки среза", () => {
  const AXIS_ROW = { ...SLICE, id: "group:g1", name: "Розница" };

  /** Запросы к ручке с данным началом адреса. */
  const callsTo = (prefix: string) => fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter(url => url.startsWith(prefix));

  it("вместо кнопок-переходов в строке — одна кнопка «⋯»", async () => {
    fetchMock.mockResolvedValue(answer([AXIS_ROW]));
    render(
      <SliceList testId="t1" axis="group" onOpenRegistry={vi.fn()} onOpenTestAnalytics={vi.fn()} />,
    );

    expect(await screen.findByRole("button", { name: "Действия со срезом: Розница" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Прохождения:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Аналитика теста" })).toBeNull();
  });

  it("срез по оси: пункты эскиза, «Сохранить как срез» есть, «Изменить условия» — нет", async () => {
    fetchMock.mockResolvedValue(answer([AXIS_ROW]));
    render(
      <SliceList
        testId="t1"
        axis="group"
        onOpenRegistry={vi.fn()}
        onOpenTestAnalytics={vi.fn()}
        onCompare={vi.fn()}
      />,
    );

    await openRowMenu("Розница");

    expect(menuItems()).toEqual([
      "Открыть прохождения",
      "Аналитика теста",
      "Сравнить с другим срезом",
      "Сохранить как срез",
      "Выгрузить прохождения",
    ]);
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("сохранённый срез: «Изменить условия» есть, «Сохранить как срез» — нет", async () => {
    render(
      <SliceList testId="t1" onOpenRegistry={vi.fn()} onOpenTestAnalytics={vi.fn()} onCompare={vi.fn()} />,
    );

    await openRowMenu("Отдел продаж");

    expect(menuItems()).toEqual([
      "Открыть прохождения",
      "Аналитика теста",
      "Сравнить с другим срезом",
      "Изменить условия",
      "Выгрузить прохождения",
    ]);
  });

  it("пунктов без обработчика нет", async () => {
    fetchMock.mockResolvedValue(answer([AXIS_ROW]));
    render(<SliceList testId="t1" axis="group" />);

    await openRowMenu("Розница");

    expect(menuItems()).toEqual(["Сохранить как срез", "Выгрузить прохождения"]);
  });

  // «Без группы», номер попытки, внешний участник на языке реестра не описываются: сравнение и
  // сохранение по пустым условиям дали бы тест целиком под именем среза.
  it("строка без условий не предлагает сравнить и сохранить", async () => {
    fetchMock.mockResolvedValue(answer([{ ...AXIS_ROW, id: "attempt:2", name: "Попытка 2", conditions: {} }]));
    render(<SliceList testId="t1" axis="attempt" onCompare={vi.fn()} />);

    await openRowMenu("Попытка 2");

    expect(menuItems()).toEqual(["Выгрузить прохождения"]);
  });

  it("«Сравнить с другим срезом» отдаёт условия и имя этого среза", async () => {
    const onCompare = vi.fn();
    fetchMock.mockResolvedValue(answer([AXIS_ROW]));
    render(<SliceList testId="t1" axis="group" onCompare={onCompare} />);

    await openRowMenu("Розница");
    await userEvent.click(screen.getByRole("menuitem", { name: "Сравнить с другим срезом" }));

    expect(onCompare).toHaveBeenCalledWith({ groupIds: ["g1"] }, "Розница");
  });

  it("«Сохранить как срез» сохраняет условия строки с тестом рамки и именем строки", async () => {
    fetchMock.mockResolvedValueOnce(answer([AXIS_ROW]));
    render(<SliceList testId="t1" axis="group" from="2026-09-01" />);

    await openRowMenu("Розница");
    await userEvent.click(screen.getByRole("menuitem", { name: "Сохранить как срез" }));

    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Название среза") as HTMLInputElement;
    // Имя предложено из строки: срез по оси уже назван, придумывать заново незачем.
    expect(name.value).toBe("Розница");
    await userEvent.clear(name);
    await userEvent.type(name, "Розница, сентябрь");

    fetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ slice: {} }) });
    await userEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const call = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === "/api/analytics/slices" && (init as RequestInit | undefined)?.method === "POST");
    expect(call).toBeTruthy();
    // Период рамки в условия не входит: он рамка расчёта, а не свойство среза (FR-07e).
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
      name: "Розница, сентябрь",
      kind: "slice",
      conditions: { groupIds: ["g1"], testIds: ["t1"] },
    });
  });

  it("ошибку сохранения говорит в окне, окно не закрывает", async () => {
    fetchMock.mockResolvedValueOnce(answer([AXIS_ROW]));
    render(<SliceList testId="t1" axis="group" />);

    await openRowMenu("Розница");
    await userEvent.click(screen.getByRole("menuitem", { name: "Сохранить как срез" }));
    const dialog = await screen.findByRole("dialog");

    fetchMock.mockResolvedValueOnce({
      ok: false, status: 409, json: async () => ({ error: "Запись с таким именем уже есть" }),
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(await within(dialog).findByText("Запись с таким именем уже есть")).toBeTruthy();
  });

  it("«Изменить условия» правит сохранённый срез и перечитывает список", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return { ok: true, json: async () => ({ slice: {} }) };
      if (String(url).startsWith("/api/analytics/slices?")) {
        return answer([{ ...SLICE, conditions: { groupIds: ["g1"], testIds: ["t1"] } }]);
      }
      // Справочники окна отбора.
      return { ok: true, json: async () => [] };
    });
    render(<SliceList testId="t1" />);

    await openRowMenu("Отдел продаж");
    await userEvent.click(screen.getByRole("menuitem", { name: "Изменить условия" }));
    const dialog = await screen.findByRole("dialog");
    const before = callsTo("/api/analytics/slices?").length;

    await userEvent.click(within(dialog).getByRole("button", { name: /Применить/ }));

    await waitFor(() => expect(callsTo("/api/analytics/slices?").length).toBe(before + 1));
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(String(put![0])).toBe("/api/analytics/slices/s1");
    // Тест среза переживает правку: окно его не показывает, но срез без теста — не срез.
    expect(JSON.parse(String((put![1] as RequestInit).body)).conditions).toEqual(
      expect.objectContaining({ testIds: ["t1"], groupIds: ["g1"] }),
    );
  });

  it("правка сохранённого среза не теряет оргусловия (FR-06b)", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return { ok: true, json: async () => ({ slice: {} }) };
      if (String(url).startsWith("/api/analytics/slices?")) {
        return answer([{ ...SLICE, conditions: { units: ["Отдел продаж"], testIds: ["t1"] } }]);
      }
      return { ok: true, json: async () => [] };
    });
    render(<SliceList testId="t1" />);

    await openRowMenu("Отдел продаж");
    await userEvent.click(screen.getByRole("menuitem", { name: "Изменить условия" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /Применить/ }));

    await waitFor(() => expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
    ).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((put![1] as RequestInit).body)).conditions)
      .toEqual(expect.objectContaining({ units: ["Отдел продаж"] }));
  });

  it("выгрузка оргсреза отбирает по его подразделению (FR-06b)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/analytics/slices?")) {
        return answer([{ ...AXIS_ROW, id: "unit:Логистика", name: "Логистика", conditions: { units: ["Логистика"] } }]);
      }
      if (String(url).startsWith("/api/analytics/registry?")) {
        return { ok: true, json: async () => ({ total: 7, rows: [] }) };
      }
      return { ok: true, json: async () => [] };
    });
    render(<SliceList testId="t1" axis="unit" />);

    await openRowMenu("Логистика");
    await userEvent.click(screen.getByRole("menuitem", { name: "Выгрузить прохождения" }));

    await waitFor(() => {
      const asked = callsTo("/api/analytics/registry?").at(-1) ?? "";
      expect(new URLSearchParams(asked.slice(asked.indexOf("?"))).getAll("unit")).toEqual(["Логистика"]);
    });
  });

  it("«Выгрузить прохождения» открывает окно экспорта с условиями среза и рамкой", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/analytics/slices?")) return answer([AXIS_ROW]);
      if (String(url).startsWith("/api/analytics/registry?")) {
        return { ok: true, json: async () => ({ total: 18, rows: [] }) };
      }
      return { ok: true, json: async () => [] };
    });
    render(<SliceList testId="t1" axis="group" from="2026-09-01" to="2026-09-30" />);

    await openRowMenu("Розница");
    await userEvent.click(screen.getByRole("menuitem", { name: "Выгрузить прохождения" }));

    expect(await screen.findByText("Экспорт прохождений")).toBeTruthy();
    await waitFor(() => {
      const asked = callsTo("/api/analytics/registry?").at(-1) ?? "";
      const query = new URLSearchParams(asked.slice(asked.indexOf("?")));
      expect(query.get("testId")).toBe("t1");
      expect(query.get("groupId")).toBe("g1");
      expect(query.get("from")).toBe("2026-09-01");
      expect(query.get("to")).toBe("2026-09-30");
    });
  });

  it("срез по потоку выгружается в пересечении своего периода и рамки", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/analytics/slices?")) {
        return answer([{
          ...AXIS_ROW, id: "period:2026-09", name: "Сентябрь 2026",
          conditions: { from: "2026-09-01", to: "2026-09-30" },
        }]);
      }
      if (String(url).startsWith("/api/analytics/registry?")) {
        return { ok: true, json: async () => ({ total: 5, rows: [] }) };
      }
      return { ok: true, json: async () => [] };
    });
    render(<SliceList testId="t1" axis="period" from="2026-09-10" />);

    await openRowMenu("Сентябрь 2026");
    await userEvent.click(screen.getByRole("menuitem", { name: "Выгрузить прохождения" }));

    await waitFor(() => {
      const asked = callsTo("/api/analytics/registry?").at(-1) ?? "";
      const query = new URLSearchParams(asked.slice(asked.indexOf("?")));
      expect(query.get("from")).toBe("2026-09-10");
      expect(query.get("to")).toBe("2026-09-30");
    });
  });
});

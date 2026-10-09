/**
 * @module features/analytics/slices/__tests__/slice-compare
 * @description PRD-56 FR-07, FR-07a, FR-07g: режим сравнения срезов.
 *
 * Сравнение — отдельный режим с ЯВНО названными срезами: их имена стоят в заголовках столбцов,
 * и читателю не приходится держать в голове, что с чем сравнивается. Отсюда два правила,
 * которые здесь и проверяются: «Разница» появляется только при двух срезах и только у ДОЛЕЙ,
 * а сравнивать можно не больше четырёх.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SliceCompare } from "../slice-compare";

const SLICES = [
  {
    id: "whole", name: "Тест целиком", conditions: {},
    started: 40, completed: 36, passed: 27, participants: 36,
    passRate: 75, avgPercent: 71, enoughData: true,
  },
  {
    id: "s1", name: "Розница", conditions: { groupIds: ["g1"] },
    started: 20, completed: 18, passed: 15, participants: 18,
    passRate: 83, avgPercent: 78, enoughData: true,
    topics: [
      { topicId: "t1", topicName: "Финансы", correctShare: 81, inSample: 18 },
      { topicId: "t2", topicName: "Право", correctShare: 55, inSample: 18 },
    ],
  },
  {
    id: "s2", name: "Отдел продаж", conditions: { groupIds: ["g2"] },
    started: 22, completed: 20, passed: 12, participants: 20,
    passRate: 60, avgPercent: 64, enoughData: true,
    topics: [
      { topicId: "t1", topicName: "Финансы", correctShare: 64, inSample: 20 },
      // Темы «Право» у этого среза нет: вопросы не выпали. Ячейка обязана сказать прочерк.
      { topicId: "t3", topicName: "Логистика", correctShare: 70, inSample: 20 },
    ],
  },
  {
    id: "s3", name: "Логистика", conditions: { groupIds: ["g3"] },
    started: 14, completed: 12, passed: 8, participants: 12,
    passRate: 67, avgPercent: 69, enoughData: true,
  },
  {
    id: "s4", name: "Подрядчики", conditions: { groupIds: ["g4"] },
    started: 16, completed: 15, passed: 9, participants: 15,
    passRate: 60, avgPercent: 62, enoughData: true,
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ slices: SLICES, minObservations: 10 }),
  }));
});

afterEach(() => vi.unstubAllGlobals());

/**
 * Выбрать срез в очередном слоте сравнения.
 *
 * Слоты устроены как в эскизе (состояние `compare`): в каждом свой список сохранённых срезов,
 * а новый слот добавляется плиткой «+ Добавить срез». Поэтому выбор — это «открыть список
 * последнего слота и взять в нём срез», а не нажатие кнопки с именем.
 */
async function pick(name: string) {
  // Доступное имя кнопке списка даёт ПОДПИСЬ поля, а не выбранное значение, поэтому пустой
  // слот отличается по тексту внутри неё.
  const triggers = await screen.findAllByRole("button", { name: /Сохранённый срез/ });
  const empty = triggers.filter(trigger => trigger.textContent?.includes("— не выбран —"));
  await userEvent.click(empty[empty.length - 1] ?? triggers[triggers.length - 1]);
  await userEvent.click(await screen.findByRole("option", { name }));
}

/** Добавить пустой слот — для срезов со второго и далее. */
async function addSlot() {
  await userEvent.click(screen.getByRole("button", { name: "+ Добавить срез" }));
}

describe("SliceCompare", () => {
  // FR-07: доли верных ПО ТЕМАМ — ради них сравнение и затевают. Тема, которой у одного из
  // срезов не было, не прячется: прочерк говорит «этих вопросов здесь не выпало».
  it("сопоставляет доли верных по темам и считает разницу только там, где есть обе", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Розница");
    await addSlot();
    await pick("Отдел продаж");

    // Доли по темам вынесены отдельной таблицей: единица счёта у них другая — доля ОТВЕТОВ,
    // а не прохождений (эскиз, состояние compare).
    expect(screen.getByText("Доля верных ответов")).toBeTruthy();

    const financeRow = screen.getByText("Финансы").closest("tr")!;
    expect(within(financeRow).getByText("81 %")).toBeTruthy();
    expect(within(financeRow).getByText("64 %")).toBeTruthy();
    expect(within(financeRow).getByText("+17 п.п.")).toBeTruthy();

    // «Право» есть только у одного среза: разницы нет, и выдумывать её не из чего.
    const lawRow = screen.getByText("Право").closest("tr")!;
    expect(within(lawRow).getByText("55 %")).toBeTruthy();
    expect(within(lawRow).getAllByText("—").length).toBe(2);
  });

  // FR-07f: имя срезу даёт автор, и оно может обещать не то, что срез считает, — поэтому
  // условия видны и в слоте, и подписью под именем столбца.
  it("показывает условия выбранного среза", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Тест целиком");

    expect(await screen.findByText("Условия отбора · 0")).toBeTruthy();
    expect(screen.getAllByText("без условий — тест целиком").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Убрать" })).toBeTruthy();
  });

  it("называет сравниваемые срезы в заголовках столбцов", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Розница");
    await addSlot();
    await pick("Отдел продаж");

    const table = screen.getAllByRole("table")[0];
    expect(within(table).getByText("Розница")).toBeTruthy();
    expect(within(table).getByText("Отдел продаж")).toBeTruthy();
  });

  it("показывает «Разницу» при двух срезах и только у долей", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Розница");
    await addSlot();
    await pick("Отдел продаж");

    const table = screen.getAllByRole("table")[0];
    expect(within(table).getByText("Разница")).toBeTruthy();
    // Доли: 83 − 60 = 23 п.п., 78 − 64 = 14 п.п.
    expect(within(table).getByText("+23 п.п.")).toBeTruthy();
    expect(within(table).getByText("+14 п.п.")).toBeTruthy();
    // Объёмы не вычитаются: разница чисел говорит о размере группы, а не о качестве.
    expect(within(table).queryByText("−2")).toBeNull();
  });

  it("убирает «Разницу», когда срезов становится три", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Розница");
    await addSlot();
    await pick("Отдел продаж");
    await addSlot();
    await pick("Логистика");

    expect(within(screen.getAllByRole("table")[0]).queryByText("Разница")).toBeNull();
  });

  it("не даёт сравнивать больше четырёх срезов и говорит почему", async () => {
    render(<SliceCompare testId="test1" />);

    for (const name of ["Розница", "Отдел продаж", "Логистика", "Подрядчики"]) {
      await pick(name);
      await addSlot();
    }

    // FR-07g: плитка ВЫКЛЮЧАЕТСЯ, а не исчезает — исчезнувшая читается как «больше срезов
    // нет», а выключенная с подписью объясняет, почему пятого не будет.
    expect(screen.getByRole("button", { name: "+ Добавить срез" })).toBeDisabled();
    expect(screen.getByText(/Сравнивают не больше четырёх/i)).toBeTruthy();
  });

  it("сравнивает с тестом целиком тем же механизмом (FR-07a)", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Тест целиком");
    await addSlot();
    await pick("Розница");

    const table = screen.getAllByRole("table")[0];
    expect(within(table).getByText("Тест целиком")).toBeTruthy();
  });

  it("ничего не сравнивает, пока срезы не выбраны", async () => {
    render(<SliceCompare testId="test1" />);

    await waitFor(() => expect(screen.getByText(/Выберите срезы/i)).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("не считает разницу там, где у среза мало данных", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        slices: [
          SLICES[1],
          { ...SLICES[2], passRate: null, avgPercent: null, enoughData: false, completed: 4 },
        ],
        minObservations: 10,
      }),
    }));

    render(<SliceCompare testId="test1" />);

    await pick("Розница");
    await addSlot();
    await pick("Отдел продаж");

    expect(screen.getAllByText(/мало данных/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/п\.п\./)).toBeNull();
  });
  // FR-07b: набранный отбор сравнивается НАРАВНЕ с сохранёнными срезами. Сохранение нужно,
  // когда срезом будут пользоваться и завтра, а вопрос «чем эти хуже тех» живёт одну минуту.
  it("сравнивает набранный отбор, не требуя сохранять его срезом", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        slices: [
          { ...SLICES[0], id: "adhoc", name: "Текущий отбор", conditions: { outcomes: ["failed"] } },
          ...SLICES,
        ],
        minObservations: 10,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SliceCompare testId="test1" adhoc={{ outcomes: ["failed"] }} />);

    // Условия уходят на сервер: срез считается тем же кодом, что сохранённый (FR-25).
    await waitFor(() => expect(
      fetchMock.mock.calls.some(call => String(call[0]).includes("conditions=")),
    ).toBe(true));
    // Слот занят сразу: пришли сюда именно за этим сравнением, и выбирать нечего.
    // Имя встречается дважды — в слоте и в заголовке столбца, — что само по себе и есть
    // ответ: отбор попал и в выбор, и в таблицу.
    expect((await screen.findAllByText("Текущий отбор")).length).toBeGreaterThan(1);
  });

  // Срез, отправленный в сравнение из строки списка, приходит со своим именем: колонка
  // «Текущий отбор» заставила бы гадать, какую строку сюда принесли.
  it("передаёт имя временного среза, чтобы колонка звалась по нему", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ slices: SLICES, minObservations: 10 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SliceCompare testId="test1" adhoc={{ groupIds: ["g1"] }} adhocName="Розница" />);

    await waitFor(() => expect(
      fetchMock.mock.calls.some(call => String(call[0]).includes("conditionsName=%D0%A0%D0%BE%D0%B7%D0%BD%D0%B8%D1%86%D0%B0")),
    ).toBe(true));
  });

  // Окно правки условий тест не показывает, и срез без теста перестал бы быть выборкой
  // одного теста: тест обязан пережить правку, как и вариант с версией.
  it("правка условий в слоте сохраняет тест среза", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        slices: [
          SLICES[0],
          { ...SLICES[1], conditions: { testIds: ["test1"], groupIds: ["g1"] } },
        ],
        minObservations: 10,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SliceCompare testId="test1" />);
    await pick("Розница");
    await userEvent.click(screen.getByRole("button", { name: "Изменить условия" }));
    await userEvent.click(await screen.findByRole("button", { name: "Применить" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(String((put![1] as RequestInit).body));
      expect(body.conditions).toMatchObject({ testIds: ["test1"], groupIds: ["g1"] });
    });
  });

  it("правка условий в слоте не теряет оргусловия (FR-06b)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        slices: [
          SLICES[0],
          { ...SLICES[1], conditions: { testIds: ["test1"], positions: ["Кладовщик"] } },
        ],
        minObservations: 10,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SliceCompare testId="test1" />);
    await pick("Розница");
    await userEvent.click(screen.getByRole("button", { name: "Изменить условия" }));
    await userEvent.click(await screen.findByRole("button", { name: "Применить" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === "PUT");
      expect(put).toBeTruthy();
      expect(JSON.parse(String((put![1] as RequestInit).body)).conditions)
        .toMatchObject({ positions: ["Кладовщик"] });
    });
  });

  // Править условия можно у СОХРАНЁННОГО среза: «тест целиком» условий не имеет, а набранный
  // отбор правится там, где набран, — в фильтре реестра.
  it("предлагает правку условий только сохранённому срезу", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Тест целиком");
    expect(screen.queryByRole("button", { name: "Изменить условия" })).toBeNull();

    await addSlot();
    await pick("Розница");
    expect(screen.getByRole("button", { name: "Изменить условия" })).toBeTruthy();
  });
});

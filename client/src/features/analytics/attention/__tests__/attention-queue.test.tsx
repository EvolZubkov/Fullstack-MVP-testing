/**
 * @module features/analytics/attention/__tests__/attention-queue
 * @description PRD-56 FR-10, FR-11: экран очереди «требует внимания».
 *
 * Экран говорит «сделай», и дела разложены по корзинам: у каждой свой вопрос и своё действие.
 * Смешать их в один список значит заставить читателя сортировать глазами — а он пришёл сюда
 * работать, а не разбирать.
 *
 * Проверяется состав корзин, подпись позиции (по ней решают, что делать), ход к прохождению и
 * то, что пустая очередь читается как «дел нет», а не как «ничего не загрузилось».
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionQueue } from "../attention-queue";

const ITEMS = [
  {
    kind: "overdue", participantId: "u2", participant: "Сафин Ильдар",
    testId: "test1", testTitle: "Сертификация", dueAt: "2026-09-01T00:00:00.000Z",
    threshold: 70,
  },
  {
    kind: "failed", participantId: "u1", participant: "Морозова Анна",
    testId: "test1", testTitle: "Сертификация", observationId: "web-1", source: "web",
    startedAt: "2026-09-08T10:00:00.000Z",
    percent: 58, threshold: 70, attemptNumber: 1, attemptLimit: 3,
  },
  {
    kind: "abandoned", participantId: "u3", participant: "Кузнецов Павел",
    testId: "test1", testTitle: "Сертификация", observationId: "web-2", source: "web",
    startedAt: "2026-09-10T09:00:00.000Z",
    percent: null, threshold: 70, attemptNumber: 2, attemptLimit: 3,
  },
  {
    kind: "exhausted", participantId: "u4", participant: "Зуева Полина",
    testId: "test1", testTitle: "Сертификация", observationId: "web-3", source: "web",
    startedAt: "2026-09-09T09:00:00.000Z",
    percent: 49, threshold: 70, attemptNumber: 3, attemptLimit: 3,
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

function answer(items: unknown[], counts?: Record<string, number>) {
  return {
    ok: true,
    json: async () => ({
      items,
      counts: counts ?? { overdue: 1, failed: 1, abandoned: 1, exhausted: 1 },
    }),
  };
}

/** Корзина по её заголовку: карточка, внутри которой лежат позиции этого вида. */
function bucket(title: string): HTMLElement {
  return screen.getByText(title).closest(".ou-card") as HTMLElement;
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(answer(ITEMS));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("AttentionQueue", () => {
  it("раскладывает дела по четырём корзинам", async () => {
    render(<AttentionQueue />);

    expect(await screen.findByText("Не начали к сроку")).toBeTruthy();
    expect(within(bucket("Не начали к сроку")).getByText(/Сафин Ильдар/)).toBeTruthy();
    expect(within(bucket("Не сдали")).getByText(/Морозова Анна/)).toBeTruthy();
    expect(within(bucket("Брошенные попытки")).getByText(/Кузнецов Павел/)).toBeTruthy();
    expect(within(bucket("Исчерпан лимит попыток")).getByText(/Зуева Полина/)).toBeTruthy();
  });

  it("подписывает позицию тем, по чему решают, что делать", async () => {
    render(<AttentionQueue />);

    // «Не сдал» с 58 при пороге 70 и «не сдал» с 20 — разные дела: первому хватит пересдачи,
    // второго надо учить заново. И «попытка 1 из 3» отличается от «3 из 3».
    expect(await screen.findByText(/58 % при пороге 70 %/)).toBeTruthy();
    expect(screen.getByText(/попытка 1 из 3/)).toBeTruthy();
  });

  it("у просроченного назначения показывает срок и просрочку, а не результат", async () => {
    render(<AttentionQueue />);
    await screen.findByText("Не начали к сроку");

    // Прохождения не было: результата нет и быть не может, а вот насколько просрочено —
    // единственное, что здесь можно сказать.
    const overdue = within(bucket("Не начали к сроку"));
    expect(overdue.getByText(/Срок 01\.09\.2026/)).toBeTruthy();
    expect(overdue.queryByText(/при пороге/)).toBeNull();
  });

  it("не показывает корзину, в которой дел нет", async () => {
    fetchMock.mockResolvedValue(answer(
      [ITEMS[1]],
      { overdue: 0, failed: 1, abandoned: 0, exhausted: 0 },
    ));

    render(<AttentionQueue />);

    await screen.findByText("Не сдали");
    // Пустая корзина с нулём — это тревога о том, чего нет: читатель ищет в ней смысл,
    // а смысла нет.
    expect(screen.queryByText("Брошенные попытки")).toBeNull();
  });

  it("ведёт из позиции к прохождению участника", async () => {
    const onOpenPassage = vi.fn();
    render(<AttentionQueue onOpenPassage={onOpenPassage} />);
    await screen.findByText("Не сдали");

    await userEvent.click(
      within(bucket("Не сдали")).getByRole("button", { name: /Разбор прохождения/ }),
    );

    expect(onOpenPassage).toHaveBeenCalledWith(
      expect.objectContaining({ observationId: "web-1", participant: "Морозова Анна" }),
    );
  });

  it("значок «Аналитика теста» ведёт на уровень теста позиции (Э2)", async () => {
    const onOpenTestAnalytics = vi.fn();
    render(<AttentionQueue onOpenTestAnalytics={onOpenTestAnalytics} />);
    await screen.findByText("Не сдали");

    await userEvent.click(within(bucket("Не сдали")).getAllByRole("button", { name: "Аналитика теста" })[0]);

    expect(onOpenTestAnalytics).toHaveBeenCalledWith("test1");
  });

  it("не предлагает открыть прохождение там, где его нет", async () => {
    // У просроченного назначения прохождения не существует: к тесту не приступали.
    render(<AttentionQueue onOpenPassage={() => {}} />);

    await screen.findByText(/Сафин Ильдар/);
    expect(within(bucket("Не начали к сроку")).queryByRole("button", { name: /Разбор прохождения/ }))
      .toBeNull();
  });

  it("ведёт в реестр за остальными делами корзины", async () => {
    const onOpenRegistry = vi.fn();
    fetchMock.mockResolvedValue(answer(
      [ITEMS[1], { ...ITEMS[1], participant: "Белкина Ольга", observationId: "web-9" }],
      { overdue: 0, failed: 12, abandoned: 0, exhausted: 0 },
    ));

    render(<AttentionQueue onOpenRegistry={onOpenRegistry} />);

    await userEvent.click(await screen.findByRole("button", { name: /Показать все 12/ }));

    expect(onOpenRegistry).toHaveBeenCalledWith(expect.objectContaining({ outcomes: ["failed"] }));
  });

  it("показывает первые дела корзины, а не весь список сразу", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      ...ITEMS[1], participant: `Участник ${i}`, observationId: `web-${i}`,
    }));
    fetchMock.mockResolvedValue(answer(many, { overdue: 0, failed: 7, abandoned: 0, exhausted: 0 }));

    render(<AttentionQueue />);

    await screen.findByText(/Участник 0/);
    expect(screen.queryByText(/Участник 5/)).toBeNull();
  });

  it("пустая очередь читается как «дел нет»", async () => {
    fetchMock.mockResolvedValue(answer([], { overdue: 0, failed: 0, abandoned: 0, exhausted: 0 }));

    render(<AttentionQueue />);

    expect(await screen.findByText(/Дел нет/i)).toBeTruthy();
  });

  it("сообщает об ошибке, а не выдаёт её за отсутствие дел", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    render(<AttentionQueue />);

    expect(await screen.findByText(/Не удалось загрузить дела/i)).toBeTruthy();
  });
});

/**
 * PRD-56 (эскиз prd56-analytics-section, «Требует внимания»): подпись корзины называет, ЧТО в
 * ней лежит. «82 дела» вместо «9 назначений» и «6 попыток» теряло предметность: по числу не
 * понять, людей это, попытки или назначения.
 */
describe("AttentionQueue — подписи корзин", () => {
  it("каждая корзина считает в своих единицах", async () => {
    fetchMock.mockResolvedValue(answer(ITEMS, { overdue: 9, failed: 14, abandoned: 6, exhausted: 2 }));
    render(<AttentionQueue />);

    expect(await screen.findByText("9 назначений · срок истёк, попытка не начиналась")).toBeTruthy();
    expect(screen.getByText("14 прохождений · попытки ещё остались")).toBeTruthy();
    expect(screen.getByText("6 попыток · начаты и не завершены больше двух суток назад")).toBeTruthy();
    expect(screen.getByText("2 участника · лимит исчерпан, тест не сдан")).toBeTruthy();
  });

  it("данные, переданные страницей, не запрашиваются второй раз", async () => {
    // Страница уже загрузила очередь ради счётчика на вкладке — второй запрос был бы лишним.
    render(<AttentionQueue data={{ items: ITEMS as never, counts: { overdue: 1, failed: 1, abandoned: 1, exhausted: 1 } }} />);

    expect(await screen.findByText("Не сдали")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/** Период вкладки (решение владельца 2026-09-25, эскиз prd56-analytics-section). */
describe("AttentionQueue — период", () => {
  const DATA = { items: ITEMS as never, counts: { overdue: 9, failed: 14, abandoned: 6, exhausted: 2 } };

  it("переключатель «За неделю / За месяц / За квартал», выбран текущий", async () => {
    render(<AttentionQueue data={DATA} period="month" onPeriodChange={() => {}} />);

    for (const label of ["За неделю", "За месяц", "За квартал"]) {
      expect(await screen.findByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "За месяц" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("смена периода уходит странице", async () => {
    const onPeriodChange = vi.fn();
    render(<AttentionQueue data={DATA} period="month" onPeriodChange={onPeriodChange} />);

    await userEvent.click(await screen.findByRole("button", { name: "За неделю" }));
    expect(onPeriodChange).toHaveBeenCalledWith("week");
  });

  it("подпись карточки называет период", async () => {
    render(<AttentionQueue data={DATA} period="quarter" onPeriodChange={() => {}} />);
    expect(await screen.findByText("14 прохождений за квартал · попытки ещё остались")).toBeTruthy();
  });

  it("переход в реестр несёт начало периода: число в реестре совпадёт с карточкой", async () => {
    const onOpenRegistry = vi.fn();
    const many = { ...DATA, items: Array.from({ length: 5 }, (_u, i) => ({ ...ITEMS[1], observationId: `f${i}`, participantId: `p${i}` })) as never };
    render(<AttentionQueue data={many} period="week" onPeriodChange={() => {}} onOpenRegistry={onOpenRegistry} />);

    await userEvent.click(await screen.findByRole("button", { name: /Показать все 14/ }));
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(onOpenRegistry).toHaveBeenCalledWith(expect.objectContaining({ outcomes: ["failed"], from: since }));
  });

  it("переключатель виден и при пустой вкладке — чтобы расширить период", async () => {
    render(<AttentionQueue data={{ items: [], counts: { overdue: 0, failed: 0, abandoned: 0, exhausted: 0 } }} period="week" onPeriodChange={() => {}} />);
    expect(await screen.findByRole("button", { name: "За квартал" })).toBeTruthy();
  });

  it("в тексте нет слова «очередь»: в интерфейсе его нет", async () => {
    render(<AttentionQueue data={DATA} period="month" onPeriodChange={() => {}} />);
    expect(await screen.findByText("Назначения без срока сюда не попадают.")).toBeTruthy();
    expect(screen.queryByText(/очеред/i)).toBeNull();
  });
});

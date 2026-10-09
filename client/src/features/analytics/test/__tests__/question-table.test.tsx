/**
 * @module features/analytics/test/__tests__/question-table
 * @description PRD-56 FR-15, FR-16, FR-17, FR-22: таблица заданий теста.
 *
 * Таблица отвечает на вопрос «что чинить»: доля верных, пропуски, экспозиция, время и
 * авторская трудность в одной строке. Тип задания — пиктограммой, как в дереве контента и в
 * таблице «Оценка» редактора: словом он занимал бы колонку, ничего к ней не добавляя.
 *
 * Вид «требуют ревизии» — отбор по СОШЕДШИМСЯ признакам, и каждый назван словами: вид без
 * объяснения читается как приговор заданию.
 *
 * У измерительного задания доли верных нет вовсе (FR-22): эталона у него не существует, и
 * ноль в этой колонке был бы про него ложью.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuestionTable } from "../question-table";
import { termOrText } from "./term-text";

/**
 * Открыть меню действий строки.
 *
 * Действия уехали под троеточие (эскиз prd66-item-quality, состояние wf-items): двумя
 * кнопками они занимали четверть ширины таблицы и выталкивали правую за горизонтальную
 * прокрутку. Сами пункты остались прежними и с прежними доступными именами.
 */
async function openRowMenu(prompt: string | RegExp): Promise<void> {
  await userEvent.click(screen.getByRole("button", {
    name: typeof prompt === "string" ? `Действия с вопросом: ${prompt}` : prompt,
  }));
}

const QUESTIONS = [
  {
    questionId: "q1", questionPrompt: "Какая мера относится к антикоррупционным?",
    questionType: "single", topicName: "Право и комплаенс", difficulty: 60,
    totalAnswers: 60, gradedAnswers: 60, correctAnswers: 25, correctPercent: 41,
    skipShare: 3, exposurePercent: 82, latencyMedianMs: 48_000, latencySampleSize: 60,
    reviewFlags: [],
  },
  {
    questionId: "q2", questionPrompt: "Быстрый и мимо",
    questionType: "multiple", topicName: "Охрана труда", difficulty: 40,
    totalAnswers: 50, gradedAnswers: 50, correctAnswers: 10, correctPercent: 20,
    skipShare: 1, exposurePercent: 90, latencyMedianMs: 3_000, latencySampleSize: 50,
    reviewFlags: [
      { kind: "fast-and-wrong", reason: "Отвечают за 3 с и мимо (20 % верных): условие, похоже, не читают" },
    ],
  },
  {
    questionId: "q3", questionPrompt: "Насколько вы согласны?",
    questionType: "scale", topicName: "Опросник", difficulty: 50,
    totalAnswers: 30, gradedAnswers: 0, correctAnswers: 0, correctPercent: null,
    skipShare: null, exposurePercent: 40, latencyMedianMs: null, latencySampleSize: 0,
    reviewFlags: [],
  },
];

describe("QuestionTable", () => {
  it("показывает задание с типом-пиктограммой и его темой", () => {
    render(<QuestionTable questions={QUESTIONS} />);

    expect(screen.getByText(termOrText("Какая мера относится к антикоррупционным?"))).toBeTruthy();
    expect(screen.getByText(termOrText("Право и комплаенс"))).toBeTruthy();
    // Тип назван пиктограммой: у неё есть доступное имя, но своей колонки нет.
    expect(screen.getByLabelText("Один ответ")).toBeTruthy();
  });

  it("пишет «не применимо» там, где доли верных не существует", () => {
    render(<QuestionTable questions={QUESTIONS} />);

    const row = screen.getByText(termOrText("Насколько вы согласны?")).closest("tr")!;
    // FR-22: у измерительного задания нет эталона — ноль здесь был бы ложью. Э4а: прочерк
    // заменён словами, причина — в подсказке.
    expect(within(row).getAllByText(termOrText("не применимо")).length).toBeGreaterThanOrEqual(1);
    expect(within(row).queryByText(termOrText("—"))).toBeNull();
  });

  it("отбирает задания с признаками ревизии и считает их", async () => {
    render(<QuestionTable questions={QUESTIONS} />);

    await userEvent.click(screen.getByRole("button", { name: /Требуют ревизии/ }));

    expect(screen.getByText(termOrText("Быстрый и мимо"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Какая мера относится к антикоррупционным?"))).toBeNull();
  });

  it("называет признак словами, а не помечает значком", async () => {
    render(<QuestionTable questions={QUESTIONS} />);

    await userEvent.click(screen.getByRole("button", { name: /Требуют ревизии/ }));

    expect(screen.getByText(termOrText(/условие, похоже, не читают/))).toBeTruthy();
  });

  it("говорит, что ревизия никому не нужна, когда признаков нет", async () => {
    render(<QuestionTable questions={[QUESTIONS[0]]} />);

    await userEvent.click(screen.getByRole("button", { name: /Требуют ревизии/ }));

    expect(screen.getByText(termOrText(/Признаки проблем не сошлись/i))).toBeTruthy();
  });

  it("ведёт из строки к прохождениям, где на задании ошиблись", async () => {
    const onOpenRegistry = vi.fn();
    render(<QuestionTable questions={QUESTIONS} onOpenRegistry={onOpenRegistry} />);

    await openRowMenu(/Действия с вопросом: Какая мера/);
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Прохождения с ошибкой: Какая мера/ }),
    );

    // FR-17: переход ведёт к тем, кто ошибся, — это и есть следующий шаг разбора задания.
    expect(onOpenRegistry).toHaveBeenCalledWith("q1");
  });

  it("сортирует по столбцу", async () => {
    render(<QuestionTable questions={QUESTIONS} psychometrics={{
      q1: { difficulty: 0.41, itemRest: 0.34, observations: 60, coefficientConfidence: "reliable" },
      q2: { difficulty: 0.2, itemRest: 0.1, observations: 50, coefficientConfidence: "tentative" },
    }} />);

    // Заголовок сортируемой колонки в ДС — не кнопка, а кликабельная ячейка: доступность
    // заголовков это отдельный долг ДС, записанный в план Э4. По умолчанию таблица уже
    // отсортирована по трудности, поэтому проверяется ОБРАТНЫЙ порядок после клика.
    await userEvent.click(screen.getByText(termOrText("Трудность")));

    const rows = screen.getAllByRole("row").slice(1);
    // Убывание: задание без трудности всегда первое (его «нет значения» уезжает в конец
    // при возрастании и в начало при убывании), затем 0,41, затем 0,20.
    expect(within(rows[0]).getByText(termOrText("Насколько вы согласны?"))).toBeTruthy();
    expect(within(rows[2]).getByText(termOrText("Быстрый и мимо"))).toBeTruthy();
  });
});

/**
 * PRD-66 FR-02, FR-03: колонка «Доля верных» заменена трудностью, рядом встала
 * дискриминативность.
 *
 * Почему замена, а не соседство: доля верных схлопывает верность к «ровно максимум» и у
 * задания с частичным кредитом просто неверна. Две похожие колонки с расходящимися числами
 * на одном экране читаются как поломка (ОВ-01, решение владельца 2026-09-24).
 *
 * Числа приходят из ТОГО ЖЕ расчёта, что питает вкладку «Качество вопросов»: считать трудность
 * второй раз здесь значило бы завести второй источник правды о ней.
 */
/**
 * Задачи 4.1 и 4.2 плана сверки: вкладка «Вопросы» говорит «вопрос», как эскиз
 * prd56-test-analytics; «задание» — термин психометрики и остаётся на «Качестве вопросов».
 */
describe("QuestionTable — термины вкладки «Вопросы»", () => {
  it("колонки «Вопрос» и «Экспозиция»", () => {
    render(<QuestionTable questions={QUESTIONS} />);

    expect(screen.getByText(termOrText("Вопрос"))).toBeTruthy();
    expect(screen.getByText(termOrText("Экспозиция"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Задание"))).toBeNull();
    expect(screen.queryByText(termOrText("Выдаётся"))).toBeNull();
  });

  it("колонки «Цена» и «Другие тесты» — как «Вес» и «Количество тестов» в отчёте WebTutor", () => {
    const rows = [
      { ...QUESTIONS[0], points: 1.5, otherTestsCount: 2 },
      { ...QUESTIONS[2], points: null, otherTestsCount: 0 },
    ];
    render(<QuestionTable questions={rows} />);

    expect(screen.getByText(termOrText("Цена"))).toBeTruthy();
    expect(screen.getByText(termOrText("Другие тесты"))).toBeTruthy();
    const graded = screen.getByText(termOrText("Какая мера относится к антикоррупционным?")).closest("tr")!;
    expect(within(graded).getByText("1,5")).toBeTruthy();
    expect(within(graded).getByText("2")).toBeTruthy();
    // У измерительного задания цены нет: баллов оно не приносит. Э4а: словами, не прочерком.
    const measurement = screen.getByText(termOrText("Насколько вы согласны?")).closest("tr")!;
    const cells = within(measurement).getAllByRole("cell");
    expect(cells[cells.length - 2].textContent).toContain("не применимо");
  });

  it("опросник колонок выдачи и цены не держит", () => {
    render(<QuestionTable questions={[QUESTIONS[2]]} measurement />);
    expect(screen.queryByText(termOrText("Цена"))).toBeNull();
    expect(screen.queryByText(termOrText("Другие тесты"))).toBeNull();
  });

  it("подзаголовок считает вопросы и прохождения", () => {
    render(<QuestionTable questions={QUESTIONS} passages={486} />);

    expect(screen.getByText(new RegExp(`^${QUESTIONS.length} вопрос`))).toBeTruthy();
    expect(screen.getByText(termOrText(/· 486 прохождений/))).toBeTruthy();
  });
});

describe("QuestionTable — психометрика в строке (PRD-66)", () => {
  const PSYCHO = {
    q1: { difficulty: 0.41, itemRest: 0.34, observations: 60, coefficientConfidence: "reliable" as const },
    q2: { difficulty: 0.79, itemRest: -0.21, observations: 50, coefficientConfidence: "tentative" as const },
  };

  it("вместо доли верных показывает трудность по доле балла", () => {
    render(<QuestionTable questions={QUESTIONS} psychometrics={PSYCHO} />);

    expect(screen.queryByText(termOrText("Доля верных"))).toBeNull();
    const row = screen.getByText(termOrText("Какая мера относится к антикоррупционным?")).closest("tr")!;
    expect(within(row).getByText(termOrText("0,41"))).toBeTruthy();
  });

  it("у задания с частичным кредитом трудность ВЫШЕ доли верных", () => {
    // Ровно тот случай, ради которого колонка заменена: доля верных у этого задания 20 %,
    // потому что полный балл берут немногие, а набирают его частями почти все.
    render(<QuestionTable questions={QUESTIONS} psychometrics={PSYCHO} />);

    const row = screen.getByText(termOrText("Быстрый и мимо")).closest("tr")!;
    expect(within(row).getByText(termOrText("0,79"))).toBeTruthy();
    expect(within(row).queryByText(termOrText("20 %"))).toBeNull();
  });

  it("авторская трудность — «Сложность: задана → по ответам» (Э4а), колонка «Трудность» одна", () => {
    render(<QuestionTable questions={QUESTIONS} psychometrics={PSYCHO} />);

    expect(screen.getByText(termOrText("Сложность: задана → по ответам"))).toBeTruthy();
    expect(screen.getAllByText(termOrText("Трудность"))).toHaveLength(1);
  });

  it("дискриминативность ведёт в разбор задания", async () => {
    const onOpenQuality = vi.fn();
    render(<QuestionTable questions={QUESTIONS} psychometrics={PSYCHO} onOpenQuality={onOpenQuality} />);

    // FR-03: без перехода новая вкладка осталась бы складом, куда никто не заходит.
    await userEvent.click(screen.getByRole("button", { name: /Разбор вопроса: Какая мера/ }));

    // Э3.3: вместе с вопросом уходит порядок таблицы — для «Предыдущий / Следующий».
    expect(onOpenQuality).toHaveBeenCalledWith("q1", expect.arrayContaining(["q1"]));
  });

  it("щелчок по строке открывает вопрос — с порядком таблицы, как она отсортирована (Э3.3)", async () => {
    const onOpenQuality = vi.fn();
    render(<QuestionTable questions={QUESTIONS} psychometrics={PSYCHO} onOpenQuality={onOpenQuality} />);

    const shown = [...document.querySelectorAll("tbody tr")];
    await userEvent.click(within(shown[0] as HTMLElement).getAllByRole("cell")[0]);

    expect(onOpenQuality).toHaveBeenCalledTimes(1);
    const [, order] = onOpenQuality.mock.calls[0];
    expect(order).toHaveLength(QUESTIONS.length);
    expect(order[0]).toBe(onOpenQuality.mock.calls[0][0]);
  });

  it("ниже порога коэффициента дискриминативности нет, а трудность есть", () => {
    // FR-38a: у двух величин РАЗНЫЕ пороги, и это не сбой — коэффициент на выборке меньше
    // тридцати меняется от одного нового участника, среднее — нет.
    render(<QuestionTable questions={QUESTIONS} psychometrics={{
      q1: { difficulty: 0.33, itemRest: null, observations: 12, coefficientConfidence: "insufficient" },
    }} />);

    const row = screen.getByText(termOrText("Какая мера относится к антикоррупционным?")).closest("tr")!;
    expect(within(row).getByText(termOrText("0,33"))).toBeTruthy();
    // Э4а: «мало данных» говорит, сколько не хватает до порога коэффициента (30).
    expect(within(row).getByText(termOrText("ещё 18"))).toBeTruthy();
  });

  it("разовое пояснение о смене числа закрывается навсегда", async () => {
    render(<QuestionTable questions={QUESTIONS} psychometrics={PSYCHO} />);

    expect(screen.getByText(termOrText(/заменена трудностью/i))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Больше не показывать" }));

    expect(screen.queryByText(termOrText(/заменена трудностью/i))).toBeNull();
  });

  it("без психометрики колонки на месте, но числа не выдуманы", () => {
    // Расчёт идёт отдельным запросом и приходит позже разметки: нули в этот момент были бы
    // ложью о задании, которую автор успеет прочитать.
    render(<QuestionTable questions={QUESTIONS} />);

    const row = screen.getByText(termOrText("Какая мера относится к антикоррупционным?")).closest("tr")!;
    // Э4а: пустое значение — «мало данных», прочерков в таблице больше нет.
    expect(within(row).getAllByText(termOrText("мало данных")).length).toBeGreaterThan(0);
    expect(within(row).queryByText(termOrText("—"))).toBeNull();
  });
});

describe("QuestionTable — исключение из выдачи", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ topicName: "Право и комплаенс", remaining: 11, drawCount: 10, allowed: true, publishedAt: "2026-09-01T10:00:00Z" }),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("метит исключённое задание перечёркнутым кругом с подсказкой", () => {
    render(<QuestionTable questions={[{ ...QUESTIONS[0], excludedFromDelivery: true }]} />);

    // FR-17a: тегом состояние не метится — тег стоит в одном ряду с темой и подтемой и
    // читается как ярлык СОДЕРЖАНИЯ, а речь о состоянии выдачи.
    expect(screen.getByLabelText(/Исключён из выдачи/i)).toBeTruthy();
  });

  it("отбирает исключённые отдельным видом со счётчиком", async () => {
    render(<QuestionTable questions={[QUESTIONS[0], { ...QUESTIONS[1], excludedFromDelivery: true }]} />);

    await userEvent.click(screen.getByRole("button", { name: /Исключённые/ }));

    expect(screen.getByText(termOrText("Быстрый и мимо"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Какая мера относится к антикоррупционным?"))).toBeNull();
  });

  it("спрашивает подтверждение и называет последствия числами", async () => {
    render(<QuestionTable questions={QUESTIONS} onDeliveryChange={vi.fn()} />);

    await openRowMenu(/Действия с вопросом: Какая мера/);
    await userEvent.click(screen.getByRole("menuitem", { name: /Исключить из выдачи: Какая мера/ }));

    // FR-17b, эскиз окна (план сверки 5.8): что станет с вопросом, что сохранится, сколько
    // останется при какой квоте и когда исключение подействует.
    expect(screen.getByText(termOrText(/Вопрос остаётся в теме и в банке/))).toBeTruthy();
    expect(screen.getByText(termOrText(/Право и комплаенс · 82 % показов при 41 % верных/))).toBeTruthy();
    expect(await screen.findByText(termOrText(/В теме останется 11 вопросов при квоте 10 на прохождение: выдача выполнима/))).toBeTruthy();
    expect(screen.getByText(termOrText(/ответы и статистика по вопросу сохраняются/))).toBeTruthy();
    expect(screen.getByText(termOrText("Подействует после новой публикации"))).toBeTruthy();
    expect(screen.getByText(termOrText(/Тест опубликован 01.09.2026/))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Исключить из выдачи" })).toBeTruthy();
  });

  it("у неопубликованного теста не обещает «после публикации»: исключение действует сразу", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ topicName: "Право и комплаенс", remaining: 11, drawCount: 10, allowed: true, publishedAt: null }),
    }));
    render(<QuestionTable questions={QUESTIONS} onDeliveryChange={vi.fn()} />);
    await openRowMenu(/Действия с вопросом: Какая мера/);
    await userEvent.click(screen.getByRole("menuitem", { name: /Исключить из выдачи: Какая мера/ }));

    await screen.findByText(termOrText(/В теме останется/));
    expect(screen.queryByText(termOrText("Подействует после новой публикации"))).toBeNull();
  });

  it("не исключает, пока подтверждение не дано", async () => {
    const onDeliveryChange = vi.fn();
    render(<QuestionTable questions={QUESTIONS} onDeliveryChange={onDeliveryChange} />);

    await openRowMenu(/Действия с вопросом: Какая мера/);
    await userEvent.click(screen.getByRole("menuitem", { name: /Исключить из выдачи: Какая мера/ }));
    await screen.findByText(termOrText(/останется 11/i));
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(onDeliveryChange).not.toHaveBeenCalled();
  });

  it("исключает задание после подтверждения", async () => {
    const onDeliveryChange = vi.fn();
    render(<QuestionTable questions={QUESTIONS} onDeliveryChange={onDeliveryChange} />);

    await openRowMenu(/Действия с вопросом: Какая мера/);
    await userEvent.click(screen.getByRole("menuitem", { name: /Исключить из выдачи: Какая мера/ }));
    await screen.findByText(termOrText(/останется 11/i));
    await userEvent.click(screen.getByRole("button", { name: "Исключить из выдачи" }));

    expect(onDeliveryChange).toHaveBeenCalledWith("q1", true);
  });

  it("называет квоту, из-за которой исключить нельзя", async () => {
    // Приёмка Э4: «выдачу собрать нельзя» без причины оставляет автора гадать, что чинить.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        topicName: "Право", remaining: 11, drawCount: 10, allowed: false,
        findings: [{
          topicId: "t1", topicName: "Право",
          issues: [{ kind: "quota_shortfall", tag: "Охрана труда", requested: 3, available: 2 }],
        }],
      }),
    }));
    render(<QuestionTable questions={QUESTIONS} onDeliveryChange={vi.fn()} />);

    await openRowMenu(/Действия с вопросом: Какая мера/);
    await userEvent.click(screen.getByRole("menuitem", { name: /Исключить из выдачи: Какая мера/ }));

    expect(await screen.findByText(termOrText(/Подтема «Охрана труда»: нужно 3, останется 2/))).toBeTruthy();
  });

  it("запрещает исключение, после которого выдачу собрать нельзя", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        topicName: "Право", remaining: 9, drawCount: 10, allowed: false,
        findings: [{ topicId: "t1", topicName: "Право", issues: [{ kind: "pool_shortfall", required: 10, available: 9 }] }],
      }),
    }));
    render(<QuestionTable questions={QUESTIONS} onDeliveryChange={vi.fn()} />);

    await openRowMenu(/Действия с вопросом: Какая мера/);
    await userEvent.click(screen.getByRole("menuitem", { name: /Исключить из выдачи: Какая мера/ }));

    // Не «выполнено с предупреждением»: кнопка выключена, и сказано почему.
    expect(await screen.findByText(termOrText(/выдачу собрать будет нельзя/i))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Исключить из выдачи" })).toBeDisabled();
  });

  it("возвращает задание в выдачу без подтверждения", async () => {
    // Возврат ничего не отнимает — спрашивать не о чем.
    const onDeliveryChange = vi.fn();
    render(
      <QuestionTable
        questions={[{ ...QUESTIONS[0], excludedFromDelivery: true }]}
        onDeliveryChange={onDeliveryChange}
      />,
    );

    await openRowMenu(/Действия с вопросом: Какая мера/);
    await userEvent.click(screen.getByRole("menuitem", { name: /Вернуть в выдачу: Какая мера/ }));

    expect(onDeliveryChange).toHaveBeenCalledWith("q1", false);
  });
});

/**
 * FR-22: у опросника эталона нет, поэтому доля верных заменяется РАЗБРОСОМ ответов, а
 * колонки, которые без эталона ничего не значат, из таблицы уходят.
 */
describe("QuestionTable — измерительный тест", () => {
  const SURVEY = [
    {
      ...QUESTIONS[2],
      questionId: "s1", questionPrompt: "Насколько часто вы делегируете решения?",
      questionType: "scale", totalAnswers: 412,
      spread: {
        answered: 412,
        options: [
          { label: "1", share: 6 }, { label: "2", share: 14 }, { label: "3", share: 44 },
          { label: "4", share: 26 }, { label: "5", share: 10 },
        ],
      },
    },
    {
      ...QUESTIONS[2],
      questionId: "s2", questionPrompt: "Что вдохновляет вас как лидера?",
      questionType: "allocation", totalAnswers: 7, spread: null,
    },
  ];

  it("показывает разброс ответов вместо доли верных", () => {
    render(<QuestionTable questions={SURVEY} measurement minObservations={10} />);

    expect(screen.getByText(termOrText("Разброс ответов"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Доля верных"))).toBeNull();
    // Э4а, решение владельца 2026-10-04: горизонтальные полосы, до пяти, по убыванию доли.
    const cell = screen.getByRole("img", { name: /3 — 44/ });
    const labels = [...cell.querySelectorAll(".tb-hbar__label")].map(node => node.textContent);
    expect(labels).toEqual(["3", "4", "2", "5", "1"]);
  });

  it("ниже порога наблюдений говорит «мало данных», а не рисует полосу", () => {
    render(<QuestionTable questions={SURVEY} measurement minObservations={10} />);

    expect(screen.getByText(termOrText("мало данных"))).toBeTruthy();
  });

  it("убирает колонки, которые без эталона ничего не значат", () => {
    // Трудность — свойство задания с верным ответом, экспозиция — вопрос вкладки «Выдача».
    render(<QuestionTable questions={SURVEY} measurement minObservations={10} />);

    expect(screen.queryByText(termOrText("Трудность"))).toBeNull();
    expect(screen.queryByText(termOrText("Экспозиция"))).toBeNull();
    expect(screen.getByText(termOrText("Ответов"))).toBeTruthy();
  });

  it("оцениваемому тесту таблицу не меняет", () => {
    render(<QuestionTable questions={QUESTIONS} />);

    // С PRD-66 FR-02 место доли верных занимает трудность — у оцениваемого теста она есть.
    expect(screen.getByText(termOrText("Трудность"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Разброс ответов"))).toBeNull();
  });
});

/**
 * PRD-57 FR-28x, FR-32: задания, на которые ПИШУТ. Сервер считал их разброс с Э3, но
 * колонка показывалась только у теста, целиком собранного из измерительных заданий, — то
 * есть в обычном тесте автор не видел ничего из посчитанного.
 */
describe("QuestionTable — написанные ответы (PRD-57)", () => {
  const WRITTEN = [
    {
      ...QUESTIONS[0],
      questionId: "w1", questionPrompt: "Как называется служба?",
      questionType: "short", totalAnswers: 40, correctPercent: 62,
      spread: { answered: 40, options: [{ label: "Ростехнадзор", share: 55 }, { label: "РТН", share: 30 }] },
    },
    {
      ...QUESTIONS[0],
      questionId: "w2", questionPrompt: "Опишите порядок действий при аварии",
      questionType: "long", totalAnswers: 12, correctPercent: null,
      volume: { answered: 12, medianLength: 340, minLength: 42, maxLength: 3000 },
    },
  ];

  it("колонка появляется и в обычном тесте, а оценка задания остаётся", () => {
    render(<QuestionTable questions={WRITTEN} minObservations={10} />);
    expect(screen.getByText(termOrText("Что отвечали"))).toBeTruthy();
    // PRD-66 FR-02: колонка оценки задания на месте, но считается долей балла.
    expect(screen.getByText(termOrText("Трудность"))).toBeTruthy();
    const labels = [...document.querySelectorAll(".tb-hbar__label")].map(node => node.textContent);
    expect(labels).toEqual(["Ростехнадзор", "РТН"]);
  });

  it("сопоставление без посчитанного разбора — «не применимо», а не «мало данных»", () => {
    // Э4а: разбор сопоставления сервер считает по парам; если его нет при 60 ответах,
    // «мало данных» было бы неправдой.
    const matching = { ...QUESTIONS[0], questionId: "m1", questionPrompt: "Сопоставьте", questionType: "matching" };
    render(<QuestionTable questions={[...WRITTEN, matching]} minObservations={10} />);
    const row = screen.getByText(termOrText("Сопоставьте")).closest("tr")!;
    expect(within(row).getAllByRole("cell")[1].textContent).toContain("не применимо");
  });

  it("у выбора — доли вариантов, верный помечен галочкой", () => {
    const choice = {
      ...QUESTIONS[0],
      spread: {
        answered: 60,
        options: [
          { label: "Проверка контрагента", share: 40, correct: true },
          { label: "Подарок партнёру", share: 45, correct: false },
          { label: "Скидка", share: 15, correct: false },
        ],
      },
    };
    render(<QuestionTable questions={[choice]} minObservations={10} />);
    // Полосы — по убыванию доли; верный помечен галочкой и зелёным.
    const labels = [...document.querySelectorAll(".tb-hbar__label")].map(node => node.textContent);
    expect(labels).toEqual(["Подарок партнёру", "✓ Проверка контрагента", "Скидка"]);
  });

  /**
   * Этап Э1 UX-аудита: полоса — сегменты по всем вариантам, верный зелёный. Прежняя полоса
   * показывала долю лидера, и 45 % неверного «Подарка» читались как 45 % верных.
   */
  it("рисует полосу сегментами по всем вариантам, верный — зелёным", () => {
    const choice = {
      ...QUESTIONS[0],
      spread: {
        answered: 60,
        options: [
          { label: "Проверка контрагента", share: 40, correct: true },
          { label: "Подарок партнёру", share: 45, correct: false },
          { label: "Скидка", share: 15, correct: false },
        ],
      },
    };
    render(<QuestionTable questions={[choice]} minObservations={10} />);

    const bar = screen.getByRole("img", { name: /Подарок партнёру/ });
    expect(bar.querySelectorAll(".ou-progress__stack-seg")).toHaveLength(3);
  });

  it("у свободного текста вместо долей — объём и длина", () => {
    render(<QuestionTable questions={WRITTEN} minObservations={10} />);
    expect(screen.getByText(termOrText(/12 ответов · медиана 340 знаков \(от 42 до 3000\)/))).toBeTruthy();
  });

  it("развёрнутый ответ — сводка; читать — на странице вопроса, без окна (Э4а)", () => {
    render(<QuestionTable questions={WRITTEN} testId="t1" minObservations={10} />);
    expect(screen.getByText(termOrText(/читать — на странице вопроса/))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Прочитать ответы/ })).toBeNull();
  });
});

/**
 * PRD-66 FR-14b: у каждого термина в заголовке — значок и толкование, дословно из эскиза
 * prd66-item-quality (состояние wf-items). Числовые заголовки стоят справа, над числами.
 */
describe("QuestionTable — подсказки терминов (FR-14b)", () => {
  const HINTS: Array<[string, string]> = [
    ["Трудность", "Средняя доля набранного балла: 0 — не решил никто, 1 — решили все. Приемлемо 0,20 — 0,80; выше 0,90 вопрос ничего не отсеивает."],
    ["Дискриминативность", "Отделяет ли вопрос сильных от слабых: корреляция балла за него с баллом за остальные вопросы формы. Хорошо от 0,30, отрицательная — почти всегда ошибка в ключе."],
    ["Пропуски", "Доля показов, в которых на вопрос не ответили. Считается по веб-прохождениям: состав выданной формы пакет SCORM не сообщает."],
    ["Экспозиция", "Доля прохождений, в которые попал вопрос. Высокая экспозиция при малом банке — ответ быстро становится известен."],
    ["Время, медиана", "Типичное время на вопрос: половина участников отвечает быстрее, половина — дольше. Медиана не зависит от брошенных и забытых открытыми вкладок."],
    ["Сложность: задана → по ответам", "Слева — сложность, которую автор задал вопросу; справа — какой она получилась по ответам участников. Обе в шкале редактора: 0 — легко, 100 — сложно; по ответам — (1 − трудность) × 100. Расхождение больше 10 пунктов: вопрос оказался легче или труднее заданного."],
  ];

  it.each(HINTS)("«%s» — со значком и толкованием", (term, hint) => {
    render(<QuestionTable questions={QUESTIONS} />);

    const trigger = screen.getByText(termOrText(hint)).closest(".tb-term-hint") as HTMLElement;
    expect(trigger).toBeTruthy();
    expect(within(trigger).getByText(termOrText(term))).toBeTruthy();
    // Значок — lucide `Info` в одном неразрывном блоке с последним словом (см. term-hint.tsx).
    expect(trigger.querySelector(".tb-term-hint__term")).toBeTruthy();
    expect(trigger.getAttribute("tabindex")).toBe("0");
    // Числовая колонка: заголовок по центру, как и её значения (правило 2026-10-03).
    expect(trigger.closest(".ou-grid__th--center")).toBeTruthy();
  });
});

/**
 * Меню строки — как в эскизе prd56-test-analytics: «Открыть вопрос в теме», прохождения с
 * ошибкой, выдача; и вход в разбор, когда вкладка качества его принимает.
 */
describe("QuestionTable — меню строки", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("«Открыть вопрос в теме» ведёт в раздел «Темы и вопросы» на этот вопрос", async () => {
    render(<QuestionTable questions={QUESTIONS} />);

    await openRowMenu(/Действия с вопросом: Какая мера/);
    await userEvent.click(screen.getByRole("menuitem", { name: /Открыть вопрос в теме: Какая мера/ }));

    expect(window.location.pathname).toBe("/author/content");
    expect(window.location.search).toBe("?questionId=q1");
  });

  it("«Разбор вопроса» есть, когда разбор можно открыть, и открывает его", async () => {
    const onOpenQuality = vi.fn();
    render(<QuestionTable questions={QUESTIONS} onOpenQuality={onOpenQuality} />);

    await openRowMenu(/Действия с вопросом: Какая мера/);
    await userEvent.click(screen.getByRole("menuitem", { name: /Разбор вопроса: Какая мера/ }));

    // Э3.3: вместе с вопросом уходит порядок таблицы — для «Предыдущий / Следующий».
    expect(onOpenQuality).toHaveBeenCalledWith("q1", expect.arrayContaining(["q1"]));
  });

  it("без входа в разбор пункта нет", async () => {
    render(<QuestionTable questions={QUESTIONS} />);

    await openRowMenu(/Действия с вопросом: Какая мера/);
    expect(screen.queryByRole("menuitem", { name: /Разбор вопроса/ })).toBeNull();
  });

  it("порядок пунктов — как в эскизе: разбор, тема, прохождения, выдача", async () => {
    render(
      <QuestionTable
        questions={QUESTIONS}
        onOpenQuality={vi.fn()}
        onOpenRegistry={vi.fn()}
        onDeliveryChange={vi.fn()}
      />,
    );

    await openRowMenu(/Действия с вопросом: Какая мера/);
    expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual([
      "Разбор вопроса", "Открыть вопрос в теме", "Прохождения с ошибкой", "Исключить из выдачи…",
    ]);
  });
});

/**
 * Э4а: «Сложность: задана → по ответам» (решение владельца 2026-10-04, вариант Б эскиза).
 */
describe("QuestionTable — сложность: задана → по ответам", () => {
  const cellOf = (prompt: string) => {
    const row = screen.getByText(termOrText(prompt)).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    return cells[cells.length - 3];
  };

  it("обе величины в шкале редактора и вывод о расхождении", () => {
    render(<QuestionTable questions={QUESTIONS} psychometrics={{
      q1: { difficulty: 0.41, itemRest: 0.3, observations: 60, coefficientConfidence: "tentative" },
      q2: { difficulty: 0.62, itemRest: 0.3, observations: 50, coefficientConfidence: "tentative" },
    }} />);

    expect(cellOf("Какая мера относится к антикоррупционным?").textContent).toBe("60 → 59расхождения нет");
    // 40 задано, по ответам 38: расхождение 2 — нет; у q2 (1 − 0,62) × 100 = 38.
    expect(cellOf("Быстрый и мимо").textContent).toBe("40 → 38расхождения нет");
  });

  it("расхождение больше 10 пунктов — тег «легче / труднее заданной»", () => {
    render(<QuestionTable questions={[{ ...QUESTIONS[0], difficulty: 50 }]} psychometrics={{
      q1: { difficulty: 0.62, itemRest: 0.3, observations: 60, coefficientConfidence: "tentative" },
    }} />);
    expect(cellOf("Какая мера относится к антикоррупционным?").textContent).toBe("50 → 38легче заданной на 12");
  });

  it("незаданная — «не задана», расхождение не считается", () => {
    render(<QuestionTable questions={[{ ...QUESTIONS[0], difficulty: null }]} psychometrics={{
      q1: { difficulty: 0.58, itemRest: 0.3, observations: 60, coefficientConfidence: "tentative" },
    }} />);
    expect(cellOf("Какая мера относится к антикоррупционным?").textContent).toBe("не задана → 42расхождение не считается");
  });

  it("без наблюдаемой — заданная и причина", () => {
    render(<QuestionTable questions={[QUESTIONS[0], QUESTIONS[2]]} />);
    expect(cellOf("Какая мера относится к антикоррупционным?").textContent).toBe("60по ответам — мало данных");
  });
});

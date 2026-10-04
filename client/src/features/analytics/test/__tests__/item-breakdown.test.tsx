/**
 * @module features/analytics/test/__tests__/item-breakdown
 * @description PRD-66 FR-24 — FR-27: карточка разбора задания.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ItemBreakdownPanel, type ItemBreakdownView, type OptionRow } from "../item-breakdown";
import { termOrText } from "./term-text";

function option(over: Partial<OptionRow> & Pick<OptionRow, "index" | "label">): OptionRow {
  return {
    correct: false,
    share: 0.2,
    bottomShare: 0.3,
    topShare: 0.1,
    restCorrelation: -0.18,
    dead: false,
    inverted: false,
    ...over,
  };
}

function view(over: Partial<ItemBreakdownView> = {}): ItemBreakdownView {
  return {
    questionId: "q1",
    prompt: "Какая мера относится к антикоррупционным?",
    questionType: "single",
    item: {
      observations: 268,
      difficulty: 0.41,
      correctedDifficulty: 0.21,
      itemRest: 0.34,
      discrimination: 0.38,
      declaredDifficulty: 60,
      timing: { medianMs: 48_000, q1Ms: 31_000, q3Ms: 82_000, measured: 244 },
    },
    groups: { size: 72, share: 0.27, topDifficulty: 0.68, bottomDifficulty: 0.19 },
    options: [
      option({ index: 0, label: "Проверка контрагента", correct: true, share: 0.41, bottomShare: 0.19, topShare: 0.68, restCorrelation: 0.34 }),
      option({ index: 1, label: "Согласование подарка", share: 0.34, bottomShare: 0.46, topShare: 0.21 }),
      option({ index: 2, label: "Бумажный журнал", share: 0.01, bottomShare: 0.02, topShare: 0, restCorrelation: null, dead: true }),
    ],
    ...over,
  };
}

describe("ItemBreakdownPanel", () => {
  it("показывает величины задания плитками в одном ряду", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);

    expect(screen.getByText(termOrText("Трудность"))).toBeTruthy();
    expect(screen.getByText(termOrText("С поправкой на угадывание"))).toBeTruthy();
    expect(screen.getByText(termOrText("Дискриминативность (r)"))).toBeTruthy();
    expect(screen.getByText(termOrText("Индекс дискриминации (D)"))).toBeTruthy();
    expect(screen.getByText(termOrText("Время, медиана"))).toBeTruthy();
  });

  it("подписи плиток и заголовки вариантов несут подсказки; «Признак» стал «Качеством варианта» (FR-14b)", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);

    for (const term of [
      "Трудность", "С поправкой на угадывание", "Дискриминативность (r)", "Индекс дискриминации (D)",
      "Сложность: задана → по ответам", "Время, медиана",
      "Выбрали", "Слабые 27 %", "Сильные 27 %", "Корреляция с остатком", "Качество варианта",
    ]) {
      const label = screen.getByText(termOrText(term));
      const tip = label.closest("[aria-describedby]");
      expect(tip, term).not.toBeNull();
      expect(tip!.querySelector(".ou-sr-only")?.textContent, term).toBeTruthy();
      // Значок — lucide `Info` в одном неразрывном блоке с последним словом (см. term-hint.tsx).
      expect(label.classList.contains("tb-term-hint__term"), term).toBe(true);
    }
    expect(screen.queryByText(termOrText("Признак"))).toBeNull();
  });

  it("плитка поправки не рисуется там, где поправка неприменима", () => {
    // У сопоставления и ранжирования вероятность случайного попадания невычислима: пустая
    // плитка читалась бы как «ноль», а это утверждение (FR-17a).
    render(<ItemBreakdownPanel view={view({
      item: { ...view().item, correctedDifficulty: null },
    })} onBack={() => {}} />);

    expect(screen.queryByText(termOrText("С поправкой на угадывание"))).toBeNull();
  });

  it("отрицательную поправку печатает типографским минусом, а не дефисом", () => {
    // Приёмка 5.5: своя копия формата печатала «-0,33», а дефис в колонке чисел — прочерк.
    render(<ItemBreakdownPanel view={view({
      item: { ...view().item, correctedDifficulty: -0.333 },
    })} onBack={() => {}} />);

    expect(screen.getByText(termOrText("−0,33"))).toBeTruthy();
    expect(screen.queryByText(termOrText("-0,33"))).toBeNull();
  });

  it("называет крайние группы их размером, а не «четвертями»", () => {
    // 27 % — не четверть, и подменять число словом нельзя (FR-26).
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);

    // Пробел перед знаком неразрывный (единый формат процентов, Э1).
    expect(screen.getByText(termOrText(/Слабые 27\s%/))).toBeTruthy();
    expect(screen.getByText(termOrText(/Сильные 27\s%/))).toBeTruthy();
  });

  it("сравнивает замысел автора с наблюдением в ОДНОЙ шкале и делает вывод (FR-18a)", () => {
    // Автор задаёт сложность «0 — легко, 100 — сложно», а трудность p — доля решивших, где 1 —
    // легко. Раньше рядом стояли «60 → 41», будто сравнимые числа; наблюдение переводится в шкалу
    // автора: 100 × (1 − 0,41) = 59.
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);
    expect(screen.getByText(termOrText("60 → 59"))).toBeTruthy();
    expect(screen.getByText(termOrText("расхождения нет"))).toBeTruthy();
  });

  it("задание оказалось легче заданного — так и сказано", () => {
    // «Как расшифровывается ЭДО?»: задумано лёгким (20), решают 97 %.
    render(<ItemBreakdownPanel view={view({ item: { ...view().item, declaredDifficulty: 60, difficulty: 0.9 } })} onBack={() => {}} />);
    expect(screen.getByText(termOrText("60 → 10"))).toBeTruthy();
    expect(screen.getByText(termOrText("легче заданной на 50"))).toBeTruthy();
  });

  it("задание оказалось труднее заданного — так и сказано", () => {
    render(<ItemBreakdownPanel view={view({ item: { ...view().item, declaredDifficulty: 20, difficulty: 0.4 } })} onBack={() => {}} />);
    expect(screen.getByText(termOrText("20 → 60"))).toBeTruthy();
    expect(screen.getByText(termOrText("труднее заданной на 40"))).toBeTruthy();
  });

  it("поправка на угадывание называет число вариантов словом и ожидание (эскиз)", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);
    expect(screen.getByText(termOrText("три варианта, ожидание 0,33"))).toBeTruthy();
    // FR-17b эскиз перенёс в подсказку термина: под числом одна строка.
    expect(screen.getByText(termOrText("С поправкой на угадывание")).closest("[aria-describedby]")!.textContent)
      .toMatch(/Частичное знание модель не учитывает/);
  });

  it("четыре варианта — «четыре варианта, ожидание 0,25»; больше десяти — цифрами", () => {
    const four = [0, 1, 2, 3].map(index => option({ index, label: `В${index}` }));
    const { unmount } = render(<ItemBreakdownPanel view={view({ options: four })} onBack={() => {}} />);
    expect(screen.getByText(termOrText("четыре варианта, ожидание 0,25"))).toBeTruthy();
    unmount();

    const twelve = Array.from({ length: 12 }, (_, index) => option({ index, label: `В${index}` }));
    render(<ItemBreakdownPanel view={view({ options: twelve })} onBack={() => {}} />);
    expect(screen.getByText(termOrText("12 вариантов, ожидание 0,08"))).toBeTruthy();
  });

  it("подзаголовок — «Тема · подтема · N наблюдений» (эскиз)", () => {
    render(<ItemBreakdownPanel
      view={view({ topicName: "Право и комплаенс", tags: ["Антикоррупция"] })}
      onBack={() => {}}
    />);
    expect(screen.getByText(termOrText("Право и комплаенс · Антикоррупция · 268 наблюдений"))).toBeTruthy();
    expect(screen.getByText(termOrText("Ко всем вопросам"))).toBeTruthy();
  });

  it("без подтем в подзаголовке только тема и число наблюдений", () => {
    render(<ItemBreakdownPanel view={view({ topicName: "Право и комплаенс", tags: [] })} onBack={() => {}} />);
    expect(screen.getByText(termOrText("Право и комплаенс · 268 наблюдений"))).toBeTruthy();
  });

  it.each([
    [0.41, "приемлемо: 0,20 — 0,80"],
    [0.12, "слишком трудный · приемлемо: 0,20 — 0,80"],
    [0.85, "лёгкий · приемлемо: 0,20 — 0,80"],
    [0.95, "слишком лёгкий · приемлемо: 0,20 — 0,80"],
  ])("подпись трудности %s — «%s» (FR-13)", (p, caption) => {
    render(<ItemBreakdownPanel view={view({ item: { ...view().item, difficulty: p } })} onBack={() => {}} />);
    expect(screen.getByText(termOrText(caption))).toBeTruthy();
  });

  it("подпись дискриминативности (r) — как в эскизе", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);
    expect(screen.getByText(termOrText("корреляция вопрос-остаток · хорошо от 0,30"))).toBeTruthy();
  });

  it.each([
    [0.38, "хорошо 0,30 — 0,39"],
    [0.45, "отлично от 0,40"],
    [0.399, "отлично от 0,40"],
    [0.25, "приемлемо 0,20 — 0,29"],
    [0.1, "слабое: ниже 0,20"],
    [-0.14, "дефект: ниже 0"],
  ])("индекс D %s печатает полосу «%s» (FR-14)", (d, band) => {
    render(<ItemBreakdownPanel view={view({ item: { ...view().item, discrimination: d } })} onBack={() => {}} />);
    expect(screen.getByText(`крайние четверти, 27 % · ${band}`)).toBeTruthy();
  });

  it("время — медиана, размах и число наблюдений с временем (FR-34)", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);
    expect(screen.getByText(termOrText("половина ответов 0:31 — 1:22 · 244 наблюдения"))).toBeTruthy();
  });

  it("заголовок «Корреляция с остатком» держит предлог при слове", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);
    expect(screen.getByText(termOrText("Корреляция с остатком")).textContent).toBe("Корреляция с остатком");
  });

  it("у задания без заданной сложности плитка говорит «не задана», расхождение не считается (Э4а)", () => {
    // «Расхождения нет» и «сравнивать не с чем» — разные состояния (FR-18); подставленная 50
    // была бы неотличима от заданной.
    render(<ItemBreakdownPanel view={view({
      item: { ...view().item, declaredDifficulty: null },
    })} onBack={() => {}} />);

    expect(screen.getByText(termOrText("Сложность: задана → по ответам"))).toBeTruthy();
    expect(screen.getByText(termOrText("не задана"))).toBeTruthy();
    expect(screen.getByText(termOrText("расхождение не считается: сложность вопросу не задана"))).toBeTruthy();
  });

  it("мало наблюдений — плитки «мало данных» со счётом, варианты — пустым состоянием (Э4а)", () => {
    render(<ItemBreakdownPanel
      view={view({ item: { ...view().item, observations: 6, difficulty: null, itemRest: null, discrimination: null } })}
      minObservations={10}
    />);

    // Трудность, поправка на угадывание, r и D — все ниже своих порогов.
    expect(screen.getAllByText(termOrText("мало данных")).length).toBe(4);
    expect(screen.getAllByText(termOrText("нужно ещё 4 наблюдения · собрано 6")).length).toBe(2);
    expect(screen.getAllByText(termOrText("нужно ещё 24 наблюдения · собрано 6")).length).toBe(2);
    expect(screen.getByText(termOrText(/Собрано 6 — нужно ещё 4/))).toBeTruthy();
  });

  it("работающие верный ответ и дистрактор — «Работает», мёртвый — «Мёртвый вариант» (эскиз)", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);

    const working = screen.getAllByText(termOrText("Работает"));
    expect(working).toHaveLength(2);
    for (const tag of working) expect(tag.closest(".ou-tag--success")).not.toBeNull();
    expect(screen.getByText(termOrText("Мёртвый вариант")).closest(".ou-tag--warning")).not.toBeNull();
    // Что вариант верный, говорит подпись под ним, а не ярлык качества.
    expect(screen.getByText(termOrText("верный ответ"))).toBeTruthy();
  });

  it("верный ответ, который выбирают слабые, «Работает» не называется", () => {
    render(<ItemBreakdownPanel view={view({
      options: [
        option({ index: 0, label: "Ключ", correct: true, correctButWeak: true }),
        option({ index: 1, label: "Дистрактор", inverted: true }),
      ],
    })} onBack={() => {}} />);

    expect(screen.getByText(termOrText("Верный ответ выбирают слабые"))).toBeTruthy();
    expect(screen.getByText(termOrText("Выбирают сильные"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Работает"))).toBeNull();
  });

  it("для типа без вариантов разбор вариантов не выдумывается — вместо него полный вид страницы (FR-27, Э4а)", () => {
    render(<ItemBreakdownPanel view={view({ options: null })} distribution={<p>Пары</p>} onBack={() => {}} />);

    expect(screen.getByText("Пары")).toBeTruthy();
    expect(screen.queryByText(termOrText("Работает"))).toBeNull();
  });

  it("время печатается медианой и размахом, а не средним", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);

    expect(screen.getByText(termOrText("0:48"))).toBeTruthy();
    expect(screen.getByText(termOrText(/половина ответов 0:31 — 1:22/))).toBeTruthy();
  });
});

/**
 * PRD-66 FR-49: разбор задания — три блока и ничего между ними: ряд плиток, таблица вариантов,
 * таблица версий содержания. Версии — последними: это разрез ВЫБОРКИ, а не свойство задания.
 */
describe("ItemBreakdownPanel — порядок блоков (FR-49)", () => {
  const versions = [
    { psychoHash: "a1b2c3d4e5", observations: 120, difficulty: 0.4, firstAt: "2026-09-01T00:00:00Z", lastAt: "2026-09-10T00:00:00Z" },
    { psychoHash: "f6e5d4c3b2", observations: 148, difficulty: 0.55, firstAt: "2026-09-11T00:00:00Z", lastAt: "2026-09-20T00:00:00Z" },
  ];

  it("варианты ответа идут раньше версий содержания", () => {
    render(<ItemBreakdownPanel
      view={view({ versions } as never)}
      onBack={() => {}}
      onSelectVersion={() => {}}
    />);

    const options = screen.getByText(termOrText("Варианты ответа"));
    const versionsTitle = screen.getByText(termOrText(/Редакции содержания|Версии содержания/));
    expect(options.compareDocumentPosition(versionsTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("заголовки таблицы версий — как в эскизе, с подсказками (FR-14b)", () => {
    render(<ItemBreakdownPanel
      view={view({ versions } as never)}
      onBack={() => {}}
      onSelectVersion={() => {}}
    />);

    expect(screen.getByText(termOrText("Версии содержания"))).toBeTruthy();
    for (const term of ["Редакция", "n", "Статистика карточки"]) {
      expect(screen.getByText(termOrText(term)).closest("[aria-describedby]"), term).not.toBeNull();
    }
    // «Трудность» есть и в плитке, и в заголовке версий — подсказка у обеих.
    for (const label of screen.getAllByText(termOrText("Трудность"))) {
      expect(label.closest("[aria-describedby]")).not.toBeNull();
    }
    expect(screen.queryByText(termOrText("Наблюдений"))).toBeNull();
    expect(screen.getByText(termOrText("Дискриминативность")).closest("[aria-describedby]")).not.toBeNull();
  });
});

/** Таблица версий содержания по эскизу: подписи строк, n, r и отметка выбранной редакции. */
describe("ItemBreakdownPanel — таблица версий (FR-49a, FR-49b)", () => {
  const VERSIONS = [
    { psychoHash: "cur", observations: 268, difficulty: 0.41, itemRest: 0.34, firstAt: "2026-09-04T12:00:00Z", lastAt: "2026-09-24T12:00:00Z" },
    { psychoHash: "old", observations: 141, difficulty: 0.52, itemRest: 0.19, firstAt: "2026-03-12T12:00:00Z", lastAt: "2026-09-03T12:00:00Z" },
    { psychoHash: null, observations: 96, difficulty: 0.47, itemRest: null, firstAt: "2026-01-10T12:00:00Z", lastAt: "2026-09-22T12:00:00Z" },
  ];

  /** Ячейки строки таблицы версий по подписи первой колонки. */
  function rowOf(title: string): HTMLElement {
    return screen.getByText(termOrText(title)).closest("tr") as HTMLElement;
  }

  it("подписи строк: текущая, прежняя с диапазоном дат и «Версия неизвестна»", () => {
    render(<ItemBreakdownPanel
      view={view({ versions: VERSIONS, currentVersion: "cur", selectedVersion: "cur" })}
      onBack={() => {}}
      onSelectVersion={() => {}}
    />);

    expect(screen.getByText(termOrText("С 04.09.2026 — текущая"))).toBeTruthy();
    expect(screen.getByText(termOrText("12.03.2026 — 03.09.2026"))).toBeTruthy();
    expect(screen.getByText(termOrText("предыдущая редакция"))).toBeTruthy();
    expect(screen.getByText(termOrText("Версия неизвестна"))).toBeTruthy();
    // Граница серии без отпечатка — день, с которого в выборке есть редакции с ним.
    expect(screen.getByText(termOrText("импорт выгрузок и прохождения до 12.03.2026"))).toBeTruthy();
  });

  it("текущая редакция — первой, прежние от новых к старым, «Версия неизвестна» — последней", () => {
    // Сервер отдаёт серии в любом порядке; эскиз ставит «стало» над «было» (приёмка 5.5).
    const shuffled = [VERSIONS[2], VERSIONS[1], VERSIONS[0]];
    render(<ItemBreakdownPanel
      view={view({ versions: shuffled, currentVersion: "cur", selectedVersion: "cur" })}
      onBack={() => {}}
      onSelectVersion={() => {}}
    />);

    const labels = [
      screen.getByText(termOrText("С 04.09.2026 — текущая")),
      screen.getByText(termOrText("12.03.2026 — 03.09.2026")),
      screen.getByText(termOrText("Версия неизвестна")),
    ];
    expect(labels[0].compareDocumentPosition(labels[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(labels[1].compareDocumentPosition(labels[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("строка несёт n, трудность и дискриминативность; без r — прочерк", () => {
    render(<ItemBreakdownPanel
      view={view({ versions: VERSIONS, currentVersion: "cur", selectedVersion: "cur" })}
      onBack={() => {}}
      onSelectVersion={() => {}}
    />);

    const old = rowOf("12.03.2026 — 03.09.2026");
    expect(old.textContent).toContain("141");
    expect(old.textContent).toContain("0,52");
    expect(old.textContent).toContain("0,19");
    const unknown = rowOf("Версия неизвестна");
    expect(unknown.textContent).toContain("96");
    expect(unknown.textContent).toContain("—");
  });

  it("текущая редакция выбрана по умолчанию, остальные — кнопка «Показать»", () => {
    render(<ItemBreakdownPanel
      view={view({ versions: VERSIONS, currentVersion: "cur", selectedVersion: "cur" })}
      onBack={() => {}}
      onSelectVersion={() => {}}
    />);

    expect(rowOf("С 04.09.2026 — текущая").querySelector(".ou-tag--info")?.textContent).toBe("Выбрана");
    expect(screen.getAllByText(termOrText("Выбрана"))).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Показать" })).toHaveLength(2);
    expect(screen.queryByText(termOrText(/все редакции вместе/))).toBeNull();
  });

  it("«Показать» переносит выбор в нажатую строку", () => {
    const picked: Array<string | null | undefined> = [];
    const { rerender } = render(<ItemBreakdownPanel
      view={view({ versions: VERSIONS, currentVersion: "cur", selectedVersion: "cur" })}
      onBack={() => {}}
      onSelectVersion={v => picked.push(v)}
    />);

    const button = rowOf("Версия неизвестна").querySelector("button") as HTMLButtonElement;
    fireEvent.click(button);
    expect(picked).toEqual([null]);

    rerender(<ItemBreakdownPanel
      view={view({ versions: VERSIONS, currentVersion: "cur", selectedVersion: null })}
      version={null}
      onBack={() => {}}
      onSelectVersion={v => picked.push(v)}
    />);
    expect(rowOf("Версия неизвестна").textContent).toContain("Выбрана");
    expect(rowOf("С 04.09.2026 — текущая").querySelector("button")?.textContent).toBe("Показать");
  });
});

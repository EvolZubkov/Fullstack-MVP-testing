/**
 * @module features/analytics/test/__tests__/item-quality
 * @description PRD-66: вкладка «Качество вопросов».
 *
 * Проверяется то, что легко потерять при правке: термины в заголовках (а не пересказ),
 * признак-симптом с числами под ним, разные пороги у трудности и коэффициентов и то, что
 * невычислимое место остаётся пустым, а не нулевым.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ItemQualityPanel, type ItemQualityRow, type ItemQualityView } from "../item-quality";
import { termOrText } from "./term-text";

function row(over: Partial<ItemQualityRow> & Pick<ItemQualityRow, "questionId">): ItemQualityRow {
  return {
    observations: 150,
    difficulty: 0.55,
    correctedDifficulty: 0.4,
    itemRest: 0.35,
    discrimination: 0.42,
    declaredDifficulty: null,
    difficultyConfidence: "reliable",
    coefficientConfidence: "reliable",
    flags: { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false },
    timingFlags: { rushed: false, slow: false },
    prompt: "Вопрос",
    topicName: "Тема",
    questionType: "single",
    ...over,
  };
}

function view(over: Partial<ItemQualityView> = {}): ItemQualityView {
  return {
    items: [row({ questionId: "q1" })],
    reliability: { alpha: 0.84, items: 42, respondents: 486, totalSd: 5.2, dichotomous: true },
    sem: 2.1,
    cutBand: null,
    sample: { respondents: 486, responses: 4860, bySource: { web: 210, telemetry: 244 }, unknownVersionShare: 0 },
    firstAttemptOnly: true,
    ...over,
  };
}

/**
 * PRD-66 FR-22: прогноз Спирмена-Брауна — сколько заданий добавить или снять ради надёжности
 * 0,80 (цель задана константой, решение владельца 2026-09-24).
 *
 * Прогноз живёт ПОДПИСЬЮ под надёжностью, а не своей плиткой: это совет к действию, а не
 * измеренная величина, и в ряду метрик он читался бы как ещё одно измерение.
 */
describe("ItemQualityPanel — прогноз длины (FR-22)", () => {
  it("говорит, сколько заданий добавить до целевой надёжности", () => {
    render(<ItemQualityPanel view={view({
      reliability: { alpha: 0.64, items: 20, respondents: 300, totalSd: 4.1, dichotomous: true },
      lengthForecast: { target: 0.8, factor: 2.25, itemsDelta: 25 },
    })} />);

    expect(screen.getByText(termOrText(/до 0,80 — ещё 25 вопросов/))).toBeTruthy();
  });

  it("у теста надёжнее целевого говорит, сколько заданий МОЖНО СНЯТЬ", () => {
    // Единственное число трека, которое разрешает сократить прогон участника: всё остальное
    // на экране только добавляет автору работы.
    render(<ItemQualityPanel view={view({
      lengthForecast: { target: 0.8, factor: 0.44, itemsDelta: -22 },
    })} />);

    expect(screen.getByText(termOrText(/22 вопроса можно снять/))).toBeTruthy();
  });

  it("без прогноза строки нет вовсе", () => {
    render(<ItemQualityPanel view={view({ lengthForecast: null })} />);

    expect(screen.queryByText(termOrText(/можно снять/))).toBeNull();
    expect(screen.queryByText(termOrText(/до 0,80/))).toBeNull();
  });

  it("оговорка о качестве добавляемых заданий названа в «Терминах»", async () => {
    // Прогноз исходит из того, что новые задания будут такими же, как нынешние. На практике
    // они обычно хуже, поэтому число оптимистично, и умалчивать об этом нельзя.
    render(<ItemQualityPanel view={view()} />);
    await userEvent.click(screen.getByRole("button", { name: "Термины" }));

    expect(screen.getByText(termOrText(/такого же качества/))).toBeTruthy();
  });

  // План сверки 5.7: статьи эскиза, которых не хватало.
  it("в «Терминах» есть корреляция с остатком, обратный пункт и дистрактор", async () => {
    render(<ItemQualityPanel view={view()} />);
    await userEvent.click(screen.getByRole("button", { name: "Термины" }));

    for (const term of ["Корреляция с остатком", "Обратный пункт", "Дистрактор"]) {
      expect(screen.getByText(termOrText(term))).toBeTruthy();
    }
    expect(screen.getByText(termOrText(/называют реверсированием/))).toBeTruthy();
    // Случайная выдача больше не «без надёжности»: оценка по связям вопросов (FR-20).
    expect(screen.queryByText(termOrText(/там нет и самой надёжности/))).toBeNull();
  });
});

describe("ItemQualityPanel", () => {
  it("называет величины ТЕРМИНАМИ, а не пересказом", () => {
    // У величины есть имя, и методист заказчика должен его узнать: «Различает» вместо
    // «Дискриминативности» — придуманный оборот, которого нет ни в одном учебнике.
    render(<ItemQualityPanel view={view()} />);

    expect(screen.getByText(termOrText("Надёжность (альфа)"))).toBeTruthy();
    expect(screen.getByText(termOrText("Ошибка измерения"))).toBeTruthy();
    expect(screen.getByText(termOrText("Трудность"))).toBeTruthy();
    expect(screen.getByText(termOrText("Дискриминативность"))).toBeTruthy();
  });

  it("признак называет СИМПТОМ, а числа под ним — основание", () => {
    // «Ошибка в ключе» — догадка, которую расчёт проверить не может; она идёт подписью, а
    // заголовком стоит то, что видно в числах.
    render(<ItemQualityPanel view={view({
      items: [row({
        questionId: "q1",
        itemRest: -0.21,
        discrimination: -0.14,
        flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false },
      })],
    })} />);

    expect(screen.getByText(termOrText("Сильные ошибаются чаще"))).toBeTruthy();
    // Числа под заголовком — основание признака: сам он причины не называет.
    expect(screen.getByText(termOrText(/вероятна ошибка в ключе: r = .?0,21, D = .?0,14/))).toBeTruthy();
  });

  it("у задания с малой выборкой трудность видна, а коэффициент — нет", () => {
    // Два порога сосуществуют (FR-38a): трудность живёт при пороге инстанса, коэффициенты — с
    // тридцати наблюдений.
    render(<ItemQualityPanel view={view({
      items: [row({
        questionId: "q1",
        observations: 12,
        difficulty: 0.33,
        difficultyConfidence: "reliable",
        coefficientConfidence: "insufficient",
      })],
    })} />);

    expect(screen.getByText(termOrText("0,33"))).toBeTruthy();
    expect(screen.getByText(termOrText("мало данных"))).toBeTruthy();
  });

  it("невычислимую величину печатает прочерком, а не нулём", () => {
    // Ноль в дискриминативности означал бы «задание никого не различает» — совсем другое
    // утверждение, чем «посчитать было не на чем».
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", itemRest: null, discrimination: null })],
    })} />);

    expect(screen.getAllByText(termOrText("—")).length).toBeGreaterThan(0);
  });

  it("причину отсутствия надёжности называет словами", () => {
    render(<ItemQualityPanel view={view({ reliability: "no-variance", sem: null })} />);
    expect(screen.getByText(termOrText(/все набрали поровну/))).toBeTruthy();
  });

  it("показывает состав выборки и режим попыток", () => {
    // Числа обязаны говорить, на чём они стоят: источник и режим попыток меняют их сильнее
    // любого фильтра.
    render(<ItemQualityPanel view={view()} />);

    expect(screen.getByText(termOrText(/веб — 210/))).toBeTruthy();
    expect(screen.getByText(termOrText(/телеметрия LMS — 244/))).toBeTruthy();
    // Умолчание «первая попытка» уже стоит чипом в строке фильтра: второй раз тегом не говорится.
    expect(screen.queryByText(termOrText("только первая попытка"))).toBeNull();
  });

  it("по всем попыткам предупреждает тегом «все попытки»", () => {
    render(<ItemQualityPanel view={view({ firstAttemptOnly: false })} />);
    expect(screen.getAllByText(termOrText("все попытки")).length).toBeGreaterThan(0);
  });

  // План сверки 5.4: единица строки — прохождения, как в эскизе и в подписи надёжности.
  it("состав выборки — в прохождениях, без слова «наблюдений»", () => {
    render(<ItemQualityPanel view={view({
      sample: {
        respondents: 486, responses: 9000, bySource: { web: 4000, telemetry: 5000 },
        passagesBySource: { web: 210, telemetry: 276 }, unknownVersionShare: 0,
      },
    })} />);

    expect(screen.getByText(termOrText("веб — 210"))).toBeTruthy();
    expect(screen.getByText(termOrText("телеметрия LMS — 276"))).toBeTruthy();
    const strip = screen.getByText(termOrText("Выборка:")).parentElement!;
    expect(within(strip).queryByText(termOrText(/наблюдени/))).toBeNull();
  });

  it("предупреждает, когда проходной балл попал внутрь интервала ошибки", () => {
    render(<ItemQualityPanel view={view({ cutBand: { low: 26.8, high: 31.2, z: 1.96, withinBand: 0 } })} />);
    expect(screen.getByText(termOrText(/Проходной балл попадает внутрь интервала/))).toBeTruthy();
  });

  it("называет, скольких участников интервал задел на самом деле (FR-21a)", () => {
    // «Решение ненадёжно» без числа затронутых предупреждает ни о чём: двое из шестидесяти и
    // половина потока требуют разных действий.
    render(<ItemQualityPanel view={view({ cutBand: { low: 26.8, high: 31.2, z: 1.96, withinBand: 37 } })} />);

    // Знаменатель — участники с ПОЛНЫМ набором, по которым считалась надёжность, а не вся
    // выборка: при неравномерной выдаче это разные числа, и смешивать их в одной фразе нельзя.
    expect(screen.getByText(termOrText(/Внутри интервала 37 участников \(8 %\)\./))).toBeTruthy();
  });

  // План сверки 5.3, эскиз prd66-item-quality (состояние quality).
  it("баннер называет порог и интервал в процентах и сколько вопросов нужно для альфы 0,90", () => {
    render(<ItemQualityPanel view={view({
      cutBand: {
        low: 27.6, high: 31.2, z: 1.96, withinBand: 38,
        cutPercent: 70, lowPercent: 65.8, highPercent: 74.2,
      },
      cutForecast: { target: 0.9, factor: 1.47, itemsDelta: 20 },
    })} />);

    expect(screen.getByText(
      "Порог 70 %, интервал 65,8 — 74,2 %. Внутри интервала 38 участников (8 %). Для альфы 0,90 нужно 62 вопроса вместо 42.",
    )).toBeTruthy();
  });

  it("тесту, которому надёжности уже хватает, совет про длину не даёт", () => {
    render(<ItemQualityPanel view={view({
      cutBand: { low: 27.6, high: 31.2, z: 1.96, withinBand: 3, cutPercent: 70, lowPercent: 65.8, highPercent: 74.2 },
      cutForecast: { target: 0.9, factor: 0.8, itemsDelta: -8 },
    })} />);

    expect(screen.queryByText(termOrText(/Для альфы 0,90/))).toBeNull();
  });

  it("ошибка измерения — в процентных пунктах, с подписью «интервал вокруг балла»", () => {
    render(<ItemQualityPanel view={view({ sem: 1.76, semPercent: 4.19 })} />);

    expect(screen.getByText(termOrText("4,2 п.п."))).toBeTruthy();
    expect(screen.getByText(termOrText("интервал вокруг балла"))).toBeTruthy();
    expect(screen.queryByText(termOrText("в долях балла"))).toBeNull();
  });

  it("подпись надёжности считает прохождения", () => {
    render(<ItemQualityPanel view={view()} />);
    expect(screen.getByText(termOrText("хорошо · 486 прохождений"))).toBeTruthy();
  });

  it("никого не задело — так и говорит, а не молчит", () => {
    // Молчание читалось бы как «не посчитали». Интервал у порога есть, но пока в него никто
    // не попал — это хорошая новость, и она стоит слов.
    render(<ItemQualityPanel view={view({ cutBand: { low: 26.8, high: 31.2, z: 1.96, withinBand: 0 } })} />);

    expect(screen.getByText(termOrText(/в него не попал никто/))).toBeTruthy();
  });

  it("предупреждает о ключах, построенных разными алгоритмами (FR-43)", () => {
    // Один человек с двумя ключами попадает в выборку дважды, и число респондентов завышено.
    // Это не «ослабленные показатели», а прямая ошибка в составе выборки, поэтому баннер
    // отдельный и тоном выше.
    render(<ItemQualityPanel view={view({
      bias: { unevenDelivery: false, importShare: 0.4, mixedAnonymity: true },
    })} />);

    expect(screen.getByText(termOrText(/посчитаны дважды/i))).toBeTruthy();
    // Совет обязан вести к исправлению ключа, а не к снятию с учёта законных данных.
    expect(screen.getByText(termOrText(/скриптом обезличивания/i))).toBeTruthy();
  });

  it("без смешения такого баннера нет", () => {
    render(<ItemQualityPanel view={view({
      bias: { unevenDelivery: false, importShare: 0, mixedAnonymity: false },
    })} />);

    expect(screen.queryByText(termOrText(/посчитаны дважды/i))).toBeNull();
  });

  it("доля невыданных наблюдений стоит рядом с трудностью задания (FR-41)", () => {
    // У выборки из импорта это и есть мера смещения `p`: трудность посчитана по тем, кто
    // задание видел, и чем больше невыданных, тем меньше выборка под числом.
    render(<ItemQualityPanel view={view({ items: [row({ questionId: "q1", missingShare: 0.31 })] })} />);

    expect(screen.getByText(termOrText(/не выдано 31 %/))).toBeTruthy();
  });

  it("задание, выданное всем, доли не печатает — ноль там не о чем говорить", () => {
    render(<ItemQualityPanel view={view({ items: [row({ questionId: "q1", missingShare: 0 })] })} />);

    expect(screen.queryByText(termOrText(/не выдано/))).toBeNull();
  });

  // Решение владельца 2026-09-25: пометка FR-09c живёт в «Версиях содержания» разбора вопроса.
  it("в строке выборки тега «редакция неизвестна» нет", () => {
    render(<ItemQualityPanel view={view({
      sample: { respondents: 10, responses: 100, bySource: { import: 100 }, unknownVersionShare: 0.42 },
    })} />);

    expect(screen.queryByText(termOrText(/редакция неизвестна/))).toBeNull();
  });

  it("кнопки выгрузок ведут на свои ручки", () => {
    render(<ItemQualityPanel view={view()} exportHref="/api/x/export" matrixHref="/api/x/matrix" />);

    expect(screen.getByText(termOrText("Психометрический отчёт")).closest("a")?.getAttribute("href")).toBe("/api/x/export");
    expect(screen.getByText(termOrText("Матрица ответов")).closest("a")?.getAttribute("href")).toBe("/api/x/matrix");
  });

  it("без ссылок выгрузок кнопок нет — интерфейс не обещает того, чего не делает", () => {
    render(<ItemQualityPanel view={view()} />);
    expect(screen.queryByText(termOrText("Матрица ответов"))).toBeNull();
  });

  it("список открывается самым тревожным: порядок по СИЛЕ подозрения (AC-02, FR-48)", () => {
    // Испорченный ключ чинят первым, поэтому он и стоит первым — независимо от того, в каком
    // порядке задания пришли с сервера.
    const calm = row({ questionId: "calm" });
    const easy = row({
      questionId: "easy",
      difficulty: 0.97,
      flags: { tooHard: false, tooEasy: true, negativeDiscrimination: false, atChanceLevel: false },
    });
    const broken = row({
      questionId: "broken",
      itemRest: -0.3,
      flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false },
    });
    render(<ItemQualityPanel view={view({ items: [calm, easy, broken] })} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("Сильные ошибаются чаще");
  });

  it("задание с малой выборкой стоит последним — признака нет не потому, что оно здорово", () => {
    const thin = row({ questionId: "thin", observations: 12, coefficientConfidence: "insufficient" });
    const easy = row({
      questionId: "easy",
      flags: { tooHard: false, tooEasy: true, negativeDiscrimination: false, atChanceLevel: false },
    });
    render(<ItemQualityPanel view={view({ items: [thin, easy] })} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[rows.length - 1].textContent).toContain("Мало данных");
  });

  it("«мало данных» говорит, сколько собрано и сколько ЕЩЁ нужно (AC-05)", () => {
    // Иначе признак не подсказывает действия: ждать ещё неделю или бросать задание вовсе.
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", observations: 12, coefficientConfidence: "insufficient" })],
    })} />);

    expect(screen.getByText(termOrText(/12 из 30 · нужно ещё 18 наблюдений/))).toBeTruthy();
  });

  it("баннер смещения показывается при неоднородной выдаче (AC-06, FR-39)", () => {
    render(<ItemQualityPanel view={view({ bias: { unevenDelivery: true, importShare: 0 } })} />);

    expect(screen.getByText(termOrText("Показатели дискриминации ослаблены"))).toBeTruthy();
    expect(screen.getByText(termOrText(/Выдача неоднородна/))).toBeTruthy();
  });

  it("у теста с однородной выдачей баннера нет — он был бы ложной тревогой", () => {
    render(<ItemQualityPanel view={view({ bias: { unevenDelivery: false, importShare: 0 } })} />);
    expect(screen.queryByText(termOrText("Показатели дискриминации ослаблены"))).toBeNull();
  });

  it("тот же баннер поднимает заметная доля импорта (FR-40)", () => {
    // Там бинарный исход вместо доли балла и неизвестная редакция — повод другой, и назван он
    // своими словами.
    render(<ItemQualityPanel view={view({ bias: { unevenDelivery: false, importShare: 0.4 } })} />);

    expect(screen.getByText(termOrText(/доля наблюдений пришла из импорта \(40 %\)/))).toBeTruthy();
  });

  it("у теста, где все задания измерительные, вкладка показывает только шкалы (FR-52)", () => {
    // Вскрыто приёмкой: таблица с восемью строками «мало данных · 0 из 30» и плитками с
    // прочерками читается как поломка экрана, хотя всё в порядке — проверять просто нечего.
    const { container } = render(<ItemQualityPanel view={view({ measurementOnly: true })} />);

    // Эскиз wf-scales: над «Шкалами методики» нет ничего — ни плиток, ни поясняющей карточки.
    expect(container.innerHTML).toBe("");
    expect(screen.queryByText(termOrText("Тест измерительный"))).toBeNull();
    expect(screen.queryByText(termOrText("Надёжность (альфа)"))).toBeNull();
    expect(screen.queryByText(termOrText("Вопросы"))).toBeNull();
  });

  it("счётчик «под подозрением» считает задания с признаками, а не все подряд", () => {
    const clean = row({ questionId: "q1" });
    const broken = row({
      questionId: "q2",
      flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false },
    });
    render(<ItemQualityPanel view={view({ items: [clean, broken] })} />);

    // Плитка и фильтр называются одинаково — считаем по плитке, она в карточке сводки.
    const tile = screen.getAllByText(termOrText("Под подозрением"))
      .map(node => node.closest(".ou-card__body"))
      .find(Boolean)!;
    expect(within(tile as HTMLElement).getByText(termOrText("1"))).toBeTruthy();
  });
});

/**
 * PRD-66 FR-05, FR-48: эвристики PRD-56 «Требуют ревизии» — признаками таблицы качества.
 *
 * Они идут сразу за прямыми дефектами (отрицательная дискриминация, угадывание) и перед прочими
 * признаками, а на малой выборке — вместо «мало данных»: там они единственное, что можно сказать.
 */
describe("ItemQualityPanel — эвристики «Требуют ревизии» (FR-05, FR-48)", () => {
  const HARD_AND_FREQUENT = { kinds: ["hard-and-frequent"], exposurePercent: 82, correctPercent: 41, latencyMedianMs: 30_000 };
  const FAST_AND_WRONG = { kinds: ["fast-and-wrong"], exposurePercent: 40, correctPercent: 30, latencyMedianMs: 4_000 };

  /** Строки таблицы сверху вниз — по тексту вопроса. */
  const order = () => screen.getAllByText(termOrText(/^Вопрос /)).map((el) => el.textContent);

  it("«Заезжено и трудно» — с числами показов и верных, как в эскизе", () => {
    render(<ItemQualityPanel
      view={view({ items: [row({ questionId: "q1", prompt: "Вопрос 1" })] })}
      heuristics={{ q1: HARD_AND_FREQUENT }}
    />);

    expect(screen.getByText(termOrText("Заезжено и трудно"))).toBeTruthy();
    expect(screen.getByText(termOrText("82 % показов, 41 % верных"))).toBeTruthy();
  });

  it("«Слишком быстрые ответы» — с медианой времени и долей верных", () => {
    render(<ItemQualityPanel
      view={view({ items: [row({ questionId: "q1", prompt: "Вопрос 1" })] })}
      heuristics={{ q1: FAST_AND_WRONG }}
    />);

    expect(screen.getByText(termOrText("Слишком быстрые ответы"))).toBeTruthy();
    expect(screen.getByText(termOrText("медиана 4 с при 30 % верных"))).toBeTruthy();
  });

  it("порядок: отрицательная дискриминация, эвристика, прочие признаки", () => {
    render(<ItemQualityPanel
      view={view({ items: [
        row({ questionId: "q-hard", prompt: "Вопрос трудный", flags: { tooHard: true, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false } }),
        row({ questionId: "q-heur", prompt: "Вопрос эвристика" }),
        row({ questionId: "q-neg", prompt: "Вопрос ключ", itemRest: -0.2, flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false } }),
      ] })}
      heuristics={{ "q-heur": HARD_AND_FREQUENT }}
    />);

    expect(order()).toEqual(["Вопрос ключ", "Вопрос эвристика", "Вопрос трудный"]);
  });

  it("на малой выборке эвристика стоит вместо «мало данных» и поднимает задание вверх", () => {
    render(<ItemQualityPanel
      view={view({ items: [
        row({ questionId: "q-ok", prompt: "Вопрос спокойный" }),
        row({ questionId: "q-thin", prompt: "Вопрос мало", observations: 12, coefficientConfidence: "insufficient" }),
      ] })}
      heuristics={{ "q-thin": HARD_AND_FREQUENT }}
    />);

    // «Мало данных» есть и в переключателе вида таблицы — смотрим строку задания.
    const thinRow = screen.getByText(termOrText("Вопрос мало")).closest("tr") as HTMLElement;
    expect(within(thinRow).getByText(termOrText("Заезжено и трудно"))).toBeTruthy();
    expect(within(thinRow).queryByText(termOrText("Мало данных"))).toBeNull();
    expect(order()).toEqual(["Вопрос мало", "Вопрос спокойный"]);
  });

  it("эвристика считается в «под подозрением»", () => {
    render(<ItemQualityPanel
      view={view({ items: [row({ questionId: "q1", prompt: "Вопрос 1" }), row({ questionId: "q2", prompt: "Вопрос 2" })] })}
      heuristics={{ q2: HARD_AND_FREQUENT }}
    />);

    // «Под подозрением» есть и в переключателе вида таблицы — берём плитку.
    const tile = screen.getAllByText(termOrText("Под подозрением"))
      .map((el) => el.closest(".ou-card"))
      .find((card): card is HTMLElement => !!card && !card.querySelector("table")) as HTMLElement;
    expect(within(tile).getByText(termOrText("1"))).toBeTruthy();
  });
});

/**
 * PRD-66 FR-48a: колонки таблицы заданий сортируются, «Признак» — по рангу подозрения.
 *
 * Без этого порядок по умолчанию невозвратен: стоит отсортировать по n, и вернуться к «сначала
 * самое тревожное» нечем. «Мало данных» — последними в обоих направлениях.
 */
describe("ItemQualityPanel — сортировка колонок (FR-48a)", () => {
  const NEG = { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false };
  const HARD = { tooHard: true, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false };
  const items = [
    row({ questionId: "a", prompt: "Вопрос А", difficulty: 0.9, observations: 300 }),
    row({ questionId: "b", prompt: "Вопрос Б", difficulty: 0.1, observations: 120, flags: HARD }),
    row({ questionId: "c", prompt: "Вопрос В", difficulty: 0.5, observations: 200, itemRest: -0.3, flags: NEG }),
    row({ questionId: "d", prompt: "Вопрос Г", difficulty: null, observations: 5, itemRest: null, coefficientConfidence: "insufficient" }),
  ];
  const order = () => screen.getAllByText(termOrText(/^Вопрос [А-Г]$/)).map((el) => el.textContent);
  /** Щелчок по заголовку колонки: он и переключает направление. */
  const clickHeader = async (title: string) => {
    const header = screen.getAllByText(termOrText(title)).find((el) => el.closest(".ou-grid__th")) as HTMLElement;
    await userEvent.click(header);
  };

  it("по умолчанию — по силе подозрения, «мало данных» в конце", () => {
    render(<ItemQualityPanel view={view({ items })} />);
    expect(order()).toEqual(["Вопрос В", "Вопрос Б", "Вопрос А", "Вопрос Г"]);
  });

  it("все пять колонок помечены сортируемыми", () => {
    render(<ItemQualityPanel view={view({ items })} />);
    expect(document.querySelectorAll(".ou-grid__th.is-sortable")).toHaveLength(5);
  });

  it("трудность сортируется по значению, пустое — последним в обоих направлениях", async () => {
    render(<ItemQualityPanel view={view({ items })} />);

    await clickHeader("Трудность");
    expect(order()).toEqual(["Вопрос Б", "Вопрос В", "Вопрос А", "Вопрос Г"]);
    await clickHeader("Трудность");
    expect(order()).toEqual(["Вопрос А", "Вопрос В", "Вопрос Б", "Вопрос Г"]);
  });

  it("n сортируется по числу наблюдений", async () => {
    render(<ItemQualityPanel view={view({ items })} />);

    await clickHeader("n");
    expect(order()).toEqual(["Вопрос Г", "Вопрос Б", "Вопрос В", "Вопрос А"]);
  });

  it("«Что не так» возвращает порядок подозрения, обратное направление — от спокойных к тревожным", async () => {
    render(<ItemQualityPanel view={view({ items })} />);
    await clickHeader("n");

    await clickHeader("Что не так");
    expect(order()).toEqual(["Вопрос В", "Вопрос Б", "Вопрос А", "Вопрос Г"]);
    await clickHeader("Что не так");
    // «Мало данных» остаётся последним и здесь: признака у задания нет не потому, что оно здорово.
    expect(order()).toEqual(["Вопрос А", "Вопрос Б", "Вопрос В", "Вопрос Г"]);
  });
});

/**
 * PRD-66 FR-38: коэффициент при 30 ≤ n < 100 выводится с меткой ориентировочности.
 *
 * Уровень `tentative` движок считал всегда, а экран его не показывал: «0,26» на сорока
 * наблюдениях и на четырёхстах выглядели одинаково.
 */
describe("ItemQualityPanel — ориентировочные коэффициенты (FR-38)", () => {
  const NEG = { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false };

  it("задание без признака помечено «Ориентировочно» с числом наблюдений, как в эскизе", () => {
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", prompt: "Вопрос 1", observations: 44, coefficientConfidence: "tentative" })],
    })} />);

    expect(screen.getByText(termOrText("Ориентировочно"))).toBeTruthy();
    expect(screen.getByText(termOrText("44 наблюдения"))).toBeTruthy();
  });

  it("у задания с признаком признак главный, а оговорка — в числах под ним", () => {
    render(<ItemQualityPanel view={view({
      items: [row({
        questionId: "q1", prompt: "Вопрос 1", observations: 44, coefficientConfidence: "tentative",
        itemRest: -0.2, discrimination: -0.1, flags: NEG,
      })],
    })} />);

    expect(screen.getByText(termOrText("Сильные ошибаются чаще"))).toBeTruthy();
    expect(screen.getByText(termOrText(/ориентировочно, 44 наблюдения/))).toBeTruthy();
  });

  it("у признака по трудности оговорки нет: трудность под правило не попадает (FR-38a)", () => {
    render(<ItemQualityPanel view={view({
      items: [row({
        questionId: "q1", prompt: "Вопрос 1", observations: 44, coefficientConfidence: "tentative",
        difficulty: 0.97, flags: { tooHard: false, tooEasy: true, negativeDiscrimination: false, atChanceLevel: false },
      })],
    })} />);

    expect(screen.getByText(termOrText("Слишком лёгкий"))).toBeTruthy();
    expect(screen.queryByText(termOrText(/ориентировочно/))).toBeNull();
  });

  it("ориентировочность — не подозрение: в «Под подозрением» не считается", () => {
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", prompt: "Вопрос 1", observations: 44, coefficientConfidence: "tentative" })],
    })} />);

    const tile = screen.getAllByText(termOrText("Под подозрением"))
      .map((el) => el.closest(".ou-card"))
      .find((card): card is HTMLElement => !!card && !card.querySelector("table")) as HTMLElement;
    expect(within(tile).getByText(termOrText("0"))).toBeTruthy();
  });

  it("при ста наблюдениях и больше оговорки нет", () => {
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", prompt: "Вопрос 1", observations: 150, coefficientConfidence: "reliable" })],
    })} />);

    expect(screen.queryByText(termOrText("Ориентировочно"))).toBeNull();
    expect(screen.queryByText(termOrText(/ориентировочно/))).toBeNull();
  });
});

/** PRD-66 FR-11: потеря выборки при импорте — рядом с n, как в эскизе. */
describe("ItemQualityPanel — несопоставленные взаимодействия (FR-11)", () => {
  it("показывает число в составе выборки", () => {
    render(<ItemQualityPanel view={view({ unmatched: 7 })} />);
    expect(screen.getByText(termOrText("не сопоставлено — 7"))).toBeTruthy();
  });

  it("без потерь тега нет", () => {
    render(<ItemQualityPanel view={view({ unmatched: 0 })} />);
    expect(screen.queryByText(termOrText(/не сопоставлено/))).toBeNull();
  });
});

/**
 * PRD-66 FR-46: вкладка показывается всегда, но при малой выборке вместо чисел — сколько
 * собрано и сколько нужно (эскиз prd66-item-quality, состояние «данных мало»).
 */
describe("ItemQualityPanel — данных мало на уровне теста (FR-46)", () => {
  const THIN_SAMPLE = { respondents: 18, responses: 180, bySource: { web: 18 }, unknownVersionShare: 0 };
  const thinView = () => view({
    sample: THIN_SAMPLE,
    reliability: "too-few-respondents",
    sem: null,
    minObservations: 10,
    items: [
      row({ questionId: "q1", prompt: "Вопрос 1", observations: 18, coefficientConfidence: "insufficient" }),
      row({ questionId: "q2", prompt: "Вопрос 2", observations: 11, coefficientConfidence: "insufficient" }),
    ],
  });

  it("говорит, сколько собрано и с чего начинаются числа", () => {
    render(<ItemQualityPanel view={thinView()} />);

    expect(screen.getByText(termOrText("Данных пока мало: собрано 18 прохождений"))).toBeTruthy();
    expect(screen.getByText(termOrText(/Дискриминативность считается с 30 наблюдений на вопрос, надёжность теста — с 30 прохождений\. Трудность показывается с 10 наблюдений\./))).toBeTruthy();
  });

  it("плиток нет: считать их не из чего", () => {
    render(<ItemQualityPanel view={thinView()} />);
    expect(screen.queryByText(termOrText("Надёжность (альфа)"))).toBeNull();
    expect(screen.queryByText(termOrText("Ошибка измерения"))).toBeNull();
  });

  it("колонка «Что не так» становится «Состояние» и говорит, сколько добрать", () => {
    render(<ItemQualityPanel view={thinView()} />);

    expect(screen.getByText(termOrText("Состояние"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Что не так"))).toBeNull();
    expect(screen.getByText(termOrText("Нужно ещё 12 наблюдений"))).toBeTruthy();
    expect(screen.getByText(termOrText("Нужно ещё 19 наблюдений"))).toBeTruthy();
    expect(screen.getByText(termOrText(/2 вопроса · накопление наблюдений/))).toBeTruthy();
  });

  it("с тридцати участников — обычная вкладка", () => {
    render(<ItemQualityPanel view={view({ sample: { ...THIN_SAMPLE, respondents: 30 } })} />);

    expect(screen.queryByText(termOrText(/Данных пока мало/))).toBeNull();
    expect(screen.getByText(termOrText("Надёжность (альфа)"))).toBeTruthy();
    expect(screen.getByText(termOrText("Что не так"))).toBeTruthy();
  });
});

/**
 * PRD-66 FR-20: при случайной выдаче надёжность — оценка по связям заданий; альфа по общему
 * ядру — рядом, когда оно есть. Способ расчёта назван прямо: оценка — не альфа полного набора.
 */
describe("ItemQualityPanel — надёжность при неоднородной выдаче (FR-20)", () => {
  it("оценка по связям заданий подписана как оценка, с длиной варианта", () => {
    render(<ItemQualityPanel view={view({
      reliability: { alpha: 0.78, items: 20, respondents: 486, totalSd: 3.1, dichotomous: true, method: "pairwise", pairs: 1200 },
    })} />);

    expect(screen.getByText(termOrText("0,78"))).toBeTruthy();
    expect(screen.getByText(termOrText(/оценка по связям вопросов · вариант из 20 вопросов/))).toBeTruthy();
    // Заголовок не должен противоречить подписи: это оценка, а не альфа полного набора.
    expect(screen.getByText(termOrText("Надёжность (оценка)"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Надёжность (альфа)"))).toBeNull();
  });

  it("интервал у порога при оценке считает участников по варианту, а не по полному набору", () => {
    render(<ItemQualityPanel view={view({
      reliability: { alpha: 0.89, items: 8, respondents: 300, totalSd: 3.1, dichotomous: true, method: "pairwise", pairs: 190 },
      cutBand: { low: 3.84, high: 7.36, z: 1.96, withinBand: 129 },
    })} />);

    // Доля — от участников с вариантом той же длины (300), а не от всей выборки.
    expect(screen.getByText(termOrText(/Внутри интервала 129 участников \(43 %\)\./))).toBeTruthy();
    expect(screen.queryByText(termOrText(/с полным набором/))).toBeNull();
  });

  it("альфа по ядру стоит рядом с оценкой", () => {
    render(<ItemQualityPanel view={view({
      reliability: { alpha: 0.78, items: 20, respondents: 486, totalSd: 3.1, dichotomous: true, method: "pairwise", pairs: 1200 },
      coreReliability: { alpha: 0.71, items: 6, respondents: 486, totalSd: 1.2, dichotomous: true, method: "core" },
    })} />);

    expect(screen.getByText(termOrText(/по общему ядру из 6 вопросов — 0,71/))).toBeTruthy();
  });

  it("основной альфой по ядру подписана и она", () => {
    render(<ItemQualityPanel view={view({
      reliability: { alpha: 0.71, items: 6, respondents: 486, totalSd: 1.2, dichotomous: true, method: "core" },
    })} />);

    expect(screen.getByText(termOrText(/по общему ядру · 6 вопросов/))).toBeTruthy();
  });

  it("без пересечений — причина словами", () => {
    render(<ItemQualityPanel view={view({ reliability: "random-delivery", sem: null })} />);
    expect(screen.getByText(termOrText(/неприменимо к случайной выдаче/))).toBeTruthy();
  });
});

/** PRD-66 FR-16a: заголовок называет симптом, а догадка о причине — в числах под ним. */
describe("ItemQualityPanel — отрицательная дискриминативность (FR-16a)", () => {
  it("под «Сильные ошибаются чаще» — «вероятна ошибка в ключе»", () => {
    render(<ItemQualityPanel view={view({
      items: [row({
        questionId: "q1", itemRest: -0.21, discrimination: -0.14,
        flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false },
      })],
    })} />);

    expect(screen.getByText(termOrText("Сильные ошибаются чаще"))).toBeTruthy();
    // Формулировка — дословно из спеки: причина-догадка и числа, на которых она стоит.
    expect(screen.getByText(termOrText(/^вероятна ошибка в ключе: r = .?0,21, D = .?0,14$/))).toBeTruthy();
  });
});

/** Флаги без признаков — основа, поверх которой тест включает нужный. */
const NO_FLAGS = { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false, weakDiscrimination: false };

/**
 * Решение владельца 2026-09-25: `0 ≤ r < 0,20` на достаточной выборке — признак «Сильные и
 * слабые отвечают одинаково». Имя — симптом (FR-16a), числа — подписью, как в эскизе
 * prd66-item-quality (состояние wf-quality). Ранг — сразу за эвристиками PRD-56.
 */
describe("ItemQualityPanel — «Сильные и слабые отвечают одинаково»", () => {
  const WEAK = { ...NO_FLAGS, weakDiscrimination: true };

  it("ставит ярлык-симптом с числами r и D под ним", () => {
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", itemRest: 0.11, discrimination: 0.08, flags: WEAK })],
    })} />);

    expect(screen.getByText(termOrText("Сильные и слабые отвечают одинаково"))).toBeTruthy();
    expect(screen.getByText(termOrText("r = 0,11, D = 0,08"))).toBeTruthy();
  });

  it("без индекса крайних групп подпись называет только r, без прочерка", () => {
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", itemRest: 0.11, discrimination: null, flags: WEAK })],
    })} />);

    expect(screen.getByText(termOrText("r = 0,11"))).toBeTruthy();
  });

  it("порядок FR-48: дефекты, эвристика, слабая дискриминативность, время и трудность", () => {
    const HEURISTIC = { kinds: ["hard-and-frequent"], exposurePercent: 82, correctPercent: 41, latencyMedianMs: 30_000 };
    render(<ItemQualityPanel
      view={view({ items: [
        row({ questionId: "slow", prompt: "Вопрос тормозит", timingFlags: { rushed: false, slow: true } }),
        row({ questionId: "easy", prompt: "Вопрос лёгкий", flags: { ...NO_FLAGS, tooEasy: true } }),
        row({ questionId: "hard", prompt: "Вопрос трудный", flags: { ...NO_FLAGS, tooHard: true } }),
        row({ questionId: "rushed", prompt: "Вопрос не читают", timingFlags: { rushed: true, slow: false } }),
        row({ questionId: "weak", prompt: "Вопрос одинаково", itemRest: 0.11, flags: WEAK }),
        row({ questionId: "heur", prompt: "Вопрос эвристика" }),
        row({ questionId: "chance", prompt: "Вопрос угадывание", flags: { ...NO_FLAGS, atChanceLevel: true } }),
        row({ questionId: "neg", prompt: "Вопрос ключ", itemRest: -0.2, flags: { ...NO_FLAGS, negativeDiscrimination: true } }),
      ] })}
      heuristics={{ heur: HEURISTIC }}
    />);

    expect(screen.getAllByText(termOrText(/^Вопрос /)).map(el => el.textContent)).toEqual([
      "Вопрос ключ", "Вопрос угадывание", "Вопрос эвристика", "Вопрос одинаково",
      "Вопрос не читают", "Вопрос трудный", "Вопрос лёгкий", "Вопрос тормозит",
    ]);
  });

  it("внутри ранга — от r ближе к нулю", () => {
    render(<ItemQualityPanel view={view({ items: [
      row({ questionId: "a", prompt: "Вопрос 0,18", itemRest: 0.18, flags: WEAK }),
      row({ questionId: "b", prompt: "Вопрос 0,02", itemRest: 0.02, flags: WEAK }),
    ] })} />);

    expect(screen.getAllByText(termOrText(/^Вопрос /)).map(el => el.textContent)).toEqual(["Вопрос 0,02", "Вопрос 0,18"]);
  });

  it("плитка, счётчик переключателя и отбор «Под подозрением» считают его одинаково", async () => {
    render(<ItemQualityPanel view={view({ items: [
      row({ questionId: "q1", prompt: "Вопрос спокойный" }),
      row({ questionId: "q2", prompt: "Вопрос одинаково", itemRest: 0.11, flags: WEAK }),
    ] })} />);

    const tile = screen.getAllByText(termOrText("Под подозрением"))
      .map((el) => el.closest(".ou-card"))
      .find((card): card is HTMLElement => !!card && !card.querySelector("table")) as HTMLElement;
    expect(within(tile).getByText(termOrText("1"))).toBeTruthy();

    const segment = screen.getByRole("button", { name: /Под подозрением/ });
    expect(segment.textContent).toContain("1");

    await userEvent.click(segment);
    expect(screen.getAllByText(termOrText(/^Вопрос /)).map(el => el.textContent)).toEqual(["Вопрос одинаково"]);
  });

  it("на ориентировочной выборке оговорка идёт в подпись: признак стоит на коэффициенте", () => {
    render(<ItemQualityPanel view={view({ items: [
      row({ questionId: "q1", observations: 44, coefficientConfidence: "tentative", itemRest: 0.11, discrimination: 0.08, flags: WEAK }),
    ] })} />);

    expect(screen.getByText(termOrText(/r = 0,11, D = 0,08 · ориентировочно, 44 наблюдения/))).toBeTruthy();
  });
});

/**
 * Найти подсказку термина (FR-14b): текст из эскиза стоит в пузырьке, а пузырёк — у триггера с
 * самим термином и значком. Триггер доступен с клавиатуры.
 */
function expectHint(term: string, hint: string): void {
  const trigger = screen.getAllByText(termOrText(hint))
    .map(bubble => bubble.closest(".tb-term-hint") as HTMLElement | null)
    .find(el => !!el && within(el).queryByText(termOrText(term)) !== null);
  expect(trigger, `подсказка у «${term}»`).toBeTruthy();
  // Значок — lucide `Info` в одном неразрывном блоке с последним словом (см. term-hint.tsx).
  expect(trigger!.querySelector(".tb-term-hint__term")).toBeTruthy();
  expect(trigger!.getAttribute("tabindex")).toBe("0");
}

describe("ItemQualityPanel — подсказки терминов (FR-14b)", () => {
  it("у каждого заголовка и каждой плитки — толкование дословно из эскиза", () => {
    render(<ItemQualityPanel view={view()} />);

    expectHint("Что не так", "Что не так с вопросом — по числам этой же строки; пусто, если по ним всё в порядке. Сортировка — по силе подозрения, от прямых дефектов к спокойным вопросам.");
    expectHint("Трудность", "Средняя доля набранного балла: 0 — не решил никто, 1 — решили все. Приемлемо 0,20 — 0,80; выше 0,90 вопрос ничего не отсеивает.");
    expectHint("Дискриминативность", "Отделяет ли вопрос сильных от слабых: корреляция балла за него с баллом за остальные вопросы формы. Хорошо от 0,30, отрицательная — почти всегда ошибка в ключе.");
    expectHint("n", "Сколько участников выборки видели этот вопрос. Коэффициенты считаются с 30 наблюдений, надёжными становятся со 100.");
    expectHint("Надёжность (альфа)", "Насколько согласованно вопросы теста меряют одно и то же. От 0,70 — приемлемо, от 0,80 — хорошо; ниже итоговый балл заметно зависит от случая.");
    expectHint("Ошибка измерения", "На сколько процентных пунктов балл участника может отклониться от его истинного уровня. Интервал вокруг балла — ±1,96 ошибки: в нём с вероятностью 95 % лежит истинный уровень.");
    expectHint("Под подозрением", "Сколько вопросов получили отметку в колонке «Что не так». Их стоит проверить первыми.");
    expectHint("Вопросов с надёжной оценкой", "Сколько вопросов набрали 100 наблюдений и больше: их коэффициенты устойчивы. У остальных числа ориентировочные или ещё не считаются.");
  });

  it("при малой выборке у «Состояния» своё толкование", () => {
    render(<ItemQualityPanel view={view({
      sample: { respondents: 18, responses: 180, bySource: { web: 18 }, unknownVersionShare: 0 },
      items: [row({ questionId: "q1", observations: 18, coefficientConfidence: "insufficient" })],
    })} />);

    expectHint("Состояние", "Сколько наблюдений собрано и сколько ещё нужно: коэффициенты вопроса считаются с 30 наблюдений. До порога признака у вопроса нет — не потому, что он здоров.");
  });

  it("заголовки числовых колонок стоят по центру — как и их значения (правило 2026-10-03)", () => {
    render(<ItemQualityPanel view={view()} />);

    for (const term of ["Трудность", "Дискриминативность", "n"]) {
      const header = screen.getAllByText(termOrText(term)).find(el => el.closest(".ou-grid__th"))!;
      expect(header.closest(".ou-grid__th--center"), term).toBeTruthy();
    }
    // Колонка тегов — тоже по центру; текстовая колонка вопроса — по левому краю.
    const flagHeader = screen.getAllByText(termOrText("Что не так")).find(el => el.closest(".ou-grid__th"))!;
    expect(flagHeader.closest(".ou-grid__th--center")).toBeTruthy();
    const questionHeader = screen.getAllByText("Вопрос").find(el => el.closest(".ou-grid__th"))!;
    expect(questionHeader.closest(".ou-grid__th--center")).toBeNull();
  });
});

describe("ItemQualityPanel — таблица", () => {
  it("«мало данных» — приглушённым тоном, как в эскизе", () => {
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", observations: 12, coefficientConfidence: "insufficient" })],
    })} />);

    expect(screen.getByText(termOrText("мало данных")).className).toContain("ou-text--tone-muted");
  });

  it("подвала «Показано N из M» нет: список приходит целиком", () => {
    render(<ItemQualityPanel view={view({ items: [row({ questionId: "q1" }), row({ questionId: "q2" })] })} />);

    expect(screen.queryByText(termOrText(/Показано/))).toBeNull();
    expect(document.querySelector(".ou-grid__footer")).toBeNull();
  });

  it("раскладка фиксированная: таблица помечена и колонок шесть, с меню", () => {
    render(<ItemQualityPanel view={view()} />);

    expect(document.querySelector(".ou-grid.tb-psy-grid")).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
  });
});

/**
 * Действия строки — меню «⋯» (эскиз prd66-item-quality, состояние wf-quality), а не щелчок по
 * строке: у вопроса несколько действий, и щелчок обещал бы одно.
 */
describe("ItemQualityPanel — меню строки", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ topicName: "Право и комплаенс", remaining: 11, drawCount: 10, allowed: true }),
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  const one = () => view({ items: [row({ questionId: "q1", prompt: "Вопрос про ключ" })] });
  const openMenu = () => userEvent.click(screen.getByRole("button", { name: "Действия с вопросом: Вопрос про ключ" }));

  it("щелчок по строке никуда не ведёт — строка не кликабельная", async () => {
    const onOpenItem = vi.fn();
    render(<ItemQualityPanel view={one()} onOpenItem={onOpenItem} />);

    await userEvent.click(screen.getByText(termOrText("Вопрос про ключ")));
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(document.querySelector("tr.is-clickable")).toBeNull();
  });

  it("пункты — как в эскизе: разбор, переход в тему, исключение", async () => {
    render(<ItemQualityPanel view={one()} testId="t1" onOpenItem={vi.fn()} onDeliveryChange={vi.fn()} />);
    await openMenu();

    expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual([
      "Разбор вопроса", "Открыть вопрос в теме", "Исключить из выдачи…",
    ]);
  });

  it("«Разбор вопроса» открывает разбор", async () => {
    const onOpenItem = vi.fn();
    render(<ItemQualityPanel view={one()} onOpenItem={onOpenItem} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Разбор вопроса: Вопрос про ключ" }));

    // Э3.3: вместе с вопросом уходит порядок таблицы — для «Предыдущий / Следующий».
    expect(onOpenItem).toHaveBeenCalledWith("q1", ["q1"]);
  });

  it("«Открыть вопрос в теме» ведёт в раздел «Темы и вопросы» на этот вопрос", async () => {
    render(<ItemQualityPanel view={one()} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Открыть вопрос в теме: Вопрос про ключ" }));

    expect(window.location.pathname).toBe("/author/content");
    expect(window.location.search).toBe("?questionId=q1");
  });

  it("исключение — через то же окно подтверждения, что на вкладке «Вопросы»", async () => {
    const onDeliveryChange = vi.fn();
    render(<ItemQualityPanel view={one()} testId="t1" onDeliveryChange={onDeliveryChange} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Исключить из выдачи: Вопрос про ключ" }));

    expect(await screen.findByText(termOrText(/останется 11/i))).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/analytics/tests/t1/questions/q1/delivery-impact", expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Исключить из выдачи" }));

    expect(onDeliveryChange).toHaveBeenCalledWith("q1", true);
  });

  it("исключённый вопрос возвращается в выдачу без подтверждения", async () => {
    const onDeliveryChange = vi.fn();
    render(<ItemQualityPanel view={one()} onDeliveryChange={onDeliveryChange} excluded={{ q1: true }} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Вернуть в выдачу: Вопрос про ключ" }));

    expect(onDeliveryChange).toHaveBeenCalledWith("q1", false);
  });

  it("без обработчика выдачи пунктов выдачи нет", async () => {
    render(<ItemQualityPanel view={one()} />);
    await openMenu();

    expect(screen.queryByRole("menuitem", { name: /из выдачи|в выдачу/ })).toBeNull();
  });

  it("пока данных мало, колонки меню нет — как в эскизе wf-quality-thin", () => {
    render(<ItemQualityPanel view={view({
      sample: { respondents: 18, responses: 180, bySource: { web: 18 }, unknownVersionShare: 0 },
      items: [row({ questionId: "q1", prompt: "Вопрос про ключ", observations: 18, coefficientConfidence: "insufficient" })],
    })} />);

    expect(screen.queryByRole("button", { name: /Действия с вопросом/ })).toBeNull();
  });
});

/**
 * Вопросы пула, которых выборка не видела (решение владельца 2026-09-26; эскиз prd66-item-quality,
 * состояние quality-thin: «Вопрос ещё не выдавался»).
 */
describe("ItemQualityPanel — вопрос ещё не выдавался", () => {
  const NEVER = {
    observations: 0, difficulty: null, correctedDifficulty: null, itemRest: null, discrimination: null,
    difficultyConfidence: "insufficient" as const, coefficientConfidence: "insufficient" as const,
    neverDelivered: true,
  };
  const HARD = { tooHard: true, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false };
  const items = [
    row({ questionId: "z", prompt: "Вопрос Я", ...NEVER }),
    row({ questionId: "a", prompt: "Вопрос А", difficulty: 0.9, observations: 300 }),
    row({ questionId: "b", prompt: "Вопрос Б", difficulty: 0.1, observations: 120, flags: HARD }),
    row({ questionId: "d", prompt: "Вопрос Г", difficulty: null, observations: 5, itemRest: null, coefficientConfidence: "insufficient" }),
  ];
  const order = () => screen.getAllByText(termOrText(/^Вопрос [А-Я]$/)).map((el) => el.textContent);
  const clickHeader = async (title: string) => {
    const header = screen.getAllByText(termOrText(title)).find((el) => el.closest(".ou-grid__th")) as HTMLElement;
    await userEvent.click(header);
  };
  const rowOf = (prompt: string) => screen.getByText(termOrText(prompt)).closest("tr") as HTMLElement;

  it("строка говорит «Вопрос ещё не выдавался», числа — «нет наблюдений», n = 0", () => {
    render(<ItemQualityPanel view={view({ items })} />);
    const tr = rowOf("Вопрос Я");

    expect(within(tr).getByText(termOrText("Вопрос ещё не выдавался"))).toBeTruthy();
    expect(within(tr).getAllByText(termOrText("нет наблюдений"))).toHaveLength(2);
    expect(within(tr).getByText(termOrText("0"))).toBeTruthy();
    expect(within(tr).queryByText(termOrText("Мало данных"))).toBeNull();
  });

  it("стоит в конце при любой колонке и направлении сортировки", async () => {
    render(<ItemQualityPanel view={view({ items })} />);
    expect(order().at(-1)).toBe("Вопрос Я");

    for (const column of ["Вопрос", "Что не так", "Трудность", "Дискриминативность", "n"]) {
      await clickHeader(column);
      expect(order().at(-1), `${column}, первое нажатие`).toBe("Вопрос Я");
      await clickHeader(column);
      expect(order().at(-1), `${column}, второе нажатие`).toBe("Вопрос Я");
    }
  });

  it("считается в «Мало данных» и «Все», но не в «Под подозрением»", async () => {
    render(<ItemQualityPanel view={view({ items })} />);

    expect(screen.getByRole("button", { name: /Мало данных/ }).textContent).toContain("2");
    expect(screen.getByRole("button", { name: /Под подозрением/ }).textContent).toContain("1");
    // Подзаголовок и плитка считают пул целиком — вместе с невыданными (эскиз: «42 вопроса»).
    expect(screen.getByText(termOrText(/^4 вопроса · отсортированы по силе подозрения$/))).toBeTruthy();
    expect(screen.getByText(termOrText("из 4 вопросов"))).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Мало данных/ }));
    expect(order()).toEqual(["Вопрос Г", "Вопрос Я"]);

    await userEvent.click(screen.getByRole("button", { name: /Под подозрением/ }));
    expect(order()).toEqual(["Вопрос Б"]);
  });

  it("в состоянии «данных мало» колонка «Состояние» говорит то же", () => {
    render(<ItemQualityPanel view={view({
      sample: { respondents: 18, responses: 180, bySource: { web: 18 }, unknownVersionShare: 0 },
      reliability: "too-few-respondents",
      items: [
        row({ questionId: "q1", prompt: "Вопрос 1", observations: 11, coefficientConfidence: "insufficient" }),
        row({ questionId: "q2", prompt: "Вопрос 2", ...NEVER }),
      ],
    })} />);

    expect(screen.getByText(termOrText("Нужно ещё 19 наблюдений"))).toBeTruthy();
    expect(within(rowOf("Вопрос 2")).getByText(termOrText("Вопрос ещё не выдавался"))).toBeTruthy();
    expect(screen.queryByText(termOrText("Нужно ещё 30 наблюдений"))).toBeNull();
  });

  it("меню: «Открыть вопрос в теме» и исключение есть, «Разбор вопроса» — нет", async () => {
    render(<ItemQualityPanel
      view={view({ items: [row({ questionId: "z", prompt: "Вопрос Я", ...NEVER })] })}
      testId="t1"
      onOpenItem={vi.fn()}
      onDeliveryChange={vi.fn()}
    />);
    await userEvent.click(screen.getByRole("button", { name: "Действия с вопросом: Вопрос Я" }));

    expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual([
      "Открыть вопрос в теме", "Исключить из выдачи…",
    ]);
  });
});

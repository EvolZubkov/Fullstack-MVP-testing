/**
 * @module tests/assemble-delivery
 *
 * PRD-30 раздел 14: the delivery stream is assembled ONCE, here. The test owns
 * the default (`tests.question_order`), a topic may override it
 * (`test_sections.question_order`, NULL = «как в тесте»), and the flat flow adds
 * a third test-level value — `shuffle_all` — which merges the questions of all
 * topics into one stream while a topic left on `fixed` travels as one unbroken
 * block (FR-19/FR-20).
 *
 * `shuffle` is injected as a REVERSE so every assertion can name the exact
 * expected sequence: a list that comes back reversed went through the shuffle, a
 * list in author order did not.
 */
import { describe, it, expect } from "vitest";
import {
  applyDeliveryOrder,
  assembleDelivery,
  effectiveSectionOrder,
  type DeliverySection,
} from "../shared/draw/assemble-delivery";

type Q = { id: string; orderIndex?: number | null };

const reverseShuffle = <T,>(arr: T[]): T[] => arr.slice().reverse();

const q = (id: string, orderIndex?: number | null): Q => ({ id, orderIndex });

const topic = (prefix: string, count: number, questionOrder?: "random" | "fixed" | null): DeliverySection<Q> => ({
  questionOrder: questionOrder ?? null,
  questions: Array.from({ length: count }, (_, i) => q(`${prefix}${i + 1}`, (i + 1) * 10)),
});

const ids = (questions: Q[]) => questions.map((question) => question.id);

describe("effectiveSectionOrder — наследование и переопределение (FR-18)", () => {
  it("тема без своего значения берёт значение теста", () => {
    expect(effectiveSectionOrder("fixed", null)).toBe("fixed");
    expect(effectiveSectionOrder("random", null)).toBe("random");
  });

  it("при «полном перемешивании» унаследованный режим темы — случайный", () => {
    // Вопросы такой темы уходят в общий поток поштучно, и порядок внутри неё
    // ничего не решает; «фиксированным» его называть было бы неправдой.
    expect(effectiveSectionOrder("shuffle_all", null)).toBe("random");
  });

  it("значение темы перекрывает значение теста в обе стороны", () => {
    expect(effectiveSectionOrder("random", "fixed")).toBe("fixed");
    expect(effectiveSectionOrder("fixed", "random")).toBe("random");
    expect(effectiveSectionOrder("shuffle_all", "fixed")).toBe("fixed");
  });

  it("тест без значения (легаси-строка) читается как «перемешивание»", () => {
    expect(effectiveSectionOrder(null, null)).toBe("random");
    expect(effectiveSectionOrder(undefined, undefined)).toBe("random");
  });
});

describe("assembleDelivery — темы блоками (FR-16)", () => {
  it("«фиксированный порядок»: темы в порядке списка, вопросы по индексу", () => {
    const result = assembleDelivery([topic("a", 3), topic("b", 2)], "fixed", "linear_flat", reverseShuffle);

    expect(ids(result.flat)).toEqual(["a1", "a2", "a3", "b1", "b2"]);
    expect(result.sections.map(ids)).toEqual([["a1", "a2", "a3"], ["b1", "b2"]]);
  });

  it("«перемешивание»: вопросы перемешаны внутри темы, темы остаются блоками", () => {
    const result = assembleDelivery([topic("a", 3), topic("b", 2)], "random", "linear_flat", reverseShuffle);

    expect(ids(result.flat)).toEqual(["a3", "a2", "a1", "b2", "b1"]);
  });

  it("тема переопределяет тест, соседние темы это не задевает", () => {
    const result = assembleDelivery(
      [topic("a", 3, "fixed"), topic("b", 2)],
      "random",
      "linear_flat",
      reverseShuffle,
    );

    expect(ids(result.flat)).toEqual(["a1", "a2", "a3", "b2", "b1"]);
  });
});

describe("assembleDelivery — полное перемешивание (FR-19/FR-20)", () => {
  it("вопросы тем идут одним потоком", () => {
    const result = assembleDelivery([topic("a", 2), topic("b", 2)], "shuffle_all", "linear_flat", reverseShuffle);

    // Единицы потока — отдельные вопросы: a1 a2 b1 b2 -> развёрнуто наоборот.
    expect(ids(result.flat)).toEqual(["b2", "b1", "a2", "a1"]);
  });

  it("тема с фиксированным порядком вклинивается неразрывным блоком", () => {
    const result = assembleDelivery(
      [topic("a", 3, "fixed"), topic("b", 2)],
      "shuffle_all",
      "linear_flat",
      reverseShuffle,
    );

    // Единицы: [блок a1 a2 a3], b1, b2 -> перестановка меняет местами ЕДИНИЦЫ,
    // блок внутри не трогается и не разрывается.
    expect(ids(result.flat)).toEqual(["b2", "b1", "a1", "a2", "a3"]);
  });

  it("состав темы не меняется — переставляется только порядок выдачи (FR-06)", () => {
    const result = assembleDelivery(
      [topic("a", 3, "fixed"), topic("b", 2)],
      "shuffle_all",
      "linear_flat",
      reverseShuffle,
    );

    expect(result.sections.map((s) => ids(s).slice().sort())).toEqual([["a1", "a2", "a3"], ["b1", "b2"]]);
    expect(ids(result.flat).slice().sort()).toEqual(["a1", "a2", "a3", "b1", "b2"]);
  });

  it("все темы фиксированы: перемешивается порядок блоков, внутри блока — авторский", () => {
    const result = assembleDelivery(
      [topic("a", 2, "fixed"), topic("b", 2, "fixed")],
      "shuffle_all",
      "linear_flat",
      reverseShuffle,
    );

    expect(ids(result.flat)).toEqual(["b1", "b2", "a1", "a2"]);
  });

  it("одна тема: значение вырождается в перемешивание этой темы", () => {
    const result = assembleDelivery([topic("a", 3)], "shuffle_all", "linear_flat", reverseShuffle);

    expect(ids(result.flat)).toEqual(["a3", "a2", "a1"]);
  });
});

describe("assembleDelivery — режимы с разбивкой по темам (FR-17)", () => {
  it.each(["linear_by_topics", "router_by_topics"])(
    "%s гасит «полное перемешивание» до «перемешивания»",
    (flowMode) => {
      const result = assembleDelivery([topic("a", 2), topic("b", 2)], "shuffle_all", flowMode, reverseShuffle);

      // Границу темы держат экраны раздела — вопросы поперёк неё не смешиваются.
      expect(ids(result.flat)).toEqual(["a2", "a1", "b2", "b1"]);
    },
  );

  it("переопределение темы в секционном режиме продолжает работать", () => {
    const result = assembleDelivery(
      [topic("a", 3, "fixed"), topic("b", 2)],
      "shuffle_all",
      "linear_by_topics",
      reverseShuffle,
    );

    expect(ids(result.flat)).toEqual(["a1", "a2", "a3", "b2", "b1"]);
  });
});

describe("assembleDelivery — режим вариантов (FR-07)", () => {
  // selectForm уже поставил вопросы в порядок выдачи: список варианта при
  // `fixed`, его перестановка иначе. Индекс вопроса такую тему не трогает.
  const variantTopic = (order: "random" | "fixed" | null): DeliverySection<Q> => ({
    questionOrder: order,
    preordered: true,
    questions: [q("v3", 30), q("v1", 10), q("v2", 20)],
  });

  it("порядок списка варианта не пересортировывается по индексу", () => {
    const result = assembleDelivery([variantTopic("fixed")], "fixed", "linear_flat", reverseShuffle);

    expect(ids(result.flat)).toEqual(["v3", "v1", "v2"]);
  });

  it("в общем потоке фиксированный вариант остаётся блоком в своём порядке", () => {
    const result = assembleDelivery(
      [variantTopic("fixed"), topic("b", 2)],
      "shuffle_all",
      "linear_flat",
      reverseShuffle,
    );

    expect(ids(result.flat)).toEqual(["b2", "b1", "v3", "v1", "v2"]);
  });

  it("вариант со случайным порядком уходит в общий поток поштучно", () => {
    const result = assembleDelivery([variantTopic("random")], "shuffle_all", "linear_flat", reverseShuffle);

    expect(ids(result.flat)).toEqual(["v2", "v1", "v3"]);
  });
});

describe("applyDeliveryOrder — чтение сохранённого потока (FR-19)", () => {
  const items = [q("a"), q("b"), q("c")];
  const id = (item: Q) => item.id;

  it("ставит вопросы в сохранённый порядок", () => {
    expect(ids(applyDeliveryOrder(items, ["c", "a", "b"], id))).toEqual(["c", "a", "b"]);
  });

  it("без сохранённого порядка отдаёт вход как есть", () => {
    expect(ids(applyDeliveryOrder(items, undefined, id))).toEqual(["a", "b", "c"]);
    expect(ids(applyDeliveryOrder(items, [], id))).toEqual(["a", "b", "c"]);
  });

  it("не теряет вопрос, которого нет в сохранённом порядке", () => {
    expect(ids(applyDeliveryOrder(items, ["c", "a"], id))).toEqual(["c", "a", "b"]);
  });

  it("игнорирует идентификаторы, которых нет в попытке", () => {
    expect(ids(applyDeliveryOrder(items, ["x", "c", "b", "a"], id))).toEqual(["c", "b", "a"]);
  });

  it("вход не мутируется", () => {
    applyDeliveryOrder(items, ["c", "b", "a"], id);
    expect(ids(items)).toEqual(["a", "b", "c"]);
  });
});

describe("assembleDelivery — краевые случаи", () => {
  it("тест без тем даёт пустой поток", () => {
    // `mixed` — свойство настроек, а не выборки: пустой тест с «полным
    // перемешиванием» всё равно объявляет, что поток собирается поперёк тем.
    expect(assembleDelivery([], "shuffle_all", "linear_flat", reverseShuffle)).toEqual({
      sections: [],
      flat: [],
      mixed: true,
    });
  });

  it("пустая тема не ломает поток и остаётся пустой секцией", () => {
    const result = assembleDelivery(
      [{ questionOrder: null, questions: [] }, topic("b", 2)],
      "shuffle_all",
      "linear_flat",
      reverseShuffle,
    );

    expect(result.sections.map(ids)).toEqual([[], ["b2", "b1"]]);
    expect(ids(result.flat)).toEqual(["b2", "b1"]);
  });

  it("вопросы без индекса идут последними и в фиксированной теме (FR-04)", () => {
    const result = assembleDelivery(
      [{ questionOrder: "fixed", questions: [q("a", 10), q("b", null), q("c", 30)] }],
      "random",
      "linear_flat",
      reverseShuffle,
    );

    expect(ids(result.flat)).toEqual(["a", "c", "b"]);
  });

  it("вход не мутируется", () => {
    const sections = [topic("a", 3, "fixed"), topic("b", 2)];
    const before = sections.map((s) => ids(s.questions));

    assembleDelivery(sections, "shuffle_all", "linear_flat", reverseShuffle);

    expect(sections.map((s) => ids(s.questions))).toEqual(before);
  });
});

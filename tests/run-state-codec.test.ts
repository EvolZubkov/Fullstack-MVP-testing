/**
 * @module tests/run-state-codec
 * @description PRD-36 §4.6, FR-20: ряды состояния кодируются строкой, элемент адресуется
 * позицией. Декодирование обязано быть обратным кодированию без потерь — иначе после
 * продолжения прогона ученик увидит чужие ответы. FR-23: испорченный ряд считается
 * отсутствующим и не роняет разбор остального состояния.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const TBRunState = new Function(`${src}\nreturn TBRunState;`)() as any;

const Q = (type: string) => ({ type });

describe("кодек выдачи", () => {
  it("выдача кодируется парой «раздел.вопрос» и разворачивается обратно", () => {
    const delivery = [{ s: 0, q: 0 }, { s: 0, q: 3 }, { s: 1, q: 41 }];
    const encoded = TBRunState.encodeDelivery(delivery);
    expect(encoded).toBe("0.0,0.3,1.15");
    expect(TBRunState.decodeDelivery(encoded)).toEqual(delivery);
  });

  it("пустая выдача кодируется пустой строкой", () => {
    expect(TBRunState.encodeDelivery([])).toBe("");
    expect(TBRunState.decodeDelivery("")).toEqual([]);
  });
});

describe("кодек ответов", () => {
  const types = [Q("single"), Q("multiple"), Q("ranking"), Q("matching"), Q("allocation"), Q("single")];
  const answers = [2, [0, 3], [2, 0, 3, 1], { 0: 1, 1: 0 }, { 0: 5, 1: 10 }, undefined];

  it("каждый тип ответа переживает круг кодирования", () => {
    const encoded = TBRunState.encodeAnswers(answers, types);
    expect(TBRunState.decodeAnswers(encoded, types)).toEqual([
      2, [0, 3], [2, 0, 3, 1], { 0: 1, 1: 0 }, { 0: 5, 1: 10 }, undefined,
    ]);
  });

  it("распределение баллов не теряет значения больше 35", () => {
    const encoded = TBRunState.encodeAnswers([{ 0: 40, 1: 60 }], [Q("allocation")]);
    expect(TBRunState.decodeAnswers(encoded, [Q("allocation")])).toEqual([{ 0: 40, 1: 60 }]);
  });

  it("шкальный вопрос кодируется как единичный выбор", () => {
    const encoded = TBRunState.encodeAnswers([4], [Q("scale")]);
    expect(TBRunState.decodeAnswers(encoded, [Q("scale")])).toEqual([4]);
  });
});

describe("кодек статусов и перемешивания", () => {
  it("статусы кодируются одним символом на вопрос", () => {
    const statuses = ["answered", "skipped", "unanswered"];
    expect(TBRunState.encodeStatuses(statuses)).toBe("asu");
    expect(TBRunState.decodeStatuses("asu")).toEqual(statuses);
  });

  it("карта перемешивания переживает круг", () => {
    const maps = [[2, 0, 3, 1], null, [1, 0]];
    const encoded = TBRunState.encodeShuffle(maps);
    expect(TBRunState.decodeShuffle(encoded)).toEqual(maps);
  });

  it("сопоставление перемешивает две колонки, и обе переживают круг", () => {
    // Найдено браузерной приёмкой: у вопроса на сопоставление перемешивание — не
    // перестановка, а ПАРА перестановок, и кодек, знавший только массивы, терял её молча —
    // карточки после перерыва вставали в авторском порядке (тот самый дефект §8).
    const maps = [{ left: [1, 2, 0], right: [0, 2, 1] }, [3, 0, 1, 2], null];
    const encoded = TBRunState.encodeShuffle(maps);
    expect(TBRunState.decodeShuffle(encoded)).toEqual(maps);
  });

  it("ячейка без разделителя читается как обычная перестановка", () => {
    // Пакеты тестов без сопоставления не должны потяжелеть ни на байт и ни на символ.
    expect(TBRunState.encodeShuffle([[1, 0]])).toBe("10");
  });
});

describe("порча ряда (FR-23)", () => {
  it("испорченная выдача читается как пустая, а не роняет разбор", () => {
    expect(TBRunState.decodeDelivery("0.0,мусор,1.2")).toEqual([{ s: 0, q: 0 }, { s: 1, q: 2 }]);
  });

  it("ответов меньше, чем вопросов — недостающие пусты, остальные на месте", () => {
    const types = [Q("single"), Q("single"), Q("single")];
    expect(TBRunState.decodeAnswers("1,2", types)).toEqual([1, 2, undefined]);
  });
});

describe("выдача пинится позициями при сборке варианта", () => {
  const appSrc = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");

  /** Pull one function out of the shipped runtime source by name. */
  const extract = (name: string): string => {
    const match = appSrc.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`${name} not found in assets/app.js`);
    return match[0];
  };

  const PORT = [
    "drawSection", "orderQuestions", "effectiveSectionOrder", "orderDeliverySection",
    // `tbDebugFullDraw` — отладочный признак полной выдачи банка (PRD-52): в проде он
    // инертен, но `generateVariant` его зовёт, и без него песочница падает на
    // ReferenceError раньше первой проверки.
    "assembleDelivery", "selectForm", "tbDebugForcedForms", "tbDebugFullDraw",
    // PRD-55: `generateVariant` отбирает задания взвешенно по запечённому весу экспозиции, и
    // без этой функции песочница падает на ReferenceError — по той же причине, что и
    // `tbDebugFullDraw` выше. Веса в фикстурах равны (поля `exposureWeight` нет), поэтому на
    // сам отбор она здесь не влияет.
    "weightedPick", "generateVariant",
  ].map(extract).join("\n");

  const question = (id: string) => ({ id, type: "single", tags: [] });

  /** Run the real generateVariant over a package shape and return the state it built. */
  function runVariant(TEST_DATA: any): any {
    const state: any = { answers: {}, flatQuestions: [], variant: null, shuffleMappings: {} };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "TEST_DATA", "state", "shuffle", "shuffleMappingFor", "console",
      `${PORT}\nreturn generateVariant;`,
    );
    factory(
      TEST_DATA,
      state,
      (arr: unknown[]) => arr, // deterministic: identity shuffle
      () => null,
      { log: () => undefined, warn: () => undefined },
    )();
    return state;
  }

  const TEST_DATA = {
    questionOrder: "fixed",
    flowPolicy: { mode: "linear_flat" },
    sections: [
      { topicId: "t1", topicName: "Первая", drawCount: 2, questions: [question("a1"), question("a2"), question("a3")] },
      { topicId: "t2", topicName: "Вторая", drawCount: 1, questions: [question("b1"), question("b2")] },
    ],
  };

  it("позиция каждого выданного вопроса указывает на него же в TEST_DATA", () => {
    const state = runVariant(TEST_DATA);
    expect(state.deliveryPositions).toHaveLength(state.flatQuestions.length);
    state.flatQuestions.forEach((fq: any, i: number) => {
      const pos = state.deliveryPositions[i];
      const addressed = TEST_DATA.sections[pos.s].questions[pos.q];
      // Адрес и содержимое обязаны сойтись: разъедутся — ученик увидит чужой вопрос.
      expect(addressed.id).toBe(fq.question.id);
    });
  });

  it("выданный вариант PRD-17 пинится по теме", () => {
    const withForms = {
      ...TEST_DATA,
      sections: [
        {
          topicId: "t1", topicName: "Первая", drawCount: 2,
          questions: [question("a1"), question("a2"), question("a3")],
          formSet: { forms: [{ id: "form-a", questionIds: ["a1", "a3"] }] },
        },
        TEST_DATA.sections[1],
      ],
    };
    const state = runVariant(withForms);
    expect(state.deliveredForms).toEqual({ t1: "form-a" });
  });

  it("тема без вариантов в карту выданных вариантов не попадает", () => {
    expect(runVariant(TEST_DATA).deliveredForms).toEqual({});
  });
});

describe("отпечаток состава", () => {
  const TEST_DATA = {
    sections: [{ questions: [{}, {}] }, { questions: [{}] }],
    breakdownKeys: ["a", "b"],
  };

  it("отпечаток собирается из состава пакета", () => {
    // Разделы, число вопросов в каждом, число ключей — и слепок состава банка: без него
    // замена вопроса адрес не меняет, а содержимое по этому адресу меняет.
    expect(TBRunState.fingerprint(TEST_DATA)).toMatch(/^2:2,1:2:[0-9a-z]+$/);
  });

  it("замена вопроса в банке меняет отпечаток", () => {
    // Позиция — это адрес, и он валиден, только пока по адресу лежит ТОТ ЖЕ вопрос.
    // Автор, заменивший вопрос, число вопросов не меняет: без учёта состава отпечаток
    // совпал бы, и отчёт по сохранённой попытке показал бы чужие вопросы.
    const before = { sections: [{ questions: [{ id: "a1" }, { id: "a2" }] }], breakdownKeys: [] };
    const after = { sections: [{ questions: [{ id: "a1" }, { id: "a9" }] }], breakdownKeys: [] };
    expect(TBRunState.fingerprint(after)).not.toBe(TBRunState.fingerprint(before));
    expect(TBRunState.sameFingerprint(TBRunState.fingerprint(before), after)).toBe(false);
  });

  it("перестановка вопросов внутри раздела меняет отпечаток", () => {
    // Тот же случай с другой стороны: состав прежний, а адреса разъехались.
    const before = { sections: [{ questions: [{ id: "a1" }, { id: "a2" }] }], breakdownKeys: [] };
    const after = { sections: [{ questions: [{ id: "a2" }, { id: "a1" }] }], breakdownKeys: [] };
    expect(TBRunState.fingerprint(after)).not.toBe(TBRunState.fingerprint(before));
  });

  it("пересборка пакета из того же теста отпечаток не меняет", () => {
    // Иначе каждый ре-экспорт объявлял бы состояние чужим и терял прогон ученика.
    const data = { sections: [{ questions: [{ id: "a1" }, { id: "a2" }] }], breakdownKeys: ["k"] };
    expect(TBRunState.fingerprint({ ...data })).toBe(TBRunState.fingerprint(data));
  });

  it("свой отпечаток признаётся своим, чужой — чужим", () => {
    expect(TBRunState.sameFingerprint(TBRunState.fingerprint(TEST_DATA), TEST_DATA)).toBe(true);
    expect(TBRunState.sameFingerprint("3:2,1,4:2:zzzz", TEST_DATA)).toBe(false);
  });

  it("короткий отпечаток без слепка состава признаётся чужим", () => {
    // Осознанно: он ничего не говорит о составе банка, а принять его за свой значило бы
    // доверить позиции пакету, состав которого не проверен.
    expect(TBRunState.sameFingerprint("2:2,1:2", TEST_DATA)).toBe(false);
  });
});

/**
 * @module shared/lms-export/__tests__/parse
 */
import { describe, it, expect } from "vitest";
import { TOPIC_LEVEL_NOT_ACHIEVED, looksLikeLmsExport, parseLmsExport } from "../parse";

/** Шапка и строка по образцу docs/references/7684237229762827328-1.xlsx, урезанные до двух блоков. */
const SHEET: string[][] = [
  [
    "Пользователь", "Код", "Организация", "Подразделение", "Должность",
    "Дата активации курса", "Дата активации модуля", "Статус", "Баллы",
    "q_80a5957f-cdc7-4490-b4c9-bcedcb973c26", "", "", "",
    "scale_cel", "", "", "",
    "var_lead_margin", "", "", "",
  ],
  [
    "", "", "", "", "", "", "", "", "",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
  ],
  [
    "Контента Контроль", "", "ПАО \"Ростелеком\"", "", "",
    "2026-09-09T13:35:00.000Z", "2026-09-09T13:39:00.000Z", "Пройден", "0",
    "другое", "", "neutral", "0[.]1,1[.]5,2[.]1,3[.]0",
    "другое", "", "neutral", "29",
    "другое", "", "neutral", "6",
  ],
];

/**
 * Тот же лист с колонкой `learner_id`, которую дописал внешний обезличиватель (BR-54-32).
 *
 * @param at куда вставить колонку
 * @param headRow в какой строке шапки её заголовок: 0 — первая, 1 — вторая
 */
function withLearnerAt(at: number, headRow: 0 | 1 = 0): string[][] {
  const insert = (row: string[], value: string) => [...row.slice(0, at), value, ...row.slice(at)];
  return [
    insert(SHEET[0], headRow === 0 ? "learner_id" : ""),
    insert(SHEET[1], headRow === 1 ? "learner_id" : ""),
    insert(SHEET[2], "u-4471"),
  ];
}

/** Колонка сразу после служебных — первое место, которое приходит в голову. */
const SHEET_WITH_LEARNER = withLearnerAt(9);

/**
 * Места, куда обезличиватель может поставить колонку: место не задано (BR-54-32), и каждое из них
 * сдвигает разное — ФИО, даты и баллы, первый блок, середину блоков, ничего.
 */
const LEARNER_POSITIONS: Array<[string, number]> = [
  ["в самом начале", 0],
  ["среди служебных", 3],
  ["сразу после служебных", 9],
  ["между блоками", 13],
  ["в самом конце", SHEET[0].length],
];

describe("looksLikeLmsExport", () => {
  it("узнаёт выгрузку по четвёрке подколонок и префиксам", () => {
    expect(looksLikeLmsExport(SHEET)).toBe(true);
  });

  it("узнаёт выгрузку и с дописанной колонкой learner_id", () => {
    // Ширина служебной части вычисляется, а не задана числом: иначе блоки взаимодействий
    // искались бы на колонку левее и лист не опознался бы вовсе.
    expect(looksLikeLmsExport(SHEET_WITH_LEARNER)).toBe(true);
  });

  it("не принимает книгу теста за выгрузку", () => {
    expect(looksLikeLmsExport([["Текст вопроса", "Тип", "Тема"], ["Что такое X?", "single", "Основы"]])).toBe(false);
  });
});

describe("parseLmsExport", () => {
  it("собирает идентификаторы вопросов, шкал и показателей", () => {
    const book = parseLmsExport(SHEET);
    expect(book.questionIds).toEqual(["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]);
    expect(book.scaleKeys).toEqual(["cel"]);
    expect(book.variableNames).toEqual(["lead_margin"]);
  });

  it("читает learner_id и НЕ сдвигает остальные поля", () => {
    // Главная опасность дописанной колонки — молчаливый сдвиг: баллы прочитались бы как статус,
    // а первый блок взаимодействий — как служебное поле.
    const [row] = parseLmsExport(SHEET_WITH_LEARNER).rows;

    expect(row.learnerId).toBe("u-4471");
    expect(row.participantName).toBe("Контента Контроль");
    expect(row.moduleActivatedAt).toBe("2026-09-09T13:39:00.000Z");
    expect(row.passed).toBe(true);
    expect(parseLmsExport(SHEET_WITH_LEARNER).questionIds)
      .toEqual(["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]);
  });

  it.each(LEARNER_POSITIONS)("находит learner_id %s и разбирает лист как исходный", (_, at) => {
    const sheet = withLearnerAt(at);
    const book = parseLmsExport(sheet);

    expect(looksLikeLmsExport(sheet)).toBe(true);
    expect(book.rows[0].learnerId).toBe("u-4471");
    // Всё прочее обязано совпасть с разбором листа без колонки — до поля.
    expect({ ...book, rows: [{ ...book.rows[0], learnerId: "" }] }).toEqual(parseLmsExport(SHEET));
    expect(book.unknownColumns).toEqual([]);
  });

  it("находит learner_id и по заголовку во второй строке шапки", () => {
    const book = parseLmsExport(withLearnerAt(0, 1));
    expect(book.rows[0].learnerId).toBe("u-4471");
    expect(book.rows[0].participantName).toBe("Контента Контроль");
  });

  it("заголовок сверяется без учёта регистра и пробелов", () => {
    const sheet = withLearnerAt(5);
    sheet[0][5] = "  Learner_ID ";
    expect(parseLmsExport(sheet).rows[0].learnerId).toBe("u-4471");
  });

  it.each(LEARNER_POSITIONS)("находит external_id %s и разбирает лист как исходный", (_, at) => {
    const sheet = withLearnerAt(at);
    sheet[0][at] = "external_id";
    const book = parseLmsExport(sheet);

    expect(looksLikeLmsExport(sheet)).toBe(true);
    expect(book.hasExternalId).toBe(true);
    expect(book.rows[0].externalId).toBe("u-4471");
    expect(book.rows[0].learnerId).toBe("");
    expect({ ...book, hasExternalId: false, rows: [{ ...book.rows[0], externalId: "" }] })
      .toEqual(parseLmsExport(SHEET));
  });

  it("external_id и learner_id вместе, в разных местах листа", () => {
    // Две вырезаемые колонки: смещение второй после вырезания первой разбор считать не должен.
    const sheet = withLearnerAt(SHEET[0].length);
    const insert = (row: string[], value: string) => [value, ...row];
    const both = [insert(sheet[0], "external_id"), insert(sheet[1], ""), insert(sheet[2], "ext-1")];
    const book = parseLmsExport(both);

    expect(book.rows[0].externalId).toBe("ext-1");
    expect(book.rows[0].learnerId).toBe("u-4471");
    expect(book.rows[0].participantName).toBe("Контента Контроль");
    expect(book.questionIds).toEqual(["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]);
  });

  it("вырезание колонки не сдвигает разреженные строки", () => {
    // exceljs отдаёт пустые ячейки ДЫРАМИ массива, а не пустыми строками. `filter` дыры
    // пропускает, и вторая строка шапки съезжала влево — лист переставал опознаваться. Нашлось
    // приёмкой на настоящем файле: плотные массивы тестов этого не видели.
    const sparse = (row: string[]) => {
      const out: string[] = new Array(row.length);
      row.forEach((v, i) => { if (v !== "") out[i] = v; });
      return out;
    };
    const sheet = withLearnerAt(3).map(sparse);
    sheet[0][3] = "external_id";

    expect(looksLikeLmsExport(sheet)).toBe(true);
    const book = parseLmsExport(sheet);
    expect(book.rows[0].externalId).toBe("u-4471");
    expect(book.rows[0].moduleActivatedAt).toBe("2026-09-09T13:39:00.000Z");
    expect(book.questionIds).toEqual(["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]);
  });

  it("без колонки external_id признак ложный, а значение пустое", () => {
    const book = parseLmsExport(SHEET);
    expect(book.hasExternalId).toBe(false);
    expect(book.rows[0].externalId).toBe("");
  });

  it("без такой колонки идентификатор пуст, а не выдуман", () => {
    expect(parseLmsExport(SHEET).rows[0].learnerId).toBe("");
  });

  it("читает служебные поля строки", () => {
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.participantName).toBe("Контента Контроль");
    expect(row.org).toBe('ПАО "Ростелеком"');
    expect(row.moduleActivatedAt).toBe("2026-09-09T13:39:00.000Z");
    expect(row.passed).toBe(true);
    expect(row.points).toBe(0);
  });

  it("читает время на задании — это материал анализа пунктов, а не украшение", () => {
    const sheet = SHEET.map((r) => [...r]);
    sheet[2][10] = "47";
    const [row] = parseLmsExport(sheet).rows;
    expect(row.latencySeconds["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]).toBe(47);
  });

  it("пустая колонка длительности — это отсутствие измерения, а не ноль", () => {
    // Пакеты, собранные до измерения времени, шлют пусто: «0 секунд» было бы выдумкой.
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.latencySeconds["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]).toBeUndefined();
  });

  it("раскладывает взаимодействия по видам", () => {
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.answers["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]).toBe("0[.]1,1[.]5,2[.]1,3[.]0");
    expect(row.results["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]).toBe("neutral");
    expect(row.scales.cel).toBe(29);
    expect(row.variables.lead_margin).toBe("6");
  });

  it("невыданное задание в наблюдения не попадает вовсе (PRD-66 FR-10a)", () => {
    // Пакет пишет взаимодействие только по ВЫДАННОМУ заданию, поэтому у невыданного пусты
    // все четыре подколонки. Пустая ячейка результата, сведённая к «neutral», делала
    // невыданное задание неотличимым от измерительного — и портила обе статистики разом:
    // трудность считалась с лишним знаменателем, а измерительные пункты тонули в
    // наблюдениях, которых не было.
    const sheet = SHEET.map((r) => [...r]);
    sheet[2][9] = "";
    sheet[2][10] = "";
    sheet[2][11] = "";
    sheet[2][12] = "";

    const [row] = parseLmsExport(sheet).rows;
    const id = "80a5957f-cdc7-4490-b4c9-bcedcb973c26";
    expect(row.answers).not.toHaveProperty(id);
    expect(row.results).not.toHaveProperty(id);
    expect(row.latencySeconds).not.toHaveProperty(id);
  });

  it("выданное и не отвеченное задание наблюдением остаётся", () => {
    // Тип взаимодействия заполнен — значит задание показали. Пустой ответ здесь значит
    // «выдано, отвечать не стали», и это данные, а не их отсутствие.
    const sheet = SHEET.map((r) => [...r]);
    sheet[2][11] = "";
    sheet[2][12] = "";

    const [row] = parseLmsExport(sheet).rows;
    const id = "80a5957f-cdc7-4490-b4c9-bcedcb973c26";
    expect(row.answers[id]).toBe("");
    expect(row.results[id]).toBe("");
  });

  it("пустой блок шкалы и показателя тоже не выдумывает наблюдения", () => {
    const sheet = SHEET.map((r) => [...r]);
    for (let i = 13; i < 21; i += 1) sheet[2][i] = "";

    const [row] = parseLmsExport(sheet).rows;
    expect(row.scales).not.toHaveProperty("cel");
    expect(row.variables).not.toHaveProperty("lead_margin");
  });

  it("складывает неопознанные блоки отдельно, не роняя разбор", () => {
    const sheet = SHEET.map((r) => [...r]);
    sheet[0][9] = "foo_bar";
    const book = parseLmsExport(sheet);
    expect(book.questionIds).toEqual([]);
    expect(book.unknownColumns).toEqual(["foo_bar"]);
  });
});

describe("уровни и рекомендованные курсы тем", () => {
  const T1 = "11111111-1111-4111-8111-111111111111";
  const T2 = "22222222-2222-4222-8222-222222222222";

  /** Та же выгрузка плюс блоки тем: `[id, ответ]`; `null` — блок пуст целиком (не выдан). */
  function withTopics(blocks: Array<[string, string | null]>): string[][] {
    const sheet = SHEET.map((r) => [...r]);
    for (const [id, value] of blocks) {
      sheet[0].push(id, "", "", "");
      sheet[1].push("Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ");
      sheet[2].push(...(value === null ? ["", "", "", ""] : ["другое", "", "neutral", value]));
    }
    return sheet;
  }

  it("уровень темы читается как записан, включая «Уровень не достигнут»", () => {
    const [row] = parseLmsExport(withTopics([
      [`topic_${T1}_level`, "Продвинутый"],
      [`topic_${T2}_level`, TOPIC_LEVEL_NOT_ACHIEVED],
    ])).rows;
    expect(row.topicLevels).toEqual({ [T1]: "Продвинутый", [T2]: "Уровень не достигнут" });
  });

  it("курсы собираются по теме в порядке номера блока, а не колонки", () => {
    const [row] = parseLmsExport(withTopics([
      [`topic_${T1}_course_2`, "6000000000000000003"],
      [`topic_${T1}_course_0`, "6000000000000000001"],
      [`topic_${T2}_course_0`, "7000000000000000001"],
    ])).rows;
    expect(row.topicCourses).toEqual({
      [T1]: ["6000000000000000001", "6000000000000000003"],
      [T2]: ["7000000000000000001"],
    });
  });

  it("пустые блоки тем не выдумывают ни уровня, ни курсов", () => {
    const [row] = parseLmsExport(withTopics([
      [`topic_${T1}_level`, null],
      [`topic_${T1}_course_0`, null],
      [`topic_${T2}_course_0`, ""],
    ])).rows;
    expect(row.topicLevels).toEqual({});
    expect(row.topicCourses).toEqual({});
  });

  it("блоки уровней и курсов не попадают в неопознанные, прочие `topic_*` — попадают", () => {
    const book = parseLmsExport(withTopics([
      [`topic_${T1}_level`, "Базовый"],
      [`topic_${T1}_course_0`, "1"],
      [`topic_${T1}_other`, "x"],
    ]));
    expect(book.unknownColumns).toEqual([`topic_${T1}_other`]);
    expect(book.questionIds).toEqual(["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]);
  });

  it("без блоков тем словари пусты", () => {
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.topicLevels).toEqual({});
    expect(row.topicCourses).toEqual({});
  });
});

describe("версия формата ответов", () => {
  /** Та же выгрузка плюс служебный блок версии, как его шлёт пакет после выравнивания. */
  function withVersion(value: string): string[][] {
    const sheet = SHEET.map((r) => [...r]);
    sheet[0].push("meta_response_format", "", "", "");
    sheet[1].push("Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ");
    sheet[2].push("другое", "", "neutral", value);
    return sheet;
  }

  it("версия читается СТРОКОЙ, а не файлом", () => {
    // В одном отчёте лежат прохождения, собранные разными версиями пакета: колонка общая,
    // значение — своё у каждого участника.
    const [row] = parseLmsExport(withVersion("2")).rows;
    expect(row.responseFormat).toBe(2);
  });

  it("отсутствие блока версии — это исходный формат", () => {
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.responseFormat).toBeNull();
  });

  it("пустая ячейка версии у старого прохождения — тоже исходный формат", () => {
    const [row] = parseLmsExport(withVersion("")).rows;
    expect(row.responseFormat).toBeNull();
  });

  it("служебный блок версии не попадает в неопознанные колонки", () => {
    // Иначе импорт предупреждал бы «пакет собран под другой версией теста» на каждой выгрузке.
    expect(parseLmsExport(withVersion("2")).unknownColumns).toEqual([]);
  });
});

describe("версия публикации и выданные варианты (PRD-56 FR-19a)", () => {
  /** Та же выгрузка плюс два служебных блока, как их шлёт пакет после этой работы. */
  function withRunMeta(version: string, variant: string): string[][] {
    const sheet = SHEET.map((r) => [...r]);
    for (const id of ["meta_test_version", "meta_variant"]) {
      sheet[0].push(id, "", "", "");
      sheet[1].push("Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ");
    }
    sheet[2].push("другое", "", "neutral", version);
    sheet[2].push("другое", "", "neutral", variant);
    return sheet;
  }

  it("версия публикации читается строкой", () => {
    const [row] = parseLmsExport(withRunMeta("3", "")).rows;
    expect(row.testVersion).toBe(3);
  });

  it("варианты читаются списком", () => {
    const [row] = parseLmsExport(withRunMeta("3", "form-a;form-b")).rows;
    expect(row.formIds).toEqual(["form-a", "form-b"]);
  });

  it("прохождение пакета прошлой сборки версии не знает", () => {
    // Ни нуля, ни текущей версии: такое прохождение уйдёт в строку «Версия не указана».
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.testVersion).toBeNull();
    expect(row.formIds).toEqual([]);
  });

  it("пустые ячейки означают то же, что и отсутствие блоков", () => {
    const [row] = parseLmsExport(withRunMeta("", "")).rows;
    expect(row.testVersion).toBeNull();
    expect(row.formIds).toEqual([]);
  });

  it("служебные блоки не попадают в неопознанные колонки", () => {
    expect(parseLmsExport(withRunMeta("3", "form-a")).unknownColumns).toEqual([]);
  });
});

describe("метка регистрации (PRD-54 BR-54-35)", () => {
  /** Та же выгрузка плюс блок `meta_registration`, как его шлёт пакет после этой работы. */
  function withRegistration(mark: string): string[][] {
    const sheet = SHEET.map((r) => [...r]);
    sheet[0].push("meta_registration", "", "", "");
    sheet[1].push("Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ");
    sheet[2].push("другое", "", "neutral", mark);
    return sheet;
  }

  it("метка читается как есть", () => {
    const [row] = parseLmsExport(withRegistration("lx1a2b3cq9zk")).rows;
    expect(row.registrationMark).toBe("lx1a2b3cq9zk");
  });

  it("пакет прошлой сборки метки не сообщает — пустая строка", () => {
    expect(parseLmsExport(SHEET).rows[0].registrationMark).toBe("");
    expect(parseLmsExport(withRegistration("")).rows[0].registrationMark).toBe("");
  });

  it("блок метки не попадает в неопознанные колонки", () => {
    expect(parseLmsExport(withRegistration("lx1a2b3cq9zk")).unknownColumns).toEqual([]);
  });
});

describe("номер и длительность попытки (PRD-54, решение 13)", () => {
  /** Та же выгрузка плюс блоки `meta_attempt` и `meta_duration`. */
  function withAttemptMeta(number: string, seconds: string): string[][] {
    const sheet = SHEET.map((r) => [...r]);
    sheet[0].push("meta_attempt", "", "", "", "meta_duration", "", "", "");
    sheet[1].push(
      "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
      "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
    );
    sheet[2].push("другое", "", "neutral", number, "другое", "", "neutral", seconds);
    return sheet;
  }

  it("читаются числами", () => {
    const [row] = parseLmsExport(withAttemptMeta("3", "1240")).rows;
    expect(row.attemptNumber).toBe(3);
    expect(row.durationSeconds).toBe(1240);
  });

  it("пусто, мусор и дробь — не сообщено; нулевая длительность законна", () => {
    expect(parseLmsExport(SHEET).rows[0]).toMatchObject({ attemptNumber: null, durationSeconds: null });
    expect(parseLmsExport(withAttemptMeta("0", "-5")).rows[0]).toMatchObject({ attemptNumber: null, durationSeconds: null });
    expect(parseLmsExport(withAttemptMeta("1.5", "0")).rows[0]).toMatchObject({ attemptNumber: null, durationSeconds: 0 });
  });

  it("блоки не попадают в неопознанные колонки", () => {
    expect(parseLmsExport(withAttemptMeta("2", "60")).unknownColumns).toEqual([]);
  });
});

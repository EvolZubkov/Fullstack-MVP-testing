/**
 * @module server/services/analytics/__tests__/response-matrix
 * @description PRD-66 FR-06, FR-07: слой наблюдений, разложенный до уровня ОТВЕТА.
 *
 * Здесь проверяются чистые адаптеры — то, что из строки источника получается каноническая
 * запись наблюдения за ответом. Проверять их без базы можно и нужно: вся суть адаптеров в
 * том, что источники ЗНАЮТ разное, и это различие выражается правилами, а не запросами.
 */
import { describe, it, expect } from "vitest";

import { skippableOf, toResponses, type SnapshotFacts } from "../response-matrix";
import type { Observation } from "../observations";

/** Веб-попытка: два задания выданы, оба отвечены. */
const webAttempt = {
  id: "atmp1",
  variantJson: {
    sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1", "q2"], formId: "form-a" }],
    psychoHashes: { q1: "hash-1", q2: "hash-2" },
    latencyMs: { q1: 7000 },
  },
  answersJson: { q1: 0, q2: 1 },
  resultJson: { overallPercent: 50 },
};

/** Оценка «первое задание верно, второе неверно», цена 2 балла. */
const grade = (questionId: string) =>
  questionId === "q1"
    ? { result: "correct" as const, earnedPoints: 2, possiblePoints: 2 }
    : { result: "incorrect" as const, earnedPoints: 0, possiblePoints: 2 };

describe("toResponses.web", () => {
  it("раскладывает попытку по ВЫДАННЫМ заданиям с долей балла и редакцией", () => {
    const rows = toResponses.web(webAttempt, { respondentId: "u1", occurredAt: new Date("2026-09-20T10:00:00Z"), groupKeys: ["g1"], grade });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      questionId: "q1",
      outcome: "correct",
      score: 2,
      maxScore: 2,
      scoreRatio: 1,
      psychoHash: "hash-1",
      latencyMs: 7000,
      formKey: "form-a",
      respondentId: "u1",
      groupKeys: ["g1"],
      source: "web",
    });
    expect(rows[1]).toMatchObject({ questionId: "q2", outcome: "incorrect", scoreRatio: 0 });
  });

  it("не измеренное время — null, а не ноль", () => {
    const rows = toResponses.web(webAttempt, { respondentId: "u1", occurredAt: new Date(), groupKeys: [], grade });
    expect(rows[1].latencyMs).toBeNull();
  });

  it("выданное и не отвеченное задание — пропуск ценой в ноль, а не пропажа", () => {
    // Решение OQ-07: «выдано, ответа нет» есть ошибка, а не отсутствие данных. Выкинуть его
    // значило бы завысить трудность: задание, которое все пропускают, выглядело бы лёгким.
    const skipped = { ...webAttempt, answersJson: { q1: 0 } };

    const rows = toResponses.web(skipped, { respondentId: "u1", occurredAt: new Date(), groupKeys: [], grade });

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ questionId: "q2", outcome: "incorrect", score: 0, scoreRatio: 0 });
  });

  it("ответ на задание вне выданного состава в наблюдения не идёт", () => {
    // Задание могли убрать из теста, а ответ остался в попытке: приписывать его выдаче,
    // которой не было, нельзя.
    const stray = { ...webAttempt, answersJson: { ...webAttempt.answersJson, q9: 3 } };

    const rows = toResponses.web(stray, { respondentId: "u1", occurredAt: new Date(), groupKeys: [], grade });

    expect(rows.map(r => r.questionId)).toEqual(["q1", "q2"]);
  });

  it("измерительное задание в долю балла не идёт вовсе", () => {
    // PA-17a: `neutral` означает «оценивать нечего». Ни верным, ни неверным такой ответ не
    // бывает, и приписать ему ноль значило бы утянуть трудность всего теста вниз.
    const rows = toResponses.web(webAttempt, {
      respondentId: "u1", occurredAt: new Date(), groupKeys: [],
      grade: () => ({ result: "neutral", earnedPoints: null, possiblePoints: null }),
    });

    expect(rows[0]).toMatchObject({ outcome: "neutral", score: null, maxScore: null, scoreRatio: null });
  });

  it("попытка без штампов редакции даёт наблюдения версии «неизвестна»", () => {
    // Попытки, пройденные до появления штампа (FR-09c). Терять их нельзя — это решение ОВ-04.
    const legacy = { ...webAttempt, variantJson: { sections: webAttempt.variantJson.sections } };

    const rows = toResponses.web(legacy, { respondentId: "u1", occurredAt: new Date(), groupKeys: [], grade });

    expect(rows.every(r => r.psychoHash === null)).toBe(true);
  });
});

describe("toResponses.lms", () => {
  const lmsRows = [
    { questionId: "q1", attemptId: "lms1", result: "correct" as const, latencyMs: 48_000, points: 3, maxPoints: 4, userAnswer: [0], topicId: "t1" },
    { questionId: "q2", attemptId: "lms1", result: "incorrect" as const, latencyMs: null, points: null, maxPoints: null, userAnswer: [1], topicId: "t1" },
  ];

  it("телеметрия несёт баллы — доля берётся из них", () => {
    const rows = toResponses.lms(lmsRows, {
      observationId: "lms1", source: "telemetry", respondentId: "p1",
      occurredAt: new Date(), groupKeys: ["g2"], forms: { t1: "form-b" }, psychoHashOf: () => "hash-1",
    });

    expect(rows[0]).toMatchObject({
      questionId: "q1", outcome: "correct", score: 3, maxScore: 4, scoreRatio: 0.75,
      latencyMs: 48_000, formKey: "form-b", psychoHash: "hash-1", source: "telemetry",
    });
  });

  it("импорт баллов не знает — доля выводится из бинарного исхода", () => {
    // FR-07: адаптеры различаются ровно тем, что источник ЗНАЕТ, и решает это САМА СТРОКА, а
    // не название источника. У выгрузки отчёта балла за задание нет вовсе — импортёр пишет
    // `points: null`, — и доля балла там бинарна: ограничение источника, а не выбор аппарата.
    const imported = lmsRows.map(row => ({ ...row, points: null, maxPoints: null }));

    const rows = toResponses.lms(imported, {
      observationId: "lms1", source: "import", respondentId: "p1",
      occurredAt: new Date(), groupKeys: [], forms: {}, psychoHashOf: () => null,
    });

    expect(rows[0]).toMatchObject({ scoreRatio: 1, score: null, maxScore: null });
    expect(rows[1]).toMatchObject({ scoreRatio: 0, score: null, maxScore: null });
  });

  it("измерительный ответ доли балла не имеет ни у одного источника", () => {
    const rows = toResponses.lms(
      [{ ...lmsRows[0], result: "neutral", points: null, maxPoints: null }],
      { observationId: "lms1", source: "import", respondentId: "p1", occurredAt: new Date(), groupKeys: [], forms: {}, psychoHashOf: () => null },
    );

    expect(rows[0]).toMatchObject({ outcome: "neutral", scoreRatio: null });
  });

  it("одинаковые наблюдения дают одинаковую матрицу у всех трёх источников", () => {
    // Требование паритета: происхождение строки не должно влиять на расчёт — источник остаётся
    // признаком для фильтра, а не развилкой в арифметике. Проверяется на задании с ТОЧНОЙ
    // оценкой: там, где балл либо весь, либо никакой, три источника обязаны сойтись до знака.
    const web = toResponses.web(
      {
        id: "a1",
        variantJson: { sections: [{ topicId: "t1", questionIds: ["q1"] }] },
        answersJson: { q1: 0 },
        resultJson: {},
      },
      {
        respondentId: "u1", occurredAt: new Date(), groupKeys: [],
        grade: () => ({ result: "correct", earnedPoints: 1, possiblePoints: 1 }),
      },
    );
    const telemetry = toResponses.lms(
      [{ questionId: "q1", result: "correct", latencyMs: null, points: 1, maxPoints: 1, userAnswer: [0] }],
      { observationId: "a1", source: "telemetry", respondentId: "u1", occurredAt: new Date(), groupKeys: [], forms: {}, psychoHashOf: () => null },
    );
    const imported = toResponses.lms(
      [{ questionId: "q1", result: "correct", latencyMs: null, points: null, maxPoints: null, userAnswer: [0] }],
      { observationId: "a1", source: "import", respondentId: "u1", occurredAt: new Date(), groupKeys: [], forms: {}, psychoHashOf: () => null },
    );

    const shape = (fact: (typeof web)[number]) => ({ outcome: fact.outcome, scoreRatio: fact.scoreRatio });
    expect(shape(telemetry[0])).toEqual(shape(web[0]));
    expect(shape(imported[0])).toEqual(shape(web[0]));
  });

  it("редакция берётся у снимка публикации, когда прохождение её сообщило", () => {
    // Снимок заморожен (PRD-15), поэтому по версии публикации редакция задания известна
    // ТОЧНО — а не «неизвестна», как у прохождения, версию не сообщившего.
    const rows = toResponses.lms(lmsRows, {
      observationId: "lms1", source: "telemetry", respondentId: "p1",
      occurredAt: new Date(), groupKeys: [], forms: {},
      psychoHashOf: questionId => (questionId === "q1" ? "snap-hash-1" : null),
    });

    expect(rows[0].psychoHash).toBe("snap-hash-1");
    expect(rows[1].psychoHash).toBeNull();
  });
});

describe("PA-12f: пропуск в телеметрии", () => {
  const answeredRow = {
    questionId: "q1", attemptId: "lms1", result: "correct" as const, latencyMs: null,
    points: 1, maxPoints: 1, userAnswer: [0], topicId: "t1",
  };
  const base = {
    observationId: "lms1", source: "telemetry" as const, respondentId: "p1",
    occurredAt: new Date(), groupKeys: [], forms: { t1: "form-a" }, psychoHashOf: () => "hash",
  };

  it("выданное оцениваемое задание без строки ответа становится нулём, как в вебе", () => {
    // OQ-07: «выдано, ответа нет» — ошибка. Веб и импорт так и считают; телеметрия строку по
    // пропуску не присылала, и задание выпадало из знаменателя трудности.
    const rows = toResponses.lms([answeredRow], {
      ...base,
      skippable: { questionIds: ["q1", "q2"], topicOf: () => "t1" },
    });

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      questionId: "q2", outcome: "incorrect", scoreRatio: 0, score: null, maxScore: null,
      formKey: "form-a", psychoHash: "hash", source: "telemetry",
    });
  });

  it("отвеченное задание не удваивается", () => {
    const rows = toResponses.lms([answeredRow], {
      ...base,
      skippable: { questionIds: ["q1"], topicOf: () => "t1" },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ questionId: "q1", outcome: "correct" });
  });

  it("без списка пропусков поведение прежнее — наблюдения только по строкам", () => {
    expect(toResponses.lms([answeredRow], base)).toHaveLength(1);
  });

  const observation = {
    id: "lms1", source: "telemetry", adaptive: false, snapshotId: "s1",
  } as unknown as Observation;
  const snapshot: SnapshotFacts = {
    stamps: new Map(),
    gradedTopics: new Map([["q1", "t1"], ["q2", "t1"]]),
    quickAdvance: false,
  };

  it("пропуском считаются только оцениваемые задания выданного состава", () => {
    // q3 измерительное: в оцениваемых его нет, и ноль за него был бы выдумкой.
    const skippable = skippableOf(observation, snapshot, ["q1", "q2", "q3"]);
    expect(skippable?.questionIds).toEqual(["q1", "q2"]);
    expect(skippable?.topicOf("q2")).toBe("t1");
  });

  it("быстрый переход: старый пакет не слал строк по «Далее», достройки нет", () => {
    // Пакеты до исправления отправляли ответ только из «Отправить ответ». При быстром переходе
    // (PRD-43) такой кнопки нет — отсутствие строки там значит «ответ потерян», а не «пропуск».
    expect(skippableOf(observation, { ...snapshot, quickAdvance: true }, ["q1"])).toBeUndefined();
  });

  it("без версии публикации, без выданного состава, адаптив и импорт — достройки нет", () => {
    expect(skippableOf(observation, undefined, ["q1"])).toBeUndefined();
    expect(skippableOf(observation, snapshot, undefined)).toBeUndefined();
    expect(skippableOf({ ...observation, adaptive: true }, snapshot, ["q1"])).toBeUndefined();
    expect(skippableOf({ ...observation, source: "import" }, snapshot, ["q1"])).toBeUndefined();
  });
});

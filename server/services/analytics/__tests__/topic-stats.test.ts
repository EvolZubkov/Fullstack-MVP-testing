/**
 * @module server/services/analytics/__tests__/topic-stats
 * @description PRD-56 FR-14, FR-14a: разрезы теста по темам и подтемам.
 *
 * Главное, что здесь проверяется, — что две колонки считают РАЗНОЕ и обе названы своей
 * единицей. «Прошли тему» — доля ПРОХОЖДЕНИЙ, где участник взял порог темы; «Доля верных
 * ответов» — доля ОТВЕТОВ. В теме из четырёх вопросов с порогом «три из четырёх» все могут
 * отвечать верно на два: доля верных 50 %, тему не прошёл никто. Смешать их значит выдать
 * трудность материала за сдаваемость.
 *
 * Колонки «вердикт» у темы нет и не будет: порог судит ОДНУ попытку, у среднего исхода нет
 * (решение владельца 2026-09-13).
 */

import { describe, expect, it } from "vitest";

import { summariseTopics, type TopicAnswerFact } from "../topic-stats";

function fact(over: Partial<TopicAnswerFact> = {}): TopicAnswerFact {
  return {
    attemptId: "a1",
    topicId: "t1",
    topicName: "Право и комплаенс",
    subtopics: [],
    result: "correct",
    earnedPoints: 1,
    possiblePoints: 1,
    ...over,
  };
}

/** Порог темы в процентах. */
const percentRule = (value: number) => ({ type: "percent" as const, value });

describe("summariseTopics", () => {
  it("считает долю верных по ответам, а взятие порога — по прохождениям", () => {
    // Четыре вопроса, порог 75 %. Оба участника ответили верно на два: доля верных 50 %,
    // тему не взял никто. Одно число про материал, другое — про людей.
    const facts = ["a1", "a2"].flatMap(attemptId => [
      fact({ attemptId, result: "correct", earnedPoints: 1 }),
      fact({ attemptId, result: "correct", earnedPoints: 1 }),
      fact({ attemptId, result: "incorrect", earnedPoints: 0 }),
      fact({ attemptId, result: "incorrect", earnedPoints: 0 }),
    ]);

    const [topic] = summariseTopics(facts, new Map([["t1", percentRule(75)]]));

    expect(topic.correctShare).toBe(50);
    expect(topic.passedShare).toBe(0);
    expect(topic.inSample).toBe(2);
  });

  it("считает прошедшим того, кто взял порог", () => {
    const facts = [
      fact({ attemptId: "a1", earnedPoints: 1 }),
      fact({ attemptId: "a1", earnedPoints: 1 }),
      fact({ attemptId: "a2", earnedPoints: 1, result: "correct" }),
      fact({ attemptId: "a2", earnedPoints: 0, result: "incorrect" }),
    ];

    const [topic] = summariseTopics(facts, new Map([["t1", percentRule(75)]]));

    // a1: 100 % — взял; a2: 50 % — нет.
    expect(topic.passedShare).toBe(50);
  });

  it("прохождение без баллов за вопросы в долю прошедших не входит", () => {
    // a2 — строка импорта выгрузки LMS: исход «верно/неверно» есть, баллов за вопрос нет.
    // Порог к ней неприменим, и «не прошёл» про неё было бы выдумкой.
    const facts = [
      fact({ attemptId: "a1", earnedPoints: 1, possiblePoints: 1 }),
      fact({ attemptId: "a2", earnedPoints: null, possiblePoints: null }),
    ];

    const [topic] = summariseTopics(facts, new Map([["t1", percentRule(75)]]));

    expect(topic.passedShare).toBe(100);
    expect(topic.correctShare).toBe(100);
    expect(topic.inSample).toBe(2);
  });

  it("если баллов нет ни у одного прохождения, доли прошедших нет, а не ноль", () => {
    const facts = [fact({ earnedPoints: null, possiblePoints: null })];

    const [topic] = summariseTopics(facts, new Map([["t1", percentRule(75)]]));

    expect(topic.passedShare).toBeNull();
  });

  it("без порога темы доли прошедших нет", () => {
    // «Не проверять отдельно» — законная настройка: тема идёт в общий зачёт и своего исхода
    // не имеет. Ноль вместо этого читался бы как «никто не справился».
    const [topic] = summariseTopics([fact()], new Map([["t1", null]]));

    expect(topic.passedShare).toBeNull();
    expect(topic.thresholdPercent).toBeNull();
  });

  it("не выдумывает процентного порога там, где он задан в баллах", () => {
    // Порог «три балла» в колонке процентов показать нечем: достижимые баллы у прохождений
    // разные. Доля прошедших при этом считается — по самому правилу, в баллах.
    const facts = [
      fact({ attemptId: "a1", earnedPoints: 3, possiblePoints: 4 }),
      fact({ attemptId: "a2", earnedPoints: 1, possiblePoints: 4 }),
    ];

    const [topic] = summariseTopics(facts, new Map([["t1", { type: "count", value: 3 }]]));

    expect(topic.thresholdPercent).toBeNull();
    expect(topic.passedShare).toBe(50);
  });

  it("держит подтемы внутри темы", () => {
    const facts = [
      fact({ subtopics: ["Антикоррупция"], result: "correct" }),
      fact({ subtopics: ["Антикоррупция"], result: "incorrect", earnedPoints: 0 }),
      fact({ subtopics: ["Персональные данные"], result: "correct" }),
    ];

    const [topic] = summariseTopics(facts, new Map([["t1", percentRule(70)]]));

    expect(topic.subtopics.map(s => s.name)).toEqual(["Антикоррупция", "Персональные данные"]);
    expect(topic.subtopics[0].correctShare).toBe(50);
  });

  it("наследует подтеме порог её темы", () => {
    // PRD-50 §16: своего порога у подтемы нет — она судится порогом темы, иначе на экране
    // появилось бы требование, которого никто не задавал.
    const facts = [fact({ subtopics: ["Антикоррупция"] })];

    const [topic] = summariseTopics(facts, new Map([["t1", percentRule(70)]]));

    expect(topic.subtopics[0].thresholdPercent).toBe(70);
  });

  it("не считает измерительные ответы верными или неверными", () => {
    const facts = [
      fact({ result: "neutral", earnedPoints: null, possiblePoints: null }),
      fact({ result: "neutral", earnedPoints: null, possiblePoints: null }),
    ];

    const [topic] = summariseTopics(facts, new Map([["t1", null]]));

    expect(topic.correctShare).toBeNull();
    expect(topic.inSample).toBe(1);
  });

  it("считает «в выборке» прохождения, а не ответы", () => {
    // Знаменатель отвечает на «сколько прохождений вообще содержали вопросы темы»: у темы с
    // квотой выдачи он меньше общего числа прохождений теста.
    const facts = [
      fact({ attemptId: "a1" }),
      fact({ attemptId: "a1" }),
      fact({ attemptId: "a2" }),
    ];

    const [topic] = summariseTopics(facts, new Map([["t1", null]]));

    expect(topic.inSample).toBe(2);
  });

  it("ничего не выдумывает на пустой выборке", () => {
    expect(summariseTopics([], new Map())).toEqual([]);
  });
});

/**
 * @module tests/regex-runner
 * @description Бюджет времени на сервере (PRD-57 FR-28q). Выражение автора исполняется в
 * НАШЕМ процессе, а Node однопоточен: без убиваемого исполнителя одно плохое выражение
 * останавливает обслуживание всех, а не одну попытку.
 *
 * Долгое выражение здесь настоящее, а не имитация: `^(\S+\s?)+ надзору$` на ответе без
 * подходящего хвоста — это те самые секунды из §6.4.
 */
import { describe, it, expect, afterAll } from "vitest";

import { checkExpressions, shutdownRegexRunner } from "../server/services/regex-runner";

const SLOW = "^(\\S+\\s?)+ надзору$";
// Длина измерена: на этой строке выражение считается около четырёх секунд, то есть
// на порядок дольше бюджета теста — сторож обязан вмешаться.
const SLOW_ANSWER = `${"аб ".repeat(24)}абв!`;

afterAll(async () => {
  await shutdownRegexRunner();
});

describe("checkExpressions", () => {
  it("быстрое выражение считается и отдаёт вердикт", async () => {
    const verdicts = await checkExpressions(
      [
        { source: "^ростехнадзор$", answer: "Ростехнадзор" },
        { source: "^ртн$", answer: "Ростехнадзор" },
      ],
      1000,
    );
    expect(verdicts).toEqual([true, false]);
  });

  it("без заданий поток не поднимается и ответ пустой", async () => {
    expect(await checkExpressions([], 1000)).toEqual([]);
  });

  it("долгое выражение убивается по бюджету", async () => {
    const verdicts = await checkExpressions([{ source: SLOW, answer: SLOW_ANSWER }], 300);
    expect(verdicts).toEqual(["budget"]);
  }, 20000);

  it("следующий запрос обслуживается: поток поднялся заново", async () => {
    const verdicts = await checkExpressions([{ source: "^рос", answer: "Ростехнадзор" }], 1000);
    expect(verdicts).toEqual([true]);
  }, 20000);

  it("невалидное выражение не совпадает и потока не роняет", async () => {
    expect(await checkExpressions([{ source: "([а-я", answer: "что угодно" }], 1000)).toEqual([false]);
  });
});

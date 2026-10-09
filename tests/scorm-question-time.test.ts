/**
 * @module tests/scorm-question-time
 *
 * Время показа вопроса — ОДИН счётчик на оба хоста (PRD-66 FR-37). Раньше он жил только в
 * пакете, а веб времени не мерил вовсе; два хоста, меряющие «время на задании» по-разному,
 * сделали бы источники несравнимыми — ровно те, что психометрика ставит рядом.
 *
 * Ключевое требование — СУММА заходов, а не последний. При разрешённом возврате к
 * неотвеченным человек возвращается к вопросу, и «последний заход» показал бы две секунды
 * на задании, над которым думали минуту.
 *
 * Счёт исполняется настоящий, с подменёнными часами: измерение времени нельзя проверить,
 * пересказав его.
 */
import { describe, it, expect } from "vitest";
import { createQuestionTime } from "@shared/questions/question-time";

interface Clock { t: number }

/** The real counter over a clock the test drives by hand. */
function makeTracker() {
  const clock: Clock = { t: 1_000_000 };
  const tracker = createQuestionTime(() => clock.t);
  return { tracker, clock };
}

describe("накопление времени показа", () => {
  it("время идёт с показа вопроса до ухода с него", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 7000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(7000);
  });

  it("переход на следующий вопрос закрывает предыдущий", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 4000;
    tracker.show("q2");
    clock.t += 3000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(4000);
    expect(tracker.totalMsFor("q2")).toBe(3000);
  });

  it("возврат к вопросу СУММИРУЕТ заходы, а не заменяет последним", () => {
    // Ровно тот случай, ради которого сумма и нужна: минута раздумий, уход, возврат на две секунды.
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 60000;
    tracker.show("q2");
    clock.t += 5000;
    tracker.show("q1");
    clock.t += 2000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(62000);
  });

  it("повторный показ того же вопроса не удваивает счёт", () => {
    // render() зовут и на перерисовку (обратная связь, смена темы), а не только на переход.
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 3000;
    tracker.show("q1");
    clock.t += 2000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(5000);
  });

  it("двойной уход не добавляет времени", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 3000;
    tracker.leave();
    clock.t += 10000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(3000);
  });

  it("время можно прочитать не уходя с вопроса", () => {
    // Попытку завершают прямо с вопроса — открытый заход обязан попасть в отчёт.
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 9000;
    expect(tracker.totalMsFor("q1")).toBe(9000);
  });

  it("у невиданного вопроса времени нет", () => {
    const { tracker } = makeTracker();
    expect(tracker.totalMsFor("q-unknown")).toBe(0);
  });

  it("часы, прыгнувшие назад, не дают отрицательного времени", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t -= 5000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(0);
  });

  it("новая попытка начинает счёт заново", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 8000;
    tracker.leave();
    tracker.reset();
    expect(tracker.totalMsFor("q1")).toBe(0);
  });

  it("счётчики независимы — у каждой попытки свой", () => {
    // Веб-хост проходит несколько попыток за одну сессию страницы; общий счётчик перенёс бы
    // секунды одной попытки в следующую.
    const first = makeTracker();
    const second = makeTracker();
    first.tracker.show("q1");
    first.clock.t += 5000;
    first.tracker.leave();

    expect(first.tracker.totalMsFor("q1")).toBe(5000);
    expect(second.tracker.totalMsFor("q1")).toBe(0);
  });

  it("карта итогов включает открытый заход", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 4000;
    tracker.show("q2");
    clock.t += 3000;

    expect(tracker.totals()).toEqual({ q1: 4000, q2: 3000 });
  });
});

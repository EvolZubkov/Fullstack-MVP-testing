/**
 * @module shared/flow/section-budget.test
 * @description Бюджет времени раздела — общая модель веб-хоста и SCORM-пакета.
 * Проверяются три согласованных правила: время идёт только внутри раздела, выход
 * ЗАМОРАЖИВАЕТ остаток (возврат продолжает с него, а не с полного лимита), а
 * исчерпанный раздел закрывается.
 */
import { describe, it, expect } from "vitest";
import {
  enterSection,
  pauseAll,
  remainingSeconds,
  isSpent,
  spentTopics,
  type SectionBudgets,
} from "./section-budget";

const EMPTY: SectionBudgets = {};

describe("бюджет раздела", () => {
  it("первый вход открывает раздел на полный лимит", () => {
    const b = enterSection(EMPTY, "A", 10, 1_000);
    expect(remainingSeconds(b, "A", 1_000)).toBe(600);
  });

  it("время идёт, пока ученик внутри раздела", () => {
    const b = enterSection(EMPTY, "A", 10, 0);
    expect(remainingSeconds(b, "A", 60_000)).toBe(540);
  });

  it("выход замораживает остаток — снаружи время не тратится", () => {
    const inside = enterSection(EMPTY, "A", 10, 0);
    const left = pauseAll(inside, 60_000); // вышли через минуту
    expect(remainingSeconds(left, "A", 60_000)).toBe(540);
    // ...и через полчаса снаружи остаток тот же
    expect(remainingSeconds(left, "A", 1_800_000)).toBe(540);
  });

  it("возврат продолжает с остатка, а не с полного лимита", () => {
    const inside = enterSection(EMPTY, "A", 10, 0);
    const left = pauseAll(inside, 60_000);
    const back = enterSection(left, "A", 10, 1_800_000); // вернулись спустя полчаса
    expect(remainingSeconds(back, "A", 1_800_000)).toBe(540);
    expect(remainingSeconds(back, "A", 1_830_000)).toBe(510); // и снова тикает
  });

  it("вход в другой раздел ставит предыдущий на паузу", () => {
    const a = enterSection(EMPTY, "A", 10, 0);
    const b = enterSection(a, "B", 5, 60_000);
    expect(remainingSeconds(b, "A", 300_000)).toBe(540); // A заморожен
    expect(remainingSeconds(b, "B", 300_000)).toBe(60); // B идёт: 300 - 240
  });

  it("переход между вопросами ОДНОГО раздела не перезапускает отсчёт", () => {
    const first = enterSection(EMPTY, "A", 10, 0);
    const same = enterSection(first, "A", 10, 60_000);
    expect(remainingSeconds(same, "A", 60_000)).toBe(540);
  });

  it("исчерпанный раздел закрыт и больше времени не получает", () => {
    const b = enterSection(EMPTY, "A", 1, 0);
    expect(isSpent(b, "A", 60_000)).toBe(true);
    expect(spentTopics(b, 60_000)).toEqual(["A"]);
    const back = enterSection(pauseAll(b, 60_000), "A", 1, 120_000);
    expect(remainingSeconds(back, "A", 120_000)).toBe(0);
  });

  it("раздел без лимита бюджета не имеет", () => {
    const b = enterSection(EMPTY, "C", null, 0);
    expect(remainingSeconds(b, "C", 10_000)).toBeNull();
    expect(spentTopics(b, 10_000)).toEqual([]);
  });
});

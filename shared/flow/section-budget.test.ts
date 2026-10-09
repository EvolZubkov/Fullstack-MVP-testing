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
  readGate,
  isClosed,
  closesOnLeave,
  testClosesOnLeave,
  openSection,
  closeSection,
  leaveSection,
  lockedSections,
  EMPTY_GATE,
  WHOLE_TEST_SECTION,
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

describe("PRD-67: закрытие раздела при выходе", () => {
  it("настройка действует только там, где есть лимит", () => {
    expect(closesOnLeave({ enabled: false, testLimitMinutes: 60, sectionLimitMinutes: 10 })).toBe(false);
    expect(closesOnLeave({ enabled: true, testLimitMinutes: null, sectionLimitMinutes: null })).toBe(false);
    expect(closesOnLeave({ enabled: true, testLimitMinutes: 0, sectionLimitMinutes: 10 })).toBe(true);
    // раздел без своего лимита под общим лимитом теста
    expect(closesOnLeave({ enabled: true, testLimitMinutes: 60, sectionLimitMinutes: null })).toBe(true);
  });

  it("выход при включённой настройке закрывает раздел и обнуляет его бюджет", () => {
    const budgets = enterSection(EMPTY, "A", 10, 0);
    const gate = openSection(EMPTY_GATE, "A");
    const left = leaveSection(gate, budgets, 60_000, true);
    expect(left.closed).toBe("A");
    expect(left.gate).toEqual({ open: null, closed: ["A"] });
    expect(remainingSeconds(left.budgets, "A", 60_000)).toBe(0);
    expect(lockedSections(left.gate, left.budgets, 60_000)).toEqual(["A"]);
  });

  it("возврат не даёт ни времени, ни повторного открытия", () => {
    const left = leaveSection(openSection(EMPTY_GATE, "A"), enterSection(EMPTY, "A", 10, 0), 60_000, true);
    expect(openSection(left.gate, "A")).toBe(left.gate); // закрытый не открывается
    const back = enterSection(left.budgets, "A", 10, 1_800_000);
    expect(remainingSeconds(back, "A", 1_800_000)).toBe(0);
  });

  it("без настройки выход лишь замораживает — прежнее правило", () => {
    const left = leaveSection(openSection(EMPTY_GATE, "A"), enterSection(EMPTY, "A", 10, 0), 60_000, false);
    expect(left.closed).toBeNull();
    expect(left.gate).toEqual({ open: null, closed: [] });
    expect(remainingSeconds(left.budgets, "A", 60_000)).toBe(540);
  });

  it("раздел без своего бюджета закрывается одним списком", () => {
    const left = leaveSection(openSection(EMPTY_GATE, "B"), EMPTY, 0, true);
    expect(left.budgets).toBe(EMPTY);
    expect(isClosed(left.gate, "B")).toBe(true);
    expect(lockedSections(left.gate, left.budgets, 0)).toEqual(["B"]);
  });

  it("тест без разделов — один неявный раздел", () => {
    const left = leaveSection(openSection(EMPTY_GATE, WHOLE_TEST_SECTION), EMPTY, 0, true);
    expect(left.closed).toBe(WHOLE_TEST_SECTION);
  });

  it("повторное закрытие не дублирует раздел в списке", () => {
    const once = closeSection(EMPTY_GATE, EMPTY, "A");
    const twice = closeSection(once.gate, once.budgets, "A");
    expect(twice.gate.closed).toEqual(["A"]);
  });

  it("выход без открытого раздела ничего не закрывает", () => {
    const left = leaveSection(EMPTY_GATE, EMPTY, 0, true);
    expect(left.closed).toBeNull();
    expect(left.gate).toBe(EMPTY_GATE);
  });

  it("тест под действием настройки: включена и есть хоть один лимит", () => {
    expect(testClosesOnLeave({ enabled: true, testLimitMinutes: null, sectionLimitMinutes: [null, 0] })).toBe(false);
    expect(testClosesOnLeave({ enabled: true, testLimitMinutes: null, sectionLimitMinutes: [null, 15] })).toBe(true);
    expect(testClosesOnLeave({ enabled: true, testLimitMinutes: 60, sectionLimitMinutes: [] })).toBe(true);
    expect(testClosesOnLeave({ enabled: false, testLimitMinutes: 60, sectionLimitMinutes: [15] })).toBe(false);
  });

  it("испорченное или прежнее состояние читается как «ничего не закрыто»", () => {
    expect(readGate(undefined)).toEqual({ open: null, closed: [] });
    expect(readGate("мусор")).toEqual({ open: null, closed: [] });
    expect(readGate({ open: 5, closed: ["A", 7] })).toEqual({ open: null, closed: ["A"] });
  });
});

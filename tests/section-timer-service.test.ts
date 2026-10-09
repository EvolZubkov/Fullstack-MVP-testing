/**
 * @module tests/section-timer-service
 * @description Серверный арбитр времени раздела (`services/section-timer`). Именно
 * он, а не браузер, решает «сколько осталось» — поэтому здесь проверяется то, ради
 * чего остаток переехал на сервер: время идёт только внутри раздела, уход
 * замораживает остаток, возврат продолжает с него, а молчащий клиент (закрытая
 * вкладка) списывает не больше окна прощения.
 */
import { describe, it, expect } from "vitest";
import {
  applyPing,
  readState,
  buildLeavePolicy,
  freezeLockedAnswers,
  GRACE_MS,
  CLOSE_GAP_MS,
  type SectionTimerState,
} from "../server/services/section-timer";
import { WHOLE_TEST_SECTION } from "../shared/flow/section-budget";

const T0 = 1_700_000_000_000;
const fresh = (): SectionTimerState => readState(null);

describe("серверный таймер раздела", () => {
  it("первый вход открывает раздел на полный лимит", () => {
    const { view } = applyPing(fresh(), "A", 10, T0);
    expect(view.remainingSeconds).toBe(600);
    expect(view.lockedTopics).toEqual([]);
  });

  it("время идёт, пока приходят пинги изнутри раздела", () => {
    const first = applyPing(fresh(), "A", 10, T0);
    const later = applyPing(first.state, "A", 10, T0 + 10_000);
    expect(later.view.remainingSeconds).toBe(590);
  });

  it("вне раздела время не тратится", () => {
    const inside = applyPing(fresh(), "A", 10, T0);
    const left = applyPing(inside.state, null, null, T0 + 10_000); // ушли на хаб
    const idle = applyPing(left.state, null, null, T0 + 20_000); // и стоим там
    expect(idle.view.remainingSeconds).toBeNull(); // вне раздела показывать нечего
    // Вернулись: остаток тот же, что был на выходе.
    const back = applyPing(idle.state, "A", 10, T0 + 20_000);
    expect(back.view.remainingSeconds).toBe(590);
  });

  it("закрытая вкладка списывает не больше окна прощения", () => {
    const inside = applyPing(fresh(), "A", 10, T0);
    // Клиент замолчал на час, следующий пинг — при возврате.
    const back = applyPing(inside.state, "A", 10, T0 + 3_600_000);
    expect(back.view.remainingSeconds).toBe(600 - GRACE_MS / 1000);
  });

  it("исчерпанный раздел блокируется и не получает времени при возврате", () => {
    let state = applyPing(fresh(), "A", 1, T0).state; // лимит 1 минута
    // Шесть пингов по 10 секунд — минута внутри раздела.
    for (let i = 1; i <= 6; i++) state = applyPing(state, "A", 1, T0 + i * 10_000).state;
    const spent = applyPing(state, "A", 1, T0 + 60_000);
    expect(spent.view.remainingSeconds).toBe(0);
    expect(spent.view.lockedTopics).toEqual(["A"]);
    const back = applyPing(spent.state, "A", 1, T0 + 600_000);
    expect(back.view.remainingSeconds).toBe(0);
  });

  it("переход в другой раздел замораживает предыдущий", () => {
    const a = applyPing(fresh(), "A", 10, T0);
    const b = applyPing(a.state, "B", 5, T0 + 10_000);
    expect(b.view.remainingSeconds).toBe(300);
    const backToA = applyPing(b.state, "A", 10, T0 + 20_000);
    expect(backToA.view.remainingSeconds).toBe(590); // A простоял, пока шёл B
  });

  it("раздел без лимита счётчика не имеет", () => {
    const { view } = applyPing(fresh(), "C", null, T0);
    expect(view.remainingSeconds).toBeNull();
    expect(view.lockedTopics).toEqual([]);
  });

  it("состояние читается из сырого JSON и переживает мусор", () => {
    const blank = { budgets: {}, lastSeenAt: 0, activeMs: 0, runId: null, gate: { open: null, closed: [] } };
    expect(readState(null)).toEqual(blank);
    expect(readState("сломано")).toEqual(blank);
    // Строка, записанная до PRD-67, читается без закрытых разделов и без прогона.
    expect(readState({ budgets: { A: { remainingMs: 5, runningSince: null } }, lastSeenAt: 7, activeMs: 9 })).toEqual({
      budgets: { A: { remainingMs: 5, runningSince: null } },
      lastSeenAt: 7,
      activeMs: 9,
      runId: null,
      gate: { open: null, closed: [] },
    });
  });
});

describe("PRD-67: закрытие раздела при выходе", () => {
  const sectioned = buildLeavePolicy({
    closeSectionOnLeave: true,
    testLimitMinutes: null,
    sectionLimits: new Map([["A", 10], ["B", 5], ["C", null]]),
    flat: false,
  });

  it("перезагрузка страницы (новый runId) закрывает открытый раздел", () => {
    const inside = applyPing(fresh(), "A", 10, T0, "run-1", sectioned);
    const reload = applyPing(inside.state, "A", 10, T0 + 5_000, "run-2", sectioned);
    expect(reload.view.remainingSeconds).toBe(0);
    expect(reload.view.lockedTopics).toEqual(["A"]);
    expect(reload.view.closedTopics).toEqual(["A"]);
  });

  it("тот же прогон без перерыва раздел не закрывает", () => {
    const inside = applyPing(fresh(), "A", 10, T0, "run-1", sectioned);
    const later = applyPing(inside.state, "A", 10, T0 + 10_000, "run-1", sectioned);
    expect(later.view.remainingSeconds).toBe(590);
    expect(later.view.closedTopics).toEqual([]);
  });

  it("короткий обрыв связи списывается полностью, но раздел живёт", () => {
    const inside = applyPing(fresh(), "A", 10, T0, "run-1", sectioned);
    const back = applyPing(inside.state, "A", 10, T0 + 90_000, "run-1", sectioned);
    expect(back.view.remainingSeconds).toBe(510); // 600 - 90, а не 600 - 30
    expect(back.view.closedTopics).toEqual([]);
  });

  it("долгое молчание той же страницы (сон ноутбука) закрывает раздел", () => {
    const inside = applyPing(fresh(), "A", 10, T0, "run-1", sectioned);
    const woke = applyPing(inside.state, "A", 10, T0 + CLOSE_GAP_MS + 1_000, "run-1", sectioned);
    expect(woke.view.remainingSeconds).toBe(0);
    expect(woke.view.closedTopics).toEqual(["A"]);
  });

  it("переход в другой раздел закрывает предыдущий навсегда", () => {
    const a = applyPing(fresh(), "A", 10, T0, "run-1", sectioned);
    const b = applyPing(a.state, "B", 5, T0 + 10_000, "run-1", sectioned);
    expect(b.view.remainingSeconds).toBe(300);
    const backToA = applyPing(b.state, "A", 10, T0 + 20_000, "run-1", sectioned);
    expect(backToA.view.remainingSeconds).toBe(0);
    expect(backToA.view.closedTopics).toEqual(["A", "B"]);
  });

  it("раздел без лимита в тесте без общего лимита не закрывается", () => {
    const c = applyPing(fresh(), "C", null, T0, "run-1", sectioned);
    const reload = applyPing(c.state, "C", null, T0 + 5_000, "run-2", sectioned);
    expect(reload.view.remainingSeconds).toBeNull();
    expect(reload.view.closedTopics).toEqual([]);
  });

  it("под общим лимитом теста закрывается и раздел без своего лимита", () => {
    const testLimited = buildLeavePolicy({
      closeSectionOnLeave: true,
      testLimitMinutes: 60,
      sectionLimits: new Map([["C", null]]),
      flat: false,
    });
    const c = applyPing(fresh(), "C", null, T0, "run-1", testLimited);
    const reload = applyPing(c.state, "C", null, T0 + 5_000, "run-2", testLimited);
    expect(reload.view.remainingSeconds).toBe(0);
    expect(reload.view.lockedTopics).toEqual(["C"]);
  });

  it("тест без разделов: выход закрывает весь тест", () => {
    const flat = buildLeavePolicy({
      closeSectionOnLeave: true,
      testLimitMinutes: 30,
      sectionLimits: new Map([["A", null], ["B", null]]),
      flat: true,
    });
    const a = applyPing(fresh(), "A", null, T0, "run-1", flat);
    // Переход между темами плоского теста — не выход.
    const b = applyPing(a.state, "B", null, T0 + 10_000, "run-1", flat);
    expect(b.view.closedTopics).toEqual([]);
    const reload = applyPing(b.state, "B", null, T0 + 15_000, "run-2", flat);
    expect(reload.view.closedTopics).toEqual([WHOLE_TEST_SECTION]);
  });

  it("без настройки новый runId ничего не закрывает", () => {
    const off = buildLeavePolicy({
      closeSectionOnLeave: false,
      testLimitMinutes: 60,
      sectionLimits: new Map([["A", 10]]),
      flat: false,
    });
    const inside = applyPing(fresh(), "A", 10, T0, "run-1", off);
    const reload = applyPing(inside.state, "A", 10, T0 + 5_000, "run-2", off);
    expect(reload.view.remainingSeconds).toBe(595);
    expect(reload.view.closedTopics).toEqual([]);
  });
});

describe("PRD-67 FR-10: ответы закрытого раздела заморожены", () => {
  const sections = [
    { topicId: "A", questionIds: ["a1", "a2"] },
    { topicId: "B", questionIds: ["b1"] },
  ];

  it("ответы открытых разделов проходят как есть", () => {
    const out = freezeLockedAnswers({ a1: 1, b1: 2 }, {}, sections, null);
    expect(out).toEqual({ a1: 1, b1: 2 });
  });

  it("ответ в закрытый раздел не меняет сохранённый", () => {
    const timer = { gate: { open: null, closed: ["A"] } };
    const out = freezeLockedAnswers({ a1: 9, a2: 9, b1: 2 }, { a1: 1 }, sections, timer);
    expect(out).toEqual({ a1: 1, b1: 2 }); // a2 не был отвечен до закрытия — и не будет
  });

  it("исчерпанный по времени раздел заморожен так же", () => {
    const timer = { budgets: { B: { remainingMs: 0, runningSince: null } }, activeMs: 1 };
    const out = freezeLockedAnswers({ a1: 1, b1: 7 }, { b1: 2 }, sections, timer);
    expect(out).toEqual({ a1: 1, b1: 2 });
  });

  it("закрытый тест без разделов замораживает все ответы", () => {
    const timer = { gate: { open: null, closed: [WHOLE_TEST_SECTION] } };
    const out = freezeLockedAnswers({ a1: 9, b1: 9 }, { a1: 1 }, sections, timer);
    expect(out).toEqual({ a1: 1 });
  });
});

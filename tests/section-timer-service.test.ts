/**
 * @module tests/section-timer-service
 * @description Серверный арбитр времени раздела (`services/section-timer`). Именно
 * он, а не браузер, решает «сколько осталось» — поэтому здесь проверяется то, ради
 * чего остаток переехал на сервер: время идёт только внутри раздела, уход
 * замораживает остаток, возврат продолжает с него, а молчащий клиент (закрытая
 * вкладка) списывает не больше окна прощения.
 */
import { describe, it, expect } from "vitest";
import { applyPing, readState, GRACE_MS, type SectionTimerState } from "../server/services/section-timer";

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
    expect(readState(null)).toEqual({ budgets: {}, lastSeenAt: 0, activeMs: 0 });
    expect(readState("сломано")).toEqual({ budgets: {}, lastSeenAt: 0, activeMs: 0 });
    expect(readState({ budgets: { A: { remainingMs: 5, runningSince: null } }, lastSeenAt: 7, activeMs: 9 })).toEqual({
      budgets: { A: { remainingMs: 5, runningSince: null } },
      lastSeenAt: 7,
      activeMs: 9,
    });
  });
});

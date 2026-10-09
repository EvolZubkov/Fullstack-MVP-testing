/**
 * @module tests/run-state-migration
 * @description PRD-36 FR-12/FR-13, §7: пакет после правки встречает состояние, записанное
 * пакетом ДО неё. Счётчик попыток, лучшая, последняя и обе даты барьеров обязаны пережить
 * приведение — на них стоят лимит попыток, кулдаун PRD-6 и интервал PRD-31.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${src}\nreturn TBRunState;`)() as any;

const TEST_DATA = {
  sections: [{ topicId: "t1", questions: [{ id: "q1" }, { id: "q2" }] }],
  breakdownKeys: [],
};

const legacyAttempt = (n: number, percent: number, at: string) => ({
  attemptNumber: n,
  completedAt: at,
  completedAtSource: "portal",
  percent,
  passed: percent >= 60,
  totalCorrect: 1,
  totalQuestions: 2,
  earnedPoints: 1,
  possiblePoints: 2,
  topicResults: [{
    topicId: "t1", topicName: "Тема", correct: 1, total: 2,
    earnedPoints: 1, possiblePoints: 2, percent, passed: percent >= 60,
  }],
  answers: { q1: 0 },
  flatQuestions: [{ topicId: "t1", question: { id: "q1", type: "single" } }],
});

const legacy = {
  attemptsUsed: 2,
  attempts: [
    legacyAttempt(1, 40, "2026-08-01T10:00:00.000Z"),
    legacyAttempt(2, 90, "2026-08-02T10:00:00.000Z"),
  ],
  timer: { limitMinutes: 30, baselineTotalSec: 120, sig: "abc" },
  retake: { lastCompletedDate: "2026-08-02" },
  // PRD-4: остаток времени по разделам пишет таймер, а не учёт попыток.
  sectionBudgets: { "topic-1": { remainingMs: 420000 } },
};

describe("приведение формата 1 к формату 2", () => {
  it("счётчик попыток сохраняется", () => {
    expect(RS.migrate(legacy, TEST_DATA).attemptsUsed).toBe(2);
  });

  it("лучшая выбирается по проценту, последняя — по хвосту массива", () => {
    const s = RS.migrate(legacy, TEST_DATA);
    expect(s.best.pc).toBe(90);
    expect(s.last).toBe(0); // лучшая и последняя совпали
  });

  it("последняя хранится отдельно, когда она не лучшая", () => {
    const s = RS.migrate(
      {
        ...legacy,
        attempts: [legacyAttempt(1, 90, "2026-08-01T10:00:00.000Z"), legacyAttempt(2, 40, "2026-08-02T10:00:00.000Z")],
      },
      TEST_DATA,
    );
    expect(s.best.pc).toBe(90);
    expect(s.last.pc).toBe(40);
  });

  it("остаток времени по разделам переживает приведение", () => {
    // Потеря этого поля подарила бы ученику полный лимит раздела заново — молча и
    // ровно там, где идёт секционный тест с ограничением времени.
    expect(RS.migrate(legacy, TEST_DATA).sectionBudgets).toEqual({ "topic-1": { remainingMs: 420000 } });
  });

  it("якорь таймера и дата кулдауна не трогаются", () => {
    const s = RS.migrate(legacy, TEST_DATA);
    expect(s.timer).toEqual(legacy.timer);
    expect(s.retake).toEqual(legacy.retake);
  });

  it("содержимое вопросов и названия тем при приведении отбрасываются", () => {
    const raw = JSON.stringify(RS.migrate(legacy, TEST_DATA));
    expect(raw).not.toContain("flatQuestions");
    expect(raw).not.toContain("Тема");
  });

  it("тема приведённой попытки адресуется номером раздела", () => {
    expect(RS.migrate(legacy, TEST_DATA).best.t[0].s).toBe(0);
  });

  it("пустое состояние приводится к пустому формату 2", () => {
    const s = RS.migrate({ attemptsUsed: 0, attempts: [] }, TEST_DATA);
    expect(s.v).toBe(2);
    expect(s.attemptsUsed).toBe(0);
    expect(s.best).toBeNull();
  });

  it("состояние формата 2 проходит насквозь", () => {
    const v2 = { v: 2, fp: RS.fingerprint(TEST_DATA), attemptsUsed: 1, best: null, last: 0 };
    expect(RS.migrate(v2, TEST_DATA)).toEqual(v2);
  });

  it("состояние ЧУЖОГО пакета теряет детализацию, но сохраняет счётчик и барьеры", () => {
    const alien = {
      v: 2,
      fp: "9:1,1,1,1,1,1,1,1,1:0",
      attemptsUsed: 2,
      best: { n: 2, at: "2026-08-02T10:00:00.000Z", pc: 90, ok: true, t: [], d: { dl: "0.0" } },
      last: 0,
      currentSession: { at: "2026-08-02T10:00:00.000Z", i: 1, dl: "0.0", an: "1", st: "a" },
      timer: legacy.timer,
      retake: legacy.retake,
    };
    const s = RS.migrate(alien, TEST_DATA);
    expect(s.attemptsUsed).toBe(2);
    expect(s.retake).toEqual(legacy.retake);
    expect(s.timer).toEqual(legacy.timer);
    // Позиции чужого пакета адресуют ДРУГИЕ вопросы — детализация и прогон отбрасываются.
    expect(s.best.d).toBeUndefined();
    expect(s.currentSession).toBeNull();
  });
});

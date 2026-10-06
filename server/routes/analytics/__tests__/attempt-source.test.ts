/**
 * @module server/routes/analytics/__tests__/attempt-source
 * @description PRD-54 раздел 12: как аналитика определяет тест и подписывает участника, когда
 * источников у прохождения стало два.
 */
import { describe, it, expect } from "vitest";
import { attemptTestId, attemptParticipant } from "../helpers";

describe("attemptTestId", () => {
  it("у импорта тест берётся из самой попытки", () => {
    expect(attemptTestId({ testId: "t1", packageId: null }, new Map())).toBe("t1");
  });

  it("у телеметрии после backfill — тоже из попытки, пакет не нужен", () => {
    const pkgs = new Map([["p1", { testId: "t2" }]]);
    expect(attemptTestId({ testId: "t1", packageId: "p1" }, pkgs)).toBe("t1");
  });

  it("у строки без test_id — запасной путь через пакет", () => {
    // Такие строки остались от пакетов, чей тест уже удалён: backfill им ничего не проставил.
    const pkgs = new Map([["p1", { testId: "t2" }]]);
    expect(attemptTestId({ testId: null, packageId: "p1" }, pkgs)).toBe("t2");
  });

  it("ни теста, ни пакета — null, а не выдуманный идентификатор", () => {
    expect(attemptTestId({ testId: null, packageId: null }, new Map())).toBeNull();
    expect(attemptTestId({ testId: null, packageId: "нет-такого" }, new Map())).toBeNull();
  });
});

describe("attemptParticipant", () => {
  const users = new Map([["u1", { name: "Иванов" }]]);

  it("связанная строка подписывается именем пользователя", () => {
    // Связь на то и заводилась, чтобы видеть человека: она перебивает псевдоним.
    const a = { userId: "u1", participantKey: "abc123def", lmsUserName: null };
    expect(attemptParticipant(a, users)).toBe("Иванов");
  });

  it("несвязанная обезличенная — псевдонимом по префиксу ключа", () => {
    // Полные 64 знака в таблице нечитаемы, шести хватает, чтобы различать участников глазами.
    const a = { userId: null, participantKey: "abc123def", lmsUserName: null };
    expect(attemptParticipant(a, new Map())).toBe("Участник abc123de");
  });

  it("телеметрия — именем из LMS", () => {
    const a = { userId: null, participantKey: null, lmsUserName: "Петров" };
    expect(attemptParticipant(a, new Map())).toBe("Петров");
  });

  it("связь на удалённого пользователя откатывается к псевдониму, а не к пустоте", () => {
    const a = { userId: "нет-такого", participantKey: "abc123def", lmsUserName: null };
    expect(attemptParticipant(a, users)).toBe("Участник abc123de");
  });

  it("совсем без признаков — понятная заглушка", () => {
    const a = { userId: null, participantKey: null, lmsUserName: null };
    expect(attemptParticipant(a, new Map())).toBe("Неизвестный участник");
  });
});

/**
 * @module server/services/analytics/__tests__/slice-axis
 * @description PRD-56 FR-06a: ось разбиения — все срезы по одному признаку сразу.
 *
 * Ось отвечает на «покажи мне все группы», а не «покажи вот эту». Проверяется состав срезов и
 * то, что ни одно прохождение не пропадает: строка «без группы» существует именно ради этого
 * (FR-09) — исчезнувшее прохождение читается как «таких нет», а не «у них не проставлен признак».
 */

import { describe, expect, it } from "vitest";

import type { Observation } from "../observations";
import { registryConditions, splitByAxis, type AxisContext } from "../slice-axis";

function observation(over: Partial<Observation> = {}): Observation {
  return {
    id: "o1",
    source: "web",
    testId: "test1",
    userId: "u1",
    participant: "Морозова Анна",
    participantKey: null,
    participantId: "u1",
    groupId: null,
    startedAt: new Date("2026-09-11T14:00:00Z"),
    finishedAt: new Date("2026-09-11T14:20:00Z"),
    durationMs: 1_200_000,
    percent: 80,
    passed: true,
    earnedPoints: 16,
    possiblePoints: 20,
    outcome: "passed",
    adaptive: false,
    snapshotId: null,
    forms: {},
    ...over,
  };
}

const context: AxisContext = {
  groupsOfParticipant: new Map([
    ["u1", ["g1"]],
    ["u2", ["g1", "g2"]],
  ]),
  groupNames: new Map([["g1", "Отдел продаж"], ["g2", "Розница"]]),
  externalParticipants: new Set(["u2"]),
  snapshotVersions: new Map([["snap-1", 3]]),
  formLabels: new Map([["form-A", "Форма A"], ["form-B", "Форма B"]]),
};

describe("splitByAxis", () => {
  it("разбивает по группе, беря членство участника", () => {
    const buckets = splitByAxis(
      [observation({ id: "a", participantId: "u1" }), observation({ id: "b", participantId: "u2" })],
      "group",
      context,
    );

    expect(buckets.map(b => b.label)).toEqual(
      expect.arrayContaining(["Отдел продаж", "Розница"]),
    );
    const sales = buckets.find(b => b.label === "Отдел продаж")!;
    expect(sales.observations.map(o => o.id)).toEqual(["a", "b"]);
  });

  it("не теряет прохождение вне групп: оно попадает в «без группы»", () => {
    const buckets = splitByAxis(
      [observation({ id: "lonely", participantId: "u-nobody" })],
      "group",
      context,
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe("Без группы");
  });

  it("берёт у импортированной строки её собственную метку группы", () => {
    // У импорта участник может быть не заведён вовсе — метку проставил импорт (PRD-54).
    const buckets = splitByAxis(
      [observation({ id: "imported", source: "import", participantId: null, groupId: "g2" })],
      "group",
      context,
    );

    expect(buckets[0].label).toBe("Розница");
  });

  it("разбивает по потоку — календарному месяцу начала", () => {
    const buckets = splitByAxis(
      [
        observation({ id: "sep", startedAt: new Date("2026-09-03T10:00:00Z") }),
        observation({ id: "oct", startedAt: new Date("2026-10-01T10:00:00Z") }),
      ],
      "period",
      context,
    );

    expect(buckets.map(b => b.key)).toEqual(["2026-09", "2026-10"]);
  });

  it("разбивает по номеру попытки: первая против повторных", () => {
    const buckets = splitByAxis(
      [
        observation({ id: "first", participantId: "u1", startedAt: new Date("2026-09-01T10:00:00Z") }),
        observation({ id: "second", participantId: "u1", startedAt: new Date("2026-09-05T10:00:00Z") }),
        observation({ id: "third", participantId: "u1", startedAt: new Date("2026-09-09T10:00:00Z") }),
      ],
      "attempt",
      context,
    );

    expect(buckets.map(b => b.label)).toEqual(["Первая попытка", "Вторая попытка", "Третья и далее"]);
    expect(buckets[0].observations.map(o => o.id)).toEqual(["first"]);
    expect(buckets[2].observations.map(o => o.id)).toEqual(["third"]);
  });

  it("номер попытки из выгрузки не даёт назвать первой ту, перед которой были другие (PRD-54, решение 13)", () => {
    // Из регистрации в LMS ушла вторая попытка; порядок по времени назвал бы её первой.
    const buckets = splitByAxis(
      [
        observation({ id: "imported", participantId: "u1", source: "import", reportedAttempt: 2, startedAt: new Date("2026-09-01T10:00:00Z") }),
        observation({ id: "later", participantId: "u1", startedAt: new Date("2026-09-05T10:00:00Z") }),
      ],
      "attempt",
      context,
    );

    expect(buckets.map(b => b.label)).toEqual(["Вторая попытка", "Третья и далее"]);
    expect(buckets[0].observations.map(o => o.id)).toEqual(["imported"]);
  });

  it("разбивает по версии публикации и называет прохождения без неё", () => {
    const buckets = splitByAxis(
      [
        observation({ id: "v3", snapshotId: "snap-1" }),
        observation({ id: "lms", source: "telemetry", snapshotId: null }),
      ],
      "version",
      context,
    );

    expect(buckets.map(b => b.label)).toEqual(
      expect.arrayContaining(["Версия 3", "Версия не указана"]),
    );
  });

  it("разбивает по варианту выдачи и называет его словами автора", () => {
    // Идентификатор формы — uuid: подписать им срез значит не подписать его вовсе.
    const buckets = splitByAxis(
      [
        observation({ id: "a", forms: { "topic-1": "form-A" } }),
        observation({ id: "b", forms: {} }),
      ],
      "variant",
      context,
    );

    expect(buckets.map(b => b.label)).toEqual(
      expect.arrayContaining(["Форма A", "Без варианта"]),
    );
  });

  it("прохождение попадает в строку КАЖДОГО своего варианта", () => {
    // У теста с двумя наборами форм вариантов у прохождения два — как групп у участника.
    const buckets = splitByAxis(
      [observation({ id: "a", forms: { "topic-1": "form-A", "topic-2": "form-B" } })],
      "variant",
      context,
    );

    expect(buckets.map(b => b.label).sort()).toEqual(["Форма A", "Форма B"]);
    expect(buckets.every(b => b.observations.length === 1)).toBe(true);
  });

  it("разбивает по источнику", () => {
    const buckets = splitByAxis(
      [
        observation({ id: "w", source: "web" }),
        observation({ id: "t", source: "telemetry" }),
        observation({ id: "i", source: "import" }),
      ],
      "source",
      context,
    );

    expect(buckets.map(b => b.label)).toEqual(
      expect.arrayContaining(["Веб", "Телеметрия LMS", "Импорт"]),
    );
  });

  it("разбивает на внутренних и внешних участников", () => {
    const buckets = splitByAxis(
      [
        observation({ id: "inside", participantId: "u1" }),
        observation({ id: "outside", participantId: "u2" }),
      ],
      "external",
      context,
    );

    const external = buckets.find(b => b.key === "external")!;
    expect(external.observations.map(o => o.id)).toEqual(["outside"]);
  });

  it("не выдумывает срезов на пустой выборке", () => {
    expect(splitByAxis([], "group", context)).toEqual([]);
  });
});

/**
 * PRD-56 FR-08: из любой строки — переход в реестр с предзаполненным фильтром.
 *
 * Реестр отбирает своим языком условий (тест, группа, источник, исход, период), и срез оси
 * должен быть на него переведён. Перевод честный: там, где условия реестра такого признака не
 * знают (номер попытки, версия публикации, вариант выдачи, внешний участник), выдаётся пусто —
 * иначе реестр показал бы ДРУГУЮ выборку под именем среза, и числа разошлись бы молча.
 */
describe("registryConditions", () => {
  it("переводит группу в условие по группе", () => {
    expect(registryConditions("group", "g1")).toEqual({ groupIds: ["g1"] });
  });

  it("переводит источник в условие по источнику", () => {
    expect(registryConditions("source", "telemetry")).toEqual({ sources: ["telemetry"] });
  });

  it("переводит месяц в период от первого до последнего дня", () => {
    // Февраль високосного года: последний день считается, а не берётся из таблицы «30/31».
    expect(registryConditions("period", "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(registryConditions("period", "2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("ничего не выдумывает для срезов «без признака»", () => {
    // «Без группы» — это отсутствие условия, а не условие: отбор по нему в реестре невыразим.
    expect(registryConditions("group", "none")).toEqual({});
    expect(registryConditions("variant", "none")).toEqual({});
  });

  // Вариант и версия заведены условиями отбора наравне с группой, поэтому переводятся точно:
  // переход «из строки среза в прохождения» открывает тот же состав, что в строке.
  it("переводит вариант выдачи и версию публикации", () => {
    expect(registryConditions("version", "snap-1")).toEqual({ snapshotIds: ["snap-1"] });
    expect(registryConditions("variant", "form-a")).toEqual({ formIds: ["form-a"] });
  });

  it("молчит там, где у реестра такого условия нет", () => {
    // Номер попытки и признак внешнего участника условиями отбора не выражаются: подменить
    // невыразимое условие похожим значило бы показать ДРУГУЮ выборку под именем среза.
    expect(registryConditions("attempt", "2")).toEqual({});
    expect(registryConditions("external", "external")).toEqual({});
  });
});

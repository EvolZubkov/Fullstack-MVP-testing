/**
 * @module server/services/analytics/__tests__/delivery-stats
 * @description PRD-56 FR-18 - FR-20: расчёты вкладки «Выдача».
 */
import { describe, it, expect } from "vitest";

import { variantStats, versionStats, exposureProfile } from "../delivery-stats";
import type { Observation } from "../observations";

const OPTS = { minObservations: 10 };

/** Прохождение: завершённое, оценённое и сдавшее, если не сказано иное. */
function observation(over: Partial<Observation> = {}): Observation {
  return {
    id: Math.random().toString(36).slice(2),
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

/** `n` прохождений одного варианта: `passed` из них сданы. */
function runs(n: number, passed: number, over: Partial<Observation> = {}): Observation[] {
  return Array.from({ length: n }, (_, i) => observation({
    ...over,
    passed: i < passed,
    outcome: i < passed ? "passed" : "failed",
    percent: i < passed ? 80 : 50,
  }));
}

const SECTIONS = [{
  topicId: "tp-1",
  topicName: "Право и комплаенс",
  forms: [{ id: "form-a", label: "Форма A" }, { id: "form-b", label: "Форма B" }],
}];

describe("variantStats (FR-18)", () => {
  it("считает прохождения, долю сдавших и средний результат по каждому варианту", () => {
    const [section] = variantStats(
      [
        ...runs(10, 9, { forms: { "tp-1": "form-a" } }),
        ...runs(10, 5, { forms: { "tp-1": "form-b" } }),
      ],
      SECTIONS,
      OPTS,
    );

    expect(section.topicName).toBe("Право и комплаенс");
    expect(section.rows.map(r => ({ label: r.label, attempts: r.attempts, passRate: r.passRate })))
      .toEqual([
        { label: "Форма A", attempts: 10, passRate: 90 },
        { label: "Форма B", attempts: 10, passRate: 50 },
      ]);
  });

  it("расхождение считается К ТЕСТУ, а не к соседнему варианту", () => {
    // По тесту сдали 14 из 20 = 70 %; у формы B 50 % — это −20 п.п. к тесту.
    const observations = [
      ...runs(10, 9, { forms: { "tp-1": "form-a" } }),
      ...runs(10, 5, { forms: { "tp-1": "form-b" } }),
    ];
    const [section] = variantStats(observations, SECTIONS, OPTS);

    expect(section.rows[1].deltaPoints).toBe(-20);
    expect(section.rows[1].deviates).toBe(true);
    // Форма A выше теста на 20 п.п. — расхождение работает в обе стороны.
    expect(section.rows[0].deltaPoints).toBe(20);
  });

  it("небольшой разброс расхождением не объявляется", () => {
    const observations = [
      ...runs(10, 8, { forms: { "tp-1": "form-a" } }),
      ...runs(10, 7, { forms: { "tp-1": "form-b" } }),
    ];
    const [section] = variantStats(observations, SECTIONS, OPTS);

    expect(section.rows.every(r => r.deviates)).toBe(false);
  });

  it("вариант ниже порога наблюдений вердикта не получает", () => {
    // Восьми прохождениям доверительный интервал доли около ±35 п.п.: у такого числа нет
    // ни доли сдавших, ни расхождения — только сам счёт прохождений.
    const [section] = variantStats(
      [
        ...runs(12, 10, { forms: { "tp-1": "form-a" } }),
        ...runs(8, 2, { forms: { "tp-1": "form-b" } }),
      ],
      SECTIONS,
      OPTS,
    );

    expect(section.rows[1]).toMatchObject({
      attempts: 8,
      lowSample: true,
      passRate: null,
      avgPercent: null,
      deltaPoints: null,
      deviates: false,
    });
  });

  it("вариант, который никто не проходил, остаётся строкой с нулём", () => {
    const [section] = variantStats(runs(10, 9, { forms: { "tp-1": "form-a" } }), SECTIONS, OPTS);

    expect(section.rows[1]).toMatchObject({ label: "Форма B", attempts: 0, passRate: null });
  });

  it("у теста без наборов форм таблицы нет вовсе", () => {
    expect(variantStats(runs(10, 9), [{ topicId: "tp-1", topicName: "Тема", forms: [] }], OPTS))
      .toEqual([]);
  });
});

describe("versionStats (FR-19)", () => {
  const SNAPSHOTS = [
    { id: "snap-1", version: 1, publishedAt: new Date("2026-01-02T00:00:00Z") },
    { id: "snap-2", version: 2, publishedAt: new Date("2026-03-15T00:00:00Z") },
    { id: "snap-3", version: 3, publishedAt: new Date("2026-07-01T00:00:00Z") },
  ];

  it("считает каждую версию отдельно, новые сверху", () => {
    const rows = versionStats(
      [
        ...runs(10, 9, { snapshotId: "snap-3" }),
        ...runs(10, 6, { snapshotId: "snap-2" }),
      ],
      SNAPSHOTS,
      OPTS,
    );

    expect(rows.map(r => r.version)).toEqual([3, 2, 1]);
    expect(rows[0]).toMatchObject({ version: 3, attempts: 10, passRate: 90, current: true });
    expect(rows[1]).toMatchObject({ version: 2, attempts: 10, passRate: 60, current: false });
  });

  it("период действия версии кончается публикацией следующей, у текущей конца нет", () => {
    const rows = versionStats([], SNAPSHOTS, OPTS);

    expect(rows[0].effectiveTo).toBeNull();
    expect(rows[1].effectiveTo?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("прохождения без версии идут ОТДЕЛЬНОЙ строкой, а не в текущую", () => {
    // Пакеты, собранные до FR-19a, версии не знают. Приписать их текущей версии значит
    // смешать в одном среднем прохождения до и после правки теста.
    const rows = versionStats(
      [...runs(10, 9, { snapshotId: "snap-3" }), ...runs(10, 2, { snapshotId: null })],
      SNAPSHOTS,
      OPTS,
    );

    const unknown = rows.at(-1)!;
    expect(unknown).toMatchObject({ snapshotId: null, version: null, attempts: 10, passRate: 20 });
    expect(rows[0].attempts).toBe(10);
  });

  it("версия, по которой ещё никто не проходил, остаётся в таблице", () => {
    // Пустая строка здесь и есть ответ: «после правки ещё никто не проходил».
    const rows = versionStats(runs(10, 9, { snapshotId: "snap-1" }), SNAPSHOTS, OPTS);

    expect(rows[0]).toMatchObject({ version: 3, attempts: 0, passRate: null });
  });

  it("строки «версия не указана» нет, когда таких прохождений нет", () => {
    const rows = versionStats(runs(10, 9, { snapshotId: "snap-3" }), SNAPSHOTS, OPTS);

    expect(rows.every(r => r.snapshotId !== null)).toBe(true);
  });
});

describe("exposureProfile (FR-20)", () => {
  const BANK = [
    { id: "q1", prompt: "Первый", type: "single", tags: ["Антикоррупция"], excluded: false },
    { id: "q2", prompt: "Второй", type: "multiple", tags: [], excluded: false },
    { id: "q3", prompt: "Третий", type: "single", tags: [], excluded: true },
    { id: "q4", prompt: "Четвёртый", type: "single", tags: [], excluded: false },
  ];

  const profile = (counts: Record<string, number>, attempts = 100) =>
    exposureProfile({
      topicId: "tp-1",
      topicName: "Право и комплаенс",
      drawCount: 2,
      bank: BANK,
      deliveredCounts: new Map(Object.entries(counts)),
      attemptsInWindow: attempts,
    });

  it("строит список по убыванию показов и считает долю прохождений", () => {
    const result = profile({ q1: 82, q2: 54, q4: 18 });

    expect(result.rows.map(r => r.questionId)).toEqual(["q1", "q2", "q4"]);
    expect(result.rows[0]).toMatchObject({ deliveredCount: 82, sharePercent: 82 });
    // Банк — пул выдачи (решение владельца 2026-09-26): исключённый q3 его не пополняет.
    expect(result.bankSize).toBe(3);
    expect(result.drawCount).toBe(2);
  });

  it("невыданные вопросы сворачиваются в одно число, а не в строки", () => {
    // Перечислять их поштучно незачем: список отвечает на «что выработано», а хвост — на
    // «сколько банка простаивает».
    const result = profile({ q1: 82 });

    expect(result.rows).toHaveLength(1);
    // q3 исключён: выдать его тест не может, и простоем банка он не считается.
    expect(result.neverDelivered).toBe(2);
  });

  it("исключённое из выдачи задание помечено, но из профиля не исчезает", () => {
    const result = profile({ q3: 12 });

    expect(result.rows[0]).toMatchObject({ questionId: "q3", excluded: true });
  });

  it("без единого прохождения доли нет, а не ноль", () => {
    const result = profile({}, 0);

    expect(result.rows).toEqual([]);
    expect(result.neverDelivered).toBe(3);
    expect(result.attemptsInWindow).toBe(0);
  });

  it("способ выдачи: квота — числом, у адаптива и вариантов квоты нет (2026-10-04)", () => {
    const base = { topicId: "tp-1", topicName: "Т", bank: BANK, deliveredCounts: new Map(), attemptsInWindow: 1 };
    expect(exposureProfile({ ...base, drawCount: 2 })).toMatchObject({ drawMode: "quota", drawCount: 2 });
    expect(exposureProfile({ ...base, drawCount: null })).toMatchObject({ drawMode: "all", drawCount: null });
    // У адаптива `draw_count` хранится нулём — в профиль он не уходит.
    expect(exposureProfile({ ...base, drawMode: "adaptive", drawCount: 0 })).toMatchObject({ drawMode: "adaptive", drawCount: null });
    expect(exposureProfile({ ...base, drawMode: "forms", drawCount: 5 })).toMatchObject({ drawMode: "forms", drawCount: null });
  });

  it("вопрос вне пула (не входит ни в один вариант) не считается ни банком, ни простоем", () => {
    const result = exposureProfile({
      topicId: "tp-1",
      topicName: "Право и комплаенс",
      drawCount: null,
      bank: [
        { ...BANK[0], inPool: true },
        { ...BANK[1], inPool: false },
        { ...BANK[3], inPool: false },
      ],
      // q4 выдавался раньше, до того как выпал из вариантов: история выдач остаётся строкой.
      deliveredCounts: new Map([["q4", 5]]),
      attemptsInWindow: 10,
    });

    expect(result.bankSize).toBe(1);
    expect(result.neverDelivered).toBe(1);
    expect(result.rows.map(r => r.questionId)).toEqual(["q4"]);
  });
});

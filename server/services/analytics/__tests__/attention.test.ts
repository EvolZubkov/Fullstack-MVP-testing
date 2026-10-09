/**
 * @module server/services/analytics/__tests__/attention
 * @description PRD-56 FR-10, FR-11: очередь «требует внимания».
 *
 * Единственный экран аналитики, который говорит «сделай». Поэтому проверяется не только состав
 * корзин, но и то, чего в очереди быть НЕ должно: тревога без основания стоит дороже пропущенной
 * строки — на неё тратят время, а потом перестают смотреть на экран вообще.
 */

import { describe, expect, it } from "vitest";

import { buildAttentionQueue, countAttention } from "../attention";
import type { Observation } from "../observations";

const NOW = new Date("2026-09-14T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

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
    startedAt: hoursAgo(100),
    finishedAt: hoursAgo(99),
    durationMs: 3_600_000,
    percent: 40,
    passed: false,
    earnedPoints: 8,
    possiblePoints: 20,
    outcome: "failed",
    adaptive: false,
    snapshotId: null,
    formId: null,
    ...over,
  };
}

function input(over: Partial<Parameters<typeof buildAttentionQueue>[0]> = {}) {
  return {
    assignments: [],
    observations: [],
    attemptLimits: new Map<string, number | null>(),
    participantNames: new Map([["u1", "Морозова Анна"], ["u2", "Сафин Ильдар"]]),
    now: NOW,
    ...over,
  };
}

describe("buildAttentionQueue", () => {
  it("ставит в очередь просроченное назначение, к которому не приступали", () => {
    const queue = buildAttentionQueue(input({
      assignments: [{ id: "a1", testId: "test1", userId: "u2", dueDate: hoursAgo(48) }],
    }));

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: "overdue", participant: "Сафин Ильдар", testId: "test1" });
  });

  it("не трогает назначение без срока", () => {
    // FR-10a: без даты «просрочено» вывести не из чего, а умолчание вроде «через месяц» —
    // это придуманная тревога, показанная живому человеку.
    const queue = buildAttentionQueue(input({
      assignments: [{ id: "a1", testId: "test1", userId: "u2", dueDate: null }],
    }));

    expect(queue).toHaveLength(0);
  });

  it("не считает просроченным назначение, срок которого ещё не наступил", () => {
    const queue = buildAttentionQueue(input({
      assignments: [{
        id: "a1", testId: "test1", userId: "u2",
        dueDate: new Date("2026-09-20T00:00:00Z"),
      }],
    }));

    expect(queue).toHaveLength(0);
  });

  it("снимает просрочку, когда к тесту всё же приступили", () => {
    const queue = buildAttentionQueue(input({
      assignments: [{ id: "a1", testId: "test1", userId: "u1", dueDate: hoursAgo(48) }],
      observations: [observation({ outcome: "passed", passed: true, percent: 90 })],
    }));

    expect(queue.filter(item => item.kind === "overdue")).toHaveLength(0);
  });

  it("ставит в очередь не сдавшего, у которого попытки остались", () => {
    const queue = buildAttentionQueue(input({
      observations: [observation()],
      attemptLimits: new Map([["test1", 3]]),
    }));

    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("failed");
  });

  it("отличает исчерпавшего лимит от просто не сдавшего", () => {
    const queue = buildAttentionQueue(input({
      observations: [
        observation({ id: "o1", startedAt: hoursAgo(100) }),
        observation({ id: "o2", startedAt: hoursAgo(200) }),
      ],
      attemptLimits: new Map([["test1", 2]]),
    }));

    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("exhausted");
  });

  it("считает брошенной попытку, висящую дольше двух суток", () => {
    const queue = buildAttentionQueue(input({
      observations: [observation({
        outcome: "incomplete", finishedAt: null, percent: null, passed: null,
        startedAt: hoursAgo(72),
      })],
    }));

    expect(queue[0]).toMatchObject({ kind: "abandoned" });
  });

  it("не считает брошенной попытку, начатую сегодня", () => {
    // Идущая сейчас попытка — это работа, а не дело: человек мог отойти на обед.
    const queue = buildAttentionQueue(input({
      observations: [observation({
        outcome: "incomplete", finishedAt: null, percent: null, passed: null,
        startedAt: hoursAgo(3),
      })],
    }));

    expect(queue).toHaveLength(0);
  });

  it("не зовёт заниматься сдавшим", () => {
    const queue = buildAttentionQueue(input({
      observations: [observation({ outcome: "passed", passed: true, percent: 90 })],
    }));

    expect(queue).toHaveLength(0);
  });

  it("не зовёт заниматься прохождением опросника, которое ничего не оценивало", () => {
    const queue = buildAttentionQueue(input({
      observations: [observation({ outcome: "completed", passed: null, percent: null })],
    }));

    expect(queue).toHaveLength(0);
  });

  it("ставит участника в очередь один раз, по последнему прохождению", () => {
    // Человек, завяливший последнюю попытку после двух проваленных, — это одно дело,
    // а не три строки в разных корзинах.
    const queue = buildAttentionQueue(input({
      observations: [
        observation({ id: "last", startedAt: hoursAgo(10), outcome: "incomplete", finishedAt: null }),
        observation({ id: "prev", startedAt: hoursAgo(100) }),
        observation({ id: "older", startedAt: hoursAgo(200) }),
      ],
    }));

    expect(queue).toHaveLength(0);
  });

  it("считает дела по корзинам", () => {
    const queue = buildAttentionQueue(input({
      assignments: [{ id: "a1", testId: "test2", userId: "u2", dueDate: hoursAgo(48) }],
      observations: [observation()],
      attemptLimits: new Map([["test1", 3]]),
    }));

    expect(countAttention(queue)).toEqual({ overdue: 1, failed: 1, abandoned: 0, exhausted: 0 });
  });

  it("несёт результат и номер попытки: по ним решают, что делать", () => {
    // «Не сдал» — это не одно и то же для 68 % при пороге 70 и для 20 %: первому хватит
    // пересдачи, второго надо учить заново. И «попытка 1 из 3» отличается от «3 из 3»:
    // у одного попытки ещё есть, у другого нет.
    const queue = buildAttentionQueue(input({
      observations: [
        observation({ id: "prev", startedAt: hoursAgo(200) }),
        observation({ id: "last", startedAt: hoursAgo(100), percent: 68 }),
      ],
      attemptLimits: new Map([["test1", 3]]),
    }));

    expect(queue[0]).toMatchObject({ percent: 68, attemptNumber: 2, attemptLimit: 3 });
  });

  it("несёт источник прохождения — без него дело некуда открыть", () => {
    // FR-11: позиция ведёт к прохождению, а разбор веб-попытки и записи из LMS читается
    // разными ручками. Без источника пришлось бы угадывать, какую звать.
    const queue = buildAttentionQueue(input({
      observations: [observation({ source: "telemetry", id: "lms-1" })],
    }));

    expect(queue[0]).toMatchObject({ source: "telemetry", observationId: "lms-1" });
  });

  it("несёт дату прохождения у всех дел, где прохождение есть", () => {
    // Колонка «Когда» пуста только там, где события ещё не было: у просроченного назначения
    // это срок, у остальных — когда человек проходил тест.
    const queue = buildAttentionQueue(input({
      observations: [observation({ startedAt: hoursAgo(100) })],
      attemptLimits: new Map([["test1", 3]]),
    }));

    expect(queue[0].startedAt).toEqual(hoursAgo(100));
  });
});

/**
 * Период вкладки (решение владельца 2026-09-25): за неделю, месяц, квартал.
 *
 * Каждая корзина режет по СВОЕЙ дате: просроченное назначение — по сроку, остальные — по
 * последней попытке. Без периода вкладка копила неудачи за всё время.
 */
describe("buildAttentionQueue — период", () => {
  const since = hoursAgo(24 * 30);

  it("старая неудача за период не попадает", () => {
    const queue = buildAttentionQueue(input({
      since,
      observations: [
        observation({ id: "fresh", participantId: "u1", startedAt: hoursAgo(24 * 5) }),
        observation({ id: "old", participantId: "u2", userId: "u2", participant: "Сафин Ильдар", startedAt: hoursAgo(24 * 60) }),
      ],
    }));

    expect(queue.map(item => item.observationId)).toEqual(["fresh"]);
  });

  it("просроченное назначение режется по сроку, а не по дате выдачи", () => {
    const queue = buildAttentionQueue(input({
      since,
      assignments: [
        { id: "a1", testId: "test1", userId: "u1", dueDate: hoursAgo(24 * 10) },
        { id: "a2", testId: "test1", userId: "u2", dueDate: hoursAgo(24 * 90) },
      ],
    }));

    expect(queue.map(item => item.participantId)).toEqual(["u1"]);
  });

  it("брошенная попытка режется по началу попытки", () => {
    const queue = buildAttentionQueue(input({
      since,
      observations: [
        observation({ id: "recent", outcome: "incomplete", finishedAt: null, startedAt: hoursAgo(24 * 3) }),
        observation({ id: "ancient", participantId: "u2", userId: "u2", outcome: "incomplete", finishedAt: null, startedAt: hoursAgo(24 * 45) }),
      ],
    }));

    expect(queue.map(item => item.observationId)).toEqual(["recent"]);
  });

  it("без периода — всё, как прежде", () => {
    const queue = buildAttentionQueue(input({
      observations: [observation({ startedAt: hoursAgo(24 * 400) })],
    }));
    expect(queue).toHaveLength(1);
  });
});

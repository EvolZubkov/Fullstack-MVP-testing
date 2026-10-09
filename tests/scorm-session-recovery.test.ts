/**
 * @module tests/scorm-session-recovery
 * @description Восстановление прерванного прогона в SCORM-пакете: что рантайм делает, встретив
 * сохранённый прогон, завершённые попытки или ничего.
 *
 * Проверяется ИСХОДНЫЙ `determineRecovery` рантайма. Прежняя версия файла пересказывала его
 * логику на TypeScript и потому не поймала бы ни одной регрессии в самом пакете (PRD-36, риск
 * «модули состояния не покрыты»): реплика оставалась зелёной независимо от того, что происходит
 * в `sessionRecovery.js`. Вместе с ней ушли ещё три блока таких же реплик (сохранение попытки,
 * beforeunload, склейка APP_URL) — ни один из них не исполнял продуктовый код и ни одной строки
 * покрытия не давал.
 *
 * Правила, которые файл охраняет (см. шапку `sessionRecovery.js`):
 *   - без таймера прерванный прогон восстанавливается с того же вопроса;
 *   - с таймером — только если якорь активного времени PRD-20 позволяет восстановить остаток;
 *   - адаптивный режим прогон не восстанавливает никогда, показывает последнюю попытку;
 *   - протухший (старше суток) прогон приравнивается к отсутствующему;
 *   - режим маршрутизатора восстанавливает секционный чекпоинт, а не позицию в вопросах.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/sessionRecovery.js"),
  "utf8",
);

type Recovery = { action: string; session?: any; attempt?: any };

interface RuntimeEnv {
  /** `suspend_data` as the runtime would have parsed it. */
  suspend: unknown;
  /** The baked TEST_DATA of the package under test. */
  TEST_DATA: unknown;
  /** PRD-20 active-time anchor, or null when absent/tampered. */
  anchor?: unknown;
  /** `cmi.total_time` in seconds, or null when unreadable. */
  totalSec?: number | null;
}

function determineRecoveryIn(env: RuntimeEnv): Recovery {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "TEST_DATA",
    "state",
    "readSuspendObj",
    "readTimerAnchor",
    "readTotalTimeSec",
    "writeSuspendObj",
    "console",
    `${src}\nreturn determineRecovery;`,
  );
  return factory(
    env.TEST_DATA,
    {},
    () => env.suspend,
    () => env.anchor ?? null,
    () => (env.totalSec === undefined ? null : env.totalSec),
    () => undefined,
    { log: () => undefined },
  )() as Recovery;
}

const codecSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const RS = new Function(`${codecSrc}\nreturn TBRunState;`)() as any;

const LINEAR = { mode: "standard", timeLimitMinutes: null, flowPolicy: { mode: "linear_flat" } };
const TIMED = { mode: "standard", timeLimitMinutes: 30, flowPolicy: { mode: "linear_flat" } };
const ADAPTIVE = { mode: "adaptive", timeLimitMinutes: null, flowPolicy: { mode: "linear_flat" } };
const ROUTER = { mode: "standard", timeLimitMinutes: null, flowPolicy: { mode: "router_by_topics" } };

/** A checkpoint in the PRD-36 format: rows, not question objects. */
const session = (over: Record<string, unknown> = {}) => ({
  at: new Date().toISOString(),
  i: 1,
  dl: "0.0,0.1",
  an: "0,",
  st: "au",
  sh: ",",
  f: {},
  fm: "linear_flat",
  ...over,
});

/** A stored summary of a finished attempt (format 2). */
const summary = (percent: number) => ({
  n: 1,
  at: new Date().toISOString(),
  pc: percent,
  ok: percent >= 60,
  t: [],
});

/** State holding ONE finished attempt: best and last are the same object (`last: 0`). */
const withAttempt = (percent: number, over: Record<string, unknown> = {}) => ({
  v: 2, attemptsUsed: 1, best: summary(percent), last: 0, ...over,
});

describe("determineRecovery: линейный режим без таймера", () => {
  it("прерванный прогон восстанавливается", () => {
    const r = determineRecoveryIn({
      suspend: { v: 2, attemptsUsed: 1, best: null, currentSession: session() },
      TEST_DATA: LINEAR,
    });
    expect(r.action).toBe("restore");
    expect(r.session.i).toBe(1);
  });

  it("протухший прогон не восстанавливается", () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const r = determineRecoveryIn({
      suspend: { v: 2, attemptsUsed: 1, best: null, currentSession: session({ at: stale }) },
      TEST_DATA: LINEAR,
    });
    expect(r.action).toBe("start_fresh");
  });

  it("прогон без выданных вопросов равносилен его отсутствию", () => {
    const r = determineRecoveryIn({
      suspend: { attemptsUsed: 0, currentSession: session({ dl: "" }) },
      TEST_DATA: LINEAR,
    });
    expect(r.action).toBe("start_fresh");
  });

  it("без прогона и без попыток тест начинается заново", () => {
    const r = determineRecoveryIn({ suspend: { v: 2, attemptsUsed: 0, best: null }, TEST_DATA: LINEAR });
    expect(r.action).toBe("start_fresh");
  });
});

describe("determineRecovery: тест с ограничением времени (PRD-20)", () => {
  it("якорь активного времени позволяет продолжить прогон", () => {
    const r = determineRecoveryIn({
      suspend: { v: 2, attemptsUsed: 1, best: null, currentSession: session() },
      TEST_DATA: TIMED,
      anchor: { limitMinutes: 30, baselineTotalSec: 120 },
      totalSec: 300,
    });
    expect(r.action).toBe("restore");
  });

  it("без якоря прогон не восстанавливается — показывается последняя попытка", () => {
    const r = determineRecoveryIn({
      suspend: withAttempt(70, { currentSession: session() }),
      TEST_DATA: TIMED,
      anchor: null,
    });
    expect(r.action).toBe("show_last_attempt");
    expect(r.attempt.pc).toBe(70);
  });

  it("якорь от ДРУГОГО лимита времени не годится: ученик не получает лимит заново", () => {
    const r = determineRecoveryIn({
      suspend: { v: 2, attemptsUsed: 1, best: null, currentSession: session() },
      TEST_DATA: TIMED,
      anchor: { limitMinutes: 45, baselineTotalSec: 120 },
      totalSec: 300,
    });
    expect(r.action).toBe("start_fresh");
  });
});

describe("determineRecovery: адаптивный режим", () => {
  it("показывает последнюю попытку, а не лучшую", () => {
    const r = determineRecoveryIn({
      suspend: { v: 2, attemptsUsed: 2, best: summary(90), last: summary(50), currentSession: session() },
      TEST_DATA: ADAPTIVE,
    });
    expect(r.action).toBe("show_last_attempt");
    expect(r.attempt.pc).toBe(50);
  });

  it("без завершённых попыток начинает заново, прогон в работе игнорируется", () => {
    const r = determineRecoveryIn({
      suspend: { v: 2, attemptsUsed: 0, best: null, currentSession: session() },
      TEST_DATA: ADAPTIVE,
    });
    expect(r.action).toBe("start_fresh");
  });
});

describe("determineRecovery: режим маршрутизатора", () => {
  it("секционный чекпоинт восстанавливается своим действием", () => {
    const r = determineRecoveryIn({
      suspend: {
        v: 2,
        attemptsUsed: 0,
        best: null,
        currentSession: session({ fm: "router_by_topics" }),
      },
      TEST_DATA: ROUTER,
    });
    expect(r.action).toBe("restore_router");
  });

  it("чекпоинт линейного прогона в маршрутизаторе не годится", () => {
    const r = determineRecoveryIn({
      suspend: { v: 2, attemptsUsed: 0, best: null, currentSession: session({ fm: "linear_flat" }) },
      TEST_DATA: ROUTER,
    });
    expect(r.action).toBe("start_fresh");
  });
});

/**
 * PRD-36 §8: круг «сохранил — восстановил» на настоящих saveCurrentSession/restoreSession.
 * Здесь закрываются два дефекта, ради которых прогон и переписан: порядок вариантов ответа
 * и выданный вариант PRD-17 не переживали перерыва.
 */
describe("прогон в работе: сохранение и восстановление рядами", () => {
  const PACKAGE = {
    mode: "standard",
    timeLimitMinutes: null,
    flowPolicy: { mode: "linear_flat" },
    sections: [
      {
        topicId: "t1", topicName: "Первая",
        questions: [
          { id: "a1", type: "single" },
          { id: "a2", type: "multiple" },
          { id: "a3", type: "single" },
        ],
      },
      { topicId: "t2", topicName: "Вторая", questions: [{ id: "b1", type: "ranking" }] },
    ],
  };

  /** Runtime state as it looks mid-run, on the third delivered question. */
  const liveState = () => ({
    currentIndex: 2,
    currentPageIndex: 0,
    flatQuestions: [
      { question: PACKAGE.sections[0].questions[0], topicId: "t1", topicName: "Первая" },
      { question: PACKAGE.sections[1].questions[0], topicId: "t2", topicName: "Вторая" },
      { question: PACKAGE.sections[0].questions[1], topicId: "t1", topicName: "Первая" },
    ],
    deliveryPositions: [{ s: 0, q: 0 }, { s: 1, q: 0 }, { s: 0, q: 1 }],
    answers: { a1: 2, b1: [1, 0, 2] },
    questionStatuses: { a1: "answered", b1: "skipped", a2: "unanswered" },
    shuffleMappings: { a1: [2, 0, 1], a2: [1, 0] },
    deliveredForms: { t1: "form-a" },
    sectionCommitted: {}, routerTopicStates: {}, sectionResults: {}, routerFinished: false,
    currentRouterTopic: null,
  });

  /** Save a live state, then restore it into a FRESH state — as a reopened SCO would. */
  function roundTrip(): { saved: any; restored: any } {
    const stored: any = { v: 2, attemptsUsed: 0, best: null };
    const restored: any = {};
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "TEST_DATA", "state", "readSuspendObj", "writeSuspendObj", "TBRunState", "console",
      `${src}\nreturn { save: saveCurrentSession, restore: restoreSession };`,
    );
    const saveApi = factory(
      PACKAGE, liveState(), () => stored, (o: any) => Object.assign(stored, o), RS,
      { log: () => undefined },
    );
    saveApi.save();
    const restoreApi = factory(
      PACKAGE, restored, () => stored, () => undefined, RS, { log: () => undefined },
    );
    restoreApi.restore(stored.currentSession);
    return { saved: stored.currentSession, restored };
  }

  it("в снимке прогона нет содержимого вопросов", () => {
    const raw = JSON.stringify(roundTrip().saved);
    expect(raw).not.toContain("multiple");
    expect(raw).not.toContain("Первая");
  });

  it("выданные вопросы возвращаются из TEST_DATA по позициям, в том же порядке", () => {
    const { restored } = roundTrip();
    expect(restored.flatQuestions.map((f: any) => f.question.id)).toEqual(["a1", "b1", "a2"]);
    expect(restored.flatQuestions[1].topicName).toBe("Вторая");
  });

  it("ответы возвращаются к своим вопросам", () => {
    expect(roundTrip().restored.answers).toEqual({ a1: 2, b1: [1, 0, 2] });
  });

  it("статусы вопросов переживают перерыв", () => {
    expect(roundTrip().restored.questionStatuses).toEqual({
      a1: "answered", b1: "skipped", a2: "unanswered",
    });
  });

  it("порядок вариантов ответа тот же, что до перерыва (§8, дефект 2)", () => {
    expect(roundTrip().restored.shuffleMappings).toEqual({ a1: [2, 0, 1], a2: [1, 0] });
  });

  it("выданный вариант PRD-17 восстанавливается, и порог by_variant остаётся его (§8, дефект 3)", () => {
    const { restored } = roundTrip();
    expect(restored.deliveredForms).toEqual({ t1: "form-a" });
    // `deliveredFormId` (PRD-24) читает именно state.variant.sections — без этого
    // восстановленный прогон молча съезжал на общий порог темы.
    expect(restored.variant.sections).toEqual([{ topicId: "t1", formId: "form-a" }]);
  });

  it("положение в прогоне сохраняется", () => {
    expect(roundTrip().restored.currentIndex).toBe(2);
  });
});

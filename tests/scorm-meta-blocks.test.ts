/**
 * @module tests/scorm-meta-blocks
 *
 * PRD-56 FR-19a: пакет сообщает версию публикации и выданные варианты — служебными блоками
 * отчёта LMS и телеметрией.
 *
 * Половина, которая ПИШЕТ, живёт в рантайме пакета обычным ES5 без импортов, поэтому
 * идентификаторы блоков и кодирование значений повторяют константы `shared/lms-export/meta`
 * литералами. Здесь эта парность и стережётся — по образцу `tests/scorm-latency`: копии кода
 * в проекте расходились дважды, и оба раза молча.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ATTEMPT_INTERACTION_ID,
  DURATION_INTERACTION_ID,
  REGISTRATION_INTERACTION_ID,
  TEST_VERSION_INTERACTION_ID,
  VARIANT_INTERACTION_ID,
  encodeVariantForms,
} from "@shared/lms-export/meta";

const RUNTIME = "server/scorm/template/app";
const resultsSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/render/resultsPage.js`), "utf8");
const telemetrySrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/telemetry/telemetry.js`), "utf8");
const suspendSrc = readFileSync(resolve(process.cwd(), `${RUNTIME}/utils/scorm/suspendAttempts.js`), "utf8");

function extractTopLevel(src: string, name: string): string {
  const m = src.match(new RegExp(`^function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "m"));
  if (!m) throw new Error(`${name} не найдена среди функций верхнего уровня`);
  return m[0];
}

interface Interaction { id: string; type: string; result: string; response: string }

/** Сборщик служебных блоков поверх подставленных `TEST_DATA` и `state`. */
function buildMeta(testData: unknown, state: unknown): Interaction[] {
  const fn = new Function(
    "TEST_DATA",
    "state",
    `${extractTopLevel(resultsSrc, "deliveredFormIds")}
     ${extractTopLevel(resultsSrc, "buildRunMetaInteractions")}
     return buildRunMetaInteractions();`,
  );
  return fn(testData, state) as Interaction[];
}

describe("служебные блоки прохождения в отчёте LMS", () => {
  const forms = { "topic-1": "form-a", "topic-2": "form-b" };

  it("версия публикации уезжает блоком с тем же идентификатором, что знает разбор", () => {
    const [version] = buildMeta({ publicationVersion: 3 }, { deliveredForms: {} });

    expect(version).toMatchObject({
      id: TEST_VERSION_INTERACTION_ID,
      type: "other",
      // Служебному блоку не о чем быть правым или неправым.
      result: "neutral",
      response: "3",
    });
  });

  it("варианты кодируются ровно так, как их читает разбор", () => {
    const blocks = buildMeta({ publicationVersion: 3 }, { deliveredForms: forms });
    const variant = blocks.find((b) => b.id === VARIANT_INTERACTION_ID);

    expect(variant).toBeDefined();
    expect(variant!.response).toBe(encodeVariantForms(["form-a", "form-b"]));
    expect(variant!.result).toBe("neutral");
  });

  it("пакет без версии публикации блока о ней не шлёт", () => {
    // Черновик и пакет, собранный до этой работы: пустая ячейка и отсутствующая колонка
    // означают для разбора одно — «не сообщено».
    const blocks = buildMeta({}, { deliveredForms: forms });

    expect(blocks.map((b) => b.id)).not.toContain(TEST_VERSION_INTERACTION_ID);
    expect(blocks.map((b) => b.id)).toContain(VARIANT_INTERACTION_ID);
  });

  it("тест без вариантов блока о вариантах не шлёт", () => {
    const blocks = buildMeta({ publicationVersion: 1 }, { deliveredForms: {} });

    expect(blocks.map((b) => b.id)).toEqual([TEST_VERSION_INTERACTION_ID]);
  });

  it("прогон без состояния не роняет сборку", () => {
    // `state` в пакете склеивается в тот же файл, и порядок склейки — не повод падать
    // при завершении попытки.
    expect(() => buildMeta({ publicationVersion: 2 }, undefined)).not.toThrow();
  });
});

/** Телеметрия поверх поддельных LMS, сети и подписи: проверяется ОТПРАВЛЕННОЕ тело. */
async function startTelemetry(testData: unknown, state: unknown): Promise<Record<string, unknown>> {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const factory = new Function(
    "TEST_DATA",
    "state",
    "fetch",
    "window",
    "navigator",
    "localStorage",
    "console",
    "crypto",
    `${telemetrySrc}
     return Telemetry;`,
  );

  const telemetry = factory(
    testData,
    state,
    async (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, clone: () => ({ json: async () => ({ attemptNumber: 1 }) }) };
    },
    { addEventListener: () => {} },
    {},
    { getItem: () => null, setItem: () => {} },
    { log: () => {}, warn: () => {}, error: () => {} },
    // Подпись здесь не проверяется — важно, ЧТО уехало; настоящий HMAC живёт на сервере.
    { subtle: { importKey: async () => ({}), sign: async () => new Uint8Array([1, 2, 3]).buffer } },
  ) as { init: (c: unknown) => void; start: () => void };

  telemetry.init({ enabled: true, packageId: "pkg-1", secretKey: "s", apiBaseUrl: "" });
  telemetry.start();
  // Отправка асинхронная: подпись идёт через промисы, тело уходит следующим тиком.
  await new Promise((r) => setTimeout(r, 0));

  return (sent[0]?.body.data ?? {}) as Record<string, unknown>;
}

describe("телеметрия сообщает версию и выданные варианты", () => {
  it("`start` несёт версию публикации и карту «тема -> вариант»", async () => {
    const data = await startTelemetry(
      { publicationVersion: 4 },
      { flatQuestions: [], deliveredForms: { "topic-1": "form-a" } },
    );

    expect(data.publicationVersion).toBe(4);
    expect(data.deliveredForms).toEqual({ "topic-1": "form-a" });
    // PRD-55: состав выданной формы уезжал и раньше — новые поля его не вытеснили.
    expect(data.deliveredQuestionIds).toEqual([]);
  });

  it("пакет без версии и без вариантов шлёт пустые значения, а не выдуманные", async () => {
    const data = await startTelemetry({}, { flatQuestions: [], deliveredForms: {} });

    expect(data.publicationVersion).toBeNull();
    expect(data.deliveredForms).toEqual({});
  });
});

/**
 * Метка регистрации поверх поддельного `suspend_data`: `readSuspendObj`/`writeSuspendObj`
 * подставляются, чтобы проверить ровно то, что метка хранится в состоянии и переживает сессии.
 */
function registrationRuntime(initial: Record<string, unknown>) {
  const store = { state: { ...initial }, writes: 0 };
  const fn = new Function(
    "readSuspendObj",
    "writeSuspendObj",
    `${extractTopLevel(suspendSrc, "registrationMark")}
     ${extractTopLevel(resultsSrc, "buildRegistrationInteraction")}
     return { registrationMark: registrationMark, build: buildRegistrationInteraction };`,
  );
  const api = fn(
    () => JSON.parse(JSON.stringify(store.state)),
    (s: Record<string, unknown>) => { store.state = s; store.writes += 1; },
  ) as { registrationMark: () => string; build: () => Interaction[] };
  return { store, ...api };
}

describe("метка регистрации в отчёте LMS (PRD-54 BR-54-35)", () => {
  it("блок уезжает с тем же идентификатором, что знает разбор", () => {
    const { build } = registrationRuntime({ v: 2, attemptsUsed: 1 });
    const [block] = build();
    expect(block).toMatchObject({ id: REGISTRATION_INTERACTION_ID, type: "other", result: "neutral" });
    expect(block.response).toMatch(/^[0-9a-z]{9,16}$/);
  });

  it("метка создаётся один раз и сохраняется в suspend_data", () => {
    const rt = registrationRuntime({ v: 2, attemptsUsed: 1 });
    const first = rt.registrationMark();
    const second = rt.registrationMark();
    expect(second).toBe(first);
    expect(rt.store.state.rk).toBe(first);
    // Вторая попытка той же регистрации метку не переписывает.
    expect(rt.store.writes).toBe(1);
  });

  it("метка, уже лежащая в состоянии, берётся как есть — она общая для всех попыток регистрации", () => {
    const rt = registrationRuntime({ v: 2, attemptsUsed: 3, rk: "lx1a2b3cq9zk" });
    expect(rt.build()[0].response).toBe("lx1a2b3cq9zk");
    expect(rt.store.writes).toBe(0);
  });

  it("недоступное состояние не роняет завершение: блока просто нет", () => {
    const fn = new Function(
      "readSuspendObj",
      "writeSuspendObj",
      `${extractTopLevel(suspendSrc, "registrationMark")}
       ${extractTopLevel(resultsSrc, "buildRegistrationInteraction")}
       return buildRegistrationInteraction();`,
    );
    const blocks = fn(() => { throw new Error("LMS недоступна"); }, () => {}) as Interaction[];
    expect(blocks).toEqual([]);
  });
});

/**
 * Номер и длительность попытки (PRD-54, решение 13) поверх поддельного `suspend_data` и часов:
 * настоящие `markAttemptStart`, `currentAttemptMeta` и `buildAttemptMetaInteractions`.
 */
function attemptRuntime(initial: Record<string, unknown>) {
  const store = { state: { ...initial } as Record<string, unknown> };
  const clock = { t: 1_000_000 };
  const fn = new Function(
    "readSuspendObj",
    "writeSuspendObj",
    "Date",
    `${extractTopLevel(suspendSrc, "markAttemptStart")}
     ${extractTopLevel(suspendSrc, "currentAttemptMeta")}
     ${extractTopLevel(resultsSrc, "buildAttemptMetaInteractions")}
     return { start: markAttemptStart, build: buildAttemptMetaInteractions };`,
  );
  const api = fn(
    () => JSON.parse(JSON.stringify(store.state)),
    (s: Record<string, unknown>) => { store.state = s; },
    { now: () => clock.t },
  ) as { start: () => void; build: (results: unknown) => Interaction[] };
  return { store, clock, ...api };
}

describe("номер и длительность попытки в отчёте LMS (PRD-54, решение 13)", () => {
  it("текущая попытка: номер растёт на каждом старте, длительность — от старта, без лимита попыток", () => {
    const rt = attemptRuntime({ v: 2, attemptsUsed: 0 });
    rt.start();
    rt.start();
    rt.clock.t += 95_400;
    const blocks = rt.build({ percent: 50 });
    expect(blocks).toEqual([
      expect.objectContaining({ id: ATTEMPT_INTERACTION_ID, type: "other", result: "neutral", response: "2" }),
      expect.objectContaining({ id: DURATION_INTERACTION_ID, type: "other", result: "neutral", response: "95" }),
    ]);
    // Счётчик лимита не тронут: «попытка уже была» он сообщает только при лимите.
    expect(rt.store.state.attemptsUsed).toBe(0);
  });

  it("сохранённая лучшая попытка говорит своим номером и длительностью", () => {
    const rt = attemptRuntime({ v: 2, an: 4, as: 1 });
    const blocks = rt.build({ stored: true, attemptNumber: 1, durationSeconds: 300 });
    expect(blocks.map((b) => b.response)).toEqual(["1", "300"]);
  });

  it("сводка до этой работы — номер 0 без длительности: блоков нет, данные текущей не подставляются", () => {
    const rt = attemptRuntime({ v: 2, an: 4, as: 1 });
    expect(rt.build({ stored: true, attemptNumber: 0, durationSeconds: null })).toEqual([]);
  });

  it("пакет без учёта номера (состояние до этой работы) блоков не шлёт", () => {
    expect(attemptRuntime({ v: 2, attemptsUsed: 1 }).build({ percent: 10 })).toEqual([]);
  });
});

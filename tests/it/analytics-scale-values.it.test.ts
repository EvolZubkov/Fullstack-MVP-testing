/**
 * @module tests/it/analytics-scale-values.it.test
 * @description PRD-56 FR-21: значения шкал прохождений читаются по тесту из ОБОИХ источников.
 *
 * Проверять это без базы нельзя, и не потому, что запрос сложный. Формы хранения РАЗНЫЕ: веб
 * пишет запись со значением внутри (`result_json.scaleResults.<ключ>.raw`), LMS — плоскую карту
 * (`scales_json`), и приведение обеих к числу живёт в самом запросе. Плюс тот же запасной путь к
 * тесту через пакет, что и у прочих выборок: у части старых строк телеметрии `test_id` пуст.
 *
 * Ошибка здесь не роняет экран — она молча ополовинивает выборку профиля по шкалам, и это ровно
 * та беда, ради которой слой наблюдений и заводился.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { attempts, scormAttempts, scormPackages, tests, users } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { AnalyticsRepository } from "../../server/storage/analytics-repository";

let repo: AnalyticsRepository;
let testId: string;
let otherTestId: string;
let userId: string;

/** Веб-попытка со значениями шкал в сохранённом результате. */
async function webAttempt(scaleResults: unknown, over: Record<string, unknown> = {}) {
  const id = randomUUID();
  await h.current!.db.insert(attempts).values({
    id,
    userId,
    testId,
    testVersion: 1,
    variantJson: {},
    resultJson: { overallPercent: 70, overallPassed: true, scaleResults },
    startedAt: new Date("2026-09-11T14:00:00Z"),
    finishedAt: new Date("2026-09-11T14:20:00Z"),
    ...over,
  } as never);
  return id;
}

/** Прохождение из LMS с плоской картой значений. */
async function lmsAttempt(scalesJson: unknown, over: Record<string, unknown> = {}) {
  const id = randomUUID();
  await h.current!.db.insert(scormAttempts).values({
    id,
    packageId: null,
    testId,
    origin: "telemetry",
    scalesJson,
    startedAt: new Date("2026-09-10T09:00:00Z"),
    finishedAt: new Date("2026-09-10T09:30:00Z"),
    lastActivityAt: new Date("2026-09-10T09:30:00Z"),
    ...over,
  } as never);
  return id;
}

beforeAll(async () => {
  h.current = await createHarness();
  repo = new AnalyticsRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  testId = randomUUID();
  otherTestId = randomUUID();
  userId = randomUUID();
  await h.current!.db.insert(users).values({
    id: userId, email: "a@b.c", passwordHash: "x", name: "Морозова Анна",
  } as never);
  for (const id of [testId, otherTestId]) {
    await h.current!.db.insert(tests).values({
      id,
      title: "Тест " + id.slice(0, 4),
      overallPassRuleJson: { type: "percent", value: 70 },
      createdBy: userId,
    } as never);
  }
});

describe("selectScaleValuesForTest", () => {
  it("приводит обе формы хранения к одному числу", async () => {
    await webAttempt({ burnout: { raw: 27, label: "Высокий" }, engagement: { raw: 13 } });
    await lmsAttempt({ burnout: 31 });

    const rows = await repo.selectScaleValuesForTest(testId);

    expect(rows).toHaveLength(2);
    const web = rows.find(r => r.source === "web")!;
    const lms = rows.find(r => r.source === "telemetry")!;
    expect(web.values).toEqual({ burnout: 27, engagement: 13 });
    expect(lms.values).toEqual({ burnout: 31 });
  });

  it("прохождения ЧУЖОГО теста в выборку не берёт", async () => {
    await webAttempt({ burnout: 27 }, { testId: otherTestId });
    await lmsAttempt({ burnout: 31 }, { testId: otherTestId });

    expect(await repo.selectScaleValuesForTest(testId)).toEqual([]);
  });

  it("находит тест старой строки телеметрии через пакет", async () => {
    // У части записей `test_id` пуст — тест известен только через пакет. Без запасного пути
    // профиль молча теряет ровно те прохождения, ради которых пакет и собирали.
    const packageId = randomUUID();
    await h.current!.db.insert(scormPackages).values({
      id: packageId,
      testId,
      testTitle: "Тест",
      secretKey: "s",
      // Колонка NOT NULL без умолчания: адрес, на который пакет шлёт телеметрию.
      apiBaseUrl: "http://localhost:8135",
      exportedAt: new Date("2026-09-01T00:00:00Z"),
      createdBy: userId,
    } as never);
    await lmsAttempt({ burnout: 31 }, { testId: null, packageId, sessionId: "sess-1" });

    const rows = await repo.selectScaleValuesForTest(testId);

    expect(rows.map(r => r.values)).toEqual([{ burnout: 31 }]);
  });

  it("незавершённые прохождения в выборку не попадают", async () => {
    // У незавершённой попытки значений шкал ещё нет: её ноль сдвинул бы среднее вниз.
    await webAttempt(null, { resultJson: null, finishedAt: null });
    await lmsAttempt({ burnout: 31 }, { finishedAt: null });

    expect(await repo.selectScaleValuesForTest(testId)).toEqual([]);
  });

  it("прохождение без шкал даёт пустую карту, а не выпадает", async () => {
    // Оцениваемый тест шкал не считает вовсе — строка остаётся, значений в ней нет.
    await webAttempt(undefined);
    await lmsAttempt(null);

    const rows = await repo.selectScaleValuesForTest(testId);

    expect(rows).toHaveLength(2);
    expect(rows.every(r => Object.keys(r.values).length === 0)).toBe(true);
  });

  it("нечисловое значение отбрасывается, а соседнее остаётся", async () => {
    // `scales_json` правит импорт выгрузки: ячейка отчёта бывает и текстом.
    await lmsAttempt({ burnout: 31, broken: "высокий" });

    const rows = await repo.selectScaleValuesForTest(testId);

    expect(rows[0].values).toEqual({ burnout: 31 });
  });
});

describe("selectIndicatorValuesForTest", () => {
  it("reads the web record and the LMS record as they were stored", async () => {
    // Normalisation by the indicator type belongs to the summary: the repository does not know
    // the types and must not guess them.
    const webId = await webAttempt(undefined, {
      resultJson: { overallPercent: 70, resultVariables: { idx: 64, style: "kom" } },
    });
    const lmsId = await lmsAttempt(null, { variablesJson: { idx: "58" } });

    const rows = await repo.selectIndicatorValuesForTest(testId);

    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.attemptId === webId)).toEqual({
      attemptId: webId, source: "web", values: { idx: 64, style: "kom" },
    });
    expect(rows.find(r => r.attemptId === lmsId)).toEqual({
      attemptId: lmsId, source: "telemetry", values: { idx: "58" },
    });
  });

  it("an imported row keeps its origin", async () => {
    await lmsAttempt(null, { origin: "import", variablesJson: { idx: "61" } });

    const rows = await repo.selectIndicatorValuesForTest(testId);

    expect(rows.map(r => r.source)).toEqual(["import"]);
  });

  it("takes neither another test's runs nor unfinished ones", async () => {
    await webAttempt(undefined, { testId: otherTestId, resultJson: { resultVariables: { idx: 1 } } });
    await lmsAttempt(null, { testId: otherTestId, variablesJson: { idx: "1" } });
    await webAttempt(undefined, { resultJson: null, finishedAt: null });
    await lmsAttempt(null, { variablesJson: { idx: "1" }, finishedAt: null });

    expect(await repo.selectIndicatorValuesForTest(testId)).toEqual([]);
  });

  it("a run without indicators stays in the selection with an empty record", async () => {
    // The row is still a run of the selection: the screen counts it as «не передано».
    await webAttempt(undefined);
    await lmsAttempt(null);

    const rows = await repo.selectIndicatorValuesForTest(testId);

    expect(rows).toHaveLength(2);
    expect(rows.every(r => Object.keys(r.values).length === 0)).toBe(true);
  });

  it("finds the test of an old telemetry row through its package", async () => {
    const packageId = randomUUID();
    await h.current!.db.insert(scormPackages).values({
      id: packageId,
      testId,
      testTitle: "Тест",
      secretKey: "s",
      apiBaseUrl: "http://localhost:8135",
      exportedAt: new Date("2026-09-01T00:00:00Z"),
      createdBy: userId,
    } as never);
    await lmsAttempt(null, { testId: null, packageId, sessionId: "sess-2", variablesJson: { idx: "70" } });

    const rows = await repo.selectIndicatorValuesForTest(testId);

    expect(rows.map(r => r.values)).toEqual([{ idx: "70" }]);
  });
});

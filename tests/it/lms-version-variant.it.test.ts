/**
 * @module tests/it/lms-version-variant.it.test
 * @description PRD-56 FR-19a/FR-18: версия публикации и выданные варианты доезжают до базы.
 *
 * Проверяется на реальной базе, потому что проверять здесь надо именно ЗАПИСЬ: колонки новые,
 * снимок ищется по паре (тест, версия), и эта пара уникальна индексом — на моках уникальности
 * не существует, и «нашли не тот снимок» вскрылось бы только на стенде.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { scormAttempts, testSnapshots, tests, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { storage } from "../../server/storage";

let testId: string;
let otherTestId: string;
let userId: string;

/** Снимок публикации теста с заданным номером версии. */
async function snapshot(id: string, version: number, forTest = testId) {
  await h.current!.db.insert(testSnapshots).values({
    id,
    testId: forTest,
    version,
    contentJson: {},
    publishedAt: new Date("2026-07-01T00:00:00Z"),
    publishedBy: userId,
  } as never);
}

beforeAll(async () => {
  h.current = await createHarness();
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
      // Колонка NOT NULL без умолчания: без правила прохождения строка теста не пишется.
      overallPassRuleJson: { type: "percent", value: 70 },
      createdBy: userId,
    } as never);
  }
});

describe("getSnapshotByVersion", () => {
  it("находит снимок своего теста по номеру версии", async () => {
    const wanted = randomUUID();
    await snapshot(randomUUID(), 1);
    await snapshot(wanted, 2);

    expect((await storage.getSnapshotByVersion(testId, 2))?.id).toBe(wanted);
  });

  it("не путает версии РАЗНЫХ тестов", async () => {
    // Номер уникален внутри теста, а не в базе: у каждого теста своя вторая версия.
    await snapshot(randomUUID(), 2);
    const foreign = randomUUID();
    await snapshot(foreign, 2, otherTestId);

    const found = await storage.getSnapshotByVersion(otherTestId, 2);

    expect(found?.id).toBe(foreign);
  });

  it("версии, которой нет, отвечает пустотой", async () => {
    await snapshot(randomUUID(), 1);

    expect(await storage.getSnapshotByVersion(testId, 99)).toBeUndefined();
  });
});

describe("прохождение из LMS несёт версию и вариант", () => {
  it("колонки записываются и читаются обратно", async () => {
    const snapshotId = randomUUID();
    await snapshot(snapshotId, 3);
    const id = randomUUID();

    await storage.createScormAttempt({
      id,
      packageId: null,
      sessionId: "sess-1",
      attemptNumber: 1,
      testId,
      origin: "telemetry",
      snapshotId,
      formsJson: { "topic-1": "form-a", "topic-2": "form-b" },
      scalesJson: { burnout: 27 },
      variablesJson: { risk: "high" },
      startedAt: new Date("2026-09-14T10:00:00Z"),
      lastActivityAt: new Date("2026-09-14T10:00:00Z"),
    } as never);

    const [row] = await h.current!.db
      .select()
      .from(scormAttempts)
      .where(eq(scormAttempts.id, id));

    expect(row.snapshotId).toBe(snapshotId);
    expect(row.formsJson).toEqual({ "topic-1": "form-a", "topic-2": "form-b" });
    expect(row.scalesJson).toEqual({ burnout: 27 });
    expect(row.variablesJson).toEqual({ risk: "high" });
  });

  it("прохождение пакета прошлой сборки пишется без версии и без вариантов", async () => {
    // Колонки обязаны быть необязательными: пакеты в поле версии не знают и знать не будут.
    const id = randomUUID();

    await storage.createScormAttempt({
      id,
      packageId: null,
      sessionId: "sess-2",
      attemptNumber: 1,
      testId,
      origin: "telemetry",
      startedAt: new Date("2026-09-14T11:00:00Z"),
      lastActivityAt: new Date("2026-09-14T11:00:00Z"),
    } as never);

    const [row] = await h.current!.db
      .select()
      .from(scormAttempts)
      .where(eq(scormAttempts.id, id));

    expect(row.snapshotId).toBeNull();
    expect(row.formsJson).toBeNull();
  });
});

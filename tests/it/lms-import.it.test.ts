/**
 * @module tests/it/lms-import.it.test
 * @description PRD-54 разделы 8.1 и 8.6: импортированные прохождения и партии на реальной базе.
 *
 * Круглый рейс здесь обязателен, а не избыточен. Идемпотентность импорта держится на ЧАСТИЧНОМ
 * уникальном индексе `(test_id, participant_key, started_at) WHERE origin = 'import'` — объекте,
 * который существует только в базе. Ошибка в нём не роняет ни один запрос: она проявится позже,
 * дублями прохождений в аналитике после второй загрузки того же файла.
 *
 * Вторая проверяемая вещь того же рода — частичность СТАРОГО индекса: телеметрия по-прежнему
 * обязана быть уникальной по (пакет, сессия, номер), а импортированные строки, у которых пакета
 * нет вовсе, не должны конфликтовать ни между собой, ни с ней.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { scormAttempts, scormPackages, users } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { ScormRepository } from "../../server/storage/scorm-repository";
// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { UsersRepository } from "../../server/storage/users-repository";

let repo: ScormRepository;
let usersRepo: UsersRepository;
let testId: string;
let batchId: string;

/** Одно прохождение из выгрузки: минимальный набор, который пишет `runImport`. */
function importedRow(over: Partial<Parameters<ScormRepository["upsertImportedAttempt"]>[0]> = {}) {
  return {
    testId,
    participantKey: "a".repeat(64),
    origin: "import" as const,
    batchId,
    groupId: null,
    userId: null,
    lmsUserName: null,
    lmsUserOrg: null,
    startedAt: new Date("2026-09-09T13:39:00Z"),
    finishedAt: new Date("2026-09-09T13:39:00Z"),
    lastActivityAt: new Date("2026-09-09T13:39:00Z"),
    resultPassed: true,
    totalPoints: 0,
    resultPercent: null,
    maxPoints: null,
    totalQuestions: 14,
    scalesJson: { cel: 29 },
    variablesJson: { lead_margin: "6" },
    ...over,
  };
}

beforeAll(async () => {
  h.current = await createHarness();
  repo = new ScormRepository();
  usersRepo = new UsersRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  testId = randomUUID();
  batchId = randomUUID();
  await repo.createLmsImportBatch({
    id: batchId,
    testId,
    groupId: null,
    fileName: "выгрузка.xlsx",
    fileHash: "b".repeat(64),
    anonymized: true,
    sourceAnonymized: false,
    linkUsers: false,
    importedBy: randomUUID(),
  });
});

describe("upsertImportedAttempt", () => {
  it("первая запись создаётся", async () => {
    const r = await repo.upsertImportedAttempt(importedRow());
    expect(r.created).toBe(true);
  });

  it("повторная запись с тем же ключом обновляет, а не дублирует", async () => {
    await repo.upsertImportedAttempt(importedRow());
    const r = await repo.upsertImportedAttempt(importedRow({ scalesJson: { cel: 31 } }));

    expect(r.created).toBe(false);
    const all = await h.current!.db.select().from(scormAttempts);
    expect(all).toHaveLength(1);
    expect(all[0].scalesJson).toEqual({ cel: 31 });
  });

  it("процент прохождения пишется и обновляется повторной загрузкой", async () => {
    await repo.upsertImportedAttempt(importedRow({ resultPercent: 64, maxPoints: 100, totalPoints: 64 }));
    await repo.upsertImportedAttempt(importedRow({ resultPercent: 81, maxPoints: 100, totalPoints: 81 }));

    const [row] = await h.current!.db.select().from(scormAttempts);
    expect(row).toMatchObject({ resultPercent: 81, maxPoints: 100, totalPoints: 81 });
  });

  it("другая дата — это другое прохождение", async () => {
    await repo.upsertImportedAttempt(importedRow());
    await repo.upsertImportedAttempt(importedRow({ startedAt: new Date("2026-09-10T10:00:00Z") }));

    expect(await h.current!.db.select().from(scormAttempts)).toHaveLength(2);
  });

  it("другой участник — это другое прохождение", async () => {
    await repo.upsertImportedAttempt(importedRow());
    await repo.upsertImportedAttempt(importedRow({ participantKey: "c".repeat(64) }));

    expect(await h.current!.db.select().from(scormAttempts)).toHaveLength(2);
  });

  it("повторная загрузка проставляет связь с пользователем, не создавая строки", async () => {
    const userId = randomUUID();
    await h.current!.db.insert(users).values({ id: userId, email: "зашифровано", name: "Иванов" });

    await repo.upsertImportedAttempt(importedRow());
    await repo.upsertImportedAttempt(importedRow({ userId }));

    const all = await h.current!.db.select().from(scormAttempts);
    expect(all).toHaveLength(1);
    expect(all[0].userId).toBe(userId);
  });
});

describe("частичность индексов", () => {
  it("телеметрия остаётся уникальной по пакету, сессии и номеру попытки", async () => {
    const packageId = randomUUID();
    await repo.createScormPackage({
      id: packageId, testId, testTitle: "Т", testMode: "standard",
      secretKey: "s", apiBaseUrl: "http://localhost", exportedAt: new Date(),
      createdBy: randomUUID(), isActive: true,
    });
    const attempt = {
      packageId, sessionId: "sess-1", attemptNumber: 1,
      startedAt: new Date(), lastActivityAt: new Date(),
    };
    await repo.createScormAttempt({ id: randomUUID(), ...attempt });

    await expect(repo.createScormAttempt({ id: randomUUID(), ...attempt })).rejects.toThrow();
  });

  it("импортированные строки без пакета между собой не конфликтуют", async () => {
    // Старый индекс по (package_id, session_id, attempt_number) стал частичным именно ради этого:
    // у импорта все три поля — NULL/1, и без условия вторая строка была бы отвергнута.
    await repo.upsertImportedAttempt(importedRow());
    await repo.upsertImportedAttempt(importedRow({ participantKey: "d".repeat(64) }));

    expect(await h.current!.db.select().from(scormAttempts)).toHaveLength(2);
  });
});

describe("deleteLmsImportBatch", () => {
  it("удаляет партию вместе с её прохождениями", async () => {
    await repo.upsertImportedAttempt(importedRow());
    await repo.upsertImportedAttempt(importedRow({ participantKey: "e".repeat(64) }));

    await repo.deleteLmsImportBatch(batchId);

    expect(await h.current!.db.select().from(scormAttempts)).toHaveLength(0);
    expect(await repo.getLmsImportBatches(testId)).toHaveLength(0);
  });

  it("не трогает телеметрию и чужие партии", async () => {
    const packageId = randomUUID();
    await repo.createScormPackage({
      id: packageId, testId, testTitle: "Т", testMode: "standard",
      secretKey: "s", apiBaseUrl: "http://localhost", exportedAt: new Date(),
      createdBy: randomUUID(), isActive: true,
    });
    await repo.createScormAttempt({
      id: randomUUID(), packageId, sessionId: "sess-1", attemptNumber: 1,
      startedAt: new Date(), lastActivityAt: new Date(),
    });
    await repo.upsertImportedAttempt(importedRow());

    await repo.deleteLmsImportBatch(batchId);

    const left = await h.current!.db.select().from(scormAttempts);
    expect(left).toHaveLength(1);
    expect(left[0].origin).toBe("telemetry");
    expect(await h.current!.db.select().from(scormPackages)).toHaveLength(1);
  });
});

describe("внешний ключ пользователя", () => {
  it("доходит до базы через белый список и находится поиском", async () => {
    // Модульный тест `normalizeExternalKey` этого НЕ ловит: колонку легко забыть в белом списке
    // `updateUser`, и тогда ключ молча не сохранится, а связывание будет тихо не срабатывать.
    const id = randomUUID();
    await h.current!.db.insert(users).values({ id, email: "зашифровано", name: "Иванов" });
    await usersRepo.updateUser(id, { externalKey: "AB-12" });

    expect((await usersRepo.getUserByExternalKey("AB-12"))?.id).toBe(id);
  });

  it("регистр и краевые пробелы при поиске не учитываются", async () => {
    const id = randomUUID();
    await h.current!.db.insert(users).values({ id, email: "зашифровано", name: "Петров" });
    await usersRepo.updateUser(id, { externalKey: "AB-12" });

    expect((await usersRepo.getUserByExternalKey("  ab-12 "))?.id).toBe(id);
  });

  it("пустой ключ не совпадает ни с кем", async () => {
    // Иначе все безымянные участники связались бы с одним пользователем.
    const id = randomUUID();
    await h.current!.db.insert(users).values({ id, email: "зашифровано", name: "Сидоров" });
    await usersRepo.updateUser(id, { externalKey: null });

    expect(await usersRepo.getUserByExternalKey("")).toBeUndefined();
    expect(await usersRepo.getUserByExternalKey("   ")).toBeUndefined();
  });
});

describe("updateLmsImportBatch", () => {
  it("проставляет счётчики и протокол после прогона", async () => {
    await repo.updateLmsImportBatch(batchId, {
      rowsTotal: 3, rowsCreated: 2, rowsUpdated: 1, rowsSkipped: 0, rowsLinked: 1,
      warnings: ["Не разобраны колонки: topic_x."],
    });

    const [batch] = await repo.getLmsImportBatches(testId);
    expect(batch.rowsCreated).toBe(2);
    expect(batch.rowsLinked).toBe(1);
    expect(batch.warningsJson).toEqual(["Не разобраны колонки: topic_x."]);
  });
});

/**
 * @module tests/it/lms-external-participants.it.test
 * @description PRD-54 раздел 5.6 (BR-54-38 - BR-54-45) на реальной схеме: внешняя учётная запись
 * участника выгрузки, членство в группе партии, откат партии и удаление группы.
 *
 * Круглый рейс обязателен по той же причине, что у ключа импорта: откат решает «занята ли запись»
 * запросами к пяти таблицам, и ошибку в одном из них не поймает ни одна заглушка — она проявится
 * удалённым человеком, у которого оставались прохождения, или мусорной записью, у которой их нет.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  groups, users, userRoles, userGroups, scormAttempts, lmsImportBatches, lmsImportBatchUsers, testAssignments,
} from "@shared/schema";
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
// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { GroupsRepository } from "../../server/storage/groups-repository";

let scorm: ScormRepository;
let usersRepo: UsersRepository;
let groupsRepo: GroupsRepository;
let testId: string;
let groupId: string;

const KEY = "a3f9c2d1e5b7".padEnd(64, "0");

/** Партия импорта с группой (или без) — как её заводит `runImport`. */
async function batch(group: string | null = groupId): Promise<string> {
  const id = randomUUID();
  await scorm.createLmsImportBatch({
    id, testId, groupId: group, fileName: "выгрузка.xlsx", fileHash: randomUUID(),
    anonymized: true, sourceAnonymized: false, linkUsers: true, importedBy: randomUUID(),
  });
  return id;
}

/** Импортированное прохождение участника в партии. */
async function attempt(batchId: string, userId: string, day: string, group: string | null = groupId) {
  await scorm.upsertImportedAttempt({
    testId, participantKey: KEY, attemptKey: `c:${day}:1`, origin: "import", batchId, groupId: group, userId,
    lmsUserName: null, lmsUserOrg: null, lmsUserUnit: null, lmsUserPosition: null,
    startedAt: new Date(`${day}T00:00:00Z`), finishedAt: new Date(`${day}T00:00:00Z`),
    lastActivityAt: new Date(`${day}T00:00:00Z`), resultPassed: true, totalPoints: 0, resultPercent: null,
    maxPoints: null, deliveredQuestionIds: [], totalQuestions: 1, scalesJson: null, variablesJson: null,
    snapshotId: null, formsJson: null, achievedLevelsJson: null, failedTopicCoursesJson: null,
  });
}

const external = (over: Partial<Parameters<UsersRepository["createImportedExternalUser"]>[0]> = {}) =>
  usersRepo.createImportedExternalUser({
    externalKey: KEY, name: null, lmsLearnerId: null, organization: null, unit: "Отдел", position: "HRBP", ...over,
  });

beforeAll(async () => {
  h.current = await createHarness();
  scorm = new ScormRepository();
  usersRepo = new UsersRepository();
  groupsRepo = new GroupsRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  testId = randomUUID();
  groupId = randomUUID();
  await h.current!.db.insert(groups).values({ id: groupId, name: "Опросник ЧИЛ - тестирование HRBP" });
});

describe("внешняя запись участника выгрузки (BR-54-39, BR-54-40)", () => {
  it("без почты и пароля, внешняя, активная, с ролью ученика и полями из файла", async () => {
    const user = await external();

    expect(user).toMatchObject({
      email: null, passwordHash: null, isExternal: true, status: "active",
      externalKey: KEY, unit: "Отдел", position: "HRBP", name: "Участник a3f9c2d1",
    });
    const roles = await h.current!.db.select().from(userRoles).where(eq(userRoles.userId, user.id));
    expect(roles.map((r) => r.role)).toEqual(["learner"]);
  });

  it("читается обратно с почтой null — расшифровывать нечего", async () => {
    const user = await external();
    expect((await usersRepo.getUser(user.id))?.email).toBeNull();
    expect((await usersRepo.getUsers()).find((u) => u.id === user.id)?.email).toBeNull();
  });

  it("занятая подпись удлиняется до свободной", async () => {
    const first = await external();
    const second = await external({ externalKey: "a3f9c2d1ffff".padEnd(64, "1") });
    const third = await external({ externalKey: "a3f9c2d1f000".padEnd(64, "2") });

    expect(first.name).toBe("Участник a3f9c2d1");
    expect(second.name).toBe("Участник a3f9c2d1f");
    expect(third.name).toBe("Участник a3f9c2d1f0");
  });

  it("ФИО, если импорт его хранит, берётся как есть", async () => {
    expect((await external({ name: "Кузнецова Ольга" })).name).toBe("Кузнецова Ольга");
  });
});

describe("членство в группе партии (BR-54-41)", () => {
  it("ставится один раз и сообщает, поставлено ли этим вызовом", async () => {
    const user = await external();
    expect(await groupsRepo.ensureGroupMember(user.id, groupId)).toBe(true);
    expect(await groupsRepo.ensureGroupMember(user.id, groupId)).toBe(false);
    expect(await groupsRepo.getGroupUsers(groupId)).toHaveLength(1);
  });

  it("член группы без почты читается с email null", async () => {
    const user = await external();
    await groupsRepo.ensureGroupMember(user.id, groupId);
    const [member] = await groupsRepo.getGroupUsers(groupId);
    expect(member).toMatchObject({ id: user.id, email: null, isExternal: true });
  });
});

describe("откат партии (BR-54-43)", () => {
  /** Партия, которая завела участника и поставила его в группу. */
  async function importedOnce() {
    const b = await batch();
    const user = await external();
    await attempt(b, user.id, "2026-09-09");
    await groupsRepo.ensureGroupMember(user.id, groupId);
    await scorm.recordImportBatchUser(b, user.id, { createdUser: true, addedToGroup: true });
    return { b, user };
  }

  it("снимает членство и удаляет заведённую запись, когда она больше ничем не занята", async () => {
    const { b, user } = await importedOnce();

    await scorm.deleteLmsImportBatch(b);

    expect(await h.current!.db.select().from(users).where(eq(users.id, user.id))).toEqual([]);
    expect(await h.current!.db.select().from(userRoles).where(eq(userRoles.userId, user.id))).toEqual([]);
    expect(await h.current!.db.select().from(userGroups)).toEqual([]);
    expect(await h.current!.db.select().from(lmsImportBatchUsers)).toEqual([]);
  });

  it("запись, назначенная на тест, остаётся", async () => {
    const { b, user } = await importedOnce();
    await h.current!.db.insert(testAssignments).values({
      id: randomUUID(), testId, userId: user.id, assignedBy: randomUUID(),
    } as never);

    await scorm.deleteLmsImportBatch(b);

    expect(await h.current!.db.select().from(users).where(eq(users.id, user.id))).toHaveLength(1);
  });

  it("запись, которую добавили в другую группу руками, остаётся", async () => {
    const { b, user } = await importedOnce();
    const other = randomUUID();
    await h.current!.db.insert(groups).values({ id: other, name: "Другая" });
    await groupsRepo.ensureGroupMember(user.id, other);

    await scorm.deleteLmsImportBatch(b);

    expect(await h.current!.db.select().from(users).where(eq(users.id, user.id))).toHaveLength(1);
    // Членство, поставленное откатываемой партией, при этом снято.
    const left = await h.current!.db.select().from(userGroups).where(eq(userGroups.userId, user.id));
    expect(left.map((m) => m.groupId)).toEqual([other]);
  });

  it("при второй партии той же группы отметки переходят к ней, и её откат доводит дело до конца", async () => {
    const { b, user } = await importedOnce();
    const b2 = await batch();
    await attempt(b2, user.id, "2026-09-10");
    await scorm.recordImportBatchUser(b2, user.id, { createdUser: false, addedToGroup: false });

    await scorm.deleteLmsImportBatch(b);

    // Прохождение второй партии осталось — значит, и человек, и членство.
    expect(await h.current!.db.select().from(users).where(eq(users.id, user.id))).toHaveLength(1);
    expect(await groupsRepo.getGroupUsers(groupId)).toHaveLength(1);
    const [heir] = await h.current!.db.select().from(lmsImportBatchUsers);
    expect(heir).toMatchObject({ batchId: b2, createdUser: true, addedToGroup: true });

    await scorm.deleteLmsImportBatch(b2);

    expect(await h.current!.db.select().from(users).where(eq(users.id, user.id))).toEqual([]);
    expect(await h.current!.db.select().from(userGroups)).toEqual([]);
  });

  it("членство, которого партия не ставила, откат не трогает", async () => {
    const b = await batch();
    const user = await external();
    await groupsRepo.ensureGroupMember(user.id, groupId);
    await attempt(b, user.id, "2026-09-09");
    await scorm.recordImportBatchUser(b, user.id, { createdUser: false, addedToGroup: false });

    await scorm.deleteLmsImportBatch(b);

    expect(await groupsRepo.getGroupUsers(groupId)).toHaveLength(1);
  });
});

describe("удаление группы (BR-54-45)", () => {
  it("называет прохождения и загрузки, а удаление снимает с них метку", async () => {
    const b = await batch();
    const user = await external();
    await attempt(b, user.id, "2026-09-09");
    await attempt(b, user.id, "2026-09-10");

    expect(await groupsRepo.getGroupImportSummary(groupId)).toEqual({ attempts: 2, batches: 1 });

    await groupsRepo.deleteGroup(groupId);

    const rows = await h.current!.db.select({ g: scormAttempts.groupId }).from(scormAttempts);
    expect(rows.map((r) => r.g)).toEqual([null, null]);
    const [batchRow] = await h.current!.db.select().from(lmsImportBatches);
    expect(batchRow.groupId).toBeNull();
  });
});

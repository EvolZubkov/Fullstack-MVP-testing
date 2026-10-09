// @vitest-environment node
/**
 * @module tests/storage/users-org-fields.test
 * @description The org-structure fields of a profile (organisation, unit,
 * position) and the LMS learner id in {@link module:server/storage/users-repository},
 * against a real (pglite) database (org-structure plan, task 1).
 *
 * Asserted against a database rather than a mock because the defect this guards
 * is a column that silently does not reach it: `createUser` writes an explicit
 * column list and `updateUser` a whitelist, and a field missing from either is
 * dropped without a word. The value dictionary is checked here too — it reads two
 * tables and folds spellings, both invisible to a mock.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness, type Harness } from "../it/db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));
vi.mock("../../server/utils/crypto", () => ({
  encryptEmail: async (e: string) => `enc:${e}`,
  decryptEmail: async (e: string) => e.replace(/^enc:/, ""),
  hashEmail: (e: string) => `hash:${e}`,
  hashPassword: async (p: string) => `hashed:${p}`,
  verifyPassword: async () => false,
  dummyVerifyPassword: async () => {},
  isLegacyBcryptHash: () => false,
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { DatabaseStorage } from "../../server/storage";
// eslint-disable-next-line import/first
import { users, scormAttempts } from "@shared/schema";

let storage: DatabaseStorage;

beforeAll(async () => {
  h.current = await createHarness();
  storage = new DatabaseStorage();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
});

async function rawRow(id: string) {
  const [row] = await h.current!.db.select().from(users).where(eq(users.id, id));
  return row;
}

function email() {
  return `u-${randomUUID()}@example.org`;
}

describe("UsersRepository — org-structure fields", () => {
  it("createUser persists organisation, unit, position and the LMS learner id", async () => {
    const created = await storage.createUser({
      email: email(),
      passwordHash: "p",
      organization: "АО «Северсталь-Сервис»",
      unit: "Отдел продаж",
      position: "Менеджер",
      lmsLearnerId: "petrov_i",
    });
    expect(await rawRow(created.id)).toMatchObject({
      organization: "АО «Северсталь-Сервис»",
      unit: "Отдел продаж",
      position: "Менеджер",
      lmsLearnerId: "petrov_i",
    });
  });

  it("updateUser writes the four fields and clears them with null", async () => {
    const created = await storage.createUser({ email: email(), passwordHash: "p" });
    await storage.updateUser(created.id, {
      organization: "ООО «Партнёр»", unit: "Логистика", position: "Кладовщик", lmsLearnerId: "egorov_p",
    });
    expect(await rawRow(created.id)).toMatchObject({
      organization: "ООО «Партнёр»", unit: "Логистика", position: "Кладовщик", lmsLearnerId: "egorov_p",
    });

    await storage.updateUser(created.id, { unit: null, lmsLearnerId: null });
    expect(await rawRow(created.id)).toMatchObject({
      organization: "ООО «Партнёр»", unit: null, position: "Кладовщик", lmsLearnerId: null,
    });
  });
});

describe("UsersRepository — org value dictionary", () => {
  it("counts values from profiles and imported passages, folding spellings", async () => {
    await storage.createUser({ email: email(), passwordHash: "p", unit: "Отдел продаж", position: "Менеджер" });
    await storage.createUser({ email: email(), passwordHash: "p", unit: "Отдел  продаж" });
    const base = {
      packageId: null, sessionId: null, attemptNumber: 1, origin: "import" as const,
      startedAt: new Date(), lastActivityAt: new Date(),
    };
    await h.current!.db.insert(scormAttempts).values([
      { ...base, id: randomUUID(), participantKey: "k1", lmsUserUnit: "ОТДЕЛ ПРОДАЖ", lmsUserOrg: "АО «Ромашка»" },
      { ...base, id: randomUUID(), participantKey: "k2", lmsUserUnit: "Логистика", lmsUserPosition: "Кладовщик" },
    ]);

    const values = await storage.getOrgValues();

    expect(values.unit).toEqual([
      { value: "Логистика", users: 0, attempts: 1 },
      { value: "Отдел продаж", users: 2, attempts: 1 },
    ]);
    expect(values.position).toEqual([
      { value: "Кладовщик", users: 0, attempts: 1 },
      { value: "Менеджер", users: 1, attempts: 0 },
    ]);
    expect(values.organization).toEqual([{ value: "АО «Ромашка»", users: 0, attempts: 1 }]);
  });
});

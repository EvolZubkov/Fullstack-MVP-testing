// @vitest-environment node
/**
 * @module tests/storage/users-external.test
 * @description PRD-28 coverage for the external-participant account in
 * {@link module:server/storage/users-repository}, driven through the
 * {@link DatabaseStorage} facade against a real (pglite) database. Two properties
 * are asserted here because both are invisible to a mock-based spec: that
 * `createUser` actually PERSISTS `is_external` (a dropped field would silently
 * produce a passwordless REGULAR account — exactly what the spec forbids), and
 * that `validatePassword` refuses an external account by the FLAG, not merely by
 * the absent hash, so setting a password on such an account never reopens the
 * password login path (FR-01/FR-02). The refusal must also keep paying the
 * timing-equalizing dummy verification, so the spy on it is asserted too: a
 * short-circuit that answers faster for an external account would turn the
 * response time into an oracle for "this address exists and is external".
 *
 * Runs in the `node` environment (per-file override) so pglite works under the
 * otherwise-jsdom unit run; living under `tests/` (not `tests/it/`) its coverage
 * counts toward the reported total.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness, type Harness } from "../it/db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
const { dummyVerifySpy } = vi.hoisted(() => ({ dummyVerifySpy: vi.fn(async () => {}) }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));
// The crypto seam is stubbed for speed and determinism, not for configuration:
// the real module falls back to dev values when ENCRYPTION_* is unset, but real
// scrypt runs the OWASP profile (hundreds of milliseconds per call) and its
// output is salted, so assertions on stored values could not be exact.
// `dummyVerifyPassword` is a SPY: the timing-equalizing call it stands for is a
// property under test here, and a silent stub would let it be optimized away.
vi.mock("../../server/utils/crypto", () => ({
  encryptEmail: async (e: string) => `enc:${e}`,
  decryptEmail: async (e: string) => e.replace(/^enc:/, ""),
  hashEmail: (e: string) => `hash:${e}`,
  hashPassword: async (p: string) => `hashed:${p}`,
  verifyPassword: async (plain: string, stored: string) => stored === `hashed:${plain}`,
  dummyVerifyPassword: dummyVerifySpy,
  // The real predicate, so the lazy-rehash branch stays reachable instead of
  // being permanently stubbed shut.
  isLegacyBcryptHash: (stored: string | null) => stored != null && /^\$2[aby]\$/.test(stored),
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { DatabaseStorage } from "../../server/storage";
// eslint-disable-next-line import/first
import { users, type InsertUser } from "@shared/schema";

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
  dummyVerifySpy.mockClear();
});

/** Reads the raw stored row (bypassing email decryption) for a created user. */
async function rawRow(id: string) {
  const [row] = await h.current!.db.select().from(users).where(eq(users.id, id));
  return row;
}

describe("UsersRepository — external participant (PRD-28)", () => {
  it("createUser persists the external flag with no password at all", async () => {
    const insert: InsertUser = {
      email: `ext-${randomUUID()}@example.org`,
      passwordHash: null,
      isExternal: true,
      name: "Внешний участник",
    };
    const created = await storage.createUser(insert);

    expect(created.isExternal).toBe(true);
    expect(created.passwordHash).toBeNull();

    // The flag must be in the DATABASE, not just in the returned object.
    const stored = await rawRow(created.id);
    expect(stored.isExternal).toBe(true);
    expect(stored.passwordHash).toBeNull();
  });

  it("createUser defaults the flag to false for a regular account", async () => {
    const insert: InsertUser = {
      email: `staff-${randomUUID()}@example.org`,
      passwordHash: "Secret!2026",
    };
    const created = await storage.createUser(insert);

    expect(created.isExternal).toBe(false);
    expect((await rawRow(created.id)).isExternal).toBe(false);
  });

  it("validatePassword refuses an external account for any password", async () => {
    const email = `ext-${randomUUID()}@example.org`;
    await storage.createUser({ email, passwordHash: null, isExternal: true } satisfies InsertUser);

    expect(await storage.validatePassword(email, "")).toBeNull();
    expect(await storage.validatePassword(email, "Secret!2026")).toBeNull();
    expect(await storage.validatePassword(email, "whatever")).toBeNull();

    // Every refusal still pays for the dummy verification — the refusal must not
    // be cheaper than a wrong password on a regular account.
    expect(dummyVerifySpy).toHaveBeenCalledTimes(3);
  });

  it("validatePassword still admits a regular account with the right password", async () => {
    const email = `staff-${randomUUID()}@example.org`;
    const created = await storage.createUser({ email, passwordHash: "Secret!2026" } satisfies InsertUser);

    const ok = await storage.validatePassword(email, "Secret!2026");
    expect(ok?.id).toBe(created.id);
    // The successful path skips the dummy — it does the real verification instead.
    expect(dummyVerifySpy).not.toHaveBeenCalled();

    expect(await storage.validatePassword(email, "wrong")).toBeNull();
  });

  it("validatePassword refuses an external account even after a password was set on it", async () => {
    // Exercises the FLAG branch specifically: the hash is present and correct here,
    // so only `isExternal` can keep the login closed.
    const email = `ext-${randomUUID()}@example.org`;
    const created = await storage.createUser({ email, passwordHash: null, isExternal: true } satisfies InsertUser);
    await storage.updateUserPassword(created.id, "Secret!2026");

    const stored = await rawRow(created.id);
    expect(stored.passwordHash).not.toBeNull(); // precondition: a usable hash exists
    expect(stored.isExternal).toBe(true);

    expect(await storage.validatePassword(email, "Secret!2026")).toBeNull();
    expect(dummyVerifySpy).toHaveBeenCalled();
  });
});

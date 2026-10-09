/**
 * @module server/services/analytics/__tests__/assigned-count-org.test
 * @description «Назначено» for the org-structure axes (org-structure plan, Р-7):
 * counted by the profile of the assigned people, since an axis about people has
 * an answer even for those who never started — «в отделе назначено 20, прошли 5».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTestAssignments: vi.fn(),
    getGroupUsers: vi.fn(),
    getUser: vi.fn(),
  },
}));
vi.mock("../../../storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { readAssigned } from "../assigned-count";

function user(id: string, profile: Record<string, string | null> = {}) {
  return { id, isExternal: false, organization: null, unit: null, position: null, ...profile };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("countByOrg", () => {
  it("counts the assigned people whose profile has the value, in any spelling", async () => {
    storageMock.getTestAssignments.mockResolvedValue([
      { groupId: "g1", userId: null },
      { groupId: null, userId: "u9" },
    ]);
    storageMock.getGroupUsers.mockResolvedValue([
      user("u1", { unit: "Отдел продаж" }),
      user("u2", { unit: "ОТДЕЛ  ПРОДАЖ" }),
      user("u3", { unit: "Логистика" }),
      user("u4"),
    ]);
    // Assigned by name and in no group: the profile is read one by one.
    storageMock.getUser.mockResolvedValue(user("u9", { unit: "отдел продаж" }));

    const assigned = await readAssigned("t1");

    expect(assigned.countByOrg("unit", "Отдел продаж")).toBe(3);
    expect(assigned.countByOrg("unit", "Логистика")).toBe(1);
    // «Не указано»: assigned with no value in the profile.
    expect(assigned.countByOrg("unit", null)).toBe(1);
    expect(assigned.countByOrg("organization", null)).toBe(5);
  });

  it("answers null when the assignments could not be read", async () => {
    storageMock.getTestAssignments.mockRejectedValue(new Error("db down"));
    const assigned = await readAssigned("t1");
    expect(assigned.countByOrg("unit", "Отдел продаж")).toBeNull();
  });
});

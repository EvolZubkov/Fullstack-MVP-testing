/**
 * @module server/services/analytics/__tests__/assigned-count
 * @description PRD-56 FR-06: сколько людей среза получили назначение теста.
 *
 * Проверяется ГРАНИЦА применимости величины. Назначение относится к человеку, а срез бывает
 * построен по свойству попытки — и тогда честный ответ «неприменимо», а не ноль: ноль читается
 * как «никого не позвали», что неправда.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTestAssignments: vi.fn(),
    getGroupUsers: vi.fn(),
    getUser: vi.fn(),
  },
}));
vi.mock("../../../storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- должно импортироваться ПОСЛЕ vi.mock
import { readAssigned } from "../assigned-count";

const user = (id: string, isExternal = false) => ({ id, isExternal });

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(undefined);
});

describe("readAssigned", () => {
  it("считает назначенных группе поимённо и списком", async () => {
    // Назначение группе — это назначение каждому её участнику: как позвали, человека не
    // касается, а величина «сколько позвали» обязана считать его один раз.
    storageMock.getTestAssignments.mockResolvedValue([
      { groupId: "g1", userId: null },
      { groupId: null, userId: "u9" },
    ]);
    storageMock.getGroupUsers.mockResolvedValue([user("u1"), user("u2")]);

    const assigned = await readAssigned("test1", ["g1"]);

    expect(assigned.countFor(["g1"])).toBe(2);
    // «Тест целиком»: считаются все назначенные, включая позванного поимённо.
    expect(assigned.countFor([])).toBe(3);
  });

  it("отвечает «неприменимо» срезу, описанному не людьми", async () => {
    storageMock.getTestAssignments.mockResolvedValue([{ groupId: "g1", userId: null }]);
    storageMock.getGroupUsers.mockResolvedValue([user("u1")]);

    const assigned = await readAssigned("test1", []);

    expect(assigned.countFor(null)).toBeNull();
  });

  it("считает группу, которой тест не назначали, честным нулём", async () => {
    // Срез ссылается на группу без назначений: её участники существуют, позванных среди них
    // нет — это ноль, а не «неприменимо».
    storageMock.getTestAssignments.mockResolvedValue([{ groupId: "g1", userId: null }]);
    storageMock.getGroupUsers.mockImplementation(async (id: string) =>
      (id === "g1" ? [user("u1")] : [user("u7")]));

    const assigned = await readAssigned("test1", ["g2"]);

    expect(assigned.countFor(["g2"])).toBe(0);
  });

  it("делит назначенных на внешних и сотрудников", async () => {
    // Ось «внутренние и внешние» — про ЛЮДЕЙ, как и группа: признак есть и у того, кто так и
    // не начал (PRD-28), поэтому величина определена.
    storageMock.getTestAssignments.mockResolvedValue([
      { groupId: "g1", userId: null },
      { groupId: null, userId: "u9" },
    ]);
    storageMock.getGroupUsers.mockResolvedValue([user("u1"), user("u2", true)]);
    storageMock.getUser.mockResolvedValue(user("u9", true));

    const assigned = await readAssigned("test1", ["g1"]);

    expect(assigned.countByKind(true)).toBe(2);
    expect(assigned.countByKind(false)).toBe(1);
  });

  it("дочитывает признак только у тех, кого не было в группах", async () => {
    // Иначе на каждого назначенного уходил бы свой запрос, а их столько же, сколько людей
    // в инсталляции.
    storageMock.getTestAssignments.mockResolvedValue([
      { groupId: "g1", userId: null },
      { groupId: null, userId: "u9" },
    ]);
    storageMock.getGroupUsers.mockResolvedValue([user("u1"), user("u2")]);

    await readAssigned("test1", ["g1"]);

    expect(storageMock.getUser).toHaveBeenCalledTimes(1);
    expect(storageMock.getUser).toHaveBeenCalledWith("u9");
  });
});

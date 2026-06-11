/**
 * @module tests/topic-access
 *
 * Unit tests of the topic-access resolution (PRD-15 block C, role-model §6.5-6.8):
 * visibility/ownership/grant rules for visibleTopic, canManageTopicContent,
 * canDeleteTopic, the grant/owner gates and visibleTopicScope.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROLES } from "@shared/access";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUserGroups: vi.fn(),
    getActiveTopicGrantsForGrantees: vi.fn(),
    getSharedTopicIds: vi.fn(),
    getTopicIdsByOwner: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import {
  visibleTopic,
  canManageTopicContent,
  canDeleteTopic,
  canGrantTopicAccess,
  canChangeTopicOwner,
  visibleTopicScope,
} from "../server/services/topic-access";

const PRIVATE = { id: "tp1", ownerId: "owner-1", visibility: "private" as const };
const SHARED = { id: "tp2", ownerId: "owner-1", visibility: "shared" as const };

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([]);
  storageMock.getSharedTopicIds.mockResolvedValue([]);
  storageMock.getTopicIdsByOwner.mockResolvedValue([]);
});

describe("visibleTopic", () => {
  it("admin sees any topic", async () => {
    expect(await visibleTopic([ROLES.ADMINISTRATOR], "x", PRIVATE)).toBe(true);
  });
  it("owner sees their private topic", async () => {
    expect(await visibleTopic([ROLES.AUTHOR], "owner-1", PRIVATE)).toBe(true);
  });
  it("any author sees a shared topic", async () => {
    expect(await visibleTopic([ROLES.AUTHOR], "stranger", SHARED)).toBe(true);
  });
  it("a stranger does NOT see a private topic without a grant (F-10)", async () => {
    expect(await visibleTopic([ROLES.AUTHOR], "stranger", PRIVATE)).toBe(false);
  });
  it("a use-grant makes a private topic visible", async () => {
    storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([
      { topicId: "tp1", accessLevel: "use" },
    ]);
    expect(await visibleTopic([ROLES.AUTHOR], "stranger", PRIVATE)).toBe(true);
  });
  it("a group grant makes a private topic visible", async () => {
    storageMock.getUserGroups.mockResolvedValue([{ id: "g1" }]);
    storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([
      { topicId: "tp1", accessLevel: "use" },
    ]);
    expect(await visibleTopic([ROLES.AUTHOR], "stranger", PRIVATE)).toBe(true);
  });
});

describe("canManageTopicContent", () => {
  it("owner and admin can manage", async () => {
    expect(await canManageTopicContent([ROLES.AUTHOR], "owner-1", PRIVATE)).toBe(true);
    expect(await canManageTopicContent([ROLES.ADMINISTRATOR], "x", PRIVATE)).toBe(true);
  });
  it("a manage grant allows managing; a use grant does not", async () => {
    storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([
      { topicId: "tp1", accessLevel: "manage" },
    ]);
    expect(await canManageTopicContent([ROLES.AUTHOR], "u2", PRIVATE)).toBe(true);
    storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([
      { topicId: "tp1", accessLevel: "use" },
    ]);
    expect(await canManageTopicContent([ROLES.AUTHOR], "u2", PRIVATE)).toBe(false);
  });
  it("a shared topic is NOT manageable by a stranger (use, not manage)", async () => {
    expect(await canManageTopicContent([ROLES.AUTHOR], "stranger", SHARED)).toBe(false);
  });
});

describe("canDeleteTopic / grant / owner gates", () => {
  it("delete is owner or admin only", () => {
    expect(canDeleteTopic([ROLES.AUTHOR], "owner-1", PRIVATE)).toBe(true);
    expect(canDeleteTopic([ROLES.ADMINISTRATOR], "x", PRIVATE)).toBe(true);
    expect(canDeleteTopic([ROLES.AUTHOR], "stranger", PRIVATE)).toBe(false);
  });
  it("granting is owner-on-own or admin", () => {
    expect(canGrantTopicAccess([ROLES.AUTHOR], "owner-1", PRIVATE)).toBe(true);
    expect(canGrantTopicAccess([ROLES.AUTHOR], "stranger", PRIVATE)).toBe(false);
    expect(canGrantTopicAccess([ROLES.ADMINISTRATOR], "x", PRIVATE)).toBe(true);
  });
  it("owner change is admin only", () => {
    expect(canChangeTopicOwner([ROLES.ADMINISTRATOR])).toBe(true);
    expect(canChangeTopicOwner([ROLES.AUTHOR])).toBe(false);
  });
});

describe("visibleTopicScope", () => {
  it("admin gets { all: true }", async () => {
    await expect(visibleTopicScope([ROLES.ADMINISTRATOR], "x")).resolves.toEqual({
      all: true,
      ids: new Set(),
    });
  });
  it("author gets shared + owned + granted", async () => {
    storageMock.getSharedTopicIds.mockResolvedValue(["shared-1"]);
    storageMock.getTopicIdsByOwner.mockResolvedValue(["owned-1"]);
    storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([{ topicId: "granted-1" }]);
    const scope = await visibleTopicScope([ROLES.AUTHOR], "u1");
    expect(scope.all).toBe(false);
    expect([...scope.ids].sort()).toEqual(["granted-1", "owned-1", "shared-1"]);
  });
  it("a non-author (manager/learner) sees nothing in the bank", async () => {
    const scope = await visibleTopicScope([ROLES.MANAGER], "u1");
    expect(scope.ids.size).toBe(0);
    expect(storageMock.getSharedTopicIds).not.toHaveBeenCalled();
  });
});

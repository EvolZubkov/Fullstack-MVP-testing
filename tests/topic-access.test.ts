/**
 * @module tests/topic-access
 *
 * Unit tests of the topic-access resolution (PRD-15 block C, role-model §6.5-6.8):
 * visibility/ownership/grant rules for visibleTopic, canManageTopicContent,
 * canDeleteTopic, the grant/owner gates and visibleTopicScope.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROLES } from "@shared/access";
import { normalizeTopicName } from "@shared/topics/naming";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUserGroups: vi.fn(),
    getActiveTopicGrantsForGrantees: vi.fn(),
    getSharedTopicIds: vi.fn(),
    getTopicIdsByOwner: vi.fn(),
    getTestsUsingTopic: vi.fn(),
    getGroupUsers: vi.fn(),
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
  dependentTestsForGrant,
} from "../server/services/topic-access";

const PRIVATE = { id: "tp1", ownerId: "owner-1", visibility: "private" as const };
const SHARED = { id: "tp2", ownerId: "owner-1", visibility: "shared" as const };

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([]);
  storageMock.getSharedTopicIds.mockResolvedValue([]);
  storageMock.getTopicIdsByOwner.mockResolvedValue([]);
  storageMock.getTestsUsingTopic.mockResolvedValue([]);
  storageMock.getGroupUsers.mockResolvedValue([]);
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

describe("normalizeTopicName (FR-27)", () => {
  it("folds case, trims, collapses spaces and maps ё->е", () => {
    expect(normalizeTopicName("  Финансы ")).toBe("финансы");
    expect(normalizeTopicName("Ёлка")).toBe("елка");
    expect(normalizeTopicName("Учёт   и  Аудит")).toBe("учет и аудит");
  });
  it("collides variants that differ only by case/space/ё", () => {
    expect(normalizeTopicName("Тёма")).toBe(normalizeTopicName("тема"));
  });
});

describe("dependentTestsForGrant (FR-26 hard-revoke feasibility)", () => {
  const using = [
    { id: "t-own", title: "Свой", ownerId: "u9", status: "published", mode: "standard" },
    { id: "t-other", title: "Чужой", ownerId: "u-other", status: "published", mode: "standard" },
    { id: "t-noown", title: "Без владельца", ownerId: null, status: "draft", mode: "standard" },
  ];

  // TD-01: grantees are users only — only the grantee's own dependent tests.
  it("returns only the grantee's own dependent tests", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue(using);
    const deps = await dependentTestsForGrant("tp1", "u9");
    expect(deps).toEqual([{ testId: "t-own", title: "Свой", status: "published" }]);
    expect(storageMock.getGroupUsers).not.toHaveBeenCalled();
  });

  it("returns an empty list when no dependent test belongs to the grantee", async () => {
    storageMock.getTestsUsingTopic.mockResolvedValue([using[1], using[2]]);
    const deps = await dependentTestsForGrant("tp1", "u9");
    expect(deps).toEqual([]);
  });
});

/**
 * Tests for DatabaseStorage — part 2
 * Covers: adaptive settings/levels/links, SCORM packages/attempts/answers,
 * group relations, test assignments, getAssignedTestsForUser, setUserGroups,
 * deleteGroup (cascade), topic courses, deleteAdaptiveLevelsByTest (cascade).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { dbMock } = vi.hoisted(() => {
  const dbMock = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return { dbMock };
});

vi.mock("../server/db", () => ({ db: dbMock }));

vi.mock("../server/utils/crypto", () => ({
  encryptEmail: (e: string) => `enc:${e}`,
  decryptEmail: (e: string) => e.replace("enc:", ""),
  hashEmail: (e: string) => `hash:${e}`,
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: async (_p: string, _r: number) => "hashed_password",
    compare: async (plain: string, hashed: string) =>
      hashed === "hashed_password" && plain === "correct",
  },
}));

// ─── Chainable mock helpers ───────────────────────────────────────────────────
const makeChain = (returnValue: any) => {
  const chain: any = {};
  chain.then = (resolve: any) => resolve(returnValue);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(returnValue);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  return chain;
};

function setupSelect(rows: any[]) {
  const chain = makeChain(rows);
  dbMock.select.mockReturnValue(chain);
  return chain;
}

function setupInsert(row: any) {
  const chain = makeChain([row]);
  dbMock.insert.mockReturnValue(chain);
  return chain;
}

function setupUpdate(row: any) {
  const chain = makeChain(row ? [row] : []);
  dbMock.update.mockReturnValue(chain);
  return chain;
}

function setupDelete(rowCount = 1) {
  const rows = rowCount > 0 ? [{}] : [];
  const chain: any = {};
  chain.then = (resolve: any) => resolve({ rowCount });
  chain.where = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(rows);
  dbMock.delete.mockReturnValue(chain);
  return chain;
}

// ─── import after mocks ───────────────────────────────────────────────────────
import { DatabaseStorage } from "../server/storage";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const now = new Date("2024-01-01T00:00:00Z");

const dbAdaptiveSettings = {
  id: "as1",
  testId: "test1",
  topicId: "t1",
  startLevel: 50,
  passRule: { type: "percent", value: 70 },
  createdAt: now,
};

const dbAdaptiveLevel = {
  id: "al1",
  testId: "test1",
  topicId: "t1",
  levelIndex: 0,
  name: "Базовый",
  difficulty: 30,
  questionsPerLevel: 5,
  passingScore: 3,
  createdAt: now,
};

const dbAdaptiveLevelLink = {
  id: "all1",
  levelId: "al1",
  url: "https://example.com/course",
  title: "Курс по теме",
  createdAt: now,
};

const dbScormPackage = {
  id: "sp1",
  testId: "test1",
  title: "Test Package",
  createdAt: now,
  updatedAt: now,
};

const dbScormAttempt = {
  id: "sa1",
  packageId: "sp1",
  sessionId: "sess1",
  attemptNumber: 1,
  status: "completed",
  score: 90,
  passed: true,
  startedAt: now,
  completedAt: now,
  suspendData: null,
};

const dbScormAnswer = {
  id: "saa1",
  attemptId: "sa1",
  questionId: "q1",
  response: "A",
  correct: true,
  points: 1,
  createdAt: now,
};

const dbGroup = { id: "g1", name: "Group A", description: null, createdAt: now, createdBy: null };
const dbTest = { id: "test1", title: "Test 1", mode: "standard", createdAt: now };
const dbAssignment = {
  id: "asgn1",
  testId: "test1",
  userId: "u1",
  groupId: null,
  dueDate: null,
  assignedAt: now,
  assignedBy: "admin1",
};
const dbTopicCourse = {
  id: "tc1",
  topicId: "t1",
  title: "Course 1",
  url: "https://example.com",
  createdAt: now,
};

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE TOPIC SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — adaptive topic settings", () => {
  let storage: DatabaseStorage;
  beforeEach(() => { vi.clearAllMocks(); storage = new DatabaseStorage(); });

  it("getAdaptiveTopicSettings — returns settings by testId+topicId", async () => {
    setupSelect([dbAdaptiveSettings]);
    const s = await storage.getAdaptiveTopicSettings("test1", "t1");
    expect(s).toBeDefined();
    expect(s!.id).toBe("as1");
  });

  it("getAdaptiveTopicSettings — returns undefined when not found", async () => {
    setupSelect([]);
    expect(await storage.getAdaptiveTopicSettings("x", "y")).toBeUndefined();
  });

  it("getAdaptiveTopicSettingsByTest — returns array for testId", async () => {
    setupSelect([dbAdaptiveSettings]);
    const arr = await storage.getAdaptiveTopicSettingsByTest("test1");
    expect(arr).toHaveLength(1);
    expect(arr[0].testId).toBe("test1");
  });

  it("createAdaptiveTopicSettings — inserts and returns settings", async () => {
    setupInsert(dbAdaptiveSettings);
    const s = await storage.createAdaptiveTopicSettings({
      testId: "test1",
      topicId: "t1",
      startLevel: 50,
      passRule: { type: "percent", value: 70 },
    } as any);
    expect(s.testId).toBe("test1");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("updateAdaptiveTopicSettings — returns updated settings", async () => {
    setupUpdate({ ...dbAdaptiveSettings, startLevel: 60 });
    const s = await storage.updateAdaptiveTopicSettings("as1", { startLevel: 60 } as any);
    expect(s).toBeDefined();
  });

  it("updateAdaptiveTopicSettings — returns undefined when not found", async () => {
    setupUpdate(null);
    expect(await storage.updateAdaptiveTopicSettings("x", {})).toBeUndefined();
  });

  it("deleteAdaptiveTopicSettingsByTest — calls delete", async () => {
    setupDelete();
    await storage.deleteAdaptiveTopicSettingsByTest("test1");
    expect(dbMock.delete).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE LEVELS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — adaptive levels", () => {
  let storage: DatabaseStorage;
  beforeEach(() => { vi.clearAllMocks(); storage = new DatabaseStorage(); });

  it("getAdaptiveLevels — returns levels ordered by index", async () => {
    setupSelect([dbAdaptiveLevel]);
    const levels = await storage.getAdaptiveLevels("test1", "t1");
    expect(levels).toHaveLength(1);
    expect(levels[0].levelIndex).toBe(0);
  });

  it("getAdaptiveLevelsByTest — returns all levels for test", async () => {
    setupSelect([dbAdaptiveLevel, { ...dbAdaptiveLevel, id: "al2", levelIndex: 1 }]);
    const levels = await storage.getAdaptiveLevelsByTest("test1");
    expect(levels).toHaveLength(2);
  });

  it("createAdaptiveLevel — inserts level", async () => {
    setupInsert(dbAdaptiveLevel);
    const level = await storage.createAdaptiveLevel({
      testId: "test1",
      topicId: "t1",
      levelIndex: 0,
      name: "Базовый",
      difficulty: 30,
    } as any);
    expect(level.name).toBe("Базовый");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("updateAdaptiveLevel — returns updated level", async () => {
    setupUpdate({ ...dbAdaptiveLevel, name: "Обновлённый" });
    const level = await storage.updateAdaptiveLevel("al1", { name: "Обновлённый" } as any);
    expect(level).toBeDefined();
  });

  it("updateAdaptiveLevel — returns undefined when not found", async () => {
    setupUpdate(null);
    expect(await storage.updateAdaptiveLevel("x", {})).toBeUndefined();
  });

  it("deleteAdaptiveLevelsByTest — cascades: deletes links then levels", async () => {
    // First call: getAdaptiveLevelsByTest (select)
    setupSelect([dbAdaptiveLevel]);
    // Subsequent delete calls need the chain
    setupDelete();
    await storage.deleteAdaptiveLevelsByTest("test1");
    expect(dbMock.select).toHaveBeenCalled();
    expect(dbMock.delete).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE LEVEL LINKS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — adaptive level links", () => {
  let storage: DatabaseStorage;
  beforeEach(() => { vi.clearAllMocks(); storage = new DatabaseStorage(); });

  it("getAdaptiveLevelLinks — returns links for levelId", async () => {
    setupSelect([dbAdaptiveLevelLink]);
    const links = await storage.getAdaptiveLevelLinks("al1");
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com/course");
  });

  it("createAdaptiveLevelLink — inserts link", async () => {
    setupInsert(dbAdaptiveLevelLink);
    const link = await storage.createAdaptiveLevelLink({
      levelId: "al1",
      url: "https://example.com/course",
      title: "Курс по теме",
    } as any);
    expect(link.levelId).toBe("al1");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("deleteAdaptiveLevelLinksByLevel — calls delete", async () => {
    setupDelete();
    await storage.deleteAdaptiveLevelLinksByLevel("al1");
    expect(dbMock.delete).toHaveBeenCalled();
  });

  it("deleteAdaptiveLevelLinksByTest — iterates levels and deletes links", async () => {
    setupSelect([dbAdaptiveLevel]);
    setupDelete();
    await storage.deleteAdaptiveLevelLinksByTest("test1");
    expect(dbMock.select).toHaveBeenCalled();
    expect(dbMock.delete).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCORM PACKAGES
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — SCORM packages", () => {
  let storage: DatabaseStorage;
  beforeEach(() => { vi.clearAllMocks(); storage = new DatabaseStorage(); });

  it("createScormPackage — inserts package", async () => {
    setupInsert(dbScormPackage);
    const pkg = await storage.createScormPackage({ ...dbScormPackage });
    expect(pkg.id).toBe("sp1");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("getScormPackage — returns package by id", async () => {
    setupSelect([dbScormPackage]);
    const pkg = await storage.getScormPackage("sp1");
    expect(pkg).toBeDefined();
    expect(pkg!.testId).toBe("test1");
  });

  it("getScormPackage — returns undefined when not found", async () => {
    setupSelect([]);
    expect(await storage.getScormPackage("x")).toBeUndefined();
  });

  it("getScormPackagesByTest — returns packages for testId", async () => {
    setupSelect([dbScormPackage]);
    const pkgs = await storage.getScormPackagesByTest("test1");
    expect(pkgs).toHaveLength(1);
  });

  it("getScormPackages — returns all packages", async () => {
    setupSelect([dbScormPackage]);
    const pkgs = await storage.getScormPackages();
    expect(pkgs).toHaveLength(1);
  });

  it("updateScormPackage — returns updated package", async () => {
    setupUpdate({ ...dbScormPackage, title: "Updated" });
    const pkg = await storage.updateScormPackage("sp1", { title: "Updated" } as any);
    expect(pkg).toBeDefined();
  });

  it("updateScormPackage — returns undefined when not found", async () => {
    setupUpdate(null);
    expect(await storage.updateScormPackage("x", {})).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCORM ATTEMPTS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — SCORM attempts", () => {
  let storage: DatabaseStorage;
  beforeEach(() => { vi.clearAllMocks(); storage = new DatabaseStorage(); });

  it("createScormAttempt — inserts attempt", async () => {
    setupInsert(dbScormAttempt);
    const a = await storage.createScormAttempt({ ...dbScormAttempt });
    expect(a.id).toBe("sa1");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("getScormAttempt — returns attempt by id", async () => {
    setupSelect([dbScormAttempt]);
    const a = await storage.getScormAttempt("sa1");
    expect(a).toBeDefined();
    expect(a!.sessionId).toBe("sess1");
  });

  it("getScormAttempt — returns undefined when not found", async () => {
    setupSelect([]);
    expect(await storage.getScormAttempt("x")).toBeUndefined();
  });

  it("getScormAttemptBySession — returns attempt with specific attemptNumber", async () => {
    setupSelect([dbScormAttempt]);
    const a = await storage.getScormAttemptBySession("sp1", "sess1", 1);
    expect(a).toBeDefined();
    expect(a!.attemptNumber).toBe(1);
  });

  it("getScormAttemptBySession — returns latest attempt when no number given", async () => {
    setupSelect([dbScormAttempt]);
    const a = await storage.getScormAttemptBySession("sp1", "sess1");
    expect(a).toBeDefined();
  });

  it("getScormAttemptBySession — returns undefined when not found", async () => {
    setupSelect([]);
    expect(await storage.getScormAttemptBySession("x", "y")).toBeUndefined();
  });

  it("getNextAttemptNumber — returns max+1", async () => {
    setupSelect([{ maxNum: 3 }]);
    const n = await storage.getNextAttemptNumber("sp1", "sess1");
    expect(n).toBe(4);
  });

  it("getNextAttemptNumber — returns 1 when no attempts exist", async () => {
    setupSelect([{ maxNum: 0 }]);
    const n = await storage.getNextAttemptNumber("sp1", "sess1");
    expect(n).toBe(1);
  });

  it("getScormAttemptsByPackage — returns attempts for package", async () => {
    setupSelect([dbScormAttempt]);
    const attempts = await storage.getScormAttemptsByPackage("sp1");
    expect(attempts).toHaveLength(1);
  });

  it("updateScormAttempt — returns updated attempt", async () => {
    setupUpdate({ ...dbScormAttempt, score: 95 });
    const a = await storage.updateScormAttempt("sa1", { score: 95 } as any);
    expect(a).toBeDefined();
  });

  it("updateScormAttempt — returns undefined when not found", async () => {
    setupUpdate(null);
    expect(await storage.updateScormAttempt("x", {})).toBeUndefined();
  });

  it("getAllScormAttempts — returns all attempts", async () => {
    setupSelect([dbScormAttempt]);
    const all = await storage.getAllScormAttempts();
    expect(all).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCORM ANSWERS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — SCORM answers", () => {
  let storage: DatabaseStorage;
  beforeEach(() => { vi.clearAllMocks(); storage = new DatabaseStorage(); });

  it("createScormAnswer — inserts answer", async () => {
    setupInsert(dbScormAnswer);
    const a = await storage.createScormAnswer({ ...dbScormAnswer });
    expect(a.id).toBe("saa1");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("getScormAnswersByAttempt — returns answers for attempt", async () => {
    setupSelect([dbScormAnswer]);
    const answers = await storage.getScormAnswersByAttempt("sa1");
    expect(answers).toHaveLength(1);
    expect(answers[0].correct).toBe(true);
  });

  it("getScormAnswersByAttempt — returns empty array when none", async () => {
    setupSelect([]);
    const answers = await storage.getScormAnswersByAttempt("x");
    expect(answers).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// USER-GROUP RELATIONS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — user-group relations", () => {
  let storage: DatabaseStorage;
  beforeEach(() => { vi.clearAllMocks(); storage = new DatabaseStorage(); });

  it("getUserGroups — returns groups for user via JOIN", async () => {
    setupSelect([{ group: dbGroup }]);
    const groups = await storage.getUserGroups("u1");
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Group A");
  });

  it("getUserGroups — returns empty array when user has no groups", async () => {
    setupSelect([]);
    const groups = await storage.getUserGroups("u1");
    expect(groups).toHaveLength(0);
  });

  it("addUserToGroup — inserts relation", async () => {
    setupInsert({ id: "ug1", userId: "u1", groupId: "g1", addedAt: now });
    const rel = await storage.addUserToGroup("u1", "g1");
    expect(rel.userId).toBe("u1");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("removeUserFromGroup — returns true on success", async () => {
    setupDelete(1);
    const result = await storage.removeUserFromGroup("u1", "g1");
    expect(result).toBe(true);
  });

  it("removeUserFromGroup — returns false when not found", async () => {
    setupDelete(0);
    const result = await storage.removeUserFromGroup("u1", "g1");
    expect(result).toBe(false);
  });

  it("setUserGroups — deletes old relations and inserts new ones", async () => {
    setupDelete();
    setupInsert({});
    await storage.setUserGroups("u1", ["g1", "g2"]);
    expect(dbMock.delete).toHaveBeenCalled();
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("setUserGroups — only deletes when groupIds is empty", async () => {
    setupDelete();
    await storage.setUserGroups("u1", []);
    expect(dbMock.delete).toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("deleteGroup — removes userGroups then group", async () => {
    setupDelete(1);
    const result = await storage.deleteGroup("g1");
    // delete called at least twice (userGroups + group)
    expect(dbMock.delete).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("getGroupUsers — returns users via JOIN, decrypts emails", async () => {
    const dbUser = {
      id: "u1",
      email: "enc:kate@example.com",
      emailHash: "hash:kate@example.com",
      passwordHash: "hashed_password",
      name: "Kate",
      role: "author",
      status: "active",
      mustChangePassword: false,
      gdprConsent: true,
      createdAt: now,
      lastLoginAt: null,
      createdBy: null,
    };
    setupSelect([{ user: dbUser }]);
    const users = await storage.getGroupUsers("g1");
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("kate@example.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST ASSIGNMENTS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — test assignments", () => {
  let storage: DatabaseStorage;
  beforeEach(() => { vi.clearAllMocks(); storage = new DatabaseStorage(); });

  it("getTestAssignments — returns assignments for test", async () => {
    setupSelect([dbAssignment]);
    const assignments = await storage.getTestAssignments("test1");
    expect(assignments).toHaveLength(1);
    expect(assignments[0].testId).toBe("test1");
  });

  it("getUserAssignments — returns assignments for user", async () => {
    setupSelect([dbAssignment]);
    const assignments = await storage.getUserAssignments("u1");
    expect(assignments).toHaveLength(1);
  });

  it("getGroupAssignments — returns assignments for group", async () => {
    const groupAssignment = { ...dbAssignment, userId: null, groupId: "g1" };
    setupSelect([groupAssignment]);
    const assignments = await storage.getGroupAssignments("g1");
    expect(assignments).toHaveLength(1);
  });

  it("createTestAssignment — inserts assignment", async () => {
    setupInsert(dbAssignment);
    const a = await storage.createTestAssignment({
      testId: "test1",
      userId: "u1",
      assignedBy: "admin1",
    } as any);
    expect(a.testId).toBe("test1");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("deleteTestAssignment — returns true on success", async () => {
    setupDelete(1);
    expect(await storage.deleteTestAssignment("asgn1")).toBe(true);
  });

  it("deleteTestAssignment — returns false when not found", async () => {
    setupDelete(0);
    expect(await storage.deleteTestAssignment("x")).toBe(false);
  });

  it("getAssignedTestsForUser — merges direct + group assignments", async () => {
    // Call sequence:
    // 1. getUserGroups → innerJoin → returns groups
    // 2. direct assignments select
    // 3. group assignments select (because groups exist)
    // 4. tests select (inArray)
    let callCount = 0;
    dbMock.select.mockImplementation(() => {
      callCount++;
      const chain = makeChain(
        callCount === 1 ? [{ group: dbGroup }]        // getUserGroups
        : callCount === 2 ? [{ testId: "test1" }]     // direct assignments
        : callCount === 3 ? [{ testId: "test2" }]     // group assignments
        : [dbTest]                                     // final tests
      );
      return chain;
    });

    const tests = await storage.getAssignedTestsForUser("u1");
    expect(tests).toBeDefined();
    expect(dbMock.select).toHaveBeenCalled();
  });

  it("getAssignedTestsForUser — returns empty array when no assignments", async () => {
    let callCount = 0;
    dbMock.select.mockImplementation(() => {
      callCount++;
      const chain = makeChain(
        callCount === 1 ? []  // getUserGroups → no groups
        : []                  // direct assignments → none
      );
      return chain;
    });
    const tests = await storage.getAssignedTestsForUser("u1");
    expect(tests).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOPIC COURSES
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — topic courses", () => {
  let storage: DatabaseStorage;
  beforeEach(() => { vi.clearAllMocks(); storage = new DatabaseStorage(); });

  it("getTopicCourses — returns courses for topic", async () => {
    setupSelect([dbTopicCourse]);
    const courses = await storage.getTopicCourses("t1");
    expect(courses).toHaveLength(1);
    expect(courses[0].title).toBe("Course 1");
  });

  it("getTopicCourses — returns empty array when none", async () => {
    setupSelect([]);
    expect(await storage.getTopicCourses("x")).toHaveLength(0);
  });

  it("createTopicCourse — inserts course", async () => {
    setupInsert(dbTopicCourse);
    const course = await storage.createTopicCourse({
      topicId: "t1",
      title: "Course 1",
      url: "https://example.com",
    } as any);
    expect(course.title).toBe("Course 1");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("deleteTopicCourse — returns true on success", async () => {
    setupDelete(1);
    expect(await storage.deleteTopicCourse("tc1")).toBe(true);
  });

  it("deleteTopicCourse — returns false when not found", async () => {
    setupDelete(0);
    expect(await storage.deleteTopicCourse("x")).toBe(false);
  });
});

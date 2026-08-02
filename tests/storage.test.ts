/**
 * Tests for DatabaseStorage (server/storage.ts)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks so they're available before imports ─────────────────────────
const { dbMock, dummyVerifySpy } = vi.hoisted(() => {
  const dbMock: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  // Multi-step methods run inside db.transaction; pass the mock itself as the tx
  // so tx.delete/insert/update reuse the same chain stubs (individual tests may
  // still override transaction with a bespoke tx).
  dbMock.transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(dbMock));
  return { dbMock, dummyVerifySpy: vi.fn(async () => {}) };
});

vi.mock("../server/db", () => ({ db: dbMock }));

vi.mock("../server/utils/crypto", () => ({
  encryptEmail: (e: string) => `enc:${e}`,
  decryptEmail: (e: string) => e.replace("enc:", ""),
  hashEmail: (e: string) => `hash:${e}`,
  // Password hashing goes through the crypto seam (storage no longer touches the
  // primitive directly); a scrypt-shaped stand-in output keeps assertions simple.
  hashPassword: async (_pwd: string) => "hashed_password",
  verifyPassword: async (plain: string, _stored: string) => plain === "correct",
  dummyVerifyPassword: dummyVerifySpy,
  isLegacyBcryptHash: (stored: string) => /^\$2[aby]\$/.test(stored),
}));

// Chainable mock — supports both await chain (thenable) and await chain.returning()
const makeChain = (returnValue: any) => {
  const chain: any = {};
  // make the chain itself awaitable (for patterns like: return db.select().from().where())
  chain.then = (resolve: any) => resolve(returnValue);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(returnValue);
  chain.orderBy = vi.fn().mockReturnValue(chain); // orderBy also needs to be awaitable
  return chain;
};


// ─── import after mocks ───────────────────────────────────────────────────────
import { DatabaseStorage } from "../server/storage";
import { getCounter } from "../server/metrics";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const now = new Date("2024-01-01T00:00:00Z");

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

const plainUser = { ...dbUser, email: "kate@example.com" };

const dbTopic = {
  id: "t1",
  name: "JavaScript",
  description: "JS basics",
  folderId: null,
  createdAt: now,
};

const dbQuestion = {
  id: "q1",
  topicId: "t1",
  type: "single",
  prompt: "What is JS?",
  dataJson: { options: ["A", "B"] },
  correctJson: { correctIndex: 0 },
  points: 1,
  difficulty: 50,
  shuffleAnswers: true,
  feedbackMode: "general",
  feedback: null,
  feedbackCorrect: null,
  feedbackIncorrect: null,
  mediaUrl: null,
  mediaType: null,
  createdAt: now,
};

const dbTest = {
  id: "test1",
  title: "Test 1",
  description: null,
  feedback: null,
  webhookUrl: null,
  overallPassRuleJson: { type: "percent", value: 80 },
  mode: "standard",
  showDifficultyLevel: true,
  showCorrectAnswers: false,
  timeLimitMinutes: null,
  maxAttempts: null,
  startPageContent: null,
  createdAt: now,
};

const dbGroup = {
  id: "g1",
  name: "Group A",
  description: null,
  createdAt: now,
  createdBy: null,
};

const dbFolder = {
  id: "f1",
  name: "Folder 1",
  parentId: null,
};

const dbAttempt = {
  id: "a1",
  userId: "u1",
  testId: "test1",
  status: "completed",
  score: 85,
  passed: true,
  startedAt: now,
  completedAt: now,
  answersJson: {},
  variantJson: {},
  timeTakenSeconds: 120,
};

// ─── Helper to reset mocks ────────────────────────────────────────────────────
function setupSelectReturning(rows: any[]) {
  const chain = makeChain(rows);
  dbMock.select.mockReturnValue(chain);
  return chain;
}

function setupInsertReturning(row: any) {
  const chain = makeChain([row]);
  dbMock.insert.mockReturnValue(chain);
  return chain;
}

function setupUpdateReturning(row: any) {
  const chain = makeChain(row ? [row] : []);
  dbMock.update.mockReturnValue(chain);
  return chain;
}

function setupDeleteReturning(rowCount: number) {
  // Some deletes use .returning() to check length, others use .rowCount from resolved value.
  // Build a full chain that supports both patterns, and mock delete to always return it.
  const rows = rowCount > 0 ? [{}] : [];
  const deleteChain: any = {};
  deleteChain.then = (resolve: any) => resolve({ rowCount });
  deleteChain.where = vi.fn().mockReturnValue(deleteChain);
  deleteChain.returning = vi.fn().mockResolvedValue(rows);
  dbMock.delete.mockReturnValue(deleteChain);
  return deleteChain;
}

// ─────────────────────────────────────────────────────────────────────────────
// USER TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — users", () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  it("getUser — returns user with decrypted email", async () => {
    setupSelectReturning([dbUser]);
    const user = await storage.getUser("u1");
    expect(user).toBeDefined();
    expect(user!.email).toBe("kate@example.com");
    expect(dbMock.select).toHaveBeenCalled();
  });

  it("getUser — returns undefined when not found", async () => {
    setupSelectReturning([]);
    const user = await storage.getUser("missing");
    expect(user).toBeUndefined();
  });

  it("getUserByEmail — looks up by emailHash", async () => {
    setupSelectReturning([dbUser]);
    const user = await storage.getUserByEmail("kate@example.com");
    expect(user).toBeDefined();
    expect(user!.email).toBe("kate@example.com");
  });

  it("getUserByEmail — returns undefined when not found", async () => {
    setupSelectReturning([]);
    const user = await storage.getUserByEmail("nobody@example.com");
    expect(user).toBeUndefined();
  });

  it("createUser — hashes password and encrypts email", async () => {
    setupInsertReturning(dbUser);
    const user = await storage.createUser({
      email: "kate@example.com",
      passwordHash: "plain_password",
      name: "Kate",
      role: "author",
      status: "active",
      mustChangePassword: false,
    });
    expect(user.email).toBe("kate@example.com"); // decrypted on return
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("validatePassword — returns user on correct password", async () => {
    // getUserByEmail will be called internally
    setupSelectReturning([dbUser]);
    const user = await storage.validatePassword("kate@example.com", "correct");
    expect(user).not.toBeNull();
    expect(user!.email).toBe("kate@example.com");
  });

  it("validatePassword — returns null on wrong password", async () => {
    setupSelectReturning([dbUser]);
    const user = await storage.validatePassword("kate@example.com", "wrong");
    expect(user).toBeNull();
  });

  it("validatePassword — returns null when user not found", async () => {
    setupSelectReturning([]);
    const user = await storage.validatePassword("nobody@test.com", "any");
    expect(user).toBeNull();
    // A dummy verify still runs, so response time does not leak account existence.
    expect(dummyVerifySpy).toHaveBeenCalled();
  });

  it("validatePassword — lazily rehashes a legacy bcrypt hash to scrypt on success", async () => {
    // PRD-9 Этап 2: a user still on a bcrypt hash logs in, and the hash is migrated
    // in place, the metric ticks up, and the returned user carries the new hash.
    const legacyUser = { ...dbUser, passwordHash: "$2a$10$legacyhashvalue" };
    setupSelectReturning([legacyUser]);
    setupUpdateReturning(legacyUser);

    const before = getCounter("auth.legacy_bcrypt_rehash");
    const user = await storage.validatePassword("kate@example.com", "correct");

    expect(user).not.toBeNull();
    expect(dbMock.update).toHaveBeenCalled();            // hash migrated in place
    expect(user!.passwordHash).toBe("hashed_password");  // scrypt stand-in from the mock
    expect(getCounter("auth.legacy_bcrypt_rehash")).toBe(before + 1);
  });

  it("validatePassword — does NOT rehash a current scrypt hash", async () => {
    setupSelectReturning([dbUser]); // passwordHash "hashed_password" (not bcrypt)
    const before = getCounter("auth.legacy_bcrypt_rehash");
    const user = await storage.validatePassword("kate@example.com", "correct");
    expect(user).not.toBeNull();
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(getCounter("auth.legacy_bcrypt_rehash")).toBe(before);
  });

  it("getUsers — decrypts all emails", async () => {
    const chain = makeChain([dbUser, { ...dbUser, id: "u2", email: "enc:bob@example.com" }]);
    dbMock.select.mockReturnValue(chain);
    const users = await storage.getUsers();
    expect(users).toHaveLength(2);
    expect(users[0].email).toBe("kate@example.com");
    expect(users[1].email).toBe("bob@example.com");
  });

  it("updateUser — encrypts email when provided", async () => {
    setupUpdateReturning({ ...dbUser, name: "Kate Updated" });
    const user = await storage.updateUser("u1", { email: "new@example.com", name: "Kate Updated" });
    expect(user).toBeDefined();
    expect(dbMock.update).toHaveBeenCalled();
  });

  it("deactivateUser — sets status to inactive", async () => {
    setupUpdateReturning({ ...dbUser, status: "inactive" });
    const user = await storage.deactivateUser("u1");
    expect(user).toBeDefined();
    expect(dbMock.update).toHaveBeenCalled();
  });

  it("activateUser — sets status to active", async () => {
    setupUpdateReturning({ ...dbUser, status: "active" });
    const user = await storage.activateUser("u1");
    expect(user).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOLDER TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — folders", () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  it("getFolders — returns array", async () => {
    setupSelectReturning([dbFolder]);
    const folders = await storage.getFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("Folder 1");
  });

  it("getFolder — returns folder by id", async () => {
    setupSelectReturning([dbFolder]);
    const folder = await storage.getFolder("f1");
    expect(folder).toBeDefined();
    expect(folder!.id).toBe("f1");
  });

  it("getFolder — returns undefined when not found", async () => {
    setupSelectReturning([]);
    const folder = await storage.getFolder("missing");
    expect(folder).toBeUndefined();
  });

  it("createFolder — inserts and returns folder", async () => {
    setupInsertReturning(dbFolder);
    const folder = await storage.createFolder({ name: "Folder 1", parentId: null });
    expect(folder.name).toBe("Folder 1");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("updateFolder — returns updated folder", async () => {
    setupUpdateReturning({ ...dbFolder, name: "Renamed" });
    const folder = await storage.updateFolder("f1", { name: "Renamed" });
    expect(folder).toBeDefined();
    expect(dbMock.update).toHaveBeenCalled();
  });

  it("updateFolder — returns undefined when not found", async () => {
    setupUpdateReturning(null);
    const folder = await storage.updateFolder("missing", { name: "X" });
    expect(folder).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOPIC TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — topics", () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  it("getTopics — returns all topics", async () => {
    setupSelectReturning([dbTopic]);
    const topics = await storage.getTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0].name).toBe("JavaScript");
  });

  it("getTopic — returns topic by id", async () => {
    setupSelectReturning([dbTopic]);
    const topic = await storage.getTopic("t1");
    expect(topic).toBeDefined();
    expect(topic!.id).toBe("t1");
  });

  it("getTopic — returns undefined when not found", async () => {
    setupSelectReturning([]);
    expect(await storage.getTopic("x")).toBeUndefined();
  });

  it("createTopic — inserts topic", async () => {
    setupInsertReturning(dbTopic);
    const topic = await storage.createTopic({ name: "JavaScript", description: "JS basics" });
    expect(topic.name).toBe("JavaScript");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("updateTopic — returns updated topic", async () => {
    setupUpdateReturning({ ...dbTopic, name: "TypeScript" });
    const topic = await storage.updateTopic("t1", { name: "TypeScript" });
    expect(topic).toBeDefined();
  });

  it("updateTopic — returns undefined when not found", async () => {
    setupUpdateReturning(null);
    expect(await storage.updateTopic("x", { name: "X" })).toBeUndefined();
  });

  it("deleteTopic — reports deleted:true on success", async () => {
    setupDeleteReturning(1);
    const result = await storage.deleteTopic("t1");
    expect(result.deleted).toBe(true);
  });

  it("deleteTopic — reports deleted:false when not found", async () => {
    setupDeleteReturning(0);
    const result = await storage.deleteTopic("missing");
    expect(result.deleted).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — questions", () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  it("getQuestions — returns all questions", async () => {
    setupSelectReturning([dbQuestion]);
    const qs = await storage.getQuestions();
    expect(qs).toHaveLength(1);
    expect(qs[0].type).toBe("single");
  });

  it("getQuestionsByTopic — filters by topicId", async () => {
    setupSelectReturning([dbQuestion]);
    const qs = await storage.getQuestionsByTopic("t1");
    expect(qs).toHaveLength(1);
    expect(dbMock.select).toHaveBeenCalled();
  });

  it("getQuestion — returns question by id", async () => {
    setupSelectReturning([dbQuestion]);
    const q = await storage.getQuestion("q1");
    expect(q).toBeDefined();
    expect(q!.id).toBe("q1");
  });

  it("getQuestion — returns undefined when not found", async () => {
    setupSelectReturning([]);
    expect(await storage.getQuestion("x")).toBeUndefined();
  });

  it("createQuestion — inserts question", async () => {
    setupInsertReturning(dbQuestion);
    const q = await storage.createQuestion({
      topicId: "t1",
      type: "single",
      prompt: "What is JS?",
      dataJson: { options: ["A", "B"] },
      correctJson: { correctIndex: 0 },
    } as any);
    expect(q.prompt).toBe("What is JS?");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("updateQuestion — returns updated question", async () => {
    // PRD-25 FR-20: updateQuestion reads the question's CURRENT topic first (the
    // topic a question leaves must be touched too), so the select is stubbed as
    // well as the update.
    setupSelectReturning([{ topicId: dbQuestion.topicId }]);
    setupUpdateReturning({ ...dbQuestion, prompt: "Updated?" });
    const q = await storage.updateQuestion("q1", { prompt: "Updated?" } as any);
    expect(q).toBeDefined();
  });

  it("deleteQuestion — returns true", async () => {
    setupDeleteReturning(1);
    expect(await storage.deleteQuestion("q1")).toBe(true);
  });

  it("deleteQuestion — returns false when not found", async () => {
    setupDeleteReturning(0);
    expect(await storage.deleteQuestion("x")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — tests", () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  it("getTests — returns all tests", async () => {
    setupSelectReturning([dbTest]);
    const ts = await storage.getTests();
    expect(ts).toHaveLength(1);
    expect(ts[0].title).toBe("Test 1");
  });

  it("getTest — returns test by id", async () => {
    setupSelectReturning([dbTest]);
    const t = await storage.getTest("test1");
    expect(t).toBeDefined();
    expect(t!.id).toBe("test1");
  });

  it("getTest — returns undefined when not found", async () => {
    setupSelectReturning([]);
    expect(await storage.getTest("x")).toBeUndefined();
  });

  it("deleteTest — returns true", async () => {
    setupDeleteReturning(1);
    expect(await storage.deleteTest("test1")).toBe(true);
  });

  it("deleteTest — returns false when not found", async () => {
    setupDeleteReturning(0);
    expect(await storage.deleteTest("x")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — groups", () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  it("getGroups — returns all groups", async () => {
    const chain = makeChain([dbGroup]);
    dbMock.select.mockReturnValue(chain);
    const groups = await storage.getGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Group A");
  });

  it("getGroup — returns group by id", async () => {
    setupSelectReturning([dbGroup]);
    const g = await storage.getGroup("g1");
    expect(g).toBeDefined();
    expect(g!.id).toBe("g1");
  });

  it("getGroup — returns undefined when not found", async () => {
    setupSelectReturning([]);
    expect(await storage.getGroup("x")).toBeUndefined();
  });

  it("createGroup — inserts group", async () => {
    setupInsertReturning(dbGroup);
    const g = await storage.createGroup({ name: "Group A" } as any);
    expect(g.name).toBe("Group A");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("updateGroup — returns updated group", async () => {
    setupUpdateReturning({ ...dbGroup, name: "Group B" });
    const g = await storage.updateGroup("g1", { name: "Group B" });
    expect(g).toBeDefined();
  });

  it("updateGroup — returns undefined when not found", async () => {
    setupUpdateReturning(null);
    expect(await storage.updateGroup("x", { name: "X" })).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATTEMPT TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — attempts", () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  it("getAttempt — returns attempt by id", async () => {
    setupSelectReturning([dbAttempt]);
    const a = await storage.getAttempt("a1");
    expect(a).toBeDefined();
    expect(a!.id).toBe("a1");
  });

  it("getAttempt — returns undefined when not found", async () => {
    setupSelectReturning([]);
    expect(await storage.getAttempt("x")).toBeUndefined();
  });

  it("createAttempt — inserts attempt", async () => {
    setupInsertReturning(dbAttempt);
    const a = await storage.createAttempt({
      userId: "u1",
      testId: "test1",
      status: "in_progress",
      score: 0,
      passed: false,
      startedAt: now,
      answersJson: {},
      variantJson: {},
    } as any);
    expect(a.userId).toBe("u1");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("updateAttempt — returns updated attempt", async () => {
    setupUpdateReturning({ ...dbAttempt, finishedAt: now });
    const a = await storage.updateAttempt("a1", { finishedAt: now });
    expect(a).toBeDefined();
  });

  it("getAttemptsByUser — returns user attempts", async () => {
    setupSelectReturning([dbAttempt]);
    const attempts = await storage.getAttemptsByUser("u1");
    expect(attempts).toHaveLength(1);
  });

  it("getAttemptsByUserAndTest — filters by user and test", async () => {
    setupSelectReturning([dbAttempt]);
    const attempts = await storage.getAttemptsByUserAndTest("u1", "test1");
    expect(attempts).toHaveLength(1);
  });

  it("getAllAttempts — returns all attempts", async () => {
    setupSelectReturning([dbAttempt]);
    const all = await storage.getAllAttempts();
    expect(all).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD RESET TOKEN TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — password reset tokens", () => {
  let storage: DatabaseStorage;
  const dbToken = {
    id: "tok1",
    userId: "u1",
    tokenHash: "abc123",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    usedAt: null,
    requestIp: "127.0.0.1",
    createdAt: now,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  it("createPasswordResetToken — inserts token", async () => {
    setupInsertReturning(dbToken);
    const token = await storage.createPasswordResetToken("u1", "abc123", "127.0.0.1");
    expect(token.tokenHash).toBe("abc123");
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("getPasswordResetToken — returns token by hash", async () => {
    setupSelectReturning([dbToken]);
    const token = await storage.getPasswordResetToken("abc123");
    expect(token).toBeDefined();
    expect(token!.userId).toBe("u1");
  });

  it("getPasswordResetToken — returns undefined when not found", async () => {
    setupSelectReturning([]);
    expect(await storage.getPasswordResetToken("wrong")).toBeUndefined();
  });

  it("markTokenAsUsed — calls update", async () => {
    setupUpdateReturning(dbToken);
    await storage.markTokenAsUsed("tok1");
    expect(dbMock.update).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRD-15 block D — test_question_scoring DAL (FR-30)
// ─────────────────────────────────────────────────────────────────────────────
describe("DatabaseStorage — test question scoring overrides", () => {
  let storage: DatabaseStorage;

  const dbOverride = {
    id: "ov1",
    testId: "test1",
    questionId: "q1",
    points: 5,
    scoringJson: null,
    difficulty: null,
    pinnedContentHash: "h1",
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  it("getTestQuestionScoring — selects the test's override rows", async () => {
    setupSelectReturning([dbOverride]);
    const rows = await storage.getTestQuestionScoring("test1");
    expect(rows).toEqual([dbOverride]);
    expect(dbMock.select).toHaveBeenCalled();
  });

  it("upsertTestQuestionScoring — inserts with conflict-update on (test, question)", async () => {
    const chain = makeChain([dbOverride]);
    chain.onConflictDoUpdate = vi.fn().mockReturnValue(chain);
    dbMock.insert.mockReturnValue(chain);

    const row = await storage.upsertTestQuestionScoring("test1", "q1", { points: 5, pinnedContentHash: "h1" });
    expect(row).toEqual(dbOverride);
    // Unset value columns are explicitly cleared (the row is replaced as a unit).
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ testId: "test1", questionId: "q1", points: 5, scoringJson: null, difficulty: null }),
    );
    expect(chain.onConflictDoUpdate).toHaveBeenCalled();
  });

  it("deleteTestQuestionScoring — true when a row was removed, false otherwise", async () => {
    setupDeleteReturning(1);
    expect(await storage.deleteTestQuestionScoring("test1", "q1")).toBe(true);
    setupDeleteReturning(0);
    expect(await storage.deleteTestQuestionScoring("test1", "q1")).toBe(false);
  });

  it("replaceTestQuestionScoring — delete-then-insert in a transaction", async () => {
    const deleteChain: any = {};
    deleteChain.where = vi.fn().mockResolvedValue(undefined);
    const insertChain = makeChain([dbOverride]);
    const tx = {
      delete: vi.fn().mockReturnValue(deleteChain),
      insert: vi.fn().mockReturnValue(insertChain),
    };
    (dbMock as any).transaction = vi.fn(async (cb: any) => cb(tx));

    const rows = await storage.replaceTestQuestionScoring("test1", [
      { questionId: "q1", points: 5, pinnedContentHash: "h1" },
    ]);
    expect(rows).toEqual([dbOverride]);
    expect(tx.delete).toHaveBeenCalled();
    expect(insertChain.values).toHaveBeenCalledWith([
      expect.objectContaining({ testId: "test1", questionId: "q1", points: 5 }),
    ]);
  });

  it("replaceTestQuestionScoring — an empty set clears all overrides", async () => {
    const deleteChain: any = {};
    deleteChain.where = vi.fn().mockResolvedValue(undefined);
    const tx = { delete: vi.fn().mockReturnValue(deleteChain), insert: vi.fn() };
    (dbMock as any).transaction = vi.fn(async (cb: any) => cb(tx));

    const rows = await storage.replaceTestQuestionScoring("test1", []);
    expect(rows).toEqual([]);
    expect(tx.delete).toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});

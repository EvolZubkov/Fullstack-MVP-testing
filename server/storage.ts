import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { eq, inArray, and, sql, desc, isNull } from "drizzle-orm";
import { db } from "./db";
import { encryptEmail, decryptEmail, hashEmail } from "./utils/crypto";
import {
  users, topics, topicCourses, topicEvents, questions, tests, testSections, attempts, folders, testFolders,
  adaptiveTopicSettings, adaptiveLevels, adaptiveLevelLinks, scormPackages, scormAttempts, scormAnswers,
  groups, userGroups, testAssignments, passwordResetTokens, assignmentAccessTokens,
  contentPages,
  type User, type InsertUser,
  type Folder, type InsertFolder,
  type TestFolder, type InsertTestFolder,
  type Topic, type InsertTopic,
  type TopicCourse, type InsertTopicCourse,
  type TopicEvent, type InsertTopicEvent,
  type Question, type InsertQuestion,
  type Test, type InsertTest,
  type TestSection, type InsertTestSection,
  type Attempt, type InsertAttempt,
  type AdaptiveTopicSettings, type InsertAdaptiveTopicSettings,
  type AdaptiveLevel, type InsertAdaptiveLevel,
  type AdaptiveLevelLink, type InsertAdaptiveLevelLink,
  type ScormPackage, type InsertScormPackage,
  type ScormAttempt, type InsertScormAttempt,
  type ScormAnswer, type InsertScormAnswer,
  type Group, type InsertGroup,
  type UserGroup, type InsertUserGroup,
  type TestAssignment, type InsertTestAssignment,
  type PasswordResetToken, type InsertPasswordResetToken,
  type AssignmentAccessToken, type InsertAssignmentAccessToken,
  type ContentPage, type InsertContentPage,
} from "@shared/schema";

/**
 * Normalizes a test row from the DB for backward compatibility (PRD-7 §1.11).
 * - If `status` is falsy (pre-migration row), derives it from `published`.
 * - Ensures `published` is always in sync with `status` when reading.
 */
function mapLegacyTest(row: Test): Test {
  const status = row.status || (row.published ? "published" : "draft");
  const published = status === "published";
  if (status === row.status && published === row.published) return row;
  return { ...row, status: status as Test["status"], published };
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  validatePassword(email: string, password: string): Promise<User | null>;
  updateUserLastLogin(id: string): Promise<void>;
  getUsers(): Promise<User[]>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  updateUserPassword(id: string, newPasswordHash: string): Promise<void>;
  deactivateUser(id: string): Promise<User | undefined>;
  activateUser(id: string): Promise<User | undefined>;

  // Groups
  getGroups(): Promise<Group[]>;
  getGroup(id: string): Promise<Group | undefined>;
  createGroup(group: InsertGroup & { createdBy?: string }): Promise<Group>;
  updateGroup(id: string, data: Partial<Group>): Promise<Group | undefined>;
  deleteGroup(id: string): Promise<boolean>;

  // User-Group relations
  getUserGroups(userId: string): Promise<Group[]>;
  getGroupUsers(groupId: string): Promise<User[]>;
  addUserToGroup(userId: string, groupId: string): Promise<UserGroup>;
  removeUserFromGroup(userId: string, groupId: string): Promise<boolean>;
  setUserGroups(userId: string, groupIds: string[]): Promise<void>;

  // Test Assignments
  getAssignment(id: string): Promise<TestAssignment | undefined>;
  getTestAssignments(testId: string): Promise<TestAssignment[]>;
  getUserAssignments(userId: string): Promise<TestAssignment[]>;
  getGroupAssignments(groupId: string): Promise<TestAssignment[]>;
  createTestAssignment(assignment: InsertTestAssignment & { assignedBy: string }): Promise<TestAssignment>;
  deleteTestAssignment(id: string): Promise<boolean>;
  getAssignedTestsForUser(userId: string): Promise<Test[]>;

  // Password Reset Tokens
  createPasswordResetToken(userId: string, tokenHash: string, requestIp: string, ttlMs?: number): Promise<PasswordResetToken>;
  getPasswordResetToken(tokenHash: string): Promise<PasswordResetToken | undefined>;
  markTokenAsUsed(id: string): Promise<void>;
  getRecentTokensCount(userId: string, hours: number): Promise<number>;

  // Assignment Access Tokens (magic links)
  createAssignmentAccessToken(data: { assignmentId: string; userId: string; testId: string; tokenHash: string; expiresAt: Date }): Promise<AssignmentAccessToken>;
  getAssignmentAccessToken(tokenHash: string): Promise<AssignmentAccessToken | undefined>;
  getAssignmentAccessTokensByAssignment(assignmentId: string): Promise<AssignmentAccessToken[]>;
  revokeAssignmentAccessToken(id: string): Promise<void>;
  revokeAssignmentAccessTokensByAssignment(assignmentId: string): Promise<void>;
  revokeAssignmentAccessTokensByAssignmentAndUser(assignmentId: string, userId: string): Promise<void>;

  getFolders(): Promise<Folder[]>;
  getFolder(id: string): Promise<Folder | undefined>;
  createFolder(folder: InsertFolder): Promise<Folder>;
  updateFolder(id: string, folder: Partial<InsertFolder>): Promise<Folder | undefined>;
  deleteFolder(id: string): Promise<boolean>;

  getTestFolders(): Promise<TestFolder[]>;
  createTestFolder(folder: InsertTestFolder): Promise<TestFolder>;
  updateTestFolder(id: string, updates: Partial<InsertTestFolder>): Promise<TestFolder | undefined>;
  /**
   * Удаляет папку, предварительно переместив все тесты и вложенные папки
   * в указанное место (`moveTo`, по умолчанию `null` = корень). Это вариант
   * "Только папку" из эскиза prd7-tests-list.html (s-folder-delete-a).
   */
  deleteTestFolder(id: string, moveTo?: string | null): Promise<boolean>;
  /**
   * Удаляет папку вместе со всеми тестами внутри неё (включая транзитивно
   * через вложенные папки) и сами вложенные папки. Используется для варианта
   * "Папку и все тесты" (s-folder-delete-b), требующего ввода точного имени
   * для подтверждения на уровне route handler.
   */
  deleteTestFolderCascade(id: string): Promise<boolean>;
  moveTestToFolder(testId: string, folderId: string | null): Promise<boolean>;

  getTopics(): Promise<Topic[]>;
  getTopic(id: string): Promise<Topic | undefined>;
  createTopic(topic: InsertTopic): Promise<Topic>;
  updateTopic(id: string, topic: Partial<InsertTopic>): Promise<Topic | undefined>;
  deleteTopic(id: string): Promise<boolean>;
  deleteTopicsBulk(ids: string[]): Promise<number>;

  getTopicCourses(topicId: string): Promise<TopicCourse[]>;
  createTopicCourse(course: InsertTopicCourse): Promise<TopicCourse>;
  deleteTopicCourse(id: string): Promise<boolean>;

  getTopicEvents(topicId: string): Promise<TopicEvent[]>;
  createTopicEvent(event: InsertTopicEvent): Promise<TopicEvent>;
  deleteTopicEvent(id: string): Promise<boolean>;

  getQuestions(): Promise<Question[]>;
  getQuestionsByTopic(topicId: string): Promise<Question[]>;
  getContentHashesByTopic(topicId: string): Promise<Set<string>>;
  getQuestion(id: string): Promise<Question | undefined>;
  getQuestionsByIds(ids: string[]): Promise<Question[]>;
  createQuestion(question: InsertQuestion): Promise<Question>;
  updateQuestion(id: string, question: Partial<InsertQuestion>): Promise<Question | undefined>;
  deleteQuestion(id: string): Promise<boolean>;
  deleteQuestionsBulk(ids: string[]): Promise<number>;

  getTests(): Promise<Test[]>;
  getTest(id: string): Promise<Test | undefined>;
  getMigrationHealth(): Promise<{ legacyStartPageCount: number }>;
  createTest(test: InsertTest, sections: Omit<InsertTestSection, "testId">[]): Promise<Test>;
  updateTest(id: string, test: Partial<InsertTest>, sections?: Omit<InsertTestSection, "testId">[]): Promise<Test | undefined>;
  /** Updates only the status field without bumping the version counter (PRD-7 §9). */
  patchTestStatus(id: string, status: "draft" | "published" | "archived"): Promise<{ id: string; status: string; version: number } | undefined>;
  deleteTest(id: string): Promise<boolean>;
  getTestSections(testId: string): Promise<TestSection[]>;

  createAttempt(attempt: InsertAttempt): Promise<Attempt>;
  getAttempt(id: string): Promise<Attempt | undefined>;
  updateAttempt(id: string, updates: Partial<Attempt>): Promise<Attempt | undefined>;
  getAttemptsByUser(userId: string): Promise<Attempt[]>;
  getAttemptsByUserAndTest(userId: string, testId: string): Promise<Attempt[]>;
  deleteAttemptsByUserAndTest(userId: string, testId: string): Promise<void>;
  getAllAttempts(): Promise<Attempt[]>;

  // Adaptive testing
  getAdaptiveTopicSettings(testId: string, topicId: string): Promise<AdaptiveTopicSettings | undefined>;
  getAdaptiveTopicSettingsByTest(testId: string): Promise<AdaptiveTopicSettings[]>;
  createAdaptiveTopicSettings(settings: InsertAdaptiveTopicSettings): Promise<AdaptiveTopicSettings>;
  updateAdaptiveTopicSettings(id: string, settings: Partial<InsertAdaptiveTopicSettings>): Promise<AdaptiveTopicSettings | undefined>;
  deleteAdaptiveTopicSettingsByTest(testId: string): Promise<void>;

  getAdaptiveLevels(testId: string, topicId: string): Promise<AdaptiveLevel[]>;
  getAdaptiveLevelsByTest(testId: string): Promise<AdaptiveLevel[]>;
  createAdaptiveLevel(level: InsertAdaptiveLevel): Promise<AdaptiveLevel>;
  updateAdaptiveLevel(id: string, level: Partial<InsertAdaptiveLevel>): Promise<AdaptiveLevel | undefined>;
  deleteAdaptiveLevelsByTest(testId: string): Promise<void>;

  getAdaptiveLevelLinks(levelId: string): Promise<AdaptiveLevelLink[]>;
  createAdaptiveLevelLink(link: InsertAdaptiveLevelLink): Promise<AdaptiveLevelLink>;
  deleteAdaptiveLevelLinksByLevel(levelId: string): Promise<void>;
  deleteAdaptiveLevelLinksByTest(testId: string): Promise<void>;

  createScormPackage(pkg: InsertScormPackage & { id: string }): Promise<ScormPackage>;
  getScormPackage(id: string): Promise<ScormPackage | undefined>;
  getScormPackagesByTest(testId: string): Promise<ScormPackage[]>;
  getScormPackages(): Promise<ScormPackage[]>;
  updateScormPackage(id: string, data: Partial<ScormPackage>): Promise<ScormPackage | undefined>;
  
  createScormAttempt(attempt: InsertScormAttempt & { id: string }): Promise<ScormAttempt>;
  getScormAttempt(id: string): Promise<ScormAttempt | undefined>;
  getScormAttemptBySession(packageId: string, sessionId: string, attemptNumber?: number): Promise<ScormAttempt | undefined>;
  getNextAttemptNumber(packageId: string, sessionId: string): Promise<number>;
  getScormAttemptsByPackage(packageId: string): Promise<ScormAttempt[]>;
  updateScormAttempt(id: string, data: Partial<ScormAttempt>): Promise<ScormAttempt | undefined>;
  getAllScormAttempts(): Promise<ScormAttempt[]>;
  
  createScormAnswer(answer: InsertScormAnswer & { id: string }): Promise<ScormAnswer>;
  getScormAnswersByAttempt(attemptId: string): Promise<ScormAnswer[]>;

  // Content Pages (PRD-1)
  getContentPages(testId: string): Promise<ContentPage[]>;
  getContentPage(id: string): Promise<ContentPage | undefined>;
  createContentPage(page: InsertContentPage): Promise<ContentPage>;
  updateContentPage(id: string, updates: Partial<InsertContentPage>): Promise<ContentPage | undefined>;
  deleteContentPage(id: string): Promise<boolean>;
  reorderContentPages(updates: { id: string; sortOrder: number }[]): Promise<void>;
}
export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (user) {
      return { ...user, email: await decryptEmail(user.email) };
    }
    return undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const emailHashValue = hashEmail(email);
    const [user] = await db.select().from(users).where(eq(users.emailHash, emailHashValue));
    if (user) {
      return { ...user, email: await decryptEmail(user.email) };
    }
    return undefined;
  }

  async createUser(insertUser: InsertUser & { createdBy?: string }): Promise<User> {
    const id = randomUUID();
    const hashedPassword = await bcrypt.hash(insertUser.passwordHash, 10);
    const emailEncrypted = await encryptEmail(insertUser.email);
    const emailHashValue = hashEmail(insertUser.email);

    const [user] = await db.insert(users).values({
      id,
      email: emailEncrypted,
      emailHash: emailHashValue,
      passwordHash: hashedPassword,
      name: insertUser.name || null,
      role: insertUser.role || "learner",
      status: insertUser.status || "pending",
      mustChangePassword: insertUser.mustChangePassword ?? true,
      gdprConsent: false,
      createdAt: new Date(),
      createdBy: insertUser.createdBy || null,
    }).returning();

    return { ...user, email: await decryptEmail(user.email) };
  }

  async validatePassword(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user : null;
  }

  async updateUserLastLogin(id: string): Promise<void> {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  }

  async getUsers(): Promise<User[]> {
    const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
    return Promise.all(allUsers.map(async user => ({ ...user, email: await decryptEmail(user.email) })));
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const updateData: any = { ...data };
    if (data.email) {
      updateData.email = await encryptEmail(data.email);
      updateData.emailHash = hashEmail(data.email);
    }

    const [updated] = await db.update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();

    if (updated) {
      return { ...updated, email: await decryptEmail(updated.email) };
    }
    return undefined;
  }

  async updateUserPassword(id: string, newPasswordHash: string): Promise<void> {
    const hashed = await bcrypt.hash(newPasswordHash, 10);
    await db.update(users).set({ 
      passwordHash: hashed,
      mustChangePassword: false,
    }).where(eq(users.id, id));
  }

  async deactivateUser(id: string): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ status: "inactive" })
      .where(eq(users.id, id))
      .returning();
    return updated || undefined;
  }

  async activateUser(id: string): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ status: "active" })
      .where(eq(users.id, id))
      .returning();
    return updated || undefined;
  }

  // ============================================
  // Groups
  // ============================================

  async getGroups(): Promise<Group[]> {
    return db.select().from(groups).orderBy(desc(groups.createdAt));
  }

  async getGroup(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group || undefined;
  }

  async createGroup(group: InsertGroup & { createdBy?: string }): Promise<Group> {
    const id = randomUUID();
    const [created] = await db.insert(groups).values({
      id,
      name: group.name,
      description: group.description || null,
      createdAt: new Date(),
      createdBy: group.createdBy || null,
    }).returning();
    return created;
  }

  async updateGroup(id: string, data: Partial<Group>): Promise<Group | undefined> {
    const [updated] = await db.update(groups).set(data).where(eq(groups.id, id)).returning();
    return updated || undefined;
  }

  async deleteGroup(id: string): Promise<boolean> {
    // Сначала удаляем связи с пользователями
    await db.delete(userGroups).where(eq(userGroups.groupId, id));
    // Затем удаляем саму группу
    const result = await db.delete(groups).where(eq(groups.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // ============================================
  // User-Group relations
  // ============================================

  async getUserGroups(userId: string): Promise<Group[]> {
    const result = await db
      .select({ group: groups })
      .from(userGroups)
      .innerJoin(groups, eq(userGroups.groupId, groups.id))
      .where(eq(userGroups.userId, userId));
    return result.map(r => r.group);
  }

  async getGroupUsers(groupId: string): Promise<User[]> {
    const result = await db
      .select({ user: users })
      .from(userGroups)
      .innerJoin(users, eq(userGroups.userId, users.id))
      .where(eq(userGroups.groupId, groupId));
    return Promise.all(result.map(async r => ({ ...r.user, email: await decryptEmail(r.user.email) })));
  }

  async addUserToGroup(userId: string, groupId: string): Promise<UserGroup> {
    const id = randomUUID();
    const [created] = await db.insert(userGroups).values({
      id,
      userId,
      groupId,
      addedAt: new Date(),
    }).returning();
    return created;
  }

  async removeUserFromGroup(userId: string, groupId: string): Promise<boolean> {
    const result = await db.delete(userGroups)
      .where(and(eq(userGroups.userId, userId), eq(userGroups.groupId, groupId)));
    return (result.rowCount ?? 0) > 0;
  }

  async setUserGroups(userId: string, groupIds: string[]): Promise<void> {
    // Удаляем все текущие связи
    await db.delete(userGroups).where(eq(userGroups.userId, userId));
    
    // Добавляем новые
    if (groupIds.length > 0) {
      const values = groupIds.map(groupId => ({
        id: randomUUID(),
        userId,
        groupId,
        addedAt: new Date(),
      }));
      await db.insert(userGroups).values(values);
    }
  }

  // ============================================
  // Test Assignments
  // ============================================

  async getAssignment(id: string): Promise<TestAssignment | undefined> {
    const [a] = await db.select().from(testAssignments).where(eq(testAssignments.id, id));
    return a;
  }

  async getTestAssignments(testId: string): Promise<TestAssignment[]> {
    return db.select().from(testAssignments).where(eq(testAssignments.testId, testId));
  }

  async getUserAssignments(userId: string): Promise<TestAssignment[]> {
    return db.select().from(testAssignments).where(eq(testAssignments.userId, userId));
  }

  async getGroupAssignments(groupId: string): Promise<TestAssignment[]> {
    return db.select().from(testAssignments).where(eq(testAssignments.groupId, groupId));
  }

  async createTestAssignment(assignment: InsertTestAssignment & { assignedBy: string }): Promise<TestAssignment> {
    const id = randomUUID();
    const [created] = await db.insert(testAssignments).values({
      id,
      testId: assignment.testId,
      userId: assignment.userId || null,
      groupId: assignment.groupId || null,
      dueDate: assignment.dueDate || null,
      assignedAt: new Date(),
      assignedBy: assignment.assignedBy,
    }).returning();
    return created;
  }

  async deleteTestAssignment(id: string): Promise<boolean> {
    const result = await db.delete(testAssignments).where(eq(testAssignments.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getAssignedTestsForUser(userId: string): Promise<Test[]> {
    // Получаем группы пользователя
    const userGroupsList = await this.getUserGroups(userId);
    const groupIds = userGroupsList.map(g => g.id);

    // Получаем назначения напрямую пользователю
    const directAssignments = await db
      .select({ testId: testAssignments.testId })
      .from(testAssignments)
      .where(eq(testAssignments.userId, userId));

    // Получаем назначения через группы
    let groupAssignments: { testId: string }[] = [];
    if (groupIds.length > 0) {
      groupAssignments = await db
        .select({ testId: testAssignments.testId })
        .from(testAssignments)
        .where(inArray(testAssignments.groupId, groupIds));
    }

    // Собираем уникальные testId
    const testIds = [...new Set([
      ...directAssignments.map(a => a.testId),
      ...groupAssignments.map(a => a.testId),
    ])];

    if (testIds.length === 0) {
      return [];
    }

    // Получаем тесты
    return db.select().from(tests).where(inArray(tests.id, testIds));
  }

  // ============================================
  // Password Reset Tokens
  // ============================================

  async createPasswordResetToken(userId: string, tokenHash: string, requestIp: string, ttlMs?: number): Promise<PasswordResetToken> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + (ttlMs ?? 30 * 60 * 1000)); // 30 минут по умолчанию
    const [token] = await db.insert(passwordResetTokens).values({
      id,
      userId,
      tokenHash,
      expiresAt,
      requestIp,
      createdAt: new Date(),
    }).returning();
    return token;
  }

  async getPasswordResetToken(tokenHash: string): Promise<PasswordResetToken | undefined> {
    const [token] = await db.select().from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash));
    return token || undefined;
  }

  async markTokenAsUsed(id: string): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, id));
  }

  async getRecentTokensCount(userId: string, hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.userId, userId),
        sql`${passwordResetTokens.createdAt} > ${since}`
      ));
    return Number(result[0]?.count || 0);
  }

  // ── Assignment Access Tokens (magic links) ──────────────────────────────────

  async createAssignmentAccessToken(data: { assignmentId: string; userId: string; testId: string; tokenHash: string; expiresAt: Date }): Promise<AssignmentAccessToken> {
    const [token] = await db.insert(assignmentAccessTokens).values({
      id: randomUUID(),
      assignmentId: data.assignmentId,
      userId: data.userId,
      testId: data.testId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
    }).returning();
    return token;
  }

  async getAssignmentAccessToken(tokenHash: string): Promise<AssignmentAccessToken | undefined> {
    const [token] = await db.select().from(assignmentAccessTokens)
      .where(eq(assignmentAccessTokens.tokenHash, tokenHash));
    return token;
  }

  async getAssignmentAccessTokensByAssignment(assignmentId: string): Promise<AssignmentAccessToken[]> {
    return db.select().from(assignmentAccessTokens)
      .where(eq(assignmentAccessTokens.assignmentId, assignmentId));
  }

  async revokeAssignmentAccessToken(id: string): Promise<void> {
    await db.update(assignmentAccessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(assignmentAccessTokens.id, id));
  }

  async revokeAssignmentAccessTokensByAssignment(assignmentId: string): Promise<void> {
    await db.update(assignmentAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(assignmentAccessTokens.assignmentId, assignmentId),
        sql`${assignmentAccessTokens.revokedAt} IS NULL`,
      ));
  }

  async revokeAssignmentAccessTokensByAssignmentAndUser(assignmentId: string, userId: string): Promise<void> {
    await db.update(assignmentAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(assignmentAccessTokens.assignmentId, assignmentId),
        eq(assignmentAccessTokens.userId, userId),
        sql`${assignmentAccessTokens.revokedAt} IS NULL`,
      ));
  }

  async getFolders(): Promise<Folder[]> {
    return db.select().from(folders);
  }

  async getFolder(id: string): Promise<Folder | undefined> {
    const [folder] = await db.select().from(folders).where(eq(folders.id, id));
    return folder || undefined;
  }

  async createFolder(folder: InsertFolder): Promise<Folder> {
    const id = randomUUID();
    const [newFolder] = await db.insert(folders).values({
      id,
      name: folder.name,
      parentId: folder.parentId || null,
    }).returning();
    return newFolder;
  }

  async updateFolder(id: string, updates: Partial<InsertFolder>): Promise<Folder | undefined> {
    const [updated] = await db.update(folders).set(updates).where(eq(folders.id, id)).returning();
    return updated || undefined;
  }

  async deleteFolder(id: string): Promise<boolean> {
    // When deleting a folder, move all its topics to root (folderId = null)
    await db.update(topics).set({ folderId: null }).where(eq(topics.folderId, id));
    // Move child folders to root (parentId = null)
    await db.update(folders).set({ parentId: null }).where(eq(folders.parentId, id));
    const result = await db.delete(folders).where(eq(folders.id, id)).returning();
    return result.length > 0;
  }

  async getTestFolders(): Promise<TestFolder[]> {
    return db.select().from(testFolders).orderBy(testFolders.name);
  }

  async createTestFolder(folder: InsertTestFolder): Promise<TestFolder> {
    const id = randomUUID();
    const [newFolder] = await db.insert(testFolders).values({
      id,
      name: folder.name,
      parentId: folder.parentId || null,
    }).returning();
    return newFolder;
  }

  async updateTestFolder(id: string, updates: Partial<InsertTestFolder>): Promise<TestFolder | undefined> {
    const [updated] = await db.update(testFolders).set(updates).where(eq(testFolders.id, id)).returning();
    return updated || undefined;
  }

  async deleteTestFolder(id: string, moveTo: string | null = null): Promise<boolean> {
    // Move direct tests to the requested destination (root by default).
    await db.update(tests).set({ folderId: moveTo }).where(eq(tests.folderId, id));
    // Reparent child folders to the requested destination.
    await db.update(testFolders).set({ parentId: moveTo }).where(eq(testFolders.parentId, id));
    const result = await db.delete(testFolders).where(eq(testFolders.id, id)).returning();
    return result.length > 0;
  }

  /**
   * Recursively delete a folder, its sub-folders and every test inside them.
   * Test-side soft cleanup (adaptive levels/links/topic-settings) is the
   * caller's responsibility (route handler), keeping this method focused on
   * the folder/test row deletion.
   */
  async deleteTestFolderCascade(id: string): Promise<boolean> {
    // Collect all descendant folder ids breadth-first.
    const allFolders = await db.select().from(testFolders);
    const childrenByParent = new Map<string | null, string[]>();
    for (const f of allFolders) {
      const key = f.parentId ?? null;
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key)!.push(f.id);
    }
    const descendantIds: string[] = [];
    const queue: string[] = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      descendantIds.push(current);
      const children = childrenByParent.get(current) ?? [];
      queue.push(...children);
    }

    // Delete every test in any of those folders. Adaptive children rows are
    // assumed cleaned up by the route handler before this call.
    if (descendantIds.length > 0) {
      await db.delete(tests).where(inArray(tests.folderId, descendantIds));
      const result = await db.delete(testFolders).where(inArray(testFolders.id, descendantIds)).returning();
      return result.length > 0;
    }
    return false;
  }

  async moveTestToFolder(testId: string, folderId: string | null): Promise<boolean> {
    const result = await db.update(tests).set({ folderId }).where(eq(tests.id, testId)).returning();
    return result.length > 0;
  }

  async getTopics(): Promise<Topic[]> {
    return db.select().from(topics);
  }

  async getTopic(id: string): Promise<Topic | undefined> {
    const [topic] = await db.select().from(topics).where(eq(topics.id, id));
    return topic || undefined;
  }

  async createTopic(topic: InsertTopic): Promise<Topic> {
    const id = randomUUID();
    const [newTopic] = await db.insert(topics).values({
      id,
      name: topic.name,
      description: topic.description || null,
      feedback: topic.feedback || null,
      folderId: topic.folderId || null,
    }).returning();
    return newTopic;
  }

  async updateTopic(id: string, updates: Partial<InsertTopic>): Promise<Topic | undefined> {
    const [updated] = await db.update(topics).set(updates).where(eq(topics.id, id)).returning();
    return updated || undefined;
  }

  async deleteTopic(id: string): Promise<boolean> {
    // Cascade delete: first delete questions and courses for this topic
    await db.delete(questions).where(eq(questions.topicId, id));
    await db.delete(topicCourses).where(eq(topicCourses.topicId, id));
    const result = await db.delete(topics).where(eq(topics.id, id)).returning();
    return result.length > 0;
  }

  async deleteTopicsBulk(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    // Cascade delete: first delete questions and courses for these topics
    await db.delete(questions).where(inArray(questions.topicId, ids));
    await db.delete(topicCourses).where(inArray(topicCourses.topicId, ids));
    const result = await db.delete(topics).where(inArray(topics.id, ids)).returning();
    return result.length;
  }

  async getTopicCourses(topicId: string): Promise<TopicCourse[]> {
    return db.select().from(topicCourses).where(eq(topicCourses.topicId, topicId));
  }

  async createTopicCourse(course: InsertTopicCourse): Promise<TopicCourse> {
    const id = randomUUID();
    const [newCourse] = await db.insert(topicCourses).values({ id, ...course }).returning();
    return newCourse;
  }

  async deleteTopicCourse(id: string): Promise<boolean> {
    const result = await db.delete(topicCourses).where(eq(topicCourses.id, id)).returning();
    return result.length > 0;
  }

  async getTopicEvents(topicId: string): Promise<TopicEvent[]> {
    return db.select().from(topicEvents).where(eq(topicEvents.topicId, topicId));
  }

  async createTopicEvent(event: InsertTopicEvent): Promise<TopicEvent> {
    const id = randomUUID();
    const [newEvent] = await db.insert(topicEvents).values({ id, ...event }).returning();
    return newEvent;
  }

  async deleteTopicEvent(id: string): Promise<boolean> {
    const result = await db.delete(topicEvents).where(eq(topicEvents.id, id)).returning();
    return result.length > 0;
  }

  async getQuestions(): Promise<Question[]> {
    return db.select().from(questions);
  }

  async getQuestionsByTopic(topicId: string): Promise<Question[]> {
    return db.select().from(questions).where(eq(questions.topicId, topicId));
  }

  async getContentHashesByTopic(topicId: string): Promise<Set<string>> {
    const rows = await db
      .select({ contentHash: questions.contentHash })
      .from(questions)
      .where(and(eq(questions.topicId, topicId), sql`${questions.contentHash} IS NOT NULL`));
    return new Set(rows.map((r) => r.contentHash!));
  }

  async getQuestion(id: string): Promise<Question | undefined> {
    const [question] = await db.select().from(questions).where(eq(questions.id, id));
    return question || undefined;
  }

  async getQuestionsByIds(ids: string[]): Promise<Question[]> {
    if (ids.length === 0) return [];
    return db.select().from(questions).where(inArray(questions.id, ids));
  }

  async createQuestion(question: InsertQuestion): Promise<Question> {
    const id = randomUUID();
    const [newQuestion] = await db.insert(questions).values({
      id,
      topicId: question.topicId,
      type: question.type,
      prompt: question.prompt,
      dataJson: question.dataJson,
      correctJson: question.correctJson,
      points: question.points ?? 1,
      difficulty: question.difficulty ?? 50,
      mediaUrl: question.mediaUrl || null,
      mediaType: question.mediaType || null,
      shuffleAnswers: question.shuffleAnswers ?? true,
      feedback: question.feedback || null,
      feedbackMode: question.feedbackMode || "general",
      feedbackCorrect: question.feedbackCorrect || null,
      feedbackIncorrect: question.feedbackIncorrect || null,
      contentHash: question.contentHash || null,
    }).returning();
    return newQuestion;
  }

  async duplicateQuestion(id: string): Promise<Question | undefined> {
    const original = await this.getQuestion(id);
    if (!original) return undefined;

    const newId = randomUUID();
    const [newQuestion] = await db.insert(questions).values({
      id: newId,
      topicId: original.topicId,
      type: original.type,
      prompt: original.prompt + " (копия)",
      dataJson: original.dataJson,
      correctJson: original.correctJson,
      points: original.points,
      difficulty: original.difficulty,
      feedback: original.feedback,
      feedbackMode: original.feedbackMode,
      feedbackCorrect: original.feedbackCorrect,
      feedbackIncorrect: original.feedbackIncorrect,
      mediaUrl: original.mediaUrl,
      mediaType: original.mediaType,
      shuffleAnswers: original.shuffleAnswers,
    }).returning();
    return newQuestion;
  }

  async duplicateTopicWithQuestions(id: string): Promise<{ topic: Topic; questions: Question[] } | undefined> {
    const originalTopic = await this.getTopic(id);
    if (!originalTopic) return undefined;

    const newTopicId = randomUUID();
    const [newTopic] = await db.insert(topics).values({
      id: newTopicId,
      name: originalTopic.name + " (копия)",
      description: originalTopic.description,
      feedback: originalTopic.feedback,
    }).returning();

    const originalCourses = await this.getTopicCourses(id);
    for (const course of originalCourses) {
      await db.insert(topicCourses).values({
        id: randomUUID(),
        topicId: newTopicId,
        title: course.title,
        url: course.url,
      });
    }

    const originalQuestions = await this.getQuestionsByTopic(id);
    const newQuestions: Question[] = [];

    for (const q of originalQuestions) {
      const [newQ] = await db.insert(questions).values({
        id: randomUUID(),
        topicId: newTopicId,
        type: q.type,
        prompt: q.prompt,
        dataJson: q.dataJson,
        correctJson: q.correctJson,
        points: q.points,
        difficulty: q.difficulty,
        mediaUrl: q.mediaUrl,
        mediaType: q.mediaType,
        shuffleAnswers: q.shuffleAnswers,
        feedback: q.feedback,
        feedbackMode: q.feedbackMode,
        feedbackCorrect: q.feedbackCorrect,
        feedbackIncorrect: q.feedbackIncorrect,
      }).returning();
      newQuestions.push(newQ);
    }

    return { topic: newTopic, questions: newQuestions };
  }

  async getTopicByName(name: string): Promise<Topic | undefined> {
    const [topic] = await db.select().from(topics).where(eq(topics.name, name));
    return topic || undefined;
  }

  async updateQuestion(id: string, updates: Partial<InsertQuestion>): Promise<Question | undefined> {
    const [updated] = await db.update(questions).set(updates).where(eq(questions.id, id)).returning();
    return updated || undefined;
  }

  async deleteQuestion(id: string): Promise<boolean> {
    const result = await db.delete(questions).where(eq(questions.id, id)).returning();
    return result.length > 0;
  }

  async deleteQuestionsBulk(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await db.delete(questions).where(inArray(questions.id, ids)).returning();
    return result.length;
  }

  async getTests(): Promise<Test[]> {
    const rows = await db.select().from(tests);
    return rows.map(mapLegacyTest);
  }

  async getTest(id: string): Promise<Test | undefined> {
    const [row] = await db.select().from(tests).where(eq(tests.id, id));
    return row ? mapLegacyTest(row) : undefined;
  }

  /**
   * Returns counts of legacy rows not yet covered by migration 003.
   * `legacyStartPageCount` — tests with non-empty `start_page_content` that have
   * no intro `content_pages` row (position='before', topic_id IS NULL).
   */
  async getMigrationHealth(): Promise<{ legacyStartPageCount: number }> {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(tests)
      .where(
        and(
          sql`${tests.startPageContent} IS NOT NULL`,
          sql`length(trim(coalesce(${tests.startPageContent}, ''))) > 0`,
          sql`NOT EXISTS (
            SELECT 1 FROM content_pages cp
            WHERE cp.test_id = ${tests.id}
              AND cp.type = 'intro'
              AND cp.topic_id IS NULL
          )`,
        ),
      );
    return { legacyStartPageCount: count ?? 0 };
  }

  async createTest(test: InsertTest, sections: Omit<InsertTestSection, "testId">[]): Promise<Test> {
    return db.transaction(async (tx) => {
      const id = randomUUID();
      // PRD-7 §4.1: status is the source of truth; sync published from it.
      const status = test.status ?? (test.published ? "published" : "draft");
      const [newTest] = await tx.insert(tests).values({
        id,
        title: test.title,
        description: test.description || null,
        overallPassRuleJson: test.overallPassRuleJson,
        webhookUrl: test.webhookUrl || null,
        status,
        published: status === "published",
        telemetryEnabled: test.telemetryEnabled ?? false,
        feedbackJson: test.feedbackJson ?? null,
        flowPolicyJson: test.flowPolicyJson ?? null,
        showCorrectAnswers: test.showCorrectAnswers || false,
        timeLimitMinutes: test.timeLimitMinutes || null,
        maxAttempts: test.maxAttempts || null,
        startPageContent: test.startPageContent || null,
        feedback: test.feedback || null,
        mode: test.mode || "standard",
        showDifficultyLevel: test.showDifficultyLevel ?? true,
      }).returning();

      for (const section of sections) {
        await tx.insert(testSections).values({
          id: randomUUID(),
          testId: id,
          topicId: section.topicId,
          drawCount: section.drawCount,
          topicPassRuleJson: section.topicPassRuleJson ?? null,
          required: section.required ?? true,
          timeLimitMinutes: section.timeLimitMinutes ?? null,
          feedbackJson: section.feedbackJson ?? null,
        });
      }

      // Safety net (§1.11): if legacy client passes startPageContent, create an
      // intro content_page so new code can use it even without migration 003.
      if (test.startPageContent?.trim()) {
        await tx.insert(contentPages).values({
          id: randomUUID(),
          testId: id,
          topicId: null,
          position: "before",
          mode: "html",
          type: "intro",
          kind: "intro",
          templateKey: null,
          sortOrder: 0,
          valuesJson: { values: { html: test.startPageContent } },
          autoAdvance: false,
          autoAdvanceDelayMs: null,
        });
      }

      return newTest;
    });
  }

  async updateTest(id: string, updates: Partial<InsertTest>, sections?: Omit<InsertTestSection, "testId">[]): Promise<Test | undefined> {
    return db.transaction(async (tx) => {
      // PRD-7 §4.1: keep status and published in sync on every write.
      const patch: Partial<InsertTest> = { ...updates };
      if (patch.status !== undefined) {
        patch.published = patch.status === "published";
      } else if (patch.published !== undefined) {
        patch.status = patch.published ? "published" : "draft";
      }

      const [updated] = await tx.update(tests)
        .set({ ...patch, version: sql`${tests.version} + 1`, updatedAt: new Date() })
        .where(eq(tests.id, id))
        .returning();
      if (!updated) return undefined;

      if (sections) {
        await tx.delete(testSections).where(eq(testSections.testId, id));
        for (const section of sections) {
          await tx.insert(testSections).values({
            id: randomUUID(),
            testId: id,
            topicId: section.topicId,
            drawCount: section.drawCount,
            topicPassRuleJson: section.topicPassRuleJson ?? null,
            required: section.required ?? true,
            timeLimitMinutes: section.timeLimitMinutes ?? null,
            feedbackJson: section.feedbackJson ?? null,
          });
        }
      }

      return updated;
    });
  }

  async patchTestStatus(id: string, status: "draft" | "published" | "archived"): Promise<{ id: string; status: string; version: number } | undefined> {
    const [row] = await db.update(tests)
      .set({ status, published: status === "published", updatedAt: new Date() })
      .where(eq(tests.id, id))
      .returning({ id: tests.id, status: tests.status, version: tests.version });
    return row ?? undefined;
  }

  async deleteTest(id: string): Promise<boolean> {
    await db.delete(testSections).where(eq(testSections.testId, id));
    const result = await db.delete(tests).where(eq(tests.id, id)).returning();
    return result.length > 0;
  }

  async getTestSections(testId: string): Promise<TestSection[]> {
    return db.select().from(testSections).where(eq(testSections.testId, testId));
  }

  async createAttempt(attempt: InsertAttempt): Promise<Attempt> {
    const id = randomUUID();
    const [newAttempt] = await db.insert(attempts).values({
      id,
      userId: attempt.userId,
      testId: attempt.testId,
      testVersion: attempt.testVersion || 1,
      variantJson: attempt.variantJson,
      answersJson: attempt.answersJson || null,
      resultJson: attempt.resultJson || null,
      startedAt: new Date(attempt.startedAt),
      finishedAt: attempt.finishedAt ? new Date(attempt.finishedAt) : null,
    }).returning();
    return newAttempt;
  }

  async getAttempt(id: string): Promise<Attempt | undefined> {
    const [attempt] = await db.select().from(attempts).where(eq(attempts.id, id));
    return attempt || undefined;
  }

  async updateAttempt(id: string, updates: Partial<Attempt>): Promise<Attempt | undefined> {
    const [updated] = await db.update(attempts).set(updates).where(eq(attempts.id, id)).returning();
    return updated || undefined;
  }

  async getAttemptsByUser(userId: string): Promise<Attempt[]> {
    return db.select().from(attempts).where(eq(attempts.userId, userId));
  }

  async getAttemptsByUserAndTest(userId: string, testId: string): Promise<Attempt[]> {
    return db.select().from(attempts).where(
      and(eq(attempts.userId, userId), eq(attempts.testId, testId))
    );
  }

  async deleteAttemptsByUserAndTest(userId: string, testId: string): Promise<void> {
    await db.delete(attempts).where(
      and(eq(attempts.userId, userId), eq(attempts.testId, testId))
    );
  }

  async getAllAttempts(): Promise<Attempt[]> {
    return db.select().from(attempts);
  }

  // === Adaptive Testing Methods ===

  async getAdaptiveTopicSettings(testId: string, topicId: string): Promise<AdaptiveTopicSettings | undefined> {
    const [settings] = await db.select().from(adaptiveTopicSettings)
      .where(and(eq(adaptiveTopicSettings.testId, testId), eq(adaptiveTopicSettings.topicId, topicId)));
    return settings || undefined;
  }

  async getAdaptiveTopicSettingsByTest(testId: string): Promise<AdaptiveTopicSettings[]> {
    return db.select().from(adaptiveTopicSettings).where(eq(adaptiveTopicSettings.testId, testId));
  }

  async createAdaptiveTopicSettings(settings: InsertAdaptiveTopicSettings): Promise<AdaptiveTopicSettings> {
    const id = randomUUID();
    const [newSettings] = await db.insert(adaptiveTopicSettings).values({ id, ...settings }).returning();
    return newSettings;
  }

  async updateAdaptiveTopicSettings(id: string, settings: Partial<InsertAdaptiveTopicSettings>): Promise<AdaptiveTopicSettings | undefined> {
    const [updated] = await db.update(adaptiveTopicSettings).set(settings).where(eq(adaptiveTopicSettings.id, id)).returning();
    return updated || undefined;
  }

  async deleteAdaptiveTopicSettingsByTest(testId: string): Promise<void> {
    await db.delete(adaptiveTopicSettings).where(eq(adaptiveTopicSettings.testId, testId));
  }

  async getAdaptiveLevels(testId: string, topicId: string): Promise<AdaptiveLevel[]> {
    return db.select().from(adaptiveLevels)
      .where(and(eq(adaptiveLevels.testId, testId), eq(adaptiveLevels.topicId, topicId)))
      .orderBy(adaptiveLevels.levelIndex);
  }

  async getAdaptiveLevelsByTest(testId: string): Promise<AdaptiveLevel[]> {
    return db.select().from(adaptiveLevels)
      .where(eq(adaptiveLevels.testId, testId))
      .orderBy(adaptiveLevels.levelIndex);
  }

  async createAdaptiveLevel(level: InsertAdaptiveLevel): Promise<AdaptiveLevel> {
    const id = randomUUID();
    const [newLevel] = await db.insert(adaptiveLevels).values({ id, ...level }).returning();
    return newLevel;
  }

  async updateAdaptiveLevel(id: string, level: Partial<InsertAdaptiveLevel>): Promise<AdaptiveLevel | undefined> {
    const [updated] = await db.update(adaptiveLevels).set(level).where(eq(adaptiveLevels.id, id)).returning();
    return updated || undefined;
  }

  async deleteAdaptiveLevelsByTest(testId: string): Promise<void> {
    // First delete all links for levels of this test
    const levels = await this.getAdaptiveLevelsByTest(testId);
    for (const level of levels) {
      await this.deleteAdaptiveLevelLinksByLevel(level.id);
    }
    await db.delete(adaptiveLevels).where(eq(adaptiveLevels.testId, testId));
  }

  async getAdaptiveLevelLinks(levelId: string): Promise<AdaptiveLevelLink[]> {
    return db.select().from(adaptiveLevelLinks).where(eq(adaptiveLevelLinks.levelId, levelId));
  }

  async createAdaptiveLevelLink(link: InsertAdaptiveLevelLink): Promise<AdaptiveLevelLink> {
    const id = randomUUID();
    const [newLink] = await db.insert(adaptiveLevelLinks).values({ id, ...link }).returning();
    return newLink;
  }

  async deleteAdaptiveLevelLinksByLevel(levelId: string): Promise<void> {
    await db.delete(adaptiveLevelLinks).where(eq(adaptiveLevelLinks.levelId, levelId));
  }

  async deleteAdaptiveLevelLinksByTest(testId: string): Promise<void> {
    const levels = await this.getAdaptiveLevelsByTest(testId);
    for (const level of levels) {
      await this.deleteAdaptiveLevelLinksByLevel(level.id);
    }
  }

  async createScormPackage(pkg: InsertScormPackage & { id: string }): Promise<ScormPackage> {
    const [created] = await db.insert(scormPackages).values(pkg).returning();
    return created;
  }

  async getScormPackage(id: string): Promise<ScormPackage | undefined> {
    const [pkg] = await db.select().from(scormPackages).where(eq(scormPackages.id, id));
    return pkg || undefined;
  }

  async getScormPackagesByTest(testId: string): Promise<ScormPackage[]> {
    return db.select().from(scormPackages).where(eq(scormPackages.testId, testId));
  }

  async getScormPackages(): Promise<ScormPackage[]> {
    return db.select().from(scormPackages);
  }

  async updateScormPackage(id: string, data: Partial<ScormPackage>): Promise<ScormPackage | undefined> {
    const [updated] = await db.update(scormPackages)
      .set(data)
      .where(eq(scormPackages.id, id))
      .returning();
    return updated || undefined;
  }

  // ============================================
  // SCORM Attempts
  // ============================================

  async createScormAttempt(attempt: InsertScormAttempt & { id: string }): Promise<ScormAttempt> {
    const [created] = await db.insert(scormAttempts).values(attempt).returning();
    return created;
  }

  async getScormAttempt(id: string): Promise<ScormAttempt | undefined> {
    const [attempt] = await db.select().from(scormAttempts).where(eq(scormAttempts.id, id));
    return attempt || undefined;
  }

  async getScormAttemptBySession(
    packageId: string, 
    sessionId: string, 
    attemptNumber?: number
  ): Promise<ScormAttempt | undefined> {
    if (attemptNumber !== undefined) {
      // Ищем конкретную попытку по номеру
      const [attempt] = await db.select().from(scormAttempts)
        .where(and(
          eq(scormAttempts.packageId, packageId),
          eq(scormAttempts.sessionId, sessionId),
          eq(scormAttempts.attemptNumber, attemptNumber)
        ));
      return attempt || undefined;
    }
    
    // Если attemptNumber не указан - вернуть последнюю попытку
    const [attempt] = await db.select().from(scormAttempts)
      .where(and(
        eq(scormAttempts.packageId, packageId),
        eq(scormAttempts.sessionId, sessionId)
      ))
      .orderBy(desc(scormAttempts.attemptNumber));
    return attempt || undefined;
  }

  async getNextAttemptNumber(packageId: string, sessionId: string): Promise<number> {
    const [result] = await db
      .select({ maxNum: sql<number>`COALESCE(MAX(${scormAttempts.attemptNumber}), 0)` })
      .from(scormAttempts)
      .where(and(
        eq(scormAttempts.packageId, packageId),
        eq(scormAttempts.sessionId, sessionId)
      ));
    return (result?.maxNum || 0) + 1;
  }

  async getScormAttemptsByPackage(packageId: string): Promise<ScormAttempt[]> {
    return db.select().from(scormAttempts).where(eq(scormAttempts.packageId, packageId));
  }

  async updateScormAttempt(id: string, data: Partial<ScormAttempt>): Promise<ScormAttempt | undefined> {
    const [updated] = await db.update(scormAttempts)
      .set(data)
      .where(eq(scormAttempts.id, id))
      .returning();
    return updated || undefined;
  }

  async getAllScormAttempts(): Promise<ScormAttempt[]> {
    return db.select().from(scormAttempts);
  }

  // ============================================
  // SCORM Answers
  // ============================================

  async createScormAnswer(answer: InsertScormAnswer & { id: string }): Promise<ScormAnswer> {
    const [created] = await db.insert(scormAnswers).values(answer).returning();
    return created;
  }

  async getScormAnswersByAttempt(attemptId: string): Promise<ScormAnswer[]> {
    return db.select().from(scormAnswers).where(eq(scormAnswers.attemptId, attemptId));
  }

  // ============================================
  // Content Pages (PRD-1)
  // ============================================

  async getContentPages(testId: string): Promise<ContentPage[]> {
    return db.select().from(contentPages)
      .where(eq(contentPages.testId, testId))
      .orderBy(contentPages.topicId, contentPages.position, contentPages.sortOrder);
  }

  async getContentPage(id: string): Promise<ContentPage | undefined> {
    const [page] = await db.select().from(contentPages).where(eq(contentPages.id, id));
    return page;
  }

  async createContentPage(page: InsertContentPage): Promise<ContentPage> {
    const [created] = await db.insert(contentPages).values(page).returning();
    return created;
  }

  async updateContentPage(id: string, updates: Partial<InsertContentPage>): Promise<ContentPage | undefined> {
    const [updated] = await db.update(contentPages)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(contentPages.id, id))
      .returning();
    return updated;
  }

  async deleteContentPage(id: string): Promise<boolean> {
    const result = await db.delete(contentPages).where(eq(contentPages.id, id)).returning();
    return result.length > 0;
  }

  async reorderContentPages(updates: { id: string; sortOrder: number }[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (const { id, sortOrder } of updates) {
        await tx.update(contentPages)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(contentPages.id, id));
      }
    });
  }
}

export const storage = new DatabaseStorage();

export async function seedDatabase() {
  const existingUsers = await db.select().from(users);
  if (existingUsers.length > 0) return;

  const adminPassword = await bcrypt.hash("admin123", 10);
  const learnerPassword = await bcrypt.hash("learner123", 10);
  const adminEmail = "admin@test.com";
  const learnerEmail = "learner@test.com";

  const adminId = randomUUID();
  const learnerId = randomUUID();

  await db.insert(users).values([
    { 
      id: adminId, 
      email: await encryptEmail(adminEmail),
      emailHash: hashEmail(adminEmail),
      passwordHash: adminPassword, 
      name: "Администратор",
      role: "author",
      status: "active",
      mustChangePassword: false,
      gdprConsent: true,
      gdprConsentAt: new Date(),
      createdAt: new Date(),
    },
    { 
      id: learnerId, 
      email: await encryptEmail(learnerEmail),
      emailHash: hashEmail(learnerEmail),
      passwordHash: learnerPassword, 
      name: "Тестовый ученик",
      role: "learner",
      status: "active",
      mustChangePassword: false,
      gdprConsent: true,
      gdprConsentAt: new Date(),
      createdAt: new Date(),
    },
  ]);

  const iptvTopicId = randomUUID();
  const wifiTopicId = randomUUID();

  await db.insert(topics).values([
    { id: iptvTopicId, name: "IPTV", description: "Internet Protocol Television fundamentals and configuration" },
    { id: wifiTopicId, name: "WiFi", description: "Wireless networking standards and troubleshooting" },
  ]);

  await db.insert(topicCourses).values([
    { id: randomUUID(), topicId: iptvTopicId, title: "IPTV Fundamentals Course", url: "https://example.com/iptv-course" },
    { id: randomUUID(), topicId: wifiTopicId, title: "WiFi Troubleshooting Guide", url: "https://example.com/wifi-course" },
  ]);

  const iptvQuestions = [
    { topicId: iptvTopicId, type: "single" as const, prompt: "What does IPTV stand for?", dataJson: { options: ["Internet Protocol Television", "Internal Protocol TV", "Integrated Platform TV", "Internet Provider Television"] }, correctJson: { correctIndex: 0 }, points: 1 },
    { topicId: iptvTopicId, type: "single" as const, prompt: "Which protocol is commonly used for IPTV streaming?", dataJson: { options: ["HTTP", "RTSP", "FTP", "SMTP"] }, correctJson: { correctIndex: 1 }, points: 1 },
    { topicId: iptvTopicId, type: "multiple" as const, prompt: "Select all valid IPTV delivery methods:", dataJson: { options: ["Unicast", "Multicast", "Broadcast", "Anycast"] }, correctJson: { correctIndices: [0, 1] }, points: 2 },
    { topicId: iptvTopicId, type: "matching" as const, prompt: "Match the IPTV term with its definition:", dataJson: { left: ["STB", "EPG", "VOD"], right: ["Set-Top Box", "Electronic Program Guide", "Video on Demand"] }, correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }] }, points: 3 },
    { topicId: iptvTopicId, type: "ranking" as const, prompt: "Rank these IPTV setup steps in correct order:", dataJson: { items: ["Connect STB to network", "Configure network settings", "Authenticate with provider", "Start watching channels"] }, correctJson: { correctOrder: [0, 1, 2, 3] }, points: 2 },
    { topicId: iptvTopicId, type: "single" as const, prompt: "What is the typical bandwidth required for HD IPTV?", dataJson: { options: ["1 Mbps", "5 Mbps", "8-10 Mbps", "50 Mbps"] }, correctJson: { correctIndex: 2 }, points: 1 },
  ];

  const wifiQuestions = [
    { topicId: wifiTopicId, type: "single" as const, prompt: "What does WiFi stand for?", dataJson: { options: ["Wireless Fidelity", "Wired Fiber", "Wireless Fiber", "Wide Fidelity"] }, correctJson: { correctIndex: 0 }, points: 1 },
    { topicId: wifiTopicId, type: "single" as const, prompt: "Which frequency band provides faster speeds but shorter range?", dataJson: { options: ["2.4 GHz", "5 GHz", "900 MHz", "60 GHz"] }, correctJson: { correctIndex: 1 }, points: 1 },
    { topicId: wifiTopicId, type: "multiple" as const, prompt: "Select all valid WiFi security protocols:", dataJson: { options: ["WPA2", "WPA3", "WEP", "HTTP"] }, correctJson: { correctIndices: [0, 1, 2] }, points: 2 },
    { topicId: wifiTopicId, type: "matching" as const, prompt: "Match the WiFi standard with its maximum theoretical speed:", dataJson: { left: ["802.11n", "802.11ac", "802.11ax"], right: ["600 Mbps", "6.9 Gbps", "9.6 Gbps"] }, correctJson: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }] }, points: 3 },
    { topicId: wifiTopicId, type: "ranking" as const, prompt: "Rank WiFi security protocols from least to most secure:", dataJson: { items: ["WEP", "WPA", "WPA2", "WPA3"] }, correctJson: { correctOrder: [0, 1, 2, 3] }, points: 2 },
    { topicId: wifiTopicId, type: "single" as const, prompt: "What is the main advantage of mesh WiFi systems?", dataJson: { options: ["Lower cost", "Better coverage", "Higher speeds", "Less power consumption"] }, correctJson: { correctIndex: 1 }, points: 1 },
  ];

  for (const q of [...iptvQuestions, ...wifiQuestions]) {
    await db.insert(questions).values({ id: randomUUID(), ...q });
  }
}

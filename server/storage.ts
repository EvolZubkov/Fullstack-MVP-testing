/**
 * @module server/storage
 * @description Data access layer for the whole application. Exposes the
 * `IStorage` contract (the authoritative surface of all persistence
 * operations) and its `DatabaseStorage` implementation over Drizzle ORM +
 * PostgreSQL. Multi-step mutations run inside `db.transaction` so partial
 * writes cannot leak; `update*` methods whitelist writable columns to prevent
 * mass-assignment. Password hashing is delegated to the `server/utils/crypto`
 * seam (`hashPassword`/`verifyPassword`), keeping the DAL crypto-agnostic.
 * Routes depend only on `IStorage`, never on the concrete class.
 */
import { randomUUID } from "crypto";
import { eq, inArray, and, sql, desc } from "drizzle-orm";
import { db } from "./db";
import { UsersRepository } from "./storage/users-repository";
import { GroupsRepository } from "./storage/groups-repository";
import { AccessRepository } from "./storage/access-repository";
import { TopicsRepository } from "./storage/topics-repository";
import { QuestionsRepository } from "./storage/questions-repository";
import { ScormRepository } from "./storage/scorm-repository";
import { AdaptiveRepository } from "./storage/adaptive-repository";
import { AttemptsRepository } from "./storage/attempts-repository";
import {
  topics, tests, testSections, attempts, folders, testFolders,
  adaptiveTopicSettings, adaptiveLevels, adaptiveLevelLinks,
  testAssignments, passwordResetTokens, assignmentAccessTokens,
  contentPages, resultVariables, scales, questionMeasurements, testQuestionScoring,
  testAccessGrants, testSnapshots,
  type User, type InsertUser,
  type Folder, type InsertFolder,
  type TestFolder, type InsertTestFolder,
  type Topic, type InsertTopic,
  type TopicCourse,
  type TopicEvent,
  type Question, type InsertQuestion,
  type Test, type InsertTest,
  type TestSection,
  type Attempt, type InsertAttempt,
  type AdaptiveTopicSettings, type InsertAdaptiveTopicSettings,
  type AdaptiveLevel, type InsertAdaptiveLevel,
  type AdaptiveLevelLink, type InsertAdaptiveLevelLink,
  type ScormPackage, type InsertScormPackage,
  type ScormAttempt, type InsertScormAttempt,
  type ScormAnswer, type InsertScormAnswer,
  type Group, type InsertGroup,
  type UserGroup, type InsertUserGroup,
  type TestAccessGrant, type InsertTestAccessGrant,
  type TestSnapshot,
  type TopicAccessGrant,
  type TestAssignment, type InsertTestAssignment,
  type PasswordResetToken, type InsertPasswordResetToken,
  type AssignmentAccessToken, type InsertAssignmentAccessToken,
  type ContentPage, type InsertContentPage,
  type ResultVariable, type InsertResultVariable,
  type Scale, type InsertScale,
  type QuestionMeasurement, type InsertQuestionMeasurement,
  type TestQuestionScoring, type InsertTestQuestionScoring,
} from "@shared/schema";
import type { StoredRole } from "@shared/access";
import { validate, type ValidationResult, type ValueType } from "@shared/formula";

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

/**
 * Minimal projection of a test that depends on a topic/question (PRD-15
 * FR-03): enough for the 409 referential-protection payload and for the
 * draw-feasibility policy (published vs draft, adaptive vs standard).
 */
export interface TestUsageRef {
  id: string;
  title: string;
  ownerId: string | null;
  status: Test["status"];
  mode: Test["mode"];
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

  // User Roles (PRD-13 RBAC)
  getUserRoles(userId: string): Promise<StoredRole[]>;
  setUserRoles(userId: string, roles: StoredRole[], grantedBy?: string | null): Promise<void>;
  addUserRole(userId: string, role: StoredRole, grantedBy?: string | null): Promise<void>;
  removeUserRole(userId: string, role: StoredRole): Promise<void>;

  // Test access grants + owner (PRD-13 RBAC)
  setTestOwner(testId: string, ownerId: string | null): Promise<void>;
  getTestIdsByOwner(ownerId: string): Promise<string[]>;
  getTestAccessGrants(testId: string): Promise<TestAccessGrant[]>;
  getUserTestGrants(userId: string): Promise<TestAccessGrant[]>;
  getTestGrantForUser(testId: string, userId: string): Promise<TestAccessGrant | undefined>;
  upsertTestAccessGrant(grant: InsertTestAccessGrant): Promise<TestAccessGrant>;
  removeTestAccessGrant(testId: string, userId: string): Promise<boolean>;

  // "Where used" lookups (PRD-15 FR-03): tests depending on shared content.
  getTestsUsingTopic(topicId: string): Promise<TestUsageRef[]>;
  getTestsUsingQuestion(questionId: string): Promise<TestUsageRef[]>;

  // Publication snapshots (PRD-15 block B, FR-10/FR-17).
  createTestSnapshot(snapshot: {
    testId: string;
    version: number;
    contentJson: unknown;
    publishedBy: string | null;
  }): Promise<TestSnapshot>;
  getLatestSnapshot(testId: string): Promise<TestSnapshot | undefined>;
  getSnapshot(id: string): Promise<TestSnapshot | undefined>;
  getSnapshotsForTest(testId: string): Promise<TestSnapshot[]>;
  deleteSnapshotsForTest(testId: string): Promise<void>;
  /** Distinct snapshot ids still referenced by any attempt of the test (FR-17). */
  getReferencedSnapshotIds(testId: string): Promise<string[]>;
  deleteSnapshotById(id: string): Promise<void>;

  // Test Assignments
  getAssignment(id: string): Promise<TestAssignment | undefined>;
  getTestAssignments(testId: string): Promise<TestAssignment[]>;
  getUserAssignments(userId: string): Promise<TestAssignment[]>;
  isTestAssignedToUser(testId: string, userId: string): Promise<boolean>;
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
  /**
   * Deletes a content folder after relocating its topics and nested folders
   * to the given destination (`moveTo`, default `null` = root) — the
   * "Move contents" variant of the folder-delete dialog (s-folder-delete).
   * Folders carry no permissions, so no content-guard is needed.
   */
  deleteFolder(id: string, moveTo?: string | null): Promise<boolean>;
  /** IDs of the folder and all its descendants (including itself), BFS traversal. */
  getFolderSubtreeIds(id: string): Promise<string[]>;
  /** Deletes folder rows by id (the caller decides the fate of their contents). */
  deleteFoldersBulk(ids: string[]): Promise<number>;

  getTestFolders(): Promise<TestFolder[]>;
  createTestFolder(folder: InsertTestFolder): Promise<TestFolder>;
  updateTestFolder(id: string, updates: Partial<InsertTestFolder>): Promise<TestFolder | undefined>;
  /**
   * Deletes a folder after relocating all its tests and nested folders to the
   * given destination (`moveTo`, default `null` = root). This is the
   * "Folder only" variant from the prd7-tests-list.html wireframe
   * (s-folder-delete-a).
   */
  deleteTestFolder(id: string, moveTo?: string | null): Promise<boolean>;
  /**
   * Deletes a folder together with every test inside it (including transitively
   * through nested folders) and the nested folders themselves. Used for the
   * "Folder and all tests" variant (s-folder-delete-b), which requires typing
   * the exact name to confirm at the route-handler level.
   */
  deleteTestFolderCascade(id: string): Promise<boolean>;
  moveTestToFolder(testId: string, folderId: string | null): Promise<boolean>;

  getTopics(): Promise<Topic[]>;
  getTopic(id: string): Promise<Topic | undefined>;
  createTopic(topic: InsertTopic): Promise<Topic>;
  updateTopic(id: string, topic: Partial<InsertTopic>): Promise<Topic | undefined>;
  renameTopicInFormulas(topicId: string, oldName: string, newName: string): Promise<void>;
  deleteTopic(id: string): Promise<boolean>;
  deleteTopicsBulk(ids: string[]): Promise<number>;
  /** Bulk-moves topics into a folder (or to root when `null`). Organizational. */
  moveTopicsToFolder(ids: string[], folderId: string | null): Promise<number>;

  // PRD-15 block C: topic ownership + access grants (grantees are users, TD-01).
  setTopicOwner(topicId: string, ownerId: string | null): Promise<void>;
  setTopicVisibility(topicId: string, visibility: "private" | "shared"): Promise<void>;
  getTopicIdsByOwner(ownerId: string): Promise<string[]>;
  getSharedTopicIds(): Promise<string[]>;
  getTopicGrants(topicId: string): Promise<TopicAccessGrant[]>;
  getActiveTopicGrantsForGrantees(userId: string): Promise<TopicAccessGrant[]>;
  getTopicGrantForGrantee(topicId: string, granteeId: string): Promise<TopicAccessGrant | undefined>;
  upsertTopicGrant(grant: {
    topicId: string;
    granteeId: string;
    accessLevel: "use" | "manage";
    grantedBy: string | null;
  }): Promise<TopicAccessGrant>;
  setTopicGrantState(id: string, state: "active" | "revoked_in_use"): Promise<void>;
  removeTopicGrant(id: string): Promise<void>;
  /** Duplicate a topic and its questions; the copy is owned by `createdBy`. */
  duplicateTopicWithQuestions(id: string, createdBy?: string): Promise<{ topic: Topic; questions: Question[] } | undefined>;

  // TD-02 r.3: recommended courses/events are derived from topics.feedback_json
  // (write paths removed). Only the read accessors remain, kept for delivery.
  getTopicCourses(topicId: string): Promise<TopicCourse[]>;
  getTopicEvents(topicId: string): Promise<TopicEvent[]>;

  getQuestions(): Promise<Question[]>;
  getQuestionsByTopic(topicId: string): Promise<Question[]>;
  getTestSectionsByTopic(topicId: string): Promise<TestSection[]>;
  getMeasurementsForQuestions(questionIds: string[]): Promise<Array<{ testId: string; questionId: string }>>;
  getTopicPageRefs(topicId: string): Promise<Array<{ testId: string }>>;
  getContentHashesByTopic(topicId: string): Promise<Set<string>>;
  getQuestion(id: string): Promise<Question | undefined>;
  getQuestionsByIds(ids: string[]): Promise<Question[]>;
  createQuestion(question: InsertQuestion): Promise<Question>;
  updateQuestion(id: string, question: Partial<InsertQuestion>): Promise<Question | undefined>;
  deleteQuestion(id: string): Promise<boolean>;
  deleteQuestionsBulk(ids: string[]): Promise<number>;
  /** Duplicate a single question within its topic (prompt gets a « (копия)» suffix). */
  duplicateQuestion(id: string): Promise<Question | undefined>;

  getTests(): Promise<Test[]>;
  getTest(id: string): Promise<Test | undefined>;
  getMigrationHealth(): Promise<{ legacyStartPageCount: number }>;
  updateTest(id: string, test: Partial<InsertTest>): Promise<Test | undefined>;
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
  /** PRD-15 FR-14: annul (delete) all in-progress attempts of a test; returns the count. */
  annulInProgressAttempts(testId: string): Promise<number>;
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

  // PRD-2: user-defined result variables (result indicators).
  getResultVariables(testId: string): Promise<ResultVariable[]>;
  createResultVariable(rv: InsertResultVariable): Promise<ResultVariable>;
  updateResultVariable(id: string, updates: Partial<InsertResultVariable>): Promise<ResultVariable | undefined>;
  deleteResultVariable(id: string): Promise<boolean>;
  reorderResultVariables(updates: { id: string; sortOrder: number }[]): Promise<void>;
  validateResultVariableFormula(
    testId: string,
    formula: string,
    type: ValueType,
    opts?: { sortOrder?: number; excludeId?: string; extraScaleKeys?: string[]; extraVarNames?: string[] },
  ): Promise<ValidationResult>;
  // PRD-5: scales and per-question measurements.
  getScales(testId: string): Promise<Scale[]>;
  createScale(scale: InsertScale): Promise<Scale>;
  updateScale(id: string, updates: Partial<InsertScale>): Promise<Scale | undefined>;
  deleteScale(id: string): Promise<boolean>;
  reorderScales(updates: { id: string; sortOrder: number }[]): Promise<void>;
  getQuestionMeasurements(testId: string): Promise<QuestionMeasurement[]>;
  getQuestionMeasurementsByQuestion(testId: string, questionId: string): Promise<QuestionMeasurement[]>;
  upsertQuestionMeasurements(
    testId: string,
    questionId: string,
    rows: InsertQuestionMeasurement[],
  ): Promise<QuestionMeasurement[]>;
  // PRD-15 block D: per-(test, question) scoring overrides (FR-30).
  getTestQuestionScoring(testId: string): Promise<TestQuestionScoring[]>;
  upsertTestQuestionScoring(
    testId: string,
    questionId: string,
    values: Omit<InsertTestQuestionScoring, "testId" | "questionId">,
  ): Promise<TestQuestionScoring>;
  deleteTestQuestionScoring(testId: string, questionId: string): Promise<boolean>;
  replaceTestQuestionScoring(
    testId: string,
    rows: Omit<InsertTestQuestionScoring, "testId">[],
  ): Promise<TestQuestionScoring[]>;
}

export class DatabaseStorage implements IStorage {
  // Domain repositories behind the facade. The split is incremental: methods of
  // an extracted domain delegate here, the rest remain inline until migrated.
  private readonly usersRepo = new UsersRepository();
  private readonly groupsRepo = new GroupsRepository();
  private readonly accessRepo = new AccessRepository();
  private readonly topicsRepo = new TopicsRepository();
  private readonly questionsRepo = new QuestionsRepository();
  private readonly scormRepo = new ScormRepository();
  private readonly adaptiveRepo = new AdaptiveRepository();
  private readonly attemptsRepo = new AttemptsRepository();

  // ============================================
  // Users (delegated to UsersRepository)
  // ============================================

  getUser(id: string): Promise<User | undefined> {
    return this.usersRepo.getUser(id);
  }

  getUserByEmail(email: string): Promise<User | undefined> {
    return this.usersRepo.getUserByEmail(email);
  }

  createUser(insertUser: InsertUser & { createdBy?: string }): Promise<User> {
    return this.usersRepo.createUser(insertUser);
  }

  validatePassword(email: string, password: string): Promise<User | null> {
    return this.usersRepo.validatePassword(email, password);
  }

  updateUserLastLogin(id: string): Promise<void> {
    return this.usersRepo.updateUserLastLogin(id);
  }

  getUsers(): Promise<User[]> {
    return this.usersRepo.getUsers();
  }

  updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    return this.usersRepo.updateUser(id, data);
  }

  updateUserPassword(id: string, newPasswordHash: string): Promise<void> {
    return this.usersRepo.updateUserPassword(id, newPasswordHash);
  }

  deactivateUser(id: string): Promise<User | undefined> {
    return this.usersRepo.deactivateUser(id);
  }

  activateUser(id: string): Promise<User | undefined> {
    return this.usersRepo.activateUser(id);
  }

  // ============================================
  // Groups + membership (delegated to GroupsRepository)
  // ============================================

  getGroups(): Promise<Group[]> {
    return this.groupsRepo.getGroups();
  }

  getGroup(id: string): Promise<Group | undefined> {
    return this.groupsRepo.getGroup(id);
  }

  createGroup(group: InsertGroup & { createdBy?: string }): Promise<Group> {
    return this.groupsRepo.createGroup(group);
  }

  updateGroup(id: string, data: Partial<Group>): Promise<Group | undefined> {
    return this.groupsRepo.updateGroup(id, data);
  }

  deleteGroup(id: string): Promise<boolean> {
    return this.groupsRepo.deleteGroup(id);
  }

  getUserGroups(userId: string): Promise<Group[]> {
    return this.groupsRepo.getUserGroups(userId);
  }

  getGroupUsers(groupId: string): Promise<User[]> {
    return this.groupsRepo.getGroupUsers(groupId);
  }

  addUserToGroup(userId: string, groupId: string): Promise<UserGroup> {
    return this.groupsRepo.addUserToGroup(userId, groupId);
  }

  removeUserFromGroup(userId: string, groupId: string): Promise<boolean> {
    return this.groupsRepo.removeUserFromGroup(userId, groupId);
  }

  setUserGroups(userId: string, groupIds: string[]): Promise<void> {
    return this.groupsRepo.setUserGroups(userId, groupIds);
  }

  // ============================================
  // Access: roles + test/topic ownership & grants (delegated to AccessRepository)
  // ============================================

  getUserRoles(userId: string): Promise<StoredRole[]> {
    return this.accessRepo.getUserRoles(userId);
  }

  setUserRoles(userId: string, roles: StoredRole[], grantedBy: string | null = null): Promise<void> {
    return this.accessRepo.setUserRoles(userId, roles, grantedBy);
  }

  addUserRole(userId: string, role: StoredRole, grantedBy: string | null = null): Promise<void> {
    return this.accessRepo.addUserRole(userId, role, grantedBy);
  }

  removeUserRole(userId: string, role: StoredRole): Promise<void> {
    return this.accessRepo.removeUserRole(userId, role);
  }

  setTestOwner(testId: string, ownerId: string | null): Promise<void> {
    return this.accessRepo.setTestOwner(testId, ownerId);
  }

  getTestIdsByOwner(ownerId: string): Promise<string[]> {
    return this.accessRepo.getTestIdsByOwner(ownerId);
  }

  async getTestsUsingTopic(topicId: string): Promise<TestUsageRef[]> {
    return db
      .selectDistinct({
        id: tests.id,
        title: tests.title,
        ownerId: tests.ownerId,
        status: tests.status,
        mode: tests.mode,
      })
      .from(testSections)
      .innerJoin(tests, eq(testSections.testId, tests.id))
      .where(eq(testSections.topicId, topicId));
  }

  async getTestsUsingQuestion(questionId: string): Promise<TestUsageRef[]> {
    // A question is delivered through its topic's sections; scale contributions
    // (question_measurements) add direct per-test dependencies (PRD-5).
    const question = await this.questionsRepo.getQuestion(questionId);
    const byTopic = question ? await this.getTestsUsingTopic(question.topicId) : [];
    const viaMeasurements = await db
      .selectDistinct({
        id: tests.id,
        title: tests.title,
        ownerId: tests.ownerId,
        status: tests.status,
        mode: tests.mode,
      })
      .from(questionMeasurements)
      .innerJoin(tests, eq(questionMeasurements.testId, tests.id))
      .where(eq(questionMeasurements.questionId, questionId));
    const seen = new Map<string, TestUsageRef>();
    for (const ref of [...byTopic, ...viaMeasurements]) seen.set(ref.id, ref);
    return [...seen.values()];
  }

  async createTestSnapshot(snapshot: {
    testId: string;
    version: number;
    contentJson: unknown;
    publishedBy: string | null;
  }): Promise<TestSnapshot> {
    const [row] = await db
      .insert(testSnapshots)
      .values({
        id: randomUUID(),
        testId: snapshot.testId,
        version: snapshot.version,
        contentJson: snapshot.contentJson,
        publishedBy: snapshot.publishedBy,
      })
      .returning();
    return row;
  }

  async getLatestSnapshot(testId: string): Promise<TestSnapshot | undefined> {
    const [row] = await db
      .select()
      .from(testSnapshots)
      .where(eq(testSnapshots.testId, testId))
      .orderBy(desc(testSnapshots.version))
      .limit(1);
    return row || undefined;
  }

  async getSnapshot(id: string): Promise<TestSnapshot | undefined> {
    const [row] = await db.select().from(testSnapshots).where(eq(testSnapshots.id, id));
    return row || undefined;
  }

  async getSnapshotsForTest(testId: string): Promise<TestSnapshot[]> {
    return db
      .select()
      .from(testSnapshots)
      .where(eq(testSnapshots.testId, testId))
      .orderBy(desc(testSnapshots.version));
  }

  async deleteSnapshotsForTest(testId: string): Promise<void> {
    await db.delete(testSnapshots).where(eq(testSnapshots.testId, testId));
  }

  async getReferencedSnapshotIds(testId: string): Promise<string[]> {
    const rows = await db
      .selectDistinct({ snapshotId: attempts.snapshotId })
      .from(attempts)
      .where(and(eq(attempts.testId, testId), sql`${attempts.snapshotId} IS NOT NULL`));
    return rows.map((r) => r.snapshotId).filter((id): id is string => !!id);
  }

  async deleteSnapshotById(id: string): Promise<void> {
    await db.delete(testSnapshots).where(eq(testSnapshots.id, id));
  }

  getTestAccessGrants(testId: string): Promise<TestAccessGrant[]> {
    return this.accessRepo.getTestAccessGrants(testId);
  }

  getUserTestGrants(userId: string): Promise<TestAccessGrant[]> {
    return this.accessRepo.getUserTestGrants(userId);
  }

  getTestGrantForUser(testId: string, userId: string): Promise<TestAccessGrant | undefined> {
    return this.accessRepo.getTestGrantForUser(testId, userId);
  }

  upsertTestAccessGrant(grant: InsertTestAccessGrant): Promise<TestAccessGrant> {
    return this.accessRepo.upsertTestAccessGrant(grant);
  }

  removeTestAccessGrant(testId: string, userId: string): Promise<boolean> {
    return this.accessRepo.removeTestAccessGrant(testId, userId);
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

  async isTestAssignedToUser(testId: string, userId: string): Promise<boolean> {
    // Direct assignment first (cheapest), then via the user's groups.
    const [direct] = await db
      .select({ id: testAssignments.id })
      .from(testAssignments)
      .where(and(eq(testAssignments.testId, testId), eq(testAssignments.userId, userId)))
      .limit(1);
    if (direct) return true;
    const groupIds = (await this.groupsRepo.getUserGroups(userId)).map((g) => g.id);
    if (groupIds.length === 0) return false;
    const [viaGroup] = await db
      .select({ id: testAssignments.id })
      .from(testAssignments)
      .where(and(eq(testAssignments.testId, testId), inArray(testAssignments.groupId, groupIds)))
      .limit(1);
    return !!viaGroup;
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
    // Groups the user belongs to
    const userGroupsList = await this.groupsRepo.getUserGroups(userId);
    const groupIds = userGroupsList.map(g => g.id);

    // Assignments made directly to the user
    const directAssignments = await db
      .select({ testId: testAssignments.testId })
      .from(testAssignments)
      .where(eq(testAssignments.userId, userId));

    // Assignments made through groups
    let groupAssignments: { testId: string }[] = [];
    if (groupIds.length > 0) {
      groupAssignments = await db
        .select({ testId: testAssignments.testId })
        .from(testAssignments)
        .where(inArray(testAssignments.groupId, groupIds));
    }

    // Collect unique testIds
    const testIds = [...new Set([
      ...directAssignments.map(a => a.testId),
      ...groupAssignments.map(a => a.testId),
    ])];

    if (testIds.length === 0) {
      return [];
    }

    // Load the tests
    return db.select().from(tests).where(inArray(tests.id, testIds));
  }

  // ============================================
  // Password Reset Tokens
  // ============================================

  async createPasswordResetToken(userId: string, tokenHash: string, requestIp: string, ttlMs?: number): Promise<PasswordResetToken> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + (ttlMs ?? 30 * 60 * 1000)); // 30 minutes by default
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
      createdBy: folder.createdBy || null,
    }).returning();
    return newFolder;
  }

  async updateFolder(id: string, updates: Partial<InsertFolder>): Promise<Folder | undefined> {
    const [updated] = await db.update(folders).set(updates).where(eq(folders.id, id)).returning();
    return updated || undefined;
  }

  async deleteFolder(id: string, moveTo: string | null = null): Promise<boolean> {
    // "Folder only" mode: reparent the folder's topics and direct sub-folders to
    // the chosen destination (`moveTo`, default null = root), then drop the row —
    // as one unit. Purely organizational — folders carry no ownership.
    return db.transaction(async (tx) => {
      await tx.update(topics).set({ folderId: moveTo }).where(eq(topics.folderId, id));
      await tx.update(folders).set({ parentId: moveTo }).where(eq(folders.parentId, id));
      const result = await tx.delete(folders).where(eq(folders.id, id)).returning();
      return result.length > 0;
    });
  }

  async getFolderSubtreeIds(id: string): Promise<string[]> {
    const all = await db.select({ id: folders.id, parentId: folders.parentId }).from(folders);
    const childrenByParent = new Map<string | null, string[]>();
    for (const f of all) {
      const key = f.parentId ?? null;
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key)!.push(f.id);
    }
    const out: string[] = [];
    const queue: string[] = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      out.push(current);
      queue.push(...(childrenByParent.get(current) ?? []));
    }
    return out;
  }

  async deleteFoldersBulk(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await db.delete(folders).where(inArray(folders.id, ids)).returning();
    return result.length;
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
      createdBy: folder.createdBy || null,
    }).returning();
    return newFolder;
  }

  async updateTestFolder(id: string, updates: Partial<InsertTestFolder>): Promise<TestFolder | undefined> {
    const [updated] = await db.update(testFolders).set(updates).where(eq(testFolders.id, id)).returning();
    return updated || undefined;
  }

  async deleteTestFolder(id: string, moveTo: string | null = null): Promise<boolean> {
    // Move direct tests + reparent child folders to the destination, then drop
    // the row — as one unit (root by default).
    return db.transaction(async (tx) => {
      await tx.update(tests).set({ folderId: moveTo }).where(eq(tests.folderId, id));
      await tx.update(testFolders).set({ parentId: moveTo }).where(eq(testFolders.parentId, id));
      const result = await tx.delete(testFolders).where(eq(testFolders.id, id)).returning();
      return result.length > 0;
    });
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

    // Delete every test in any of those folders, then the folders — as one unit.
    // Adaptive children rows are assumed cleaned up by the route handler first.
    if (descendantIds.length > 0) {
      return db.transaction(async (tx) => {
        await tx.delete(tests).where(inArray(tests.folderId, descendantIds));
        const result = await tx.delete(testFolders).where(inArray(testFolders.id, descendantIds)).returning();
        return result.length > 0;
      });
    }
    return false;
  }

  async moveTestToFolder(testId: string, folderId: string | null): Promise<boolean> {
    const result = await db.update(tests).set({ folderId }).where(eq(tests.id, testId)).returning();
    return result.length > 0;
  }

  // ============================================
  // Topics (delegated to TopicsRepository)
  // ============================================

  getTopics(): Promise<Topic[]> {
    return this.topicsRepo.getTopics();
  }

  getTopic(id: string): Promise<Topic | undefined> {
    return this.topicsRepo.getTopic(id);
  }

  createTopic(topic: InsertTopic): Promise<Topic> {
    return this.topicsRepo.createTopic(topic);
  }

  updateTopic(id: string, updates: Partial<InsertTopic>): Promise<Topic | undefined> {
    return this.topicsRepo.updateTopic(id, updates);
  }

  renameTopicInFormulas(topicId: string, oldName: string, newName: string): Promise<void> {
    return this.topicsRepo.renameTopicInFormulas(topicId, oldName, newName);
  }

  // ─── Topic ownership and access grants (delegated to AccessRepository) ─────

  setTopicOwner(topicId: string, ownerId: string | null): Promise<void> {
    return this.accessRepo.setTopicOwner(topicId, ownerId);
  }

  setTopicVisibility(topicId: string, visibility: "private" | "shared"): Promise<void> {
    return this.accessRepo.setTopicVisibility(topicId, visibility);
  }

  getTopicIdsByOwner(ownerId: string): Promise<string[]> {
    return this.accessRepo.getTopicIdsByOwner(ownerId);
  }

  getSharedTopicIds(): Promise<string[]> {
    return this.accessRepo.getSharedTopicIds();
  }

  getTopicGrants(topicId: string): Promise<TopicAccessGrant[]> {
    return this.accessRepo.getTopicGrants(topicId);
  }

  getActiveTopicGrantsForGrantees(userId: string): Promise<TopicAccessGrant[]> {
    return this.accessRepo.getActiveTopicGrantsForGrantees(userId);
  }

  getTopicGrantForGrantee(topicId: string, granteeId: string): Promise<TopicAccessGrant | undefined> {
    return this.accessRepo.getTopicGrantForGrantee(topicId, granteeId);
  }

  upsertTopicGrant(grant: {
    topicId: string;
    granteeId: string;
    accessLevel: "use" | "manage";
    grantedBy: string | null;
  }): Promise<TopicAccessGrant> {
    return this.accessRepo.upsertTopicGrant(grant);
  }

  setTopicGrantState(id: string, state: "active" | "revoked_in_use"): Promise<void> {
    return this.accessRepo.setTopicGrantState(id, state);
  }

  removeTopicGrant(id: string): Promise<void> {
    return this.accessRepo.removeTopicGrant(id);
  }

  deleteTopic(id: string): Promise<boolean> {
    return this.topicsRepo.deleteTopic(id);
  }

  deleteTopicsBulk(ids: string[]): Promise<number> {
    return this.topicsRepo.deleteTopicsBulk(ids);
  }

  moveTopicsToFolder(ids: string[], folderId: string | null): Promise<number> {
    return this.topicsRepo.moveTopicsToFolder(ids, folderId);
  }

  getTopicCourses(topicId: string): Promise<TopicCourse[]> {
    return this.topicsRepo.getTopicCourses(topicId);
  }

  getTopicEvents(topicId: string): Promise<TopicEvent[]> {
    return this.topicsRepo.getTopicEvents(topicId);
  }

  // ============================================
  // Questions (delegated to QuestionsRepository)
  // ============================================

  getQuestions(): Promise<Question[]> {
    return this.questionsRepo.getQuestions();
  }

  getQuestionsByTopic(topicId: string): Promise<Question[]> {
    return this.questionsRepo.getQuestionsByTopic(topicId);
  }

  getContentHashesByTopic(topicId: string): Promise<Set<string>> {
    return this.questionsRepo.getContentHashesByTopic(topicId);
  }

  getQuestion(id: string): Promise<Question | undefined> {
    return this.questionsRepo.getQuestion(id);
  }

  getQuestionsByIds(ids: string[]): Promise<Question[]> {
    return this.questionsRepo.getQuestionsByIds(ids);
  }

  createQuestion(question: InsertQuestion): Promise<Question> {
    return this.questionsRepo.createQuestion(question);
  }

  duplicateQuestion(id: string): Promise<Question | undefined> {
    return this.questionsRepo.duplicateQuestion(id);
  }

  duplicateTopicWithQuestions(
    id: string,
    createdBy?: string,
  ): Promise<{ topic: Topic; questions: Question[] } | undefined> {
    return this.topicsRepo.duplicateTopicWithQuestions(id, createdBy);
  }

  updateQuestion(id: string, updates: Partial<InsertQuestion>): Promise<Question | undefined> {
    return this.questionsRepo.updateQuestion(id, updates);
  }

  deleteQuestion(id: string): Promise<boolean> {
    return this.questionsRepo.deleteQuestion(id);
  }

  deleteQuestionsBulk(ids: string[]): Promise<number> {
    return this.questionsRepo.deleteQuestionsBulk(ids);
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

  async updateTest(id: string, updates: Partial<InsertTest>): Promise<Test | undefined> {
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
      // Section writes go exclusively through TestSettingsService (the single
      // section writer). updateTest only patches the test row.
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

  /**
   * Delete a test and every row that has no meaning without it, atomically —
   * the single owner of test deletion (callers no longer clean up adaptive rows
   * themselves). FK ON DELETE CASCADE removes content_pages, scales,
   * result_variables, question_measurements and test_question_scoring when the
   * test row goes. SCORM packages/attempts/answers are deliberately KEPT:
   * `scorm_packages.testId` is nullable by design — the exported package outlives
   * the test in the LMS, so its telemetry is retained.
   */
  async deleteTest(id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      // Adaptive config: links carry no testId, so resolve them via their levels.
      await tx.delete(adaptiveLevelLinks).where(
        sql`${adaptiveLevelLinks.levelId} IN (SELECT ${adaptiveLevels.id} FROM ${adaptiveLevels} WHERE ${adaptiveLevels.testId} = ${id})`,
      );
      await tx.delete(adaptiveLevels).where(eq(adaptiveLevels.testId, id));
      await tx.delete(adaptiveTopicSettings).where(eq(adaptiveTopicSettings.testId, id));

      // Structural dependents.
      await tx.delete(testSections).where(eq(testSections.testId, id));
      await tx.delete(testAssignments).where(eq(testAssignments.testId, id));
      await tx.delete(testAccessGrants).where(eq(testAccessGrants.testId, id));

      // Delivery history. A hard delete is not restorable (archive is the
      // retention path), so attempts and snapshots go too. Attempts pin
      // snapshots, so drop attempts first.
      await tx.delete(attempts).where(eq(attempts.testId, id));
      await tx.delete(testSnapshots).where(eq(testSnapshots.testId, id));

      const result = await tx.delete(tests).where(eq(tests.id, id)).returning();
      return result.length > 0;
    });
  }

  async getTestSections(testId: string): Promise<TestSection[]> {
    return db
      .select()
      .from(testSections)
      .where(eq(testSections.testId, testId))
      .orderBy(testSections.sortOrder);
  }

  async getTestSectionsByTopic(topicId: string): Promise<TestSection[]> {
    return db.select().from(testSections).where(eq(testSections.topicId, topicId));
  }

  async getMeasurementsForQuestions(
    questionIds: string[],
  ): Promise<Array<{ testId: string; questionId: string }>> {
    if (questionIds.length === 0) return [];
    return db
      .select({ testId: questionMeasurements.testId, questionId: questionMeasurements.questionId })
      .from(questionMeasurements)
      .where(inArray(questionMeasurements.questionId, questionIds));
  }

  async getTopicPageRefs(topicId: string): Promise<Array<{ testId: string }>> {
    return db
      .select({ testId: contentPages.testId })
      .from(contentPages)
      .where(eq(contentPages.topicId, topicId));
  }

  // ============================================
  // Attempts (delegated to AttemptsRepository)
  // ============================================

  createAttempt(attempt: InsertAttempt): Promise<Attempt> {
    return this.attemptsRepo.createAttempt(attempt);
  }

  getAttempt(id: string): Promise<Attempt | undefined> {
    return this.attemptsRepo.getAttempt(id);
  }

  updateAttempt(id: string, updates: Partial<Attempt>): Promise<Attempt | undefined> {
    return this.attemptsRepo.updateAttempt(id, updates);
  }

  getAttemptsByUser(userId: string): Promise<Attempt[]> {
    return this.attemptsRepo.getAttemptsByUser(userId);
  }

  getAttemptsByUserAndTest(userId: string, testId: string): Promise<Attempt[]> {
    return this.attemptsRepo.getAttemptsByUserAndTest(userId, testId);
  }

  deleteAttemptsByUserAndTest(userId: string, testId: string): Promise<void> {
    return this.attemptsRepo.deleteAttemptsByUserAndTest(userId, testId);
  }

  annulInProgressAttempts(testId: string): Promise<number> {
    return this.attemptsRepo.annulInProgressAttempts(testId);
  }

  getAllAttempts(): Promise<Attempt[]> {
    return this.attemptsRepo.getAllAttempts();
  }

  // ============================================
  // Adaptive delivery (delegated to AdaptiveRepository)
  // ============================================

  getAdaptiveTopicSettings(testId: string, topicId: string): Promise<AdaptiveTopicSettings | undefined> {
    return this.adaptiveRepo.getAdaptiveTopicSettings(testId, topicId);
  }

  getAdaptiveTopicSettingsByTest(testId: string): Promise<AdaptiveTopicSettings[]> {
    return this.adaptiveRepo.getAdaptiveTopicSettingsByTest(testId);
  }

  createAdaptiveTopicSettings(settings: InsertAdaptiveTopicSettings): Promise<AdaptiveTopicSettings> {
    return this.adaptiveRepo.createAdaptiveTopicSettings(settings);
  }

  updateAdaptiveTopicSettings(id: string, settings: Partial<InsertAdaptiveTopicSettings>): Promise<AdaptiveTopicSettings | undefined> {
    return this.adaptiveRepo.updateAdaptiveTopicSettings(id, settings);
  }

  deleteAdaptiveTopicSettingsByTest(testId: string): Promise<void> {
    return this.adaptiveRepo.deleteAdaptiveTopicSettingsByTest(testId);
  }

  getAdaptiveLevels(testId: string, topicId: string): Promise<AdaptiveLevel[]> {
    return this.adaptiveRepo.getAdaptiveLevels(testId, topicId);
  }

  getAdaptiveLevelsByTest(testId: string): Promise<AdaptiveLevel[]> {
    return this.adaptiveRepo.getAdaptiveLevelsByTest(testId);
  }

  createAdaptiveLevel(level: InsertAdaptiveLevel): Promise<AdaptiveLevel> {
    return this.adaptiveRepo.createAdaptiveLevel(level);
  }

  updateAdaptiveLevel(id: string, level: Partial<InsertAdaptiveLevel>): Promise<AdaptiveLevel | undefined> {
    return this.adaptiveRepo.updateAdaptiveLevel(id, level);
  }

  deleteAdaptiveLevelsByTest(testId: string): Promise<void> {
    return this.adaptiveRepo.deleteAdaptiveLevelsByTest(testId);
  }

  getAdaptiveLevelLinks(levelId: string): Promise<AdaptiveLevelLink[]> {
    return this.adaptiveRepo.getAdaptiveLevelLinks(levelId);
  }

  createAdaptiveLevelLink(link: InsertAdaptiveLevelLink): Promise<AdaptiveLevelLink> {
    return this.adaptiveRepo.createAdaptiveLevelLink(link);
  }

  deleteAdaptiveLevelLinksByLevel(levelId: string): Promise<void> {
    return this.adaptiveRepo.deleteAdaptiveLevelLinksByLevel(levelId);
  }

  deleteAdaptiveLevelLinksByTest(testId: string): Promise<void> {
    return this.adaptiveRepo.deleteAdaptiveLevelLinksByTest(testId);
  }

  // ============================================
  // SCORM telemetry (delegated to ScormRepository)
  // ============================================

  createScormPackage(pkg: InsertScormPackage & { id: string }): Promise<ScormPackage> {
    return this.scormRepo.createScormPackage(pkg);
  }

  getScormPackage(id: string): Promise<ScormPackage | undefined> {
    return this.scormRepo.getScormPackage(id);
  }

  getScormPackagesByTest(testId: string): Promise<ScormPackage[]> {
    return this.scormRepo.getScormPackagesByTest(testId);
  }

  getScormPackages(): Promise<ScormPackage[]> {
    return this.scormRepo.getScormPackages();
  }

  updateScormPackage(id: string, data: Partial<ScormPackage>): Promise<ScormPackage | undefined> {
    return this.scormRepo.updateScormPackage(id, data);
  }

  createScormAttempt(attempt: InsertScormAttempt & { id: string }): Promise<ScormAttempt> {
    return this.scormRepo.createScormAttempt(attempt);
  }

  getScormAttempt(id: string): Promise<ScormAttempt | undefined> {
    return this.scormRepo.getScormAttempt(id);
  }

  getScormAttemptBySession(
    packageId: string,
    sessionId: string,
    attemptNumber?: number,
  ): Promise<ScormAttempt | undefined> {
    return this.scormRepo.getScormAttemptBySession(packageId, sessionId, attemptNumber);
  }

  getNextAttemptNumber(packageId: string, sessionId: string): Promise<number> {
    return this.scormRepo.getNextAttemptNumber(packageId, sessionId);
  }

  getScormAttemptsByPackage(packageId: string): Promise<ScormAttempt[]> {
    return this.scormRepo.getScormAttemptsByPackage(packageId);
  }

  updateScormAttempt(id: string, data: Partial<ScormAttempt>): Promise<ScormAttempt | undefined> {
    return this.scormRepo.updateScormAttempt(id, data);
  }

  getAllScormAttempts(): Promise<ScormAttempt[]> {
    return this.scormRepo.getAllScormAttempts();
  }

  createScormAnswer(answer: InsertScormAnswer & { id: string }): Promise<ScormAnswer> {
    return this.scormRepo.createScormAnswer(answer);
  }

  getScormAnswersByAttempt(attemptId: string): Promise<ScormAnswer[]> {
    return this.scormRepo.getScormAnswersByAttempt(attemptId);
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

  // ─── Result variables (PRD-2) ──────────────────────────────────────────────
  async getResultVariables(testId: string): Promise<ResultVariable[]> {
    return db.select().from(resultVariables)
      .where(eq(resultVariables.testId, testId))
      .orderBy(resultVariables.sortOrder);
  }

  async createResultVariable(rv: InsertResultVariable): Promise<ResultVariable> {
    const [created] = await db.insert(resultVariables).values(rv).returning();
    return created;
  }

  async updateResultVariable(id: string, updates: Partial<InsertResultVariable>): Promise<ResultVariable | undefined> {
    const [updated] = await db.update(resultVariables)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(resultVariables.id, id))
      .returning();
    return updated;
  }

  async deleteResultVariable(id: string): Promise<boolean> {
    const result = await db.delete(resultVariables).where(eq(resultVariables.id, id)).returning();
    return result.length > 0;
  }

  async reorderResultVariables(updates: { id: string; sortOrder: number }[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (const { id, sortOrder } of updates) {
        await tx.update(resultVariables)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(resultVariables.id, id));
      }
    });
  }

  /**
   * Validate a result-variable formula against a test's reference sets using the
   * shared DSL. `topicById` resolves to the test's topics; `var()` may reference
   * only variables with a smaller `sort_order` (DAG, scoring-model §10.9).
   * `scaleById`/`countScales` resolve against the test's scales (PRD-5, B2).
   */
  async validateResultVariableFormula(
    testId: string,
    formula: string,
    type: ValueType,
    opts: { sortOrder?: number; excludeId?: string; extraScaleKeys?: string[]; extraVarNames?: string[] } = {},
  ): Promise<ValidationResult> {
    const sections = await db.select().from(testSections).where(eq(testSections.testId, testId));
    const sectionTopicIds = sections.map((s) => s.topicId);
    // Valid `topicById` args = topic UUIDs plus their custom codes; `topicByName`
    // args = topic names.
    const topicRows = sectionTopicIds.length
      ? await db
          .select({ id: topics.id, name: topics.name, code: topics.code })
          .from(topics)
          .where(inArray(topics.id, sectionTopicIds))
      : [];
    const topicIds = new Set<string>(sectionTopicIds);
    const topicNames = new Set<string>();
    for (const t of topicRows) {
      if (t.code) topicIds.add(t.code);
      if (t.name) topicNames.add(t.name);
    }
    const existing = await this.getResultVariables(testId);
    const prior = existing.filter(
      (rv) => rv.id !== opts.excludeId && (opts.sortOrder === undefined || rv.sortOrder < opts.sortOrder),
    );
    // `extraScaleKeys`/`extraVarNames`: scales/variables defined in the SAME
    // workbook but not yet persisted (PRD-14 FR-15 dry-run, and a brand-new
    // target test). Without them, a formula referencing a fresh scale/variable
    // would falsely fail validation while the plan is computed without writes.
    const priorVarNames = new Set([...prior.map((rv) => rv.name), ...(opts.extraVarNames ?? [])]);
    const scaleRows = await db.select().from(scales).where(eq(scales.testId, testId));
    const scaleKeys = new Set([...scaleRows.map((s) => s.key), ...(opts.extraScaleKeys ?? [])]);
    return validate(formula, type, { topicIds, topicNames, priorVarNames, scaleKeys });
  }

  // ─── PRD-5: scales ──────────────────────────────────────────────────────────

  async getScales(testId: string): Promise<Scale[]> {
    return db.select().from(scales)
      .where(eq(scales.testId, testId))
      .orderBy(scales.sortOrder);
  }

  async createScale(scale: InsertScale): Promise<Scale> {
    const [created] = await db.insert(scales).values(scale).returning();
    return created;
  }

  async updateScale(id: string, updates: Partial<InsertScale>): Promise<Scale | undefined> {
    const [updated] = await db.update(scales)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(scales.id, id))
      .returning();
    return updated;
  }

  async deleteScale(id: string): Promise<boolean> {
    const result = await db.delete(scales).where(eq(scales.id, id)).returning();
    return result.length > 0;
  }

  async reorderScales(updates: { id: string; sortOrder: number }[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (const { id, sortOrder } of updates) {
        await tx.update(scales)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(scales.id, id));
      }
    });
  }

  // ─── PRD-5: per-question measurements ─────────────────────────────────────────

  async getQuestionMeasurements(testId: string): Promise<QuestionMeasurement[]> {
    return db.select().from(questionMeasurements)
      .where(eq(questionMeasurements.testId, testId))
      .orderBy(questionMeasurements.sortOrder);
  }

  async getQuestionMeasurementsByQuestion(
    testId: string,
    questionId: string,
  ): Promise<QuestionMeasurement[]> {
    return db.select().from(questionMeasurements)
      .where(and(
        eq(questionMeasurements.testId, testId),
        eq(questionMeasurements.questionId, questionId),
      ))
      .orderBy(questionMeasurements.sortOrder);
  }

  /**
   * Replace all measurements of one question in one test with `rows`
   * (delete-then-insert in a transaction). Returns the persisted rows. An empty
   * `rows` clears the question's contributions.
   */
  async upsertQuestionMeasurements(
    testId: string,
    questionId: string,
    rows: InsertQuestionMeasurement[],
  ): Promise<QuestionMeasurement[]> {
    return db.transaction(async (tx) => {
      await tx.delete(questionMeasurements).where(and(
        eq(questionMeasurements.testId, testId),
        eq(questionMeasurements.questionId, questionId),
      ));
      if (rows.length === 0) return [];
      return tx.insert(questionMeasurements)
        .values(rows.map((r) => ({ ...r, testId, questionId })))
        .returning();
    });
  }

  // ─── PRD-15 block D: per-(test, question) scoring overrides (FR-30) ──────────

  async getTestQuestionScoring(testId: string): Promise<TestQuestionScoring[]> {
    return db.select().from(testQuestionScoring)
      .where(eq(testQuestionScoring.testId, testId));
  }

  /**
   * Insert or update the single override row of one question in one test.
   * All value columns are replaced as a unit — a null/undefined value clears
   * that link of the chain.
   */
  async upsertTestQuestionScoring(
    testId: string,
    questionId: string,
    values: Omit<InsertTestQuestionScoring, "testId" | "questionId">,
  ): Promise<TestQuestionScoring> {
    const patch = {
      points: values.points ?? null,
      scoringJson: values.scoringJson ?? null,
      difficulty: values.difficulty ?? null,
      pinnedContentHash: values.pinnedContentHash ?? null,
    };
    const [row] = await db.insert(testQuestionScoring)
      .values({ testId, questionId, ...patch })
      .onConflictDoUpdate({
        target: [testQuestionScoring.testId, testQuestionScoring.questionId],
        set: { ...patch, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async deleteTestQuestionScoring(testId: string, questionId: string): Promise<boolean> {
    const result = await db.delete(testQuestionScoring)
      .where(and(
        eq(testQuestionScoring.testId, testId),
        eq(testQuestionScoring.questionId, questionId),
      ))
      .returning();
    return result.length > 0;
  }

  /**
   * Replace ALL scoring overrides of a test with `rows` (delete-then-insert in
   * a transaction) — the workbook «Оценка» sheet is authoritative for the
   * test's override set (PRD-14/PRD-15 FR-36 round-trip). An empty `rows`
   * clears every override.
   */
  async replaceTestQuestionScoring(
    testId: string,
    rows: Omit<InsertTestQuestionScoring, "testId">[],
  ): Promise<TestQuestionScoring[]> {
    return db.transaction(async (tx) => {
      await tx.delete(testQuestionScoring).where(eq(testQuestionScoring.testId, testId));
      if (rows.length === 0) return [];
      return tx.insert(testQuestionScoring)
        .values(rows.map((r) => ({ ...r, testId })))
        .returning();
    });
  }
}

export const storage = new DatabaseStorage();

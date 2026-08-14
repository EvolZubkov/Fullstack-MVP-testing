/**
 * @module server/storage
 * @description Data access layer for the whole application. Exposes the
 * `IStorage` contract (the authoritative surface of all persistence operations)
 * and its `DatabaseStorage` implementation. `DatabaseStorage` is a thin
 * delegating facade: every method forwards to a per-domain repository under
 * `server/storage/*` that owns the Drizzle ORM + PostgreSQL queries for its
 * aggregate (transactions, whitelisting, cascades and the crypto seam all live
 * in the repositories). This file holds no query logic of its own — it exists so
 * routes depend only on `IStorage`, never on the concrete repositories.
 */
import { UsersRepository } from "./storage/users-repository";
import { GroupsRepository } from "./storage/groups-repository";
import { AccessRepository } from "./storage/access-repository";
import { TopicsRepository, type TopicDeletionResult, type TopicsBulkDeletionResult } from "./storage/topics-repository";
import { QuestionsRepository } from "./storage/questions-repository";
import { ScormRepository } from "./storage/scorm-repository";
import { AdaptiveRepository } from "./storage/adaptive-repository";
import { AttemptsRepository } from "./storage/attempts-repository";
import { ScalesVariablesRepository } from "./storage/scales-variables-repository";
import { TestsRepository, type TestUsageRef } from "./storage/tests-repository";
import { ContentPagesRepository, type ContentPageBinding } from "./storage/content-pages-repository";
import { AssignmentsRepository } from "./storage/assignments-repository";
import { FoldersRepository } from "./storage/folders-repository";
import { MediaRepository, type MediaUsageRef } from "./storage/media-repository";
import {
  TestTransferRepository,
  type ImportWriteResult,
  type TransferWriteBatch,
  type TransferWriteCounts,
} from "./storage/test-transfer-repository";
// Type-only: `test-snapshot` imports this module at runtime, so a value import here
// would close the cycle.
import type { TestSnapshotContent } from "./services/test-snapshot";

export type { TestUsageRef };
export type { MediaUsageRef };
export type { TopicDeletionResult, TopicsBulkDeletionResult };
// Type-only imports: the facade names these in `IStorage` and its delegating
// method signatures. Table objects and query helpers live in the repositories.
import type {
  User, InsertUser,
  Folder, InsertFolder,
  TestFolder, InsertTestFolder,
  Topic, InsertTopic,
  TopicCourse,
  TopicEvent,
  Question, InsertQuestion,
  Test, InsertTest,
  TestSection,
  Attempt, InsertAttempt,
  AdaptiveTopicSettings, InsertAdaptiveTopicSettings,
  AdaptiveLevel, InsertAdaptiveLevel,
  AdaptiveLevelLink, InsertAdaptiveLevelLink,
  ScormPackage, InsertScormPackage,
  ScormAttempt, InsertScormAttempt,
  ScormAnswer, InsertScormAnswer,
  Group, InsertGroup,
  UserGroup,
  TestAccessGrant, InsertTestAccessGrant,
  TestSnapshot,
  TopicAccessGrant,
  TestAssignment, InsertTestAssignment,
  PasswordResetToken,
  AssignmentAccessToken,
  ContentPage, InsertContentPage,
  ResultVariable, InsertResultVariable,
  Scale, InsertScale,
  QuestionMeasurement, InsertQuestionMeasurement,
  TestQuestionScoring, InsertTestQuestionScoring,
  MediaAsset, InsertMediaAsset, MediaUsage, MediaEntityType,
} from "@shared/schema";
import type { StoredRole } from "@shared/access";
import { type ValidationResult, type ValueType } from "@shared/formula";

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
  /** PRD-28: clear the external-participant flag (one-way; see the repository). */
  promoteExternalUser(id: string): Promise<User | undefined>;

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
  /** Every snapshot in the database, for the media re-sync (Медиатека). */
  getAllSnapshots(): Promise<TestSnapshot[]>;
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
  /** PRD-25 FR-11: every assignment, for the home-page counters. */
  getAllAssignments(): Promise<TestAssignment[]>;
  createTestAssignment(assignment: InsertTestAssignment & { assignedBy: string }): Promise<TestAssignment>;
  deleteTestAssignment(id: string): Promise<boolean>;
  getAssignedTestsForUser(userId: string): Promise<Test[]>;
  /** PRD-31 §5.3: assignment a new attempt belongs to; null = implicit legacy bucket. */
  getCurrentAssignmentId(userId: string, testId: string): Promise<string | null>;

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
  deleteTopic(id: string): Promise<TopicDeletionResult>;
  deleteTopicsBulk(ids: string[]): Promise<TopicsBulkDeletionResult>;
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
  /** Question type + answer key of the given topics — input of `isMeasurementOnly`. */
  getGradingTraitsByTopics(
    topicIds: string[],
  ): Promise<Array<{ topicId: string; type: string; correctJson: unknown }>>;
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
  /**
   * PRD-15 FR-14: annul (delete) in-progress attempts of a test; returns the count.
   * `userId` narrows it to one learner (the start route drops its own abandoned run).
   */
  annulInProgressAttempts(testId: string, userId?: string): Promise<number>;
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
  /** PRD-22: variant bindings of many tests in ONE query (tests-list audit). */
  getContentPageBindings(testIds: string[]): Promise<ContentPageBinding[]>;
  getContentPages(testId: string): Promise<ContentPage[]>;
  /** Every content page across every test — the media re-sync's full-table read. */
  getAllContentPages(): Promise<ContentPage[]>;
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

  // Media library: asset registry (media_assets) and reverse usage index (media_usages).
  createMediaAsset(asset: Omit<InsertMediaAsset, "id">): Promise<MediaAsset>;
  getMediaAsset(id: string): Promise<MediaAsset | undefined>;
  getMediaAssetByStorageKey(storageKey: string): Promise<MediaAsset | undefined>;
  findMediaAssetByOwnerChecksum(ownerId: string | null, checksum: string): Promise<MediaAsset | undefined>;
  countMediaAssetsByChecksum(checksum: string): Promise<number>;
  listMediaAssetsByOwner(ownerId: string): Promise<MediaAsset[]>;
  deleteMediaAsset(id: string): Promise<boolean>;
  replaceMediaUsages(entityType: MediaEntityType, entityId: string, refs: MediaUsageRef[]): Promise<void>;
  getMediaUsagesByAsset(assetId: string): Promise<MediaUsage[]>;
  listOrphanMediaAssets(): Promise<MediaAsset[]>;
  deleteMediaUsagesExcept(entityType: MediaEntityType, keepIds: string[]): Promise<void>;

  // Перенос теста между инсталляциями (.tbtest): запись уже перенумерованного графа
  // одной транзакцией. Идентификаторы приходят готовыми — см. services/test-transfer/plan.
  writeImportedTest(content: TestSnapshotContent): Promise<ImportWriteResult>;
  applyTransferBatch(batch: TransferWriteBatch): Promise<TransferWriteCounts>;
  getAnsweredQuestionIds(testId: string): Promise<string[]>;
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
  private readonly scalesVariablesRepo = new ScalesVariablesRepository();
  private readonly testsRepo = new TestsRepository();
  private readonly contentPagesRepo = new ContentPagesRepository();
  private readonly assignmentsRepo = new AssignmentsRepository();
  private readonly foldersRepo = new FoldersRepository();
  private readonly mediaRepo = new MediaRepository();
  private readonly transferRepo = new TestTransferRepository();

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

  promoteExternalUser(id: string): Promise<User | undefined> {
    return this.usersRepo.promoteExternalUser(id);
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

  // ============================================
  // Test usage refs + snapshots (delegated to TestsRepository)
  // ============================================

  getTestsUsingTopic(topicId: string): Promise<TestUsageRef[]> {
    return this.testsRepo.getTestsUsingTopic(topicId);
  }

  getTestsUsingQuestion(questionId: string): Promise<TestUsageRef[]> {
    return this.testsRepo.getTestsUsingQuestion(questionId);
  }

  createTestSnapshot(snapshot: {
    testId: string;
    version: number;
    contentJson: unknown;
    publishedBy: string | null;
  }): Promise<TestSnapshot> {
    return this.testsRepo.createTestSnapshot(snapshot);
  }

  getLatestSnapshot(testId: string): Promise<TestSnapshot | undefined> {
    return this.testsRepo.getLatestSnapshot(testId);
  }

  getSnapshot(id: string): Promise<TestSnapshot | undefined> {
    return this.testsRepo.getSnapshot(id);
  }

  getSnapshotsForTest(testId: string): Promise<TestSnapshot[]> {
    return this.testsRepo.getSnapshotsForTest(testId);
  }

  getAllSnapshots(): Promise<TestSnapshot[]> {
    return this.testsRepo.getAllSnapshots();
  }

  deleteSnapshotsForTest(testId: string): Promise<void> {
    return this.testsRepo.deleteSnapshotsForTest(testId);
  }

  getReferencedSnapshotIds(testId: string): Promise<string[]> {
    return this.testsRepo.getReferencedSnapshotIds(testId);
  }

  deleteSnapshotById(id: string): Promise<void> {
    return this.testsRepo.deleteSnapshotById(id);
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
  // Test Assignments (delegated to AssignmentsRepository)
  // ============================================

  getAssignment(id: string): Promise<TestAssignment | undefined> {
    return this.assignmentsRepo.getAssignment(id);
  }

  getTestAssignments(testId: string): Promise<TestAssignment[]> {
    return this.assignmentsRepo.getTestAssignments(testId);
  }

  getUserAssignments(userId: string): Promise<TestAssignment[]> {
    return this.assignmentsRepo.getUserAssignments(userId);
  }

  getGroupAssignments(groupId: string): Promise<TestAssignment[]> {
    return this.assignmentsRepo.getGroupAssignments(groupId);
  }

  getAllAssignments(): Promise<TestAssignment[]> {
    return this.assignmentsRepo.getAllAssignments();
  }

  isTestAssignedToUser(testId: string, userId: string): Promise<boolean> {
    return this.assignmentsRepo.isTestAssignedToUser(testId, userId);
  }

  createTestAssignment(assignment: InsertTestAssignment & { assignedBy: string }): Promise<TestAssignment> {
    return this.assignmentsRepo.createTestAssignment(assignment);
  }

  deleteTestAssignment(id: string): Promise<boolean> {
    return this.assignmentsRepo.deleteTestAssignment(id);
  }

  getAssignedTestsForUser(userId: string): Promise<Test[]> {
    return this.assignmentsRepo.getAssignedTestsForUser(userId);
  }

  getCurrentAssignmentId(userId: string, testId: string): Promise<string | null> {
    return this.assignmentsRepo.getCurrentAssignmentId(userId, testId);
  }

  // ============================================
  // Password Reset Tokens (delegated to UsersRepository)
  // ============================================

  createPasswordResetToken(userId: string, tokenHash: string, requestIp: string, ttlMs?: number): Promise<PasswordResetToken> {
    return this.usersRepo.createPasswordResetToken(userId, tokenHash, requestIp, ttlMs);
  }

  getPasswordResetToken(tokenHash: string): Promise<PasswordResetToken | undefined> {
    return this.usersRepo.getPasswordResetToken(tokenHash);
  }

  markTokenAsUsed(id: string): Promise<void> {
    return this.usersRepo.markTokenAsUsed(id);
  }

  getRecentTokensCount(userId: string, hours: number): Promise<number> {
    return this.usersRepo.getRecentTokensCount(userId, hours);
  }

  // ── Assignment Access Tokens (magic links) (delegated to AssignmentsRepository) ─

  createAssignmentAccessToken(data: { assignmentId: string; userId: string; testId: string; tokenHash: string; expiresAt: Date }): Promise<AssignmentAccessToken> {
    return this.assignmentsRepo.createAssignmentAccessToken(data);
  }

  getAssignmentAccessToken(tokenHash: string): Promise<AssignmentAccessToken | undefined> {
    return this.assignmentsRepo.getAssignmentAccessToken(tokenHash);
  }

  getAssignmentAccessTokensByAssignment(assignmentId: string): Promise<AssignmentAccessToken[]> {
    return this.assignmentsRepo.getAssignmentAccessTokensByAssignment(assignmentId);
  }

  revokeAssignmentAccessToken(id: string): Promise<void> {
    return this.assignmentsRepo.revokeAssignmentAccessToken(id);
  }

  revokeAssignmentAccessTokensByAssignment(assignmentId: string): Promise<void> {
    return this.assignmentsRepo.revokeAssignmentAccessTokensByAssignment(assignmentId);
  }

  revokeAssignmentAccessTokensByAssignmentAndUser(assignmentId: string, userId: string): Promise<void> {
    return this.assignmentsRepo.revokeAssignmentAccessTokensByAssignmentAndUser(assignmentId, userId);
  }

  // ============================================
  // Folders: content + test trees (delegated to FoldersRepository)
  // ============================================

  getFolders(): Promise<Folder[]> {
    return this.foldersRepo.getFolders();
  }

  getFolder(id: string): Promise<Folder | undefined> {
    return this.foldersRepo.getFolder(id);
  }

  createFolder(folder: InsertFolder): Promise<Folder> {
    return this.foldersRepo.createFolder(folder);
  }

  updateFolder(id: string, updates: Partial<InsertFolder>): Promise<Folder | undefined> {
    return this.foldersRepo.updateFolder(id, updates);
  }

  deleteFolder(id: string, moveTo: string | null = null): Promise<boolean> {
    return this.foldersRepo.deleteFolder(id, moveTo);
  }

  getFolderSubtreeIds(id: string): Promise<string[]> {
    return this.foldersRepo.getFolderSubtreeIds(id);
  }

  deleteFoldersBulk(ids: string[]): Promise<number> {
    return this.foldersRepo.deleteFoldersBulk(ids);
  }

  getTestFolders(): Promise<TestFolder[]> {
    return this.foldersRepo.getTestFolders();
  }

  createTestFolder(folder: InsertTestFolder): Promise<TestFolder> {
    return this.foldersRepo.createTestFolder(folder);
  }

  updateTestFolder(id: string, updates: Partial<InsertTestFolder>): Promise<TestFolder | undefined> {
    return this.foldersRepo.updateTestFolder(id, updates);
  }

  deleteTestFolder(id: string, moveTo: string | null = null): Promise<boolean> {
    return this.foldersRepo.deleteTestFolder(id, moveTo);
  }

  deleteTestFolderCascade(id: string): Promise<boolean> {
    return this.foldersRepo.deleteTestFolderCascade(id);
  }

  moveTestToFolder(testId: string, folderId: string | null): Promise<boolean> {
    return this.foldersRepo.moveTestToFolder(testId, folderId);
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

  deleteTopic(id: string): Promise<TopicDeletionResult> {
    return this.topicsRepo.deleteTopic(id);
  }

  deleteTopicsBulk(ids: string[]): Promise<TopicsBulkDeletionResult> {
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

  getGradingTraitsByTopics(
    topicIds: string[],
  ): Promise<Array<{ topicId: string; type: string; correctJson: unknown }>> {
    return this.questionsRepo.getGradingTraitsByTopics(topicIds);
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

  // ============================================
  // Tests (delegated to TestsRepository)
  // ============================================

  getTests(): Promise<Test[]> {
    return this.testsRepo.getTests();
  }

  getTest(id: string): Promise<Test | undefined> {
    return this.testsRepo.getTest(id);
  }

  getMigrationHealth(): Promise<{ legacyStartPageCount: number }> {
    return this.testsRepo.getMigrationHealth();
  }

  updateTest(id: string, updates: Partial<InsertTest>): Promise<Test | undefined> {
    return this.testsRepo.updateTest(id, updates);
  }

  patchTestStatus(id: string, status: "draft" | "published" | "archived"): Promise<{ id: string; status: string; version: number } | undefined> {
    return this.testsRepo.patchTestStatus(id, status);
  }

  deleteTest(id: string): Promise<boolean> {
    return this.testsRepo.deleteTest(id);
  }

  getTestSections(testId: string): Promise<TestSection[]> {
    return this.testsRepo.getTestSections(testId);
  }

  getTestSectionsByTopic(topicId: string): Promise<TestSection[]> {
    return this.testsRepo.getTestSectionsByTopic(topicId);
  }

  getMeasurementsForQuestions(
    questionIds: string[],
  ): Promise<Array<{ testId: string; questionId: string }>> {
    return this.scalesVariablesRepo.getMeasurementsForQuestions(questionIds);
  }

  getTopicPageRefs(topicId: string): Promise<Array<{ testId: string }>> {
    return this.testsRepo.getTopicPageRefs(topicId);
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

  annulInProgressAttempts(testId: string, userId?: string): Promise<number> {
    return this.attemptsRepo.annulInProgressAttempts(testId, userId);
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
  // Content Pages (PRD-1) (delegated to ContentPagesRepository)
  // ============================================

  getContentPageBindings(testIds: string[]): Promise<ContentPageBinding[]> {
    return this.contentPagesRepo.getContentPageBindings(testIds);
  }

  getContentPages(testId: string): Promise<ContentPage[]> {
    return this.contentPagesRepo.getContentPages(testId);
  }

  getAllContentPages(): Promise<ContentPage[]> {
    return this.contentPagesRepo.getAllContentPages();
  }

  getContentPage(id: string): Promise<ContentPage | undefined> {
    return this.contentPagesRepo.getContentPage(id);
  }

  createContentPage(page: InsertContentPage): Promise<ContentPage> {
    return this.contentPagesRepo.createContentPage(page);
  }

  updateContentPage(id: string, updates: Partial<InsertContentPage>): Promise<ContentPage | undefined> {
    return this.contentPagesRepo.updateContentPage(id, updates);
  }

  deleteContentPage(id: string): Promise<boolean> {
    return this.contentPagesRepo.deleteContentPage(id);
  }

  reorderContentPages(updates: { id: string; sortOrder: number }[]): Promise<void> {
    return this.contentPagesRepo.reorderContentPages(updates);
  }

  // ============================================
  // Scales / result variables / scoring (delegated to ScalesVariablesRepository)
  // ============================================

  getResultVariables(testId: string): Promise<ResultVariable[]> {
    return this.scalesVariablesRepo.getResultVariables(testId);
  }

  createResultVariable(rv: InsertResultVariable): Promise<ResultVariable> {
    return this.scalesVariablesRepo.createResultVariable(rv);
  }

  updateResultVariable(id: string, updates: Partial<InsertResultVariable>): Promise<ResultVariable | undefined> {
    return this.scalesVariablesRepo.updateResultVariable(id, updates);
  }

  deleteResultVariable(id: string): Promise<boolean> {
    return this.scalesVariablesRepo.deleteResultVariable(id);
  }

  reorderResultVariables(updates: { id: string; sortOrder: number }[]): Promise<void> {
    return this.scalesVariablesRepo.reorderResultVariables(updates);
  }

  validateResultVariableFormula(
    testId: string,
    formula: string,
    type: ValueType,
    opts: { sortOrder?: number; excludeId?: string; extraScaleKeys?: string[]; extraVarNames?: string[] } = {},
  ): Promise<ValidationResult> {
    return this.scalesVariablesRepo.validateResultVariableFormula(testId, formula, type, opts);
  }

  getScales(testId: string): Promise<Scale[]> {
    return this.scalesVariablesRepo.getScales(testId);
  }

  createScale(scale: InsertScale): Promise<Scale> {
    return this.scalesVariablesRepo.createScale(scale);
  }

  updateScale(id: string, updates: Partial<InsertScale>): Promise<Scale | undefined> {
    return this.scalesVariablesRepo.updateScale(id, updates);
  }

  deleteScale(id: string): Promise<boolean> {
    return this.scalesVariablesRepo.deleteScale(id);
  }

  reorderScales(updates: { id: string; sortOrder: number }[]): Promise<void> {
    return this.scalesVariablesRepo.reorderScales(updates);
  }

  getQuestionMeasurements(testId: string): Promise<QuestionMeasurement[]> {
    return this.scalesVariablesRepo.getQuestionMeasurements(testId);
  }

  getQuestionMeasurementsByQuestion(testId: string, questionId: string): Promise<QuestionMeasurement[]> {
    return this.scalesVariablesRepo.getQuestionMeasurementsByQuestion(testId, questionId);
  }

  upsertQuestionMeasurements(
    testId: string,
    questionId: string,
    rows: InsertQuestionMeasurement[],
  ): Promise<QuestionMeasurement[]> {
    return this.scalesVariablesRepo.upsertQuestionMeasurements(testId, questionId, rows);
  }

  getTestQuestionScoring(testId: string): Promise<TestQuestionScoring[]> {
    return this.scalesVariablesRepo.getTestQuestionScoring(testId);
  }

  upsertTestQuestionScoring(
    testId: string,
    questionId: string,
    values: Omit<InsertTestQuestionScoring, "testId" | "questionId">,
  ): Promise<TestQuestionScoring> {
    return this.scalesVariablesRepo.upsertTestQuestionScoring(testId, questionId, values);
  }

  deleteTestQuestionScoring(testId: string, questionId: string): Promise<boolean> {
    return this.scalesVariablesRepo.deleteTestQuestionScoring(testId, questionId);
  }

  replaceTestQuestionScoring(
    testId: string,
    rows: Omit<InsertTestQuestionScoring, "testId">[],
  ): Promise<TestQuestionScoring[]> {
    return this.scalesVariablesRepo.replaceTestQuestionScoring(testId, rows);
  }

  // ============================================
  // Media library (delegated to MediaRepository)
  // ============================================

  createMediaAsset(asset: Omit<InsertMediaAsset, "id">): Promise<MediaAsset> {
    return this.mediaRepo.createAsset(asset);
  }

  getMediaAsset(id: string): Promise<MediaAsset | undefined> {
    return this.mediaRepo.getAsset(id);
  }

  getMediaAssetByStorageKey(storageKey: string): Promise<MediaAsset | undefined> {
    return this.mediaRepo.getAssetByStorageKey(storageKey);
  }

  findMediaAssetByOwnerChecksum(ownerId: string | null, checksum: string): Promise<MediaAsset | undefined> {
    return this.mediaRepo.findAssetByOwnerChecksum(ownerId, checksum);
  }

  countMediaAssetsByChecksum(checksum: string): Promise<number> {
    return this.mediaRepo.countAssetsByChecksum(checksum);
  }

  listMediaAssetsByOwner(ownerId: string): Promise<MediaAsset[]> {
    return this.mediaRepo.listAssetsByOwner(ownerId);
  }

  deleteMediaAsset(id: string): Promise<boolean> {
    return this.mediaRepo.deleteAsset(id);
  }

  replaceMediaUsages(entityType: MediaEntityType, entityId: string, refs: MediaUsageRef[]): Promise<void> {
    return this.mediaRepo.replaceUsages(entityType, entityId, refs);
  }

  getMediaUsagesByAsset(assetId: string): Promise<MediaUsage[]> {
    return this.mediaRepo.getUsagesByAsset(assetId);
  }

  listOrphanMediaAssets(): Promise<MediaAsset[]> {
    return this.mediaRepo.listOrphanAssets();
  }

  deleteMediaUsagesExcept(entityType: MediaEntityType, keepIds: string[]): Promise<void> {
    return this.mediaRepo.deleteUsagesExcept(entityType, keepIds);
  }

  writeImportedTest(content: TestSnapshotContent): Promise<ImportWriteResult> {
    return this.transferRepo.writeImportedTest(content);
  }

  applyTransferBatch(batch: TransferWriteBatch): Promise<TransferWriteCounts> {
    return this.transferRepo.applyTransferBatch(batch);
  }

  getAnsweredQuestionIds(testId: string): Promise<string[]> {
    return this.attemptsRepo.getAnsweredQuestionIds(testId);
  }
}

export const storage = new DatabaseStorage();

import { pgTable, varchar, text, integer, boolean, timestamp, jsonb, uniqueIndex, uuid, numeric } from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: text("email").notNull(), // Зашифрованный email
  emailHash: varchar("email_hash", { length: 64 }).unique(), // SHA-256 хеш для поиска
  passwordHash: text("password_hash").notNull(), // bcrypt hash
  name: text("name"), // заполняется при первом входе
  role: text("role", { enum: ["author", "learner"] }).notNull().default("learner"),
  status: text("status", { enum: ["pending", "active", "inactive"] }).notNull().default("pending"),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  gdprConsent: boolean("gdpr_consent").notNull().default(false),
  gdprConsentAt: timestamp("gdpr_consent_at"),
  lastLoginAt: timestamp("last_login_at"),
  expiresAt: timestamp("expires_at"), // срок действия учётки
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 36 }), // кто создал
});

// Группы пользователей
export const groups = pgTable("groups", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 36 }),
});

// Связь пользователей с группами (многие-ко-многим)
export const userGroups = pgTable("user_groups", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  groupId: varchar("group_id", { length: 36 }).notNull(),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (table) => ({
  userGroupIdx: uniqueIndex("user_groups_user_group_idx").on(table.userId, table.groupId),
}));

// Назначение тестов пользователям/группам
export const testAssignments = pgTable("test_assignments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }), // nullable - если назначено группе
  groupId: varchar("group_id", { length: 36 }), // nullable - если назначено пользователю
  dueDate: timestamp("due_date"), // срок выполнения
  linkExpiresAt: timestamp("link_expires_at"), // срок жизни magic link (если null → dueDate или +30 дней)
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  assignedBy: varchar("assigned_by", { length: 36 }).notNull(),
});

// Magic-link токены для доступа к тесту без пароля
export const assignmentAccessTokens = pgTable("assignment_access_tokens", {
  id: varchar("id", { length: 36 }).primaryKey(),
  assignmentId: varchar("assignment_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 от случайного токена
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"), // NULL = активен
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Токены сброса пароля
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  tokenHash: text("token_hash").notNull(), // HMAC-SHA256
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  requestIp: text("request_ip"),
});

export const folders = pgTable("folders", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  parentId: varchar("parent_id", { length: 36 }),
});

export const topics = pgTable("topics", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  feedback: text("feedback"),
  folderId: varchar("folder_id", { length: 36 }),
});

export const topicCourses = pgTable("topic_courses", {
  id: varchar("id", { length: 36 }).primaryKey(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
});

// Рекомендуемые мероприятия (офлайн: мастер-класс, лабораторная и т.д.)
export const topicEvents = pgTable("topic_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  title: text("title").notNull(),
});

export const questions = pgTable("questions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  type: text("type", { enum: ["single", "multiple", "matching", "ranking"] }).notNull(),
  prompt: text("prompt").notNull(),
  dataJson: jsonb("data_json").notNull(),
  correctJson: jsonb("correct_json").notNull(),
  points: integer("points").notNull().default(1),
  difficulty: integer("difficulty").notNull().default(50),
  mediaUrl: text("media_url"),
  mediaType: text("media_type", { enum: ["image", "audio", "video"] }),
  shuffleAnswers: boolean("shuffle_answers").notNull().default(true),
  feedback: text("feedback"),
  feedbackMode: text("feedback_mode", { enum: ["general", "conditional"] }).notNull().default("general"),
  feedbackCorrect: text("feedback_correct"),
  feedbackIncorrect: text("feedback_incorrect"),
  contentHash: text("content_hash"),
  // PRD-2 §8.2: tags feed result-variable aggregate formulas; chip input in the question card.
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
});

export const testFolders = pgTable("test_folders", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  parentId: varchar("parent_id", { length: 36 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tests = pgTable("tests", {
  id: varchar("id", { length: 36 }).primaryKey(),
  folderId: varchar("folder_id", { length: 36 }),
  title: text("title").notNull(),
  description: text("description"),
  mode: text("mode", { enum: ["standard", "adaptive"] }).notNull().default("standard"),
  showDifficultyLevel: boolean("show_difficulty_level").notNull().default(true),
  overallPassRuleJson: jsonb("overall_pass_rule_json").notNull(),
  webhookUrl: text("webhook_url"),
  /** @deprecated PRD-7: superseded by `status`. Kept for transitional backward compatibility; remove in a later release. */
  published: boolean("published").default(false),
  status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  feedback: text("feedback"),
  feedbackJson: jsonb("feedback_json"),
  flowPolicyJson: jsonb("flow_policy_json"),
  telemetryEnabled: boolean("telemetry_enabled").notNull().default(false),
  timeLimitMinutes: integer("time_limit_minutes"),
  maxAttempts: integer("max_attempts"),
  showCorrectAnswers: boolean("show_correct_answers").notNull().default(false),
  /** @deprecated PRD-7: replaced by `content_pages` row of type='intro' without topic_id. Kept for backward compatibility. */
  startPageContent: text("start_page_content"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  designSettingsJson: jsonb("design_settings_json").notNull().default({}),
});

export const testSections = pgTable("test_sections", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  drawCount: integer("draw_count").notNull(),
  topicPassRuleJson: jsonb("topic_pass_rule_json"),
  required: boolean("required").notNull().default(true),
  timeLimitMinutes: integer("time_limit_minutes"),
  feedbackJson: jsonb("feedback_json"),
  // PRD-7 S13.5 / G47: explicit author-controlled topic order. Persisted on
  // every save as the index of the topic in the editor's sections array, so
  // drag-reorder in Structure round-trips through getTestSections() ORDER BY.
  sortOrder: integer("sort_order").notNull().default(0),
});

export const adaptiveTopicSettings = pgTable("adaptive_topic_settings", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  failureFeedback: text("failure_feedback"),
});

export const adaptiveLevels = pgTable("adaptive_levels", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  levelIndex: integer("level_index").notNull(),
  levelName: text("level_name").notNull(),
  minDifficulty: integer("min_difficulty").notNull(),
  maxDifficulty: integer("max_difficulty").notNull(),
  questionsCount: integer("questions_count").notNull(),
  passThreshold: integer("pass_threshold").notNull(),
  passThresholdType: text("pass_threshold_type", { enum: ["percent", "absolute"] }).notNull().default("percent"),
  feedback: text("feedback"),
});

export const adaptiveLevelLinks = pgTable("adaptive_level_links", {
  id: varchar("id", { length: 36 }).primaryKey(),
  levelId: varchar("level_id", { length: 36 }).notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
});

export const attempts = pgTable("attempts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  testVersion: integer("test_version").notNull().default(1),
  variantJson: jsonb("variant_json").notNull(),
  answersJson: jsonb("answers_json"),
  resultJson: jsonb("result_json"),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
});

export const insertTestFolderSchema = createInsertSchema(testFolders).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertFolderSchema = createInsertSchema(folders).omit({ id: true });
export const insertTopicSchema = createInsertSchema(topics).omit({ id: true });
export const insertTopicCourseSchema = createInsertSchema(topicCourses).omit({ id: true });
export const insertTopicEventSchema = createInsertSchema(topicEvents).omit({ id: true });
export const insertQuestionSchema = createInsertSchema(questions).omit({ id: true });
export const insertTestSchema = createInsertSchema(tests).omit({ id: true });
export const insertTestSectionSchema = createInsertSchema(testSections).omit({ id: true });
export const insertAttemptSchema = createInsertSchema(attempts).omit({ id: true });

export const insertAdaptiveTopicSettingsSchema = createInsertSchema(adaptiveTopicSettings).omit({ id: true });
export const insertAdaptiveLevelSchema = createInsertSchema(adaptiveLevels).omit({ id: true });
export const insertAdaptiveLevelLinkSchema = createInsertSchema(adaptiveLevelLinks).omit({ id: true });
export const insertGroupSchema = createInsertSchema(groups).omit({ id: true });
export const insertUserGroupSchema = createInsertSchema(userGroups).omit({ id: true });
export const insertTestAssignmentSchema = createInsertSchema(testAssignments).omit({ id: true });
export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({ id: true });
export const insertAssignmentAccessTokenSchema = createInsertSchema(assignmentAccessTokens).omit({ id: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type Folder = typeof folders.$inferSelect;

export type InsertTestFolder = z.infer<typeof insertTestFolderSchema>;
export type TestFolder = typeof testFolders.$inferSelect;

export type InsertTopic = z.infer<typeof insertTopicSchema>;
export type Topic = typeof topics.$inferSelect;

export type InsertTopicCourse = z.infer<typeof insertTopicCourseSchema>;
export type TopicCourse = typeof topicCourses.$inferSelect;

export type InsertTopicEvent = z.infer<typeof insertTopicEventSchema>;
export type TopicEvent = typeof topicEvents.$inferSelect;

export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questions.$inferSelect;

export type InsertTest = z.infer<typeof insertTestSchema>;
export type Test = typeof tests.$inferSelect;

export type InsertTestSection = z.infer<typeof insertTestSectionSchema>;
export type TestSection = typeof testSections.$inferSelect;

export type InsertAttempt = z.infer<typeof insertAttemptSchema>;
export type Attempt = typeof attempts.$inferSelect;

export type InsertAdaptiveTopicSettings = z.infer<typeof insertAdaptiveTopicSettingsSchema>;
export type AdaptiveTopicSettings = typeof adaptiveTopicSettings.$inferSelect;

export type InsertAdaptiveLevel = z.infer<typeof insertAdaptiveLevelSchema>;
export type AdaptiveLevel = typeof adaptiveLevels.$inferSelect;

export type InsertAdaptiveLevelLink = z.infer<typeof insertAdaptiveLevelLinkSchema>;
export type AdaptiveLevelLink = typeof adaptiveLevelLinks.$inferSelect;

export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type Group = typeof groups.$inferSelect;

export type InsertUserGroup = z.infer<typeof insertUserGroupSchema>;
export type UserGroup = typeof userGroups.$inferSelect;

export type InsertTestAssignment = z.infer<typeof insertTestAssignmentSchema>;
export type TestAssignment = typeof testAssignments.$inferSelect;

export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export type InsertAssignmentAccessToken = z.infer<typeof insertAssignmentAccessTokenSchema>;
export type AssignmentAccessToken = typeof assignmentAccessTokens.$inferSelect;

export const passRuleSchema = z.object({
  type: z.enum(["percent", "absolute"]),
  value: z.number(),
});

export type PassRule = z.infer<typeof passRuleSchema>;

/**
 * Feedback structures (PRD-7 §3.4 / decisions.md §3.4, §3.5).
 *
 * The single jsonb column `tests.feedback_json` (and `test_sections.feedback_json`)
 * stores `format`, `text`, nested `links` and nested `assets`. Per decisions.md §3.4
 * there are NO separate `feedback_links_json` / `feedback_assets_json` columns — links
 * and assets are inlined.
 *
 * Default for legacy `feedback: string` (§4.3): `{ format: "plain", text, links: [], assets: [] }`.
 */
export const feedbackFormatSchema = z.enum(["plain", "richText", "html"]);

export const feedbackLinkSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
});

export const feedbackAssetSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.literal("application/pdf"),
  /** Filled by backend when the asset is persisted to SCORM (decisions.md §6.5). */
  scormHref: z.string().optional(),
});

export const feedbackContentSchema = z.object({
  format: feedbackFormatSchema,
  text: z.string(),
  links: z.array(feedbackLinkSchema).default([]),
  assets: z.array(feedbackAssetSchema).default([]),
});

export type FeedbackFormat = z.infer<typeof feedbackFormatSchema>;
export type FeedbackLink = z.infer<typeof feedbackLinkSchema>;
export type FeedbackAsset = z.infer<typeof feedbackAssetSchema>;
export type FeedbackContent = z.infer<typeof feedbackContentSchema>;

export const singleChoiceDataSchema = z.object({
  options: z.array(z.string()),
});

export const multipleChoiceDataSchema = z.object({
  options: z.array(z.string()),
});

export const matchingDataSchema = z.object({
  left: z.array(z.string()),
  right: z.array(z.string()),
});

export const rankingDataSchema = z.object({
  items: z.array(z.string()),
});

export const singleChoiceCorrectSchema = z.object({
  correctIndex: z.number(),
});

export const multipleChoiceCorrectSchema = z.object({
  correctIndices: z.array(z.number()),
});

export const matchingCorrectSchema = z.object({
  pairs: z.array(z.object({ left: z.number(), right: z.number() })),
});

export const rankingCorrectSchema = z.object({
  correctOrder: z.array(z.number()),
});

export type SingleChoiceData = z.infer<typeof singleChoiceDataSchema>;
export type MultipleChoiceData = z.infer<typeof multipleChoiceDataSchema>;
export type MatchingData = z.infer<typeof matchingDataSchema>;
export type RankingData = z.infer<typeof rankingDataSchema>;

export type SingleChoiceCorrect = z.infer<typeof singleChoiceCorrectSchema>;
export type MultipleChoiceCorrect = z.infer<typeof multipleChoiceCorrectSchema>;
export type MatchingCorrect = z.infer<typeof matchingCorrectSchema>;
export type RankingCorrect = z.infer<typeof rankingCorrectSchema>;

export const testVariantSchema = z.object({
  sections: z.array(z.object({
    topicId: z.string(),
    topicName: z.string(),
    questionIds: z.array(z.string()),
  })),
});

export type TestVariant = z.infer<typeof testVariantSchema>;

export const attemptAnswerSchema = z.record(z.string(), z.unknown());
export type AttemptAnswers = z.infer<typeof attemptAnswerSchema>;

export const topicResultSchema = z.object({
  topicId: z.string(),
  topicName: z.string(),
  correct: z.number(),
  total: z.number(),
  percent: z.number(),
  earnedPoints: z.number(),
  possiblePoints: z.number(),
  passed: z.boolean().nullable(),
  passRule: passRuleSchema.nullable(),
  recommendedCourses: z.array(z.object({ title: z.string(), url: z.string() })),
});

export const attemptResultSchema = z.object({
  totalCorrect: z.number(),
  totalQuestions: z.number(),
  overallPercent: z.number(),
  totalEarnedPoints: z.number(),
  totalPossiblePoints: z.number(),
  overallPassed: z.boolean(),
  topicResults: z.array(topicResultSchema),
});

export type TopicResult = z.infer<typeof topicResultSchema>;
export type AttemptResult = z.infer<typeof attemptResultSchema>;

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

export type LoginData = z.infer<typeof loginSchema>;

// === Adaptive Testing Types ===

// Adaptive variant - stores state of adaptive test attempt
export const adaptiveVariantSchema = z.object({
  mode: z.literal("adaptive"),
  topics: z.array(z.object({
    topicId: z.string(),
    topicName: z.string(),
    currentLevelIndex: z.number(),
    levelsState: z.array(z.object({
      levelIndex: z.number(),
      levelName: z.string(),
      minDifficulty: z.number(),
      maxDifficulty: z.number(),
      questionsCount: z.number(),
      passThreshold: z.number(),
      passThresholdType: z.enum(["percent", "absolute"]),
      questionIds: z.array(z.string()),
      answeredQuestionIds: z.array(z.string()),
      correctCount: z.number(),
      status: z.enum(["pending", "in_progress", "passed", "failed"]),
    })),
    finalLevelIndex: z.number().nullable(), // The level user achieved (or null if failed all)
    status: z.enum(["in_progress", "completed"]),
  })),
  currentTopicIndex: z.number(),
  currentQuestionId: z.string().nullable(),
});

export type AdaptiveVariant = z.infer<typeof adaptiveVariantSchema>;

export type AdaptiveLevelState = AdaptiveVariant["topics"][0]["levelsState"][0];
export type AdaptiveTopicState = AdaptiveVariant["topics"][0];

// Adaptive result extends standard result
export const adaptiveTopicResultSchema = z.object({
  topicId: z.string(),
  topicName: z.string(),
  achievedLevelIndex: z.number().nullable(),
  achievedLevelName: z.string().nullable(),
  levelPercent: z.number(), // Percent within achieved level
  totalQuestionsAnswered: z.number(),
  totalCorrect: z.number(),
  levelsAttempted: z.array(z.object({
    levelIndex: z.number(),
    levelName: z.string(),
    questionsAnswered: z.number(),
    correctCount: z.number(),
    status: z.enum(["passed", "failed"]),
  })),
  feedback: z.string().nullable(),
  recommendedLinks: z.array(z.object({ title: z.string(), url: z.string() })),
});

export const adaptiveAttemptResultSchema = z.object({
  mode: z.literal("adaptive"),
  overallPassed: z.boolean(),
  topicResults: z.array(adaptiveTopicResultSchema),
});

export type AdaptiveTopicResult = z.infer<typeof adaptiveTopicResultSchema>;
export type AdaptiveAttemptResult = z.infer<typeof adaptiveAttemptResultSchema>;

// Response from answer-adaptive endpoint
export const adaptiveAnswerResponseSchema = z.object({
  isCorrect: z.boolean(),
  correctAnswer: z.unknown().optional(), // Only if showCorrectAnswers is enabled
  feedback: z.string().nullable().optional(),
  nextQuestion: z.object({
    id: z.string(),
    question: z.unknown(), // Question object
    topicName: z.string(),
    levelName: z.string(),
    questionNumber: z.number(),
    totalInLevel: z.number(),
  }).nullable(), // null if test is finished
  levelTransition: z.object({
    type: z.enum(["up", "down", "complete"]),
    fromLevel: z.string(),
    toLevel: z.string().nullable(),
    message: z.string(),
  }).nullable(),
  topicTransition: z.object({
    fromTopic: z.string(),
    toTopic: z.string(),
  }).nullable(),
  isFinished: z.boolean(),
  result: adaptiveAttemptResultSchema.nullable(), // Only when isFinished is true
});

export type AdaptiveAnswerResponse = z.infer<typeof adaptiveAnswerResponseSchema>;

// ============================================
// Phase 5: Detailed Analytics Types
// Добавить в конец schema.ts
// ============================================

// Детальный ответ на вопрос (для хранения в resultJson)
export const detailedAnswerSchema = z.object({
  questionId: z.string(),
  questionPrompt: z.string(),
  questionType: z.enum(["single", "multiple", "matching", "ranking"]),
  topicId: z.string(),
  topicName: z.string(),
  userAnswer: z.unknown(),
  correctAnswer: z.unknown(),
  isCorrect: z.boolean(),
  earnedPoints: z.number(),
  possiblePoints: z.number(),
  answeredAt: z.string().optional(), // ISO timestamp
  // Для адаптивных тестов
  levelName: z.string().optional(),
  levelIndex: z.number().optional(),
  difficulty: z.number().optional(),
});

export type DetailedAnswer = z.infer<typeof detailedAnswerSchema>;

// Событие траектории адаптивного теста
export const adaptiveTrajectoryEventSchema = z.object({
  timestamp: z.string(),
  action: z.enum(["start", "answer", "level_up", "level_down", "topic_complete", "test_complete"]),
  topicId: z.string().optional(),
  topicName: z.string().optional(),
  levelIndex: z.number().optional(),
  levelName: z.string().optional(),
  questionId: z.string().optional(),
  isCorrect: z.boolean().optional(),
  message: z.string().optional(),
});

export type AdaptiveTrajectoryEvent = z.infer<typeof adaptiveTrajectoryEventSchema>;

// Расширенный результат с детализацией (для стандартных тестов)
export const detailedAttemptResultSchema = attemptResultSchema.extend({
  detailedAnswers: z.array(detailedAnswerSchema),
  duration: z.number().optional(), // Время прохождения в секундах
});

export type DetailedAttemptResult = z.infer<typeof detailedAttemptResultSchema>;

// Расширенный результат для адаптивных тестов
export const detailedAdaptiveResultSchema = adaptiveAttemptResultSchema.extend({
  detailedAnswers: z.array(detailedAnswerSchema),
  trajectory: z.array(adaptiveTrajectoryEventSchema),
  duration: z.number().optional(),
});

export type DetailedAdaptiveResult = z.infer<typeof detailedAdaptiveResultSchema>;

// ============================================
// Analytics API Response Types
// ============================================

// Статистика по уровню (для адаптивных тестов)
export const adaptiveLevelStatsSchema = z.object({
  levelIndex: z.number(),
  levelName: z.string(),
  topicId: z.string(),
  topicName: z.string(),
  achievedCount: z.number(), // Сколько пользователей достигло этого уровня как финального
  attemptedCount: z.number(), // Сколько пользователей проходило этот уровень
  passedCount: z.number(), // Сколько прошли этот уровень
  failedCount: z.number(), // Сколько провалили
  avgCorrectPercent: z.number(),
});

export type AdaptiveLevelStats = z.infer<typeof adaptiveLevelStatsSchema>;

// Статистика по вопросу
export const questionStatsSchema = z.object({
  questionId: z.string(),
  questionPrompt: z.string(),
  questionType: z.enum(["single", "multiple", "matching", "ranking"]),
  topicId: z.string(),
  topicName: z.string(),
  difficulty: z.number(),
  totalAnswers: z.number(),
  correctAnswers: z.number(),
  correctPercent: z.number(),
  avgTimeSeconds: z.number().optional(),
});

export type QuestionStats = z.infer<typeof questionStatsSchema>;

// Детальная аналитика по тесту
export const testAnalyticsSchema = z.object({
  testId: z.string(),
  testTitle: z.string(),
  testMode: z.enum(["standard", "adaptive"]),
  
  // Общая статистика
  summary: z.object({
    totalAttempts: z.number(),
    completedAttempts: z.number(),
    uniqueUsers: z.number(),
    avgPercent: z.number(),
    avgDuration: z.number().optional(), // в секундах
    passRate: z.number(),
    avgScore: z.number(),
    maxScore: z.number(),
  }),
  
  // Статистика по темам
  topicStats: z.array(z.object({
    topicId: z.string(),
    topicName: z.string(),
    totalAnswers: z.number(),
    correctAnswers: z.number(),
    avgPercent: z.number(),
    passRate: z.number().nullable(),
  })),
  
  // Статистика по вопросам
  questionStats: z.array(questionStatsSchema),
  
  // Для адаптивных тестов - статистика по уровням
  levelStats: z.array(adaptiveLevelStatsSchema).optional(),
  
  // Распределение результатов (для гистограммы)
  scoreDistribution: z.array(z.object({
    range: z.string(), // "0-10", "11-20", etc.
    count: z.number(),
  })),
  
  // Тренды по дням
  dailyTrends: z.array(z.object({
    date: z.string(),
    attempts: z.number(),
    avgPercent: z.number(),
    passRate: z.number(),
  })),
});

export type TestAnalytics = z.infer<typeof testAnalyticsSchema>;

// Элемент списка попыток
export const attemptListItemSchema = z.object({
  attemptId: z.string(),
  userId: z.string(),
  username: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  duration: z.number().nullable(), // в секундах
  overallPercent: z.number(),
  earnedPoints: z.number(),
  possiblePoints: z.number(),
  passed: z.boolean(),
  // Для адаптивных
  achievedLevels: z.array(z.object({
    topicName: z.string(),
    levelName: z.string().nullable(),
  })).optional(),
});

export type AttemptListItem = z.infer<typeof attemptListItemSchema>;

// Детализация попытки
export const attemptDetailSchema = z.object({
  attemptId: z.string(),
  userId: z.string(),
  username: z.string(),
  testId: z.string(),
  testTitle: z.string(),
  testMode: z.enum(["standard", "adaptive"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  duration: z.number().nullable(),
  
  // Результаты
  overallPercent: z.number(),
  earnedPoints: z.number(),
  possiblePoints: z.number(),
  passed: z.boolean(),
  
  // Детальные ответы
  answers: z.array(detailedAnswerSchema),
  
  // Результаты по темам
  topicResults: z.array(topicResultSchema).or(z.array(adaptiveTopicResultSchema)),
  
  // Для адаптивных - траектория
  trajectory: z.array(adaptiveTrajectoryEventSchema).optional(),
  achievedLevels: z.array(z.object({
    topicId: z.string(),
    topicName: z.string(),
    levelIndex: z.number().nullable(),
    levelName: z.string().nullable(),
  })).optional(),
});

export type AttemptDetail = z.infer<typeof attemptDetailSchema>;

// ============================================
// SCORM Telemetry Tables
// Добавить в конец schema.ts
// ============================================

export const scormPackages = pgTable("scorm_packages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }), // nullable - тест может быть удалён
  testTitle: text("test_title").notNull(),
  testMode: text("test_mode", { enum: ["standard", "adaptive"] }).notNull().default("standard"),
  secretKey: text("secret_key").notNull(),
  apiBaseUrl: text("api_base_url").notNull(),
  exportedAt: timestamp("exported_at").notNull(),
  createdBy: varchar("created_by", { length: 36 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const scormAttempts = pgTable("scorm_attempts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  packageId: varchar("package_id", { length: 36 }).notNull(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  
  // НОВОЕ: Номер попытки внутри сессии (1, 2, 3...)
  attemptNumber: integer("attempt_number").notNull().default(1),
  
  // Данные из LMS
  lmsUserId: text("lms_user_id"),
  lmsUserName: text("lms_user_name"),
  lmsUserEmail: text("lms_user_email"),
  lmsUserOrg: text("lms_user_org"),
  
  // Временные метки
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  lastActivityAt: timestamp("last_activity_at").notNull(),
  
  // Результаты
  resultPercent: integer("result_percent"),
  resultPassed: boolean("result_passed"),
  totalPoints: integer("total_points"),
  maxPoints: integer("max_points"),
  totalQuestions: integer("total_questions"),
  correctAnswers: integer("correct_answers"),
  
  // Для адаптивных тестов
  achievedLevelsJson: jsonb("achieved_levels_json"),
  
  // Рекомендованные курсы для проваленных тем
  failedTopicCoursesJson: jsonb("failed_topic_courses_json"),
}, (table) => ({
  // Уникальный индекс: одна комбинация package+session+attemptNumber
  sessionAttemptIdx: uniqueIndex("scorm_attempts_session_attempt_idx")
    .on(table.packageId, table.sessionId, table.attemptNumber),
}));

export const scormAnswers = pgTable("scorm_answers", {
  id: varchar("id", { length: 36 }).primaryKey(),
  attemptId: varchar("attempt_id", { length: 36 }).notNull(),
  
  // Данные вопроса
  questionId: varchar("question_id", { length: 36 }).notNull(),
  questionPrompt: text("question_prompt").notNull(),
  questionType: text("question_type", { enum: ["single", "multiple", "matching", "ranking"] }).notNull(),
  topicId: varchar("topic_id", { length: 36 }),
  topicName: text("topic_name"),
  difficulty: integer("difficulty"),
  
  // Ответ
  userAnswerJson: jsonb("user_answer_json").notNull(),
  correctAnswerJson: jsonb("correct_answer_json").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  points: integer("points").notNull(),
  maxPoints: integer("max_points").notNull(),
  
  // Варианты ответов для отображения в аналитике
  optionsJson: jsonb("options_json"),           // для single/multiple
  leftItemsJson: jsonb("left_items_json"),      // для matching
  rightItemsJson: jsonb("right_items_json"),    // для matching
  itemsJson: jsonb("items_json"),               // для ranking
  
  // Для адаптивных
  levelIndex: integer("level_index"),
  levelName: text("level_name"),
  
  answeredAt: timestamp("answered_at").notNull(),
});

// ============================================
// Templates & Content Pages (PRD-1)
// ============================================

export const templates = pgTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull(),
  templateApiVersion: text("template_api_version").notNull().default("1.0"),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  manifest: jsonb("manifest").notNull(),
  previewPath: text("preview_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const contentPages = pgTable("content_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: varchar("test_id", { length: 36 }).notNull().references(() => tests.id, { onDelete: "cascade" }),
  // PRD-7 §4.2: nullable topicId allows test-scope pages (position 'before'/'after',
  // i.e. the «До теста» / «После теста» zones in linear_flat); topic-scoped pages
  // use 'before_topic'/'after_topic' with a topicId.
  topicId: varchar("topic_id", { length: 36 }).references(() => topics.id),
  position: text("position", { enum: ["before", "after", "before_topic", "after_topic"] }).notNull(),
  mode: text("mode", { enum: ["template", "standard", "html"] }).notNull().default("template"),
  /** @deprecated Use `kind` instead. Kept for backward compat in this release. */
  type: text("type", { enum: ["intro", "info", "summary", "html"] }).notNull(),
  /** PRD-1 §4.3: variant-binding kind. Drives lifecycle of system pages. */
  kind: text("kind", { enum: ["questions", "router", "summary", "intro", "info"] }).notNull(),
  templateKey: text("template_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  valuesJson: jsonb("values_json").notNull().default({}),
  autoAdvance: boolean("auto_advance").notNull().default(false),
  autoAdvanceDelayMs: integer("auto_advance_delay_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Insert schemas
export const insertScormPackageSchema = createInsertSchema(scormPackages).omit({ id: true });
export const insertScormAttemptSchema = createInsertSchema(scormAttempts).omit({ id: true });
export const insertScormAnswerSchema = createInsertSchema(scormAnswers).omit({ id: true });

// Types
export type InsertScormPackage = z.infer<typeof insertScormPackageSchema>;
export type ScormPackage = typeof scormPackages.$inferSelect;

export type InsertScormAttempt = z.infer<typeof insertScormAttemptSchema>;
export type ScormAttempt = typeof scormAttempts.$inferSelect;

export type InsertScormAnswer = z.infer<typeof insertScormAnswerSchema>;
export type ScormAnswer = typeof scormAnswers.$inferSelect;

// Templates & Content Pages types (PRD-1)

/**
 * PRD-1 §4.3: variant.kind — functional role of a template variant.
 * Drives variant binding rules in PRD-7 §1.4 (silent binding for system kinds).
 */
export const variantKindSchema = z.enum(["questions", "router", "summary", "intro", "info"]);
export type VariantKind = z.infer<typeof variantKindSchema>;

/**
 * Single entry in `manifest.contentTemplates[]`. Schema is intentionally narrow:
 * it locks the variant-binding contract (key/label/kind) and lets template-specific
 * shape (placeholders, pageKind, textFit, etc.) pass through unchanged.
 */
export const contentTemplateEntrySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: variantKindSchema,
  pageKind: z.string().optional(),
  isDefault: z.boolean().optional(),
  placeholders: z.array(z.unknown()).optional(),
}).passthrough();

/**
 * Top-level SCORM template manifest contract relevant to the variant-binding system.
 * Other fields (params, layouts, capabilities, preview, etc.) pass through and
 * are validated by adjacent specs (spec-template-platform.md).
 */
export const templateManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  templateApiVersion: z.string().min(1),
  contentTemplates: z.array(contentTemplateEntrySchema).min(1),
}).passthrough();

/**
 * PRD-1 §4.3.2 / PRD-7 §1.4: the built-in `default` template is the system-wide
 * fallback for every system variant kind. When another template omits a variant
 * of a system kind, `bindSystemVariant()` falls back to the default — so the
 * default itself must declare each system kind, otherwise reconcile silently
 * fails to materialize the corresponding `content_pages` row (G48 2026-05-28).
 *
 * System kinds: `intro`, `summary`, `router`, `questions`. The user kind `info`
 * is author-created and not lifecycle-managed.
 */
const REQUIRED_DEFAULT_VARIANT_KINDS = ["intro", "summary", "router", "questions"] as const;

export const defaultTemplateManifestSchema = templateManifestSchema.superRefine((m, ctx) => {
  const declared = new Set(m.contentTemplates.map((ct) => ct.kind));
  for (const required of REQUIRED_DEFAULT_VARIANT_KINDS) {
    if (!declared.has(required)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Default template must declare at least one contentTemplate with kind: "${required}"`,
        path: ["contentTemplates"],
      });
    }
  }
});

export type TemplateManifest = z.infer<typeof templateManifestSchema>;

export const designSettingsSchema = z.object({
  templateId: z.string(),
  templateVersion: z.string(),
  templateApiVersion: z.string(),
  params: z.record(z.string(), z.unknown()),
});

export type DesignSettings = z.infer<typeof designSettingsSchema>;

export const contentPageValuesSchema = z.object({
  values: z.record(z.string(), z.unknown()).default({}),
  placeholderStyles: z.record(z.string(), z.object({ fontSize: z.number() })).optional(),
});

export type ContentPageValues = z.infer<typeof contentPageValuesSchema>;

export const insertTemplateSchema = createInsertSchema(templates).omit({ createdAt: true, updatedAt: true });
export const insertContentPageSchema = createInsertSchema(contentPages).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templates.$inferSelect;

export type InsertContentPage = z.infer<typeof insertContentPageSchema>;
export type ContentPage = typeof contentPages.$inferSelect;

// PRD-2: user-defined result variables (показатели результата). Test-scoped,
// formula-driven values published to result.* at completion. See migration 008
// for the name-regex CHECK and the partial unique indexes that enforce at most
// one success / one completion controller per test.
export const resultVariables = pgTable("result_variables", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: varchar("test_id", { length: 36 }).notNull().references(() => tests.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  label: text("label").notNull(),
  type: text("type", { enum: ["boolean", "number", "string"] }).notNull(),
  formula: text("formula").notNull(),
  showToLearner: boolean("show_to_learner").notNull().default(false),
  scormTarget: text("scorm_target", { enum: ["interaction", "suspend_data", "both", "none"] }).notNull().default("both"),
  controlsStatus: text("controls_status", { enum: ["none", "success", "completion"] }).notNull().default("none"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertResultVariableSchema = createInsertSchema(resultVariables)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/, "name: начинается с буквы; строчные/цифры/подчёркивание; до 64 символов"),
    label: z.string().min(1).max(120),
  });

export type InsertResultVariable = z.infer<typeof insertResultVariableSchema>;
export type ResultVariable = typeof resultVariables.$inferSelect;

// PRD-5: measurement scales (шкалы). Test-scoped named aggregates of explicit
// per-question contributions, normalized (with optional inversion) and banded.
// Published to scale.* before result.* at completion. See migration 009 for the
// key-regex CHECK and the enum CHECKs.
export const scales = pgTable("scales", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: varchar("test_id", { length: 36 }).notNull().references(() => tests.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  type: text("type", { enum: ["number", "boolean", "category", "level"] }).notNull(),
  aggregation: text("aggregation", { enum: ["sum", "avg", "weighted_avg", "max", "min"] }).notNull().default("sum"),
  normalization: text("normalization", { enum: ["none", "percent", "custom"] }).notNull().default("none"),
  direction: text("direction", { enum: ["positive", "inverse"] }).notNull().default("positive"),
  configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
  showToLearner: boolean("show_to_learner").notNull().default(false),
  scormTarget: text("scorm_target", { enum: ["none", "suspend_data", "interaction", "both"] }).notNull().default("none"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertScaleSchema = createInsertSchema(scales)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/, "key: начинается с буквы; строчные/цифры/подчёркивание; до 64 символов"),
    label: z.string().min(1).max(120),
  });

export type InsertScale = z.infer<typeof insertScaleSchema>;
export type Scale = typeof scales.$inferSelect;

// PRD-5: explicit contribution of one question unit (whole question / option /
// matching pair / ranking position) into one scale. `value_json` is the explicit
// numeric contribution (0 and negatives valid); correctness is orthogonal.
export const questionMeasurements = pgTable("question_measurements", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: varchar("test_id", { length: 36 }).notNull().references(() => tests.id, { onDelete: "cascade" }),
  questionId: varchar("question_id", { length: 36 }).notNull().references(() => questions.id, { onDelete: "cascade" }),
  scaleId: uuid("scale_id").notNull().references(() => scales.id, { onDelete: "cascade" }),
  sourceType: text("source_type", { enum: ["question", "option", "matching_pair", "ranking_position"] }).notNull(),
  sourceKey: text("source_key"),
  valueJson: jsonb("value_json").$type<number>().notNull(),
  weight: numeric("weight").notNull().default("1"),
  conditionJson: jsonb("condition_json").$type<Record<string, unknown> | null>(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertQuestionMeasurementSchema = createInsertSchema(questionMeasurements)
  .omit({ id: true, createdAt: true, updatedAt: true });

export type InsertQuestionMeasurement = z.infer<typeof insertQuestionMeasurementSchema>;
export type QuestionMeasurement = typeof questionMeasurements.$inferSelect;
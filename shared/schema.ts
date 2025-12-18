import { pgTable, text, varchar, integer, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role", { enum: ["author", "learner"] }).notNull().default("learner"),
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

export const questions = pgTable("questions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  type: text("type", { enum: ["single", "multiple", "matching", "ranking"] }).notNull(),
  prompt: text("prompt").notNull(),
  dataJson: jsonb("data_json").notNull(),
  correctJson: jsonb("correct_json").notNull(),
  points: integer("points").notNull().default(1),
  mediaUrl: text("media_url"),
  mediaType: text("media_type", { enum: ["image", "audio", "video"] }),
  shuffleAnswers: boolean("shuffle_answers").notNull().default(true),
  feedback: text("feedback"),
  feedbackMode: text("feedback_mode", { enum: ["general", "conditional"] }).notNull().default("general"),
  feedbackCorrect: text("feedback_correct"),
  feedbackIncorrect: text("feedback_incorrect"),
});

export const tests = pgTable("tests", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  overallPassRuleJson: jsonb("overall_pass_rule_json").notNull(),
  webhookUrl: text("webhook_url"),
  published: boolean("published").default(false),
  version: integer("version").notNull().default(1),
  feedback: text("feedback"),
  timeLimitMinutes: integer("time_limit_minutes"),
  maxAttempts: integer("max_attempts"),
  showCorrectAnswers: boolean("show_correct_answers").notNull().default(false),
  startPageContent: text("start_page_content"),
});

export const testSections = pgTable("test_sections", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  drawCount: integer("draw_count").notNull(),
  topicPassRuleJson: jsonb("topic_pass_rule_json"),
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

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertFolderSchema = createInsertSchema(folders).omit({ id: true });
export const insertTopicSchema = createInsertSchema(topics).omit({ id: true });
export const insertTopicCourseSchema = createInsertSchema(topicCourses).omit({ id: true });
export const insertQuestionSchema = createInsertSchema(questions).omit({ id: true });
export const insertTestSchema = createInsertSchema(tests).omit({ id: true });
export const insertTestSectionSchema = createInsertSchema(testSections).omit({ id: true });
export const insertAttemptSchema = createInsertSchema(attempts).omit({ id: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type Folder = typeof folders.$inferSelect;

export type InsertTopic = z.infer<typeof insertTopicSchema>;
export type Topic = typeof topics.$inferSelect;

export type InsertTopicCourse = z.infer<typeof insertTopicCourseSchema>;
export type TopicCourse = typeof topicCourses.$inferSelect;

export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questions.$inferSelect;

export type InsertTest = z.infer<typeof insertTestSchema>;
export type Test = typeof tests.$inferSelect;

export type InsertTestSection = z.infer<typeof insertTestSectionSchema>;
export type TestSection = typeof testSections.$inferSelect;

export type InsertAttempt = z.infer<typeof insertAttemptSchema>;
export type Attempt = typeof attempts.$inferSelect;

export const passRuleSchema = z.object({
  type: z.enum(["percent", "absolute"]),
  value: z.number(),
});

export type PassRule = z.infer<typeof passRuleSchema>;

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
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginData = z.infer<typeof loginSchema>;

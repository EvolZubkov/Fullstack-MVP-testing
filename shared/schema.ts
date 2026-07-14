import { pgTable, varchar, text, integer, boolean, timestamp, jsonb, uniqueIndex, index, uuid, real } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { normalizeTag, normalizeTags, TAG_MAX_LENGTH } from "./tags";
import { STORED_ROLES } from "./access/roles";

export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: text("email").notNull(), // Зашифрованный email
  emailHash: varchar("email_hash", { length: 64 }).unique(), // SHA-256 хеш для поиска
  passwordHash: text("password_hash").notNull(), // bcrypt hash
  name: text("name"), // заполняется при первом входе
  // PRD-13 (T-10): the legacy single `role` column was dropped — roles live in
  // `user_roles` (many-to-many) plus the configuration-derived superadmin.
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

/**
 * PRD-13 RBAC: a user holds a SET of roles (many-to-many). Effective permissions
 * are the union over these roles plus the configuration-derived superadmin. The
 * `superadmin` role is never stored here. This is the sole source of stored roles —
 * the legacy `users.role` column was dropped in migration 017 (T-10).
 */
export const userRoles = pgTable("user_roles", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  role: text("role", { enum: STORED_ROLES }).notNull(),
  grantedBy: varchar("granted_by", { length: 36 }), // who assigned this role
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
}, (table) => ({
  userRoleIdx: uniqueIndex("user_roles_user_role_idx").on(table.userId, table.role),
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
  // PRD-15 FR-01: creation audit. NULL = legacy row (destructive ops admin-only).
  createdBy: varchar("created_by", { length: 36 }),
});

export const topics = pgTable("topics", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  feedback: text("feedback"),
  // TD-02 (additive, variant A): rich topic feedback mirroring tests/sections
  // `feedback_json` ({ format, text, links (courses), assets (PDF), events }).
  // Backfilled from the legacy `feedback` text + topic_courses + topic_events by
  // migration 023. Delivery readers (web results, SCORM, snapshots) still source
  // the legacy tables until r.3; this column backs the unified topic feedback
  // editor (T-32 Drawer). NULL = not yet backfilled.
  feedbackJson: jsonb("feedback_json"),
  folderId: varchar("folder_id", { length: 36 }),
  // PRD-15 FR-01: creation audit. NULL = legacy row (destructive ops admin-only).
  createdBy: varchar("created_by", { length: 36 }),
  // PRD-15 block C (FR-18): topic owner. NULL = legacy (admin-managed). New
  // topics are owned by their creator.
  ownerId: varchar("owner_id", { length: 36 }),
  // Visibility: `private` (owner + grants + admin) or `shared` (all authors may
  // use). New topics default to private (confidentiality of keys, F-10); legacy
  // rows are backfilled to shared so nothing changes on day one.
  visibility: text("visibility", { enum: ["private", "shared"] }).notNull().default("shared"),
  // PRD-15 FR-27: normalized name (lowercase, collapsed spaces, ё->е) backing
  // the per-owner uniqueness index and the same-name warning. NULL only for rows
  // not yet backfilled by migration 022.
  nameNormalized: text("name_normalized"),
  // Optional author-defined readable id (slug). When set, result-variable formulas
  // address the topic via `topicById("<code>")` instead of the opaque UUID; absent
  // (NULL) → formulas fall back to the UUID. Uniqueness is not enforced at the DB
  // level — resolution is per-test (migration 032).
  code: text("code"),
}, (table) => ({
  // FR-27: hard uniqueness only WITHIN one owner; legacy unowned rows (owner
  // NULL) are excluded by the partial predicate, so they never collide.
  ownerNameIdx: uniqueIndex("topics_owner_name_normalized_idx")
    .on(table.ownerId, table.nameNormalized)
    .where(sql`owner_id IS NOT NULL`),
}));

// PRD-15 block C (FR-19): access to a topic for a non-owner USER. `use` lets
// them see the topic and its questions and use the topic in their tests;
// `manage` adds CRUD of the topic's questions and editing the topic (not
// deletion — owner/admin only). `state` carries the soft-revoke "revoked, in
// use" (FR-25). One grant per (topic, user). TD-01: grants address users only —
// groups are for test assignment, not content access (the grantee_type column
// was dropped, migration 025).
export const topicAccessGrants = pgTable("topic_access_grants", {
  id: varchar("id", { length: 36 }).primaryKey(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  granteeId: varchar("grantee_id", { length: 36 }).notNull(),
  accessLevel: text("access_level", { enum: ["use", "manage"] }).notNull(),
  state: text("state", { enum: ["active", "revoked_in_use"] }).notNull().default("active"),
  grantedBy: varchar("granted_by", { length: 36 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  topicGranteeIdx: uniqueIndex("topic_access_grants_topic_grantee_idx").on(
    table.topicId, table.granteeId,
  ),
}));

export type TopicAccessGrant = typeof topicAccessGrants.$inferSelect;

// TD-02 r.3: the topic_courses / topic_events tables were dropped (migration
// 024). Recommended courses/events live in topics.feedback_json; these shapes
// are kept as standalone types for the delivery projection (see
// shared/topics/recommendations.ts and TestSnapshotContent).

// ─── PRD-10: graded answer scoring (цена ответа) ─────────────────────────────
// Per-question scoring config on the correctness axis (how many points an answer
// earns), orthogonal to scale contributions (PRD-5, question_measurements).
// Absence (null) = exact match, sMax = 1 — legacy tests stay bit-identical
// (scoring-model §11; PRD-10 FR-02). Stored in its own nullable `scoring_json`
// column, NOT mixed into correct_json (which the answer checker parses). Unit
// identity is index-based (option index / matching pair / ranking position),
// consistent with the PRD-5 source_key convention — no durable ids (PRD-10 OQ-3).

/** Counter token in a tier predicate: total correct units (T), pairs (P) or items (N). */
export const scoringCounterTokenSchema = z.enum(["T", "P", "N"]);

/** One condition of a tier predicate (scoring-model §11.2): `lhs op rhs`. */
export const scoringConditionSchema = z.object({
  /** Left counter: correctly selected (c) or wrongly selected (x). */
  lhs: z.enum(["c", "x"]),
  op: z.enum(["==", ">=", "<=", "<", ">"]),
  /** Right side: a literal number or a counter token (T/P/N). */
  rhs: z.union([z.number(), scoringCounterTokenSchema]),
});

/** Tier predicate: conjunction of conditions — all must hold (scoring-model §11.2). */
export const scoringPredicateSchema = z.object({
  all: z.array(scoringConditionSchema).min(1),
});

/** A graduated tier: when `when` holds, award `score` (floored at 0). */
export const scoringTierSchema = z.object({
  when: scoringPredicateSchema,
  score: z.number().min(0),
});

/**
 * Question scoring config, discriminated by `kind`:
 * - `exact`    — exact match (0/1), sMax = 1; same as null (default).
 * - `weighted` — single choice: score = weight of the chosen option (additive).
 * - `tiered`   — multiple/matching/ranking: first matching tier wins, else 0
 *                (non-additive step table over the answer counters).
 * `sMax` is optional and otherwise derived: max(weights) | max(tier.score).
 */
export const questionScoringSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact") }),
  z.object({
    kind: z.literal("weighted"),
    weights: z.array(z.number().min(0)).min(1),
    sMax: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal("tiered"),
    tiers: z.array(scoringTierSchema).min(1),
    sMax: z.number().positive().optional(),
  }),
]);

export type ScoringCondition = z.infer<typeof scoringConditionSchema>;
export type ScoringPredicate = z.infer<typeof scoringPredicateSchema>;
export type ScoringTier = z.infer<typeof scoringTierSchema>;
export type QuestionScoring = z.infer<typeof questionScoringSchema>;

export const questions = pgTable("questions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  type: text("type", { enum: ["single", "multiple", "matching", "ranking"] }).notNull(),
  prompt: text("prompt").notNull(),
  dataJson: jsonb("data_json").notNull(),
  correctJson: jsonb("correct_json").notNull(),
  // PRD-15 block D, T-40: `points` and `scoring_json` were dropped here (migration
  // 028) — scoring is a property of the test, not the question. The price and the
  // graded config now live on test_question_scoring (per-test override) + section/
  // test defaults + the system default; see shared/scoring/effective-scoring.
  // PRD-16 FR-10: difficulty is an OPTIONAL 0–100 number; NULL = «не задано».
  // Default 50 kept for inserts that omit it; an explicit null clears it.
  difficulty: integer("difficulty").default(50),
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
  // PRD-15 FR-01: creation audit. NULL = legacy row (destructive ops admin-only).
  createdBy: varchar("created_by", { length: 36 }),
});

export const testFolders = pgTable("test_folders", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  parentId: varchar("parent_id", { length: 36 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // PRD-15 FR-01: creation audit. NULL = legacy row (destructive ops admin-only).
  createdBy: varchar("created_by", { length: 36 }),
});

// ─── PRD-6: retake gate / cooldown (ограничение повторного прохождения) ──────
// Optional per-test policy that gates a new attempt before the SCORM `Initialize`
// (FR-01/02). Absence / `enabled !== true` / no plugin = legacy behaviour
// (`allowed = true`). Eligibility is decided by a pluggable rule (PRD-6 §3.4).

/** Reference to a chosen eligibility plugin + its admin-managed config (PRD-6 §3.1). */
export const eligibilityPluginRefSchema = z.object({
  key: z.string().min(1),
  configId: z.string().optional(),
  failPolicy: z.enum(["failOpen", "failClosed"]).default("failOpen"),
});

/**
 * `tests.retake_policy_json`. `cooldownPeriodDays` is whole calendar days
 * (1–3650); legacy `cooldownDays` is accepted on input and normalized.
 */
export const retakePolicySchema = z.preprocess(
  (val) => {
    if (val && typeof val === "object") {
      const v = val as Record<string, unknown>;
      if (v.cooldownPeriodDays == null && typeof v.cooldownDays === "number") {
        return { ...v, cooldownPeriodDays: v.cooldownDays };
      }
    }
    return val;
  },
  z.object({
    enabled: z.boolean().default(false),
    cooldownPeriodDays: z.number().int().min(1).max(3650),
    gateMode: z.literal("before_internal_start").default("before_internal_start"),
    eligibilityPlugin: eligibilityPluginRefSchema.nullish(),
    blockedPageId: z.string().optional(),
  }),
);

export type EligibilityPluginRef = z.infer<typeof eligibilityPluginRefSchema>;
export type RetakePolicy = z.infer<typeof retakePolicySchema>;

export const tests = pgTable("tests", {
  id: varchar("id", { length: 36 }).primaryKey(),
  folderId: varchar("folder_id", { length: 36 }),
  // PRD-13 RBAC: test owner (a content-role user). Null = unowned legacy test,
  // accessible only to administrators/superadmin until an admin assigns an owner.
  ownerId: varchar("owner_id", { length: 36 }),
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
  // PRD-6: optional retake gate / cooldown policy. Null = legacy (no gate).
  retakePolicyJson: jsonb("retake_policy_json").$type<RetakePolicy>(),
  // PRD-15 block D (FR-31): test-wide default price of a question. Null = no
  // default — the effective chain falls through to the system default (1 point).
  defaultQuestionPoints: integer("default_question_points"),
  // PRD-19 (FR-01): allow skipping a question and returning to unanswered ones within an
  // attempt. Default true (new tests); migration 031 backfills EXISTING tests to false to
  // preserve their strict-linear navigation.
  allowReturnToUnanswered: boolean("allow_return_to_unanswered").notNull().default(true),
  // PRD-19 (FR-04a): permit changing an already-submitted answer before section/test finish.
  // Default false. Depends on allowReturnToUnanswered=true and is mutually exclusive with
  // showCorrectAnswers (FR-04b) — enforced in the editor/service layer, not as a DB CHECK.
  allowAnswerChange: boolean("allow_answer_change").notNull().default(false),
  // PRD-19 (FR-05a): show the section-results screen (optional system node, sectioned tests).
  // Default true; not applicable to linear_flat (no sections) — ignored by the runtime there.
  showSectionResults: boolean("show_section_results").notNull().default(true),
});

/**
 * PRD-13 RBAC: explicit access to a test for a non-owner. `edit` lets an author
 * edit/publish/export the test; `assign` lets a manager assign it. Grants are
 * created and revoked only by an administrator or superadmin. One grant per
 * (test, user); `edit` covers the `assign` scope during access resolution.
 */
export const testAccessGrants = pgTable("test_access_grants", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  accessLevel: text("access_level", { enum: ["edit", "assign"] }).notNull(),
  grantedBy: varchar("granted_by", { length: 36 }), // which admin granted it
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  testUserIdx: uniqueIndex("test_access_grants_test_user_idx").on(table.testId, table.userId),
}));

// ─── PRD-11: tag draw quotas (квоты выдачи по тегам) ─────────────────────────
// Optional per-section stratified-draw blueprint guaranteeing coverage of
// sub-topics (tags) within a topic's draw_count sample. Absence = today's
// uniform draw (FR-02). A delivery mechanism, orthogonal to scoring (PRD-10).
// Sub-topic = a value in questions.tags; no new entity (PRD-11 §4).

/**
 * One quota (stratum): take `count` questions tagged `tag`. `mode` is PER-TAG
 * (PRD-11 §3a, FR-03b) — "exact" (default, exactly `count`) or "min" (at least
 * `count`; the remainder may pull more of the same tag). `tag` is normalized
 * on save (trim + collapse spaces, 1–{@link TAG_MAX_LENGTH} chars); the draw
 * match is case-insensitive (shared/tags.ts).
 */
export const drawStratumSchema = z.object({
  tag: z
    .string()
    .transform(normalizeTag)
    .refine((t) => t.length >= 1 && t.length <= TAG_MAX_LENGTH, {
      message: `Тег: 1–${TAG_MAX_LENGTH} символов после нормализации`,
    }),
  count: z.number().int().min(1),
  mode: z.enum(["exact", "min"]).optional(),
});

/**
 * Stratified-draw blueprint (scoring-model §2.4; PRD-11 §3a, FR-01/03/03a/03b).
 * Just a non-empty list of per-tag strata; the mode lives on each stratum, so
 * there is no topic-level mode/granularity. Absence of a blueprint = uniform
 * draw (FR-02).
 */
export const drawBlueprintSchema = z.object({
  strata: z.array(drawStratumSchema).min(1),
});

export type DrawStratum = z.infer<typeof drawStratumSchema>;
export type DrawBlueprint = z.infer<typeof drawBlueprintSchema>;

/**
 * PRD-17 (BR-12): a single fixed VARIANT of a section — a named, author-curated
 * subset of the topic's question bank. `id` is a stable key (rotation history is
 * matched on it, not on list position — PRD-17 R-3/D-8). `questionIds` is the
 * variant's content; the whole variant is delivered, in random order (FR-04/15).
 */
export const formSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(100),
  questionIds: z.array(z.string()).min(1),
});

/**
 * PRD-17 (BR-12): the set of fixed variants on a section. Presence switches the
 * section into "variants mode": one variant is picked at topic start and
 * delivered whole; the section's draw_count/draw_all/draw_blueprint are NOT
 * applied (FR-03). At least two variants. Absence = legacy draw (uniform/quotas).
 */
export const formSetSchema = z.object({
  forms: z.array(formSchema).min(2),
});

export type Form = z.infer<typeof formSchema>;
export type FormSet = z.infer<typeof formSetSchema>;

export const testSections = pgTable("test_sections", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  topicId: varchar("topic_id", { length: 36 }).notNull(),
  drawCount: integer("draw_count").notNull(),
  // When true the topic contributes its ENTIRE current question pool to the
  // test, ignoring drawCount. Stores the author's manual intent; adaptive mode
  // overrides the effective behaviour to "all" without touching this flag, so
  // leaving adaptive restores the manual setting. Default false = legacy draw.
  drawAll: boolean("draw_all").notNull().default(false),
  topicPassRuleJson: jsonb("topic_pass_rule_json"),
  required: boolean("required").notNull().default(true),
  timeLimitMinutes: integer("time_limit_minutes"),
  feedbackJson: jsonb("feedback_json"),
  // PRD-11: optional stratified-draw blueprint. Null = uniform draw (FR-02).
  drawBlueprintJson: jsonb("draw_blueprint_json").$type<DrawBlueprint>(),
  // PRD-17 (BR-12): optional fixed-variant set. Presence puts the section into
  // "variants mode" (one variant picked at topic start, delivered whole — FR-04);
  // draw_count/draw_all/draw_blueprint are then not applied (FR-03). Null = legacy
  // draw (uniform / quotas), backward-compatible.
  formSetJson: jsonb("form_set_json").$type<FormSet>(),
  // PRD-15 block D (FR-31): per-section default price of a question. Null = no
  // default — the chain falls through to the test default, then the system 1.
  defaultPoints: integer("default_points"),
  // PRD-7 S13.5 / G47: explicit author-controlled topic order. Persisted on
  // every save as the index of the topic in the editor's sections array, so
  // drag-reorder in Structure round-trips through getTestSections() ORDER BY.
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => ({
  // PRD-15 FR-03: powers the "where used" lookup (tests depending on a topic).
  topicIdIdx: index("test_sections_topic_id_idx").on(table.topicId),
}));

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
  // PRD-15 block B (FR-13): the publication snapshot this attempt is delivered
  // and graded from. NULL = legacy/live delivery (drafts, preview, or attempts
  // started before snapshots existed) — the transitional mode.
  snapshotId: varchar("snapshot_id", { length: 36 }),
  variantJson: jsonb("variant_json").notNull(),
  answersJson: jsonb("answers_json"),
  resultJson: jsonb("result_json"),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
});

// PRD-15 block B (FR-10): a frozen, self-contained snapshot of a test created
// on publish/republish. Delivery of a published test reads ONLY from the
// snapshot, so later edits to the bank do not change in-flight or future
// attempts until the next republish. `content_json` holds the resolved
// deliverable (test row, sections, per-topic question pools, adaptive config,
// scales, measurements, result variables, content pages, topic courses/events).
// `version` is a per-test monotonic counter; one row per (test_id, version).
export const testSnapshots = pgTable("test_snapshots", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  version: integer("version").notNull(),
  contentJson: jsonb("content_json").notNull(),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  publishedBy: varchar("published_by", { length: 36 }),
}, (table) => ({
  testVersionIdx: uniqueIndex("test_snapshots_test_version_idx").on(table.testId, table.version),
}));

export type TestSnapshot = typeof testSnapshots.$inferSelect;

// PRD-15 block D (FR-30): per-(test, question) scoring override — the price and
// graded config are a property of the TEST; the question row carries content
// only. Every value column is independently nullable: a null link falls through
// the effective chain (override -> section default -> test default -> system;
// shared/scoring/effective-scoring). `pinned_content_hash` is the question's
// contentHash at authoring time — a mismatch with the current hash marks the
// override as stale in the editor (FR-30). Rows die with their test or question
// (FK cascade).
export const testQuestionScoring = pgTable("test_question_scoring", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: varchar("test_id", { length: 36 }).notNull().references(() => tests.id, { onDelete: "cascade" }),
  questionId: varchar("question_id", { length: 36 }).notNull().references(() => questions.id, { onDelete: "cascade" }),
  points: integer("points"),
  scoringJson: jsonb("scoring_json").$type<QuestionScoring>(),
  difficulty: integer("difficulty"),
  pinnedContentHash: text("pinned_content_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  testQuestionIdx: uniqueIndex("test_question_scoring_test_question_idx").on(table.testId, table.questionId),
  questionIdIdx: index("test_question_scoring_question_id_idx").on(table.questionId),
}));

export const insertTestQuestionScoringSchema = createInsertSchema(testQuestionScoring)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    // The override price allows an explicit 0 (an unscored question in THIS test).
    points: z.number().int().min(0).nullish(),
    difficulty: z.number().int().min(0).max(100).nullish(),
    // drizzle-zod types jsonb loosely; validate the graded config explicitly.
    scoringJson: questionScoringSchema.nullish(),
  });

export type TestQuestionScoring = typeof testQuestionScoring.$inferSelect;
export type InsertTestQuestionScoring = z.infer<typeof insertTestQuestionScoringSchema>;

export const insertTestFolderSchema = createInsertSchema(testFolders).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertFolderSchema = createInsertSchema(folders).omit({ id: true });
export const insertTopicSchema = createInsertSchema(topics).omit({ id: true }).extend({
  // Optional readable id (slug): lower snake_case, ≤64. Blank → NULL (use the UUID).
  code: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/, "code: строчная буква в начале; буквы/цифры/подчёркивание; до 64 символов")
      .nullable()
      .optional(),
  ),
});
export const insertQuestionSchema = createInsertSchema(questions)
  .omit({ id: true })
  // drizzle-zod types jsonb loosely; normalize tags on save (PRD-11 §3a:
  // trim/collapse, dedup, length cap). Scoring left the question in T-40.
  .extend({
    tags: z.array(z.string()).transform(normalizeTags).optional(),
  });
export const insertTestSchema = createInsertSchema(tests)
  .omit({ id: true })
  // drizzle-zod types jsonb loosely; validate the retake policy explicitly (PRD-6).
  .extend({ retakePolicyJson: retakePolicySchema.nullish() });
export const insertTestSectionSchema = createInsertSchema(testSections)
  .omit({ id: true })
  // drizzle-zod types jsonb loosely; validate the draw blueprint + variant set explicitly.
  .extend({
    drawBlueprintJson: drawBlueprintSchema.nullish(),
    formSetJson: formSetSchema.nullish(),
  });
export const insertAttemptSchema = createInsertSchema(attempts).omit({ id: true });

export const insertAdaptiveTopicSettingsSchema = createInsertSchema(adaptiveTopicSettings).omit({ id: true });
export const insertAdaptiveLevelSchema = createInsertSchema(adaptiveLevels).omit({ id: true });
export const insertAdaptiveLevelLinkSchema = createInsertSchema(adaptiveLevelLinks).omit({ id: true });
export const insertGroupSchema = createInsertSchema(groups).omit({ id: true });
export const insertUserGroupSchema = createInsertSchema(userGroups).omit({ id: true });
export const insertUserRoleSchema = createInsertSchema(userRoles).omit({ id: true, grantedAt: true });
export const insertTestAccessGrantSchema = createInsertSchema(testAccessGrants).omit({ id: true, createdAt: true });
export const insertTestAssignmentSchema = createInsertSchema(testAssignments).omit({ id: true });
export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({ id: true });
export const insertAssignmentAccessTokenSchema = createInsertSchema(assignmentAccessTokens).omit({ id: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;
export type UserRole = typeof userRoles.$inferSelect;

export type InsertTestAccessGrant = z.infer<typeof insertTestAccessGrantSchema>;
export type TestAccessGrant = typeof testAccessGrants.$inferSelect;

export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type Folder = typeof folders.$inferSelect;

export type InsertTestFolder = z.infer<typeof insertTestFolderSchema>;
export type TestFolder = typeof testFolders.$inferSelect;

export type InsertTopic = z.infer<typeof insertTopicSchema>;
export type Topic = typeof topics.$inferSelect;

// TD-02 r.3: standalone projection shapes (the backing tables were dropped,
// migration 024). A recommended course = a feedback link; an event = a feedback
// event title. Ids are synthetic (index-based) — see shared/topics/recommendations.
export type TopicCourse = { id: string; topicId: string; title: string; url: string };
export type TopicEvent = { id: string; topicId: string; title: string };

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

// `none` = no overall/topic pass threshold (pass is governed elsewhere, e.g.
// adaptive levels or scales). The read mapper and SCORM/attempt consumers
// already treat `none` as "skip percent/absolute gating"; the write schema
// must accept it too, otherwise existing tests stored with `type: "none"`
// fail to save (HTTP 400 on overallPassRuleJson.type).
export const passRuleSchema = z.object({
  type: z.enum(["percent", "absolute", "none"]),
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

/**
 * Recommended event (TD-02): a named event the learner may attend. Unlike a
 * course link (`feedbackLinkSchema`, URL required), the event URL is OPTIONAL —
 * an event may have no registration page.
 */
export const feedbackEventSchema = z.object({
  title: z.string().min(1),
  url: z.union([z.string().url(), z.literal("")]).optional(),
});

export const feedbackContentSchema = z.object({
  format: feedbackFormatSchema,
  text: z.string(),
  // `links` carries recommended courses (UI label «Курсы»); `assets` — documents
  // (PDF); `events` — recommended events with an optional link.
  links: z.array(feedbackLinkSchema).default([]),
  assets: z.array(feedbackAssetSchema).default([]),
  events: z.array(feedbackEventSchema).default([]),
});

export type FeedbackFormat = z.infer<typeof feedbackFormatSchema>;
export type FeedbackLink = z.infer<typeof feedbackLinkSchema>;
export type FeedbackAsset = z.infer<typeof feedbackAssetSchema>;
export type FeedbackEvent = z.infer<typeof feedbackEventSchema>;
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
    /**
     * PRD-17 (BR-12): when this section ran in "variants mode", the stable id of
     * the variant that was drawn for this attempt. Pins the delivered set and is
     * the source of rotation history on the next retake (FR-07/FR-08). Absent for
     * non-variant sections and pre-PRD-17 attempts (treat missing as "no variant").
     */
    formId: z.string().optional(),
    /**
     * PRD-4 v1.1 §3.2 — per-section (per-topic) time budget in minutes, or
     * `null` when the topic has no custom limit (inherit_test / none). Carried
     * in the persisted variant so the web learner runtime can run a per-topic
     * timer (mirrors `TEST_DATA.sections[].timeLimitMinutes` in the SCORM
     * package). Absent on legacy in-progress attempts — treat missing as null.
     */
    timeLimitMinutes: z.number().int().positive().nullable().optional(),
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
  // TD-02: recommended events for a failed topic (url optional). `.default([])`
  // keeps legacy stored results (without the field) valid.
  recommendedEvents: z.array(z.object({ title: z.string(), url: z.string().optional() })).default([]),
});

export const attemptResultSchema = z.object({
  totalCorrect: z.number(),
  totalQuestions: z.number(),
  overallPercent: z.number(),
  totalEarnedPoints: z.number(),
  totalPossiblePoints: z.number(),
  overallPassed: z.boolean(),
  topicResults: z.array(topicResultSchema),
  // PRD-12 (web parity): graded namespaces computed via @shared engines, present
  // only when the test defines scales (PRD-5) / result variables (PRD-2). Absence
  // keeps the legacy result shape and old stored results valid (back-compat).
  scaleResults: z.record(z.string(), z.unknown()).optional(),
  resultVariables: z.record(z.string(), z.unknown()).optional(),
  status: z.object({ success: z.boolean().optional(), completion: z.boolean().optional() }).optional(),
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
  // PRD-3 §5.1: explicit lifecycle state. `is_active` stays as the author-facing
  // visibility flag; `status` is the admin lifecycle FSM (draft/active/inactive/invalid).
  status: text("status", { enum: ["draft", "active", "inactive", "invalid"] })
    .notNull()
    .default("active"),
  // PRD-3 §6: source adapter. Built-ins sync from disk; uploaded come from an admin ZIP.
  sourceType: text("source_type", { enum: ["builtin", "uploaded"] })
    .notNull()
    .default("builtin"),
  // Absolute/relative path to the template root: the on-disk built-in dir, or the
  // extracted uploads/templates/<id> dir for uploaded packages.
  sourcePath: text("source_path"),
  manifest: jsonb("manifest").notNull(),
  previewPath: text("preview_path"),
  // PRD-3 §4: persisted structural-validation and browser smoke-test reports.
  validationJson: jsonb("validation_json"),
  smokeTestJson: jsonb("smoke_test_json"),
  // PRD-3: cheap source fingerprint (hash of each file's path/size/mtime) used by
  // the startup reconcile to skip re-validating templates whose files are unchanged.
  sourceFingerprint: text("source_fingerprint"),
  installedAt: timestamp("installed_at").notNull().defaultNow(),
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
  /** PRD-1 §4.3: variant-binding kind. Drives lifecycle of system pages.
   *  PRD-19: `review` (обзор / section-finish) and `section-results` (итоги раздела)
   *  are system runtime nodes — singleton design bindings like start/results,
   *  rendered by their own runtime phase and EXCLUDED from the content-page flow.
   *  They replace the legacy per-topic `intro`/`summary` section pages. */
  kind: text("kind", { enum: ["start", "questions", "router", "summary", "results", "intro", "info", "review", "section-results"] }).notNull(),
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
export const variantKindSchema = z.enum(["start", "questions", "router", "summary", "results", "intro", "info", "review", "section-results"]);
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
 * System kinds: `start`, `results`, `router`, `questions`, `intro` («Введение
 * раздела», per-topic — PRD-1 §4.3), plus the PRD-19 section nodes `review` (обзор)
 * and `section-results` (итоги раздела — supersedes the legacy per-topic `summary`).
 * `summary` is kept as a valid kind for backward compatibility with existing
 * rows/templates but is no longer system-managed (its «Итог раздела» role is the
 * computed `section-results` node). The user kind `info` is author-created and not
 * lifecycle-managed.
 */
const REQUIRED_DEFAULT_VARIANT_KINDS = ["start", "results", "router", "questions", "intro", "review", "section-results"] as const;

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

/**
 * Template platform API versions this build accepts (PRD-3 §4.1). Kept here,
 * free of any server/db import, so the pure template validator can use it.
 * Re-exported from server/template-registry for backward-compatible imports.
 */
export const SUPPORTED_TEMPLATE_API_VERSIONS = ["1.0"] as const;

/** Returns true when the given templateApiVersion is accepted by this build. */
export function isSupportedTemplateApiVersion(version: string): boolean {
  return (SUPPORTED_TEMPLATE_API_VERSIONS as readonly string[]).includes(version);
}

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

export const insertTemplateSchema = createInsertSchema(templates).omit({ createdAt: true, updatedAt: true, installedAt: true });
export const insertContentPageSchema = createInsertSchema(contentPages).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templates.$inferSelect;

/** PRD-3 §5.1: lifecycle states of a template in the admin registry. */
export const templateStatusSchema = z.enum(["draft", "active", "inactive", "invalid"]);
export type TemplateStatus = z.infer<typeof templateStatusSchema>;

/** PRD-3 §6: where a template came from (single registry, two source adapters). */
export const templateSourceTypeSchema = z.enum(["builtin", "uploaded"]);
export type TemplateSourceType = z.infer<typeof templateSourceTypeSchema>;

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
    // Label is OPTIONAL (parity with scales, per the approved wireframe). Empty is
    // allowed; consumers fall back to the name for display. Column is NOT NULL, so
    // "" (not null) is stored.
    label: z.string().max(120).default(""),
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
    // Label is OPTIONAL (per the approved wireframe). Empty is allowed; consumers
    // fall back to the key for display. Column is NOT NULL, so "" (not null) is stored.
    label: z.string().max(120).default(""),
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
  weight: real("weight").notNull().default(1),
  conditionJson: jsonb("condition_json"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertQuestionMeasurementSchema = createInsertSchema(questionMeasurements)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    // The contribution is an explicit numeric value (0 and negatives valid).
    valueJson: z.number(),
    // Fields with a DB default / nullable are optional in the API payload.
    weight: z.number().optional(),
    sourceKey: z.string().nullish(),
    sortOrder: z.number().optional(),
    conditionJson: z.unknown().nullish(),
  });

export type InsertQuestionMeasurement = z.infer<typeof insertQuestionMeasurementSchema>;
export type QuestionMeasurement = typeof questionMeasurements.$inferSelect;
import { pgTable, varchar, text, integer, boolean, timestamp, date, jsonb, uniqueIndex, index, check, uuid, real, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { normalizeTag, normalizeTags, TAG_MAX_LENGTH } from "./tags";
import { isAllocationFeasible } from "./questions/allocation";
import { STORED_ROLES } from "./access/roles";
import { PLACEHOLDER_TYPES, SETTING_TYPES } from "./template/field-types";
import type { BreakdownFeedback as BreakdownFeedbackShape } from "./breakdown/types";

export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: text("email").notNull(), // Зашифрованный email
  emailHash: varchar("email_hash", { length: 64 }).unique(), // SHA-256 хеш для поиска
  passwordHash: text("password_hash"), // scrypt hash (PRD-9); NULL for an external participant (PRD-28)
  name: text("name"), // заполняется при первом входе
  // PRD-28: an external participant is a FLAG on the account, never a role. Such an
  // account has no password at all: password login, recovery and the invite letter
  // are refused, and the only way in is the assignment link.
  isExternal: boolean("is_external").notNull().default(false),
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
  // PRD-54: ключ, по которому импорт выгрузки отчёта LMS находит этого человека. Задаётся руками
  // (карточка пользователя или колонка массовой загрузки) — сопоставление по ФИО запрещено.
  // Уникальность обеспечивает индекс по lower(external_key) из миграции 0029: выражения в
  // индексах drizzle-kit не генерирует, поэтому он дописан в SQL вручную.
  externalKey: text("external_key"),
  /**
   * PRD-54 BR-54-31: идентификатор обучающегося в LMS (`cmi.learner_id`), по которому
   * связывается ТЕЛЕМЕТРИЯ.
   *
   * Отдельное поле, а не `external_key`: источники дают РАЗНЫЕ идентификаторы одного человека и
   * оба существуют одновременно — в рантайме LMS сообщает `learner_id` и не знает табельного
   * кода, в выгрузке есть код и нет `learner_id`. Поле «что-нибудь одно» превратило бы
   * связывание в лотерею: заполнивший его не знал бы, какой источник включил, а какой выключил.
   */
  lmsLearnerId: text("lms_learner_id"),
  /**
   * PRD-54 BR-54-25, BR-54-28: поля, из которых считается псевдоним участника выгрузки.
   *
   * Нужны, чтобы система могла посчитать для СВОЕГО пользователя тот же ключ, что внешний
   * обезличиватель считает для строки файла, и связать их. Необязательны: их отсутствие значит
   * лишь, что связывание пойдёт другим путём или не пойдёт вовсе.
   */
  organization: text("organization"),
  unit: text("unit"),
  position: text("position"),
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
}, (table) => ({
  // Assignments are queried independently by test, by user, and by group
  // (learner test-list, assignment management).
  testIdIdx: index("test_assignments_test_id_idx").on(table.testId),
  userIdIdx: index("test_assignments_user_id_idx").on(table.userId),
  groupIdIdx: index("test_assignments_group_id_idx").on(table.groupId),
}));

// Magic-link токены для доступа к тесту без пароля
export const assignmentAccessTokens = pgTable("assignment_access_tokens", {
  id: varchar("id", { length: 36 }).primaryKey(),
  /**
   * PRD-52: NULL у ревью-ссылки. У рецензирования назначения нет — доступ несёт
   * грант `review`, — но вход, отзыв, срок жизни и конвейер писем те же, поэтому
   * заводить таблицу-близнеца ради одного поля дороже, чем обнулить это.
   */
  assignmentId: varchar("assignment_id", { length: 36 }),
  userId: varchar("user_id", { length: 36 }).notNull(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  /**
   * Куда ведёт ссылка: `attempt` — прохождение теста (PRD-28), `review` — экран
   * рецензента (PRD-52). Значение по умолчанию сохраняет смысл всех выданных ранее
   * ссылок без бэкфилла.
   */
  purpose: text("purpose", { enum: ["attempt", "review"] }).notNull().default("attempt"),
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
}, (table) => ({
  // Every reset verification looks a token up by its hash; recent-request
  // throttling counts a user's tokens over a time window.
  tokenHashIdx: index("password_reset_tokens_token_hash_idx").on(table.tokenHash),
  userIdIdx: index("password_reset_tokens_user_id_idx").on(table.userId),
}));

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
  /**
   * ТОЛКОВАНИЕ темы — текст, который объясняет результат, а не советует, что делать
   * (см. {@link interpretationSchema}). Печатается в строке темы ВСЕГДА: и когда тема
   * взята, и когда нет, — и в сводный блок «Рекомендации» не попадает.
   *
   * Живёт на ТЕМЕ, а не на тесте: описание компетенции («формирует эффективную команду…»)
   * принадлежит самой компетенции и переиспользуется каждым тестом, который её измеряет.
   * Тест вправе сказать своё — для этого есть `test_sections.interpretation_json`.
   *
   * NULL/пустой текст = толкования нет, и строка темы печатается как печаталась.
   */
  interpretationJson: jsonb("interpretation_json").$type<InterpretationText>(),
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
  // PRD-25 FR-20: time of the last change to the topic itself or to any of its
  // questions. Backs the «Мои темы и вопросы» home-page section, which orders by
  // recency. Touched by the topic and question repositories in the same
  // transaction as the mutation — see server/storage/shared.ts#touchTopics.
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // FR-27: hard uniqueness only WITHIN one owner; legacy unowned rows (owner
  // NULL) are excluded by the partial predicate, so they never collide.
  ownerNameIdx: uniqueIndex("topics_owner_name_normalized_idx")
    .on(table.ownerId, table.nameNormalized)
    .where(sql`owner_id IS NOT NULL`),
  // PRD-25: the home page reads the most recently touched topics first.
  updatedAtIdx: index("topics_updated_at_idx").on(table.updatedAt),
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
  type: text("type", { enum: ["single", "multiple", "matching", "ranking", "scale", "allocation", "short", "blanks", "long"] }).notNull(),
  prompt: text("prompt").notNull(),
  /**
   * PRD-57 §4.3: формат, в котором АВТОР написал текст задания.
   *
   * Аддитивно и без миграции текста: у всех существующих заданий формат `markdown`, и это
   * ровно их сегодняшнее поведение — текст читается как подмножество разметки. Колонка
   * `prompt` остаётся исходником в любом формате.
   *
   * `richText` и `html` хранят одно и то же — разметку; помнить их по отдельности нужно,
   * чтобы автор возвращался в тот редактор, которым набирал. Написание повторяет
   * `feedbackContentSchema.format` и `tests.description_format` намеренно: второй словарь
   * форматов в продукте — это способ завести два разных «Форматированных».
   */
  promptFormat: text("prompt_format", {
    enum: ["markdown", "richText", "html"],
  }).notNull().default("markdown"),
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
  /**
   * PRD-30 FR-01: author-defined position of the question inside its topic
   * («Индекс в теме»). NULL = not set — such questions are delivered after all
   * indexed ones (FR-04). Nullable WITHOUT a default on purpose: any non-null
   * default would migrate every existing question into one group of equals, and
   * no topic would gain an order. Values need not be dense or unique — equal
   * indices form a group that the delivery engine shuffles inside (FR-05).
   * Named `order_index`, not `sort_order`: `test_sections.sort_order` is a dense
   * technical order the editor rewrites on every save, this one is author data.
   */
  orderIndex: integer("order_index"),
  feedback: text("feedback"),
  feedbackMode: text("feedback_mode", { enum: ["general", "conditional"] }).notNull().default("general"),
  feedbackCorrect: text("feedback_correct"),
  feedbackIncorrect: text("feedback_incorrect"),
  contentHash: text("content_hash"),
  /**
   * PRD-66 FR-09a: the fingerprint of the question's CONTENT, by which answers are
   * grouped into an observation series. Written by the repository on every create and
   * update (`shared/questions/psycho-hash`), never by a caller.
   *
   * A separate column from `content_hash` on purpose: that one is pinned by PRD-15
   * (`test_question_scoring.pinned_content_hash` ties a per-test price to a revision),
   * so changing how it is computed would mark every price override stale at once.
   * The two answer different questions and must be free to diverge.
   *
   * Nullable: a row written before migration `0039` and not yet backfilled carries no
   * stamp, and its earlier observations stay the series «версия неизвестна» (FR-09c).
   */
  psychoHash: text("psycho_hash"),
  // PRD-2 §8.2: tags feed result-variable aggregate formulas; chip input in the question card.
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  // PRD-15 FR-01: creation audit. NULL = legacy row (destructive ops admin-only).
  createdBy: varchar("created_by", { length: 36 }),
}, (table) => ({
  // Questions are read/deleted by topic on every topic and delivery path.
  topicIdIdx: index("questions_topic_id_idx").on(table.topicId),
}));

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
 * PRD-31 barrier B: minimum interval between attempts INSIDE one assignment.
 * Wall-clock hours, so an author asking for "once a day" gets 24 h rather than a
 * calendar boundary. Absence of the whole branch = the barrier is off.
 */
export const attemptIntervalSchema = z.object({
  enabled: z.boolean().default(false),
  /** Whole hours, 1..8760 (one year). Required when `enabled` (see the refine below). */
  hours: z.number().int().min(1).max(8760).optional(),
});

/**
 * `tests.retake_policy_json`. Two INDEPENDENT barriers (PRD-31 §3), applied at
 * disjoint moments:
 *   - `enabled` + `cooldownPeriodDays` — barrier A, calendar days BETWEEN assignments;
 *   - `attemptInterval` — barrier B, wall-clock hours INSIDE one assignment.
 *
 * `cooldownPeriodDays` is optional at the type level and required only when barrier
 * A is on, so a test can carry barrier B alone without inventing a cooldown value
 * for a switch that is off. Legacy `cooldownDays` is accepted and normalized.
 *
 * PRD-40: `cooldownByOutcome` (default off) splits barrier A's single period into
 * two — `cooldownPeriodDaysPassed` / `cooldownPeriodDaysFailed` — chosen at runtime
 * by the outcome of the last attempt of the OTHER assignment that anchors the
 * decision (see `shared/eligibility/engine.ts` `resolveCooldownDays`). Off (the
 * default, and every existing test) keeps `cooldownPeriodDays` as the only period,
 * byte-identical to pre-PRD-40 behaviour.
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
  z
    .object({
      enabled: z.boolean().default(false),
      cooldownPeriodDays: z.number().int().min(1).max(3650).optional(),
      cooldownByOutcome: z.boolean().default(false),
      cooldownPeriodDaysPassed: z.number().int().min(1).max(3650).optional(),
      cooldownPeriodDaysFailed: z.number().int().min(1).max(3650).optional(),
      gateMode: z.literal("before_internal_start").default("before_internal_start"),
      eligibilityPlugin: eligibilityPluginRefSchema.nullish(),
      blockedPageId: z.string().optional(),
      attemptInterval: attemptIntervalSchema.nullish(),
    })
    .superRefine((v, ctx) => {
      if (v.enabled && v.cooldownByOutcome) {
        if (v.cooldownPeriodDaysPassed == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cooldownPeriodDaysPassed"],
            message: "cooldownPeriodDaysPassed обязателен при разделении кулдауна по исходу",
          });
        }
        if (v.cooldownPeriodDaysFailed == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cooldownPeriodDaysFailed"],
            message: "cooldownPeriodDaysFailed обязателен при разделении кулдауна по исходу",
          });
        }
      } else if (v.enabled && v.cooldownPeriodDays == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cooldownPeriodDays"],
          message: "cooldownPeriodDays обязателен при включённом кулдауне",
        });
      }
      if (v.attemptInterval?.enabled && v.attemptInterval.hours == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attemptInterval", "hours"],
          message: "Интервал в часах обязателен при включённом ограничении между попытками",
        });
      }
    }),
);

export type EligibilityPluginRef = z.infer<typeof eligibilityPluginRefSchema>;
export type AttemptInterval = z.infer<typeof attemptIntervalSchema>;
export type RetakePolicy = z.infer<typeof retakePolicySchema>;

/** Выбор варианта отчёта и значения его полей для ОДНОГО режима (PRD-27 §4.1). */
export const reportModeSettingsSchema = z.object({
  /**
   * `contentTemplates[].key` выбранного варианта. Необязателен: настройки отчёта
   * существовали ДО того, как у отчёта появились варианты (PRD-35), и такие ветки лежат в
   * базе без ключа. Отсутствие ключа = вариант, помеченный `isDefault`, — ровно так его
   * и разрешает `resolveReportVariant`, поэтому требовать ключ значило бы отбрасывать
   * настройку, по которой хосты уже собирают отчёт.
   */
  variantKey: z.string().min(1).optional(),
  /** Значения `settings[]` варианта. Ключи, которых вариант не объявляет, отбрасываются. */
  values: z.record(z.string(), z.unknown()).default({}),
});

/**
 * `tests.report_settings_json`. Ключи ветвей — РЕЖИМЫ теста, а не виды манифеста: тест
 * одного режима хранит одну ветку, но обе сохраняются при смене режима, чтобы настройка
 * не терялась (§4.1). Отсутствие ветки = вариант с `isDefault` активного шаблона.
 */
export const reportSettingsSchema = z.object({
  /**
   * Выдавать ли отчёт обучающемуся. Настройка ОБЩАЯ, вне ветвей режима: документ либо
   * положен слушателю этого теста, либо нет, и от режима выдачи это не зависит.
   *
   * Отсутствие = выдавать. До этой настройки отчёт был доступен всегда (`canReport: true`
   * прямо в маршруте результата), и умолчание сохраняет поведение каждого уже
   * существующего теста.
   */
  enabled: z.boolean().optional(),
  /**
   * PRD-49: переопределения надписей ИМЕННО для отчёта. Слой лежит вне ветвей режима по
   * той же причине, что и `enabled`: формулировка принадлежит документу, а не способу
   * его выдачи. Отсутствие ключа = документ говорит теми же словами, что экран итогов.
   * Форма та же, что у `design_settings_json.labels` (см. `shared/template/labels`).
   */
  labels: z.record(z.string(), z.object({ on: z.boolean().optional(), text: z.string().optional() })).optional(),
  standard: reportModeSettingsSchema.nullish(),
  adaptive: reportModeSettingsSchema.nullish(),
});

/**
 * Положен ли отчёт обучающемуся по настройкам теста.
 *
 * Одно правило на оба хоста и на все места, где спрашивают: маршрут результата, сборка
 * пакета, предпросмотр. Отдельная функция, а не сравнение с `true` на каждом вызове, —
 * потому что «поле отсутствует» и «поле включено» здесь означают одно и то же, и забыть об
 * этом в одном из мест значило бы отнять отчёт у половины уже существующих тестов.
 */
export function isReportEnabled(settings: ReportSettings | null | undefined): boolean {
  return settings?.enabled !== false;
}

export type ReportModeSettings = z.infer<typeof reportModeSettingsSchema>;
export type ReportSettings = z.infer<typeof reportSettingsSchema>;

/**
 * PRD-50 §4 (FR-11): ONE named group of sections, stored in `tests.section_groups_json`.
 * A section joins it by `test_sections.group_key`; a key nothing points at is legal (an
 * empty group simply does not print — FR-12).
 *
 * `order` is OPTIONAL although the list is called ordered: the list already carries its
 * order in the position of its elements, and demanding the number would reject perfectly
 * meaningful data written by an importer or baked into a SCORM package. The core sorts by
 * `order` where it is present and falls back to the position where it is not
 * (`shared/scoring/section-groups`).
 */
export const sectionGroupSchema = z.object({
  key: z.string().trim().min(1).max(64),
  label: z.string().trim().max(200),
  order: z.number().int().min(0).optional(),
});

/**
 * `tests.section_groups_json` — the test's groups in author order. Absent column = no
 * groups at all, i.e. exactly today's flat list of topic cards (FR-27).
 *
 * Duplicate keys are rejected: two groups with one key make a section's membership
 * ambiguous, and the resolver would have to pick one silently.
 */
export const sectionGroupsSchema = z.array(sectionGroupSchema).superRefine((groups, ctx) => {
  const seen = new Set<string>();
  for (const g of groups) {
    if (seen.has(g.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Повторяющийся ключ блока: ${g.key}` });
      return;
    }
    seen.add(g.key);
  }
});

export type SectionGroup = z.infer<typeof sectionGroupSchema>;

export const tests = pgTable("tests", {
  id: varchar("id", { length: 36 }).primaryKey(),
  folderId: varchar("folder_id", { length: 36 }),
  // PRD-13 RBAC: test owner (a content-role user). Null = unowned legacy test,
  // accessible only to administrators/superadmin until an admin assigns an owner.
  ownerId: varchar("owner_id", { length: 36 }),
  title: text("title").notNull(),
  description: text("description"),
  /**
   * PRD-59 FR-02: the format `description` is written in. The column holds the
   * FORMAT only — the text itself stays the author's source in `description`, so
   * every plain consumer (the letter's text part, the package's XML metadata, the
   * Excel workbook) keeps reading what it always read.
   *
   * The spelling repeats `feedbackContentSchema.format` deliberately: a second
   * vocabulary of formats in the product is how two screens start disagreeing about
   * what «Форматированный» means.
   */
  descriptionFormat: text("description_format", {
    enum: ["plain", "richText", "html"],
  }).notNull().default("plain"),
  mode: text("mode", { enum: ["standard", "adaptive"] }).notNull().default("standard"),
  showDifficultyLevel: boolean("show_difficulty_level").notNull().default(true),
  overallPassRuleJson: jsonb("overall_pass_rule_json").notNull(),
  /**
   * How the overall threshold and the per-topic gates combine into the verdict
   * (`docs/architecture/test-settings-parameter-structure.md` §3.4, PRD-4 §5.2).
   * The editor radio group «Тест пройден, если» writes exactly this column.
   *
   * The backfill migration derives it for existing tests from their topic rules
   * (`overall_and_required_topics` when any topic carries an own rule, otherwise
   * `overall_only`) — the same derivation the editor used to display while the
   * column did not exist, so no author sees their setting change under them.
   */
  passDecisionPolicy: text("pass_decision_policy", {
    enum: [
      "overall_only",
      "overall_and_required_topics",
      "required_topics_only",
      "all_topics_passed",
    ],
  })
    .notNull()
    .default("overall_only"),
  webhookUrl: text("webhook_url"),
  /** @deprecated PRD-7: superseded by `status`. Kept for transitional backward compatibility; remove in a later release. */
  published: boolean("published").default(false),
  status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  /**
   * @deprecated PRD-61 §10: общая обратная связь УРОВНЯ ТЕСТА снята. Колонка не читается ни
   * одним хостом, не запекается в пакет, не выгружается книгой и не правится из ящика —
   * её назначение закрыли три вводных текста (`intro_json`). Оставлена, чтобы снятие можно
   * было откатить без потери данных; сносится отдельной миграцией (пункт технического долга
   * ROADMAP §0.3). Обратная связь ТЕМ и РАЗДЕЛОВ — другие колонки, они живы.
   */
  feedback: text("feedback"),
  /** @deprecated PRD-61 §10 — см. {@link feedback} выше. */
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
  /**
   * PRD-30 FR-16: the test-wide delivery order, and the default every topic
   * inherits unless it overrides it (`test_sections.question_order`).
   *
   * `random` (default, today's behaviour) shuffles inside each topic and keeps
   * topics as blocks; `fixed` delivers topics and questions in the author's
   * order; `shuffle_all` merges the questions of ALL topics into one shuffled
   * stream and is offered only in the flat flow (FR-17) — a topic that stays
   * `fixed` is then delivered as one unbroken block (FR-20).
   */
  questionOrder: text("question_order", { enum: ["fixed", "random", "shuffle_all"] })
    .notNull()
    .default("random"),
  // PRD-19 (FR-01): allow skipping a question and returning to unanswered ones within an
  // attempt. Default true (new tests); migration 031 backfills EXISTING tests to false to
  // preserve their strict-linear navigation.
  allowReturnToUnanswered: boolean("allow_return_to_unanswered").notNull().default(true),
  // PRD-19 (FR-04a): permit changing an already-submitted answer before section/test finish.
  // Default false. Depends on allowReturnToUnanswered=true and is mutually exclusive with
  // showCorrectAnswers (FR-04b) — enforced in the editor/service layer, not as a DB CHECK.
  allowAnswerChange: boolean("allow_answer_change").notNull().default(false),
  // PRD-19 (FR-11a): free navigation inside the CURRENT section — any question of it is a
  // jump target, including one not shown yet, so «не выдан» stops existing within the
  // section. The section boundary still holds (FR-11b): a neighbouring section is out of
  // reach until the current one is finished, a finished section stays locked, the flat flow
  // spreads the freedom over the whole test, and adaptive topics ignore the setting — there
  // the ladder of levels decides the order. Depends on allowReturnToUnanswered=true (FR-11c):
  // without return the pills are an indicator, not navigation. Default false so an existing
  // test keeps today's frontier without its author touching anything.
  allowFreeSectionNavigation: boolean("allow_free_section_navigation").notNull().default(false),
  // PRD-43: independent of allowReturnToUnanswered — whether submitting an answer
  // also advances to the next question in one click, or needs a separate «Далее»
  // click. Default false (today's two-step behaviour for a brand-new test); the
  // backfill migration sets EXISTING rows to `NOT allow_return_to_unanswered` so
  // no existing test's navigation changes after this ships.
  quickAdvance: boolean("quick_advance").notNull().default(false),
  // PRD-19 (FR-05a): show the section-results screen (optional system node, sectioned tests).
  // Default true; not applicable to linear_flat (no sections) — ignored by the runtime there.
  showSectionResults: boolean("show_section_results").notNull().default(true),
  // PRD-67: leaving a started section with a time limit (its own or the test's) CLOSES it
  // instead of freezing its clock — the frozen clock let a learner read a question, close
  // the tab, look the answer up and come back. A test without sections is one section, so
  // there leaving ends the attempt. Default false: every existing test keeps its behaviour.
  closeSectionOnLeave: boolean("close_section_on_leave").notNull().default(false),
  // Какой результат SCORM-пакет отдаёт в LMS, когда попыток несколько: лучшую по проценту
  // или только что завершённую. Стандарт этого не решает — SCORM не предписывает LMS ничего
  // о хранении истории, и платформы (Moodle, Blackboard, Teachbase) держат выбор у себя,
  // ожидая от содержимого данные ТЕКУЩЕЙ попытки. Но LMS, хранящая лишь снимок, при выборе
  // «последняя» безвозвратно перекроет удачную попытку неудачной, поэтому решает автор.
  // Умолчание 'last' — то, чего ждёт платформа: содержимое отчитывается за текущую попытку,
  // а какую засчитать, решает LMS своей настройкой. Тесты, заведённые до этой колонки,
  // остались на 'best' (значение проставлено миграцией 0022) — их поведение не меняется.
  // В вебе настройка не применяется: внешней системы там нет, попытки показываются каждая
  // сама по себе.
  lmsAttemptResult: text("lms_attempt_result", { enum: ["best", "last"] })
    .notNull()
    .default("last"),
  // Обзор при полностью отвеченном объёме. `shouldShowReview` выводит показ из ПРАВ
  // навигации, и по ним обзор при разрешённой правке полезен всегда; нужен ли он тесту,
  // который проходят подряд и ни к чему не возвращаются, — суждение о методике, и вынести
  // его может только автор. Default false: ни один настроенный тест не меняет выдачу.
  // Действует ТОЛЬКО когда пропущенных нет — путь к пропущенному не отнимается никогда.
  skipReviewWhenComplete: boolean("skip_review_when_complete").notNull().default(false),
  // PRD-34 (FR-01): protection of the question text from casual copying. Default TRUE —
  // existing tests DO change behaviour, which is the accepted decision (FR-03), not a
  // side effect. A training test whose text is meant to be taken away turns it off.
  copyProtection: boolean("copy_protection").notNull().default(true),
  // PRD-34 (FR-16): anonymised watermark over the scene. Independent of copyProtection
  // (FR-02) — attribution is useful on its own. Default false.
  protectionWatermark: boolean("protection_watermark").notNull().default(false),
  // PRD-34 (FR-21): hide the task while the window is not active. Independent too.
  protectionHideOnBlur: boolean("protection_hide_on_blur").notNull().default(false),
  // PRD-27 (D-4): выбранный вариант ОТЧЁТА и значения его полей, по режиму теста.
  // Отдельно от `design_settings_json`, хотя выбор и принадлежит шаблону: тот коммитится
  // черновиком вкладки «Оформление», а поля отчёта живут в блоке обратной связи вкладки
  // «Настройки», и один черновик связал бы две вкладки порядком сохранения (§4.2).
  // NULL = автор ничего не выбирал: берётся вариант с `isDefault`.
  reportSettingsJson: jsonb("report_settings_json").$type<ReportSettings>(),
  /**
   * Вводные блоки экрана итогов и отчёта (см. {@link testIntroSchema}). Своя колонка, а не
   * ветвь `report_settings_json`: текст экрана к настройкам отчёта отношения не имеет, и
   * складывать их вместе значило бы связать два независимых черновика редактора.
   */
  introJson: jsonb("intro_json").$type<TestIntro>(),
  /**
   * PRD-50 FR-13: breakdown display setting. `hidden` (default) means this test behaves
   * exactly as it did before PRD-50. `basis` picks the NUMBER shown on screen, not the
   * verdict's currency — the pass threshold is always evaluated in points.
   */
  breakdownDisplayJson: jsonb("breakdown_display_json").$type<{
    visibility: "hidden" | "bar" | "bar_and_value";
    basis: "units" | "points";
    /** PRD-50 FR-44 (Э4): nested bars, the test-scope block, or both. Absent = nested. */
    placement?: "topics" | "block" | "both";
  }>(),
  /**
   * PRD-50 FR-53: учитывать ли подтемы в вердикте темы. `false` (умолчание и значение
   * бэкфилла) = подтема говорит о результате, но не судит его — поведение до §16.
   */
  breakdownGateEnabled: boolean("breakdown_gate_enabled").notNull().default(false),
  /**
   * PRD-50 FR-11: named groups of sections, in author order (see {@link sectionGroupSchema}).
   * Null/empty = no groups, and the results screen prints exactly the flat list of topic
   * cards every test has printed so far (FR-27).
   */
  sectionGroupsJson: jsonb("section_groups_json").$type<SectionGroup[]>(),
}, (table) => ({
  // Test lists filter by lifecycle status (draft/published/archived).
  statusIdx: index("tests_status_idx").on(table.status),
}));

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
  // PRD-52: `review` opens the reviewer screen of ONE test (comments + a throwaway
  // run) and nothing else. Stored as plain text, so the value needs no migration.
  accessLevel: text("access_level", { enum: ["edit", "assign", "review"] }).notNull(),
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
  /**
   * PRD-50 FR-50: обратная связь ПОДТЕМ этого раздела — карта «ключ -> текст с
   * рекомендациями». NULL = у подтем текста нет, и результат печатается ровно как раньше.
   * Своя колонка, а не поле правил: правило — оценка, текст — содержание результата.
   */
  breakdownFeedbackJson: jsonb("breakdown_feedback_json").$type<BreakdownFeedbackShape<FeedbackContent>>(),
  /**
   * ТОЛКОВАНИЕ темы, заданное ЭТИМ ТЕСТОМ. Заменяет текст самой темы целиком (не
   * складывается с ним) — то же правило, что у обратной связи темы: две редакции одного
   * текста, склеенные в выдаче, автор нигде не видит и не может проверить.
   *
   * Правка из ящика теста пишется ТОЛЬКО сюда: тема общая для многих тестов, и менять её
   * из редактора одного теста значило бы править чужие тесты. NULL = берётся текст темы.
   */
  interpretationJson: jsonb("interpretation_json").$type<InterpretationText>(),
  /**
   * ТОЛКОВАНИЯ ПОДТЕМ (тегов) этого раздела — карта «ключ подтемы -> текст».
   *
   * Своя колонка, а не ветвь `breakdown_feedback_json`: та несёт РЕКОМЕНДАЦИЮ, у неё своё
   * правило выдачи (доля подтемы ниже общего порога теста) и свой адресат — сводный блок
   * рекомендаций. Толкование печатается всегда, когда автор включил его показ, и стоит под
   * полосой своей подтемы. Два разных правила в одном поле не живут.
   *
   * Сущности «тег» в базе нет (теги — строки в `questions.tags`), поэтому текст принадлежит
   * РАЗДЕЛУ: в другом тесте та же подтема описывается заново. NULL = толкований нет.
   */
  breakdownInterpretationJson: jsonb("breakdown_interpretation_json")
    .$type<BreakdownFeedbackShape<InterpretationText>>(),
  /**
   * PRD-50 FR-11/FR-12: the group this section belongs to — a `key` of the test's
   * `section_groups_json`. Null = the section belongs to no group and prints after all
   * groups, in its own order (FR-25); a key no group declares means the SAME thing, so a
   * deleted group never hides a section (FR-12). No FK: the groups live in a JSON column,
   * and the resolver in `shared/scoring/section-groups` is where the reference is made
   * good — on both hosts, over stored attempts and baked packages alike.
   */
  groupKey: text("group_key"),
  /**
   * PRD-30 FR-02/FR-18: how this topic's questions are ordered on delivery.
   * `random` shuffles the drawn set (today's behaviour), `fixed` orders it by
   * `questions.order_index` (FR-03) or, in variants mode, by the variant's own
   * list (FR-07).
   *
   * NULL is the default and means «как в тесте» — the topic inherits
   * `tests.question_order`. A value here is an OVERRIDE, and the editor shows a
   * reset control next to it precisely because a value is present. An enum
   * rather than a boolean so the next position («by ascending difficulty»)
   * needs no second migration.
   */
  questionOrder: text("question_order", { enum: ["random", "fixed"] }),
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
  // getTestSections filters by test_id and orders by sort_order (editor topic order).
  testIdSortIdx: index("test_sections_test_id_sort_order_idx").on(table.testId, table.sortOrder),
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
  /**
   * PRD-31 (FR-12): the assignment this attempt was taken under. The assignment is
   * the UNIT OF ACCESS: `maxAttempts` and the hour interval (barrier B) are counted
   * INSIDE it, while the calendar cooldown (barrier A) gates the FIRST attempt of a
   * new one. NULL = a legacy row or an attempt taken outside any assignment; all
   * such rows behave as ONE implicit assignment (FR-13). No FK on purpose — a
   * deleted assignment simply stops being "current", which is the intended meaning.
   *
   * Deliberately NOT indexed: every caller already loads a learner's attempts of one
   * test through `(user_id, test_id)` and splits them by assignment in memory, so a
   * third index would only cost writes on the fastest-growing table.
   */
  assignmentId: varchar("assignment_id", { length: 36 }),
  variantJson: jsonb("variant_json").notNull(),
  answersJson: jsonb("answers_json"),
  resultJson: jsonb("result_json"),
  /**
   * Section time budgets of THIS attempt (`shared/flow/section-budget`), kept
   * server-side on purpose: the remaining time of a section decides whether the
   * learner may keep answering, so it must not live where the learner can edit it
   * (it used to sit in `localStorage`). Shape: `{ budgets, lastSeenAt, activeMs }`
   * plus the PRD-67 fields `{ runId, gate }` (page-run identity and open/closed
   * sections). NULL for attempts of tests without section limits.
   */
  sectionTimerJson: jsonb("section_timer_json"),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
}, (table) => ({
  // Attempts is the fastest-growing table; these back the hot read/delete paths.
  // (user_id, test_id) also serves user-only lookups via the leading column.
  userTestIdx: index("attempts_user_test_idx").on(table.userId, table.testId),
  // testId filter: annul in-progress, snapshot reference scan, deep test delete.
  testIdIdx: index("attempts_test_id_idx").on(table.testId),
  // Snapshot referential lookups (PRD-15 block B).
  snapshotIdIdx: index("attempts_snapshot_id_idx").on(table.snapshotId),
}));

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
  /**
   * PRD-56 FR-17a: задание исключено из выдачи ЭТОГО теста.
   *
   * Состояние, а не разовая команда: выдача перестаёт его брать, пока признак стоит. Живёт
   * здесь, а не у вопроса, потому что негодное ЗДЕСЬ задание может быть годно в другом тесте,
   * а отключение в банке — операция владельца темы, а не читателя аналитики. Собранные
   * ответы и статистика сохраняются: из аналитики задание не пропадает.
   */
  excludedFromDelivery: boolean("excluded_from_delivery").notNull().default(false),
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
export const insertTopicSchema = createInsertSchema(topics).omit({ id: true, updatedAt: true }).extend({
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
  // drizzle-zod types jsonb loosely; validate the retake policy (PRD-6) and the
  // section groups (PRD-50 FR-11) explicitly.
  .extend({
    retakePolicyJson: retakePolicySchema.nullish(),
    sectionGroupsJson: sectionGroupsSchema.nullish(),
  });
export const insertTestSectionSchema = createInsertSchema(testSections)
  .omit({ id: true })
  // drizzle-zod types jsonb loosely; validate the draw blueprint + variant set explicitly.
  .extend({
    drawBlueprintJson: drawBlueprintSchema.nullish(),
    formSetJson: formSetSchema.nullish(),
    // `breakdownFeedbackJson` НЕ валидируется здесь: его схема опирается на
    // `feedbackContentSchema`, объявленную ниже по файлу (обратная связь темы), а этот
    // insert-схемой пользуются раньше. Проверку делает маршрут записи разделов теста,
    // как и для остальных «живых» JSON-колонок.
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
 * PRD-24: per-variant pass threshold. Stored inside a topic rule's `byForm`,
 * keyed by the stable PRD-17 `formId`. `percent` compares the points-based
 * percent; `absolute` compares Σ earned points of the delivered variant
 * (same basis as the other sources — PRD-10 FR-10).
 */
export const byVariantThresholdSchema = z.object({
  type: z.enum(["percent", "absolute"]),
  value: z.number(),
});

export type ByVariantThreshold = z.infer<typeof byVariantThresholdSchema>;

/**
 * PRD-24: the topic pass-rule union as stored in
 * `test_sections.topic_pass_rule_json`. `by_variant` carries a per-`formId`
 * threshold map (PRD-17 variants); the other three sources are the PRD-7 ones.
 * `resolveTopicRule` (shared/scoring/pass-rule) stays the runtime authority and
 * tolerates legacy shapes, so this schema is for authoring/validation paths.
 */
export const topicPassRuleSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("inherit_overall") }),
  z.object({ source: z.literal("none") }),
  z.object({
    source: z.literal("custom"),
    type: z.enum(["percent", "absolute"]),
    value: z.number(),
  }),
  z.object({
    source: z.literal("by_variant"),
    byForm: z.record(z.string(), byVariantThresholdSchema),
  }),
]);

export type TopicPassRuleJson = z.infer<typeof topicPassRuleSchema>;

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
  /**
   * Legacy-only: descriptors saved through the retired upload flow (PRD-32) carry the
   * original file name. New rows (PRD-42, title + URL only) do not write it.
   */
  fileName: z.string().optional(),
  /** Legacy-only, see `fileName` above. */
  mimeType: z.literal("application/pdf").optional(),
  /**
   * The material's address. A plain, unvalidated string ON PURPOSE (PRD-42 §7 technical
   * debt): a descriptor saved through the retired upload flow still carries the relative
   * media-library address `/api/media/<id>` here, and tightening this to `.url()` (as
   * `feedbackLinkSchema` does) would make saving ANY test with such a legacy row fail
   * validation. New rows are expected to carry a real external URL, but nothing enforces it.
   */
  url: z.string().optional(),
  /**
   * Read-only legacy field: packages exported before the media library existed carry the
   * in-package address here. New code does not write it — the address belongs in `url`.
   */
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

/**
 * PRD-50 FR-50: обратная связь ПОДТЕМЫ (ключа разреза) внутри одного раздела теста.
 *
 * Отдельная колонка, а не поле внутри `breakdown_rules_json`, по той же причине, по которой
 * квоты и пороги живут врозь: правило — это оценка, а текст — содержание результата.
 * Пороги к тому же перестали что-либо судить (решение владельца 2026-09-03), и подмешивать
 * к ним живой авторский текст значило бы хоронить его в легаси-структуре.
 *
 * Формат значения — тот же `feedback_json`, что у темы и у раздела (`format`, `text`,
 * `links`, `assets`, `events`), поэтому текст подтемы собирается тем же сборщиком
 * рекомендаций и печатается теми же блоками.
 *
 * Ключ записи — ключ подтемы КАК ЕГО НАПИСАЛ АВТОР; сопоставление идёт через `tagKey`
 * (регистр и пробелы), как и везде в разрезе. Пустая запись = текста нет.
 */
export const breakdownFeedbackSchema = z.object({
  axis: z.literal("tag"),
  keys: z.record(z.string(), feedbackContentSchema),
});

/**
 * ВВОДНЫЙ ТЕКСТ — блок, который идёт ПЕРВЫМ, до всего остального: до сводки баллов, до тем,
 * до измерений и рекомендаций. Объясняет слушателю, что он сейчас читает.
 *
 * Формат тот же, что у обратной связи (`plain` / `richText` / `html`), и разметку из него
 * строит тот же {@link module:shared/template/rich-text richTextToHtml}: автор пишет эти
 * тексты в одном редакторе и вправе ожидать одинакового поведения.
 *
 * Пустой текст = блока нет. Гейт стоит именно на тексте, а не на наличии записи: автор,
 * стерший текст, ожидает, что блок исчезнет, а не станет пустой рамкой.
 */
export const introTextSchema = z.object({
  format: feedbackFormatSchema.default("plain"),
  text: z.string().default(""),
});

/**
 * ВВОДНЫЙ ТЕКСТ одной выдачи (PRD-61): общее вступление плюс необязательные тексты по исходу.
 *
 * `format`/`text` — общее вступление, печатаемое при ЛЮБОМ исходе. Это ровно тот текст, что
 * лежал здесь до PRD-61, и смысл его не менялся: он и тогда печатался всегда. `passed` и
 * `failed` печатаются ВТОРЫМ блоком, под ним, и только когда вердикт вынесен — правило живёт
 * в {@link module:shared/report/report-intro}, а не здесь.
 *
 * Ветви исхода — тексты, а не блоки ({@link introTextSchema}): у текста исхода не может быть
 * собственных текстов исхода.
 *
 * Отсутствие ветвей — не порча данных и не переходное состояние, а вечный вход: так выглядит
 * всякий тест, заведённый до PRD-61, всякий снимок публикации, сделанный до него (снимок
 * морозит строку теста целиком и не мигрируется), и всякий SCORM-пакет, собранный раньше.
 */
export const introBlockSchema = introTextSchema.extend({
  passed: introTextSchema.nullish(),
  failed: introTextSchema.nullish(),
});

/**
 * ТОЛКОВАНИЕ — текст, который объясняет результат темы или подтемы.
 *
 * Форма та же, что у вводного блока (`format` + `text`), и разметку из него строит тот же
 * `richTextToHtml`: автор пишет все эти тексты в одном редакторе и вправе ожидать
 * одинакового поведения. Вложений (курсы, материалы, мероприятия) у толкования НЕТ — они
 * принадлежат рекомендации, а толкование не советует, а объясняет.
 *
 * Пустой текст = толкования нет: гейт стоит на тексте, а не на наличии записи, иначе автор,
 * стерший текст, получил бы пустую строку вместо исчезнувшего блока.
 */
export const interpretationSchema = z.object({
  format: feedbackFormatSchema.default("plain"),
  text: z.string().default(""),
});

export type InterpretationText = z.infer<typeof interpretationSchema>;

/**
 * Толкования подтем ОДНОГО раздела: `axis` + карта «ключ подтемы -> текст».
 *
 * Форма повторяет {@link breakdownFeedbackSchema} намеренно: адресация подтемы (ключ как его
 * написал автор, сопоставление через `tagKey`) — это уже решённый вопрос, и второй способ
 * адресовать ту же сущность развёл бы тексты и рекомендации по разным ключам.
 */
export const breakdownInterpretationSchema = z.object({
  axis: z.literal("tag"),
  keys: z.record(z.string(), interpretationSchema),
});

/**
 * `tests.intro_json`. Экран итогов и отчёт — РАЗНЫЕ адресаты: экран читают сразу и бегло,
 * отчёт уносят с собой и показывают специалисту, поэтому тексты хранятся раздельно и
 * задаются независимо. Отсутствие ветви = вводного блока в этой выдаче нет.
 */
export const testIntroSchema = z.object({
  results: introBlockSchema.nullish(),
  report: introBlockSchema.nullish(),
  /**
   * Печатать в отчёте ТОТ ЖЕ текст, что на экране итогов.
   *
   * Не копия при сохранении, а ссылка: автор правит вводное слово в одном месте, и обе
   * выдачи меняются вместе. Скопировать текст в обе ветви значило бы завести вторую
   * редакцию, которая молча разойдётся с первой при следующей правке.
   *
   * Собственный текст отчёта при этом НЕ стирается — он просто не используется, пока
   * переключатель включён, и возвращается, стоит его выключить.
   */
  reportSameAsResults: z.boolean().optional(),
});

export type IntroText = z.infer<typeof introTextSchema>;
export type IntroBlock = z.infer<typeof introBlockSchema>;
export type TestIntro = z.infer<typeof testIntroSchema>;

/**
 * `tests.breakdown_display_json` (PRD-50 FR-13). `visibility` gates whether the
 * key-breakdown rows (tag subtotals) print on the topic card at all; `hidden`
 * (absent column) reproduces the byte-identical screen a test built before PRD-50
 * has always shown. `basis` picks the NUMBER the bar carries, never the pass
 * verdict's currency — the threshold is always evaluated in points.
 */
export const breakdownDisplaySchema = z.object({
  visibility: z.enum(["hidden", "bar", "bar_and_value"]),
  basis: z.enum(["units", "points"]),
  /**
   * PRD-50 FR-28/FR-44 (Э4): where the visible breakdown is printed — nested in the topic
   * cards, as the test-scope summary block, or both. OPTIONAL on purpose: every setting
   * saved before Э4 lacks it, and absence has to keep meaning exactly what those tests
   * already print, i.e. `topics`.
   */
  placement: z.enum(["topics", "block", "both"]).optional(),
  /**
   * Печатать ли ТОЛКОВАНИЯ подтем (`test_sections.breakdown_interpretation_json`).
   *
   * Живёт здесь, рядом с остальными решениями «что показывает строка подтемы», а не у
   * текстов: показ и содержание — разные вопросы, и автор ищет «показывать или нет» там,
   * где уже стоят вид полосы, база и место печати.
   *
   * ОТСУТСТВИЕ = НЕ печатать. Референс сертификата толкований подтем не содержит, и ни один
   * существующий тест не должен получить их молча — включение остаётся действием автора.
   * Показ вложен в показ самих подытогов: при `visibility: "hidden"` строк подтем нет, и
   * печатать толкование некуда.
   */
  showInterpretation: z.boolean().optional(),
});

export type BreakdownDisplaySetting = z.infer<typeof breakdownDisplaySchema>;

/**
 * Вводный блок ОТЧЁТА с учётом переключателя «как на экране итогов».
 *
 * Реэкспорт: само правило живёт в чистом `shared/report/report-intro`, потому что тот же
 * ответ нужен ВНУТРИ SCORM-пакета, а схему туда не затащить — она тянет drizzle и zod.
 */
export { resolveReportIntro } from "./report/report-intro";

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

/**
 * Budget-allocation question (PRD-44 FR-02 - FR-05). The statements live in `options`,
 * the SAME field single/multiple/scale use, so every existing reader of `dataJson.options`
 * — the option editor, the workbook column, the font-fitting pass, the preview — keeps
 * working with no change of its own.
 *
 * `maxPerOption` defaults to the whole budget and cannot be defaulted with `.default()`:
 * it depends on a sibling field, so the fallback is applied in the transform. The
 * feasibility rule (`count * min <= budget <= count * max`) is checked HERE rather than
 * only in the editor, because without it an author can save a configuration no learner can
 * complete — the reference discussion asked for a floor of 2 across four statements on a
 * budget of 7, i.e. 8 points out of 7 available. The message names both numbers.
 */
export const allocationDataSchema = z
  .object({
    options: z
      .array(z.string().trim().min(1, "Подпись утверждения не может быть пустой"))
      .min(2, "Утверждений должно быть не меньше двух")
      .max(10, "Утверждений должно быть не больше десяти"),
    budget: z.number().int().min(1).max(1000),
    minPerOption: z.number().int().min(0).optional(),
    maxPerOption: z.number().int().min(0).optional(),
  })
  .transform((d) => ({
    options: d.options,
    budget: d.budget,
    minPerOption: d.minPerOption ?? 0,
    maxPerOption: d.maxPerOption ?? d.budget,
  }))
  .superRefine((d, ctx) => {
    if (d.minPerOption > d.maxPerOption) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minPerOption"],
        message: "Минимум на вариант не может превышать максимум",
      });
      return;
    }
    if (d.maxPerOption > d.budget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxPerOption"],
        message: "Максимум на вариант не может превышать бюджет",
      });
      return;
    }
    const feasibility = isAllocationFeasible(d);
    if (feasibility.ok) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [feasibility.kind === "min" ? "minPerOption" : "maxPerOption"],
      message:
        feasibility.kind === "min"
          ? `Распределение невыполнимо: минимумы требуют ${feasibility.required} баллов, а бюджет — ${feasibility.available}`
          : `Распределение невыполнимо: нужно распределить ${feasibility.required} баллов, а максимумы дают только ${feasibility.available}`,
    });
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

/**
 * PRD-57 §6.1: the answer check of an open question, stored in `questions.correct_json`.
 *
 * The rules ARE the answer key of a short answer, which is why they live in the existing
 * key column rather than in one of their own: snapshots, the SCORM bake, test transfer
 * and the Excel workbook already carry that column.
 *
 * `match: "regex"` is accepted since Э7 — together with the time budget it could not ship
 * without (FR-28q). Validation does NOT reject an expression that fails to compile: the
 * editor measures and warns, but the decision stays with the author (FR-28p1), and a rule
 * saved through the Excel workbook must not be silently dropped either.
 *
 * A RANGE has no operator: it is two rules and the set's join (FR-28aa3).
 */
export const answerRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    match: z.enum(["wildcard", "regex"]),
    value: z.string().min(1),
    /** PRD-57 Э7: замер при сохранении назвал выражение долгим — пакет его не исполняет. */
    slow: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("number"),
    op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]),
    value: z.number().finite(),
    tolerance: z
      .object({ unit: z.enum(["abs", "pct"]), value: z.number().finite().nonnegative() })
      .optional(),
  }),
]);

export const answerRuleSetSchema = z
  .object({
    answerKind: z.enum(["text", "number"]),
    join: z.enum(["any", "all"]),
    rules: z.array(answerRuleSchema),
    unit: z.string().max(16).optional(),
  })
  .refine(
    (set) => set.rules.every((rule) => (set.answerKind === "number" ? rule.kind === "number" : rule.kind === "text")),
    { message: "Вид ответа и правила должны совпадать: текст либо число", path: ["rules"] },
  );

export type AnswerRuleSetInput = z.infer<typeof answerRuleSetSchema>;

/**
 * PRD-57 FR-24: эталон задания «Пропуски» — набор правил НА КАЖДЫЙ пропуск.
 *
 * Хранится в том же `correct_json`, что и у остальных типов: снимок публикации, выпечка
 * пакета, перенос теста и книга Excel уже возят эту колонку, и заводить вторую значило бы
 * учить каждого из них новому месту.
 *
 * Пропуск БЕЗ правил схемой принимается: это не ошибка формы, а несделанная работа —
 * строка списка помечена «Правил нет», и публикация такого задания не пройдёт (FR-24d).
 * Повтор имени, наоборот, отвергается здесь: два поля с общим правилом делают сборку
 * балла неоднозначной, а выигрыша не дают (FR-24a).
 */
export const blanksCorrectSchema = z.object({
  blanks: z.array(
    z
      .object({
        id: z.string().regex(/^[A-Za-z0-9_]+$/, "Имя пропуска — латиница, цифры и подчёркивание"),
      })
      .and(answerRuleSetSchema),
  ),
}).refine(
  (value) => new Set(value.blanks.map((blank) => blank.id)).size === value.blanks.length,
  { message: "Имена пропусков в одном задании не повторяются", path: ["blanks"] },
);

export type BlanksCorrectInput = z.infer<typeof blanksCorrectSchema>;

/**
 * PRD-57 FR-28v: the content of a short answer is its length limit and nothing else.
 *
 * The type has no options, so `data_json` carries just this setting. An ABSENT key means
 * «the system ceiling» (`limits.shortAnswerMaxLength`): storing a copy of the ceiling in
 * every question would freeze it at the moment the question was written, and the ceiling
 * is exactly the number the WebTutor measurement (#51) is expected to move.
 *
 * The upper bound is NOT checked here: the ceiling belongs to an installation's
 * configuration, while this schema is shared by all of them. Holding the author to the
 * ceiling is the editor's job.
 */
export const shortAnswerDataSchema = z.object({
  maxLength: z.number().int().positive().optional(),
});

export type ShortAnswerData = z.infer<typeof shortAnswerDataSchema>;

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
    /**
     * PRD-4 v1.1 §4.7 — is the section OBLIGATORY? Carried beside the time budget
     * and for the same reason: it is what the router's «all_required_*» completion
     * policy counts, and the SCORM package bakes it into `TEST_DATA.sections[]`.
     * Absent on attempts started before it shipped — treat missing as `true`, which
     * is both the column's default and the behaviour those attempts already had.
     */
    required: z.boolean().optional(),
  })),
  /**
   * PRD-30 FR-19: the delivery stream as question ids, when it does NOT follow
   * from concatenating the sections — that is, under the test-wide «полное
   * перемешивание», where the questions of all topics travel interleaved. The
   * per-section lists keep the composition (grading, section screens read them),
   * this keeps the order.
   *
   * Absent for every other test and for pre-PRD-30 attempts: the client then
   * walks the sections in order, exactly as it always has.
   */
  deliveryOrder: z.array(z.string()).optional(),
  /**
   * PRD-66 FR-09b: отпечаток редакции КАЖДОГО выданного задания, карта `id -> отпечаток`.
   *
   * Снимается в момент ВЫДАЧИ, а не ответа, и это не техническая мелочь. Веб отдаёт
   * содержание один раз — на старте, — и дальше участник отвечает на то, что уже у него на
   * экране. Правка задания посреди чужого прохождения не меняет того, что участник видел:
   * «текущая редакция в момент ответа» назвала бы редакцию, которой он не видел, и увела бы
   * наблюдение в чужую серию. Редакция выдачи называет ровно ту, на которую отвечали.
   *
   * Значение `null` — «редакция сменилась по ходу прохождения»: такое наблюдение не
   * принадлежит чисто ни одной редакции и идёт в серию «версия неизвестна» (FR-09c).
   * Отсутствие всего поля — попытка, начатая до появления штампа, с тем же смыслом.
   */
  psychoHashes: z.record(z.string(), z.string().nullable()).optional(),
  /**
   * PRD-66 FR-37a: время, проведённое на каждом задании, в миллисекундах — карта
   * `id -> сумма всех заходов`.
   *
   * СУММА, а не последний заход: при разрешённом возврате к неотвеченным человек уходит с
   * задания и возвращается, и «последний заход» показал бы две секунды на том, над чем думали
   * минуту. Считает тот же счётчик, что и в пакете (`shared/questions/question-time`), — два
   * хоста, меряющие время по-разному, сделали бы источники несравнимыми.
   *
   * Живёт здесь, а не в карте ответов: та плоская, «задание -> значение ответа», её целиком
   * присылает клиент, и читают её движок оценивания и аналитика. Отсутствие поля — попытка,
   * пройденная до появления замера: у её ответов времени нет, и это «не измерялось», а не ноль.
   */
  latencyMs: z.record(z.string(), z.number().nonnegative()).optional(),
});

export type TestVariant = z.infer<typeof testVariantSchema>;

export const attemptAnswerSchema = z.record(z.string(), z.unknown());
export type AttemptAnswers = z.infer<typeof attemptAnswerSchema>;

/**
 * One PRD-50 breakdown record as it is STORED with an attempt — the mirror of
 * `shared/breakdown/types`'s `BreakdownEntry`. Declared once because three places keep
 * the very same record (a topic's own scope, the test scope, an adaptive topic's scope),
 * and three hand-written copies would drift the moment the record gains a field.
 */
export const breakdownEntrySchema = z.object({
  scope: z.string(),
  axis: z.string(),
  key: z.string(),
  items: z.number(),
  answered: z.number(),
  earned: z.number(),
  possible: z.number(),
  unitEarned: z.number(),
  unitPossible: z.number(),
  percentPoints: z.number(),
  percentUnits: z.number(),
  // PRD-50 Э2: the key's own verdict, stamped by `applyBreakdownGate` when the section
  // declares a threshold for it. `null` = the key is ungated or was not delivered at all
  // (`items = 0`); absent = written before thresholds existed. Declared here and not only
  // on the TS type because zod STRIPS undeclared keys: without this line the verdict would
  // be computed, stored into the object, and silently dropped on the way through the schema.
  passed: z.boolean().nullable().optional(),
});

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
  // PRD-32: PDF attachments of the topic (`topics.feedback_json`) and of this test's
  // section over it (`test_sections.feedback_json`), addresses already normalised at
  // grading time. Stored WITH the attempt, like the courses above: the results screen
  // renders from the saved result, and re-reading live content would hand a past
  // attempt today's materials. `.default([])` keeps attempts graded before PRD-32 valid.
  recommendedAssets: z.array(z.object({ title: z.string(), url: z.string() })).default([]),
  // Feedback texts of the topic (`topics.feedback_json.text`, or the legacy
  // `topics.feedback` column) and of this test's section over it
  // (`test_sections.feedback_json.text`). Stored WITH the attempt, like the
  // recommendations above: the results screen renders from the saved result, and
  // re-reading live content would hand a past attempt today's wording.
  // An ARRAY and not one glued string on purpose — the topic and the section are two
  // INDEPENDENT authoring points; gluing them would lose the boundary the consolidated
  // recommendations block de-duplicates on. `.default([])` keeps attempts graded before
  // this work valid.
  feedbackTexts: z.array(z.string()).default([]),
  // PRD-50: breakdown records of THIS section's scope, stored WITH the attempt like the
  // recommendations above — the results screen renders from the saved result, and
  // recomputing from live content would hand a past attempt today's tags.
  // `.default([])` keeps attempts graded before PRD-50 valid.
  breakdown: z.array(breakdownEntrySchema).default([]),
  // PRD-50 FR-11: the group (`test_sections.group_key`) this section was DELIVERED in.
  // Stored WITH the attempt for the same reason as everything above it: the results
  // screen renders from the saved result, so an attempt keeps the membership it was
  // graded under even if the author regroups the test afterwards.
  //
  // `.optional()` and NOT `.default(null)`: a section outside every group must add no
  // key at all, so the result JSON of a test that never used groups stays byte-identical
  // to what it has always been (FR-27).
  groupKey: z.string().optional(),
});

export const attemptResultSchema = z.object({
  totalCorrect: z.number(),
  totalQuestions: z.number(),
  overallPercent: z.number(),
  totalEarnedPoints: z.number(),
  totalPossiblePoints: z.number(),
  overallPassed: z.boolean(),
  topicResults: z.array(topicResultSchema),
  // PRD-50 FR-39: records of the TEST scope. Section-scope records live on their own
  // topics and are NOT duplicated here — one record, one place. `optional()`, not
  // `.default([])`: an absent field means "attempt finished before this work", and
  // analytics needs to tell that apart from "test has no tags" to know whether it can
  // trust an empty list.
  breakdowns: z.array(breakdownEntrySchema).optional(),
  // PRD-12 (web parity): graded namespaces computed via @shared engines, present
  // only when the test defines scales (PRD-5) / result variables (PRD-2). Absence
  // keeps the legacy result shape and old stored results valid (back-compat).
  scaleResults: z.record(z.string(), z.unknown()).optional(),
  resultVariables: z.record(z.string(), z.unknown()).optional(),
  status: z.object({ success: z.boolean().optional(), completion: z.boolean().optional() }).optional(),
  /**
   * PRD-57 (#43): исход КАЖДОГО ответа этой попытки.
   *
   * `optional()`, а не `.default([])`, по той же причине, что и у разрезов выше:
   * отсутствие поля означает «попытка завершена до этой работы», и аналитика обязана
   * отличать это от «вопросов не было» — в первом случае она считает исход на месте, во
   * втором считать нечего.
   */
  questionOutcomes: z
    .array(
      z.object({
        questionId: z.string(),
        // PRD-57 FR-35: четвёртое состояние — «ждёт проверки». Оно ОБЯЗАНО быть здесь,
        // а не только в агрегате: `attemptResultSchema` — второй контракт результата, и
        // поле, не объявленное в нём, срезается на записи без единой ошибки.
        result: z.enum(["correct", "incorrect", "neutral", "pending"]),
        earned: z.number(),
        possible: z.number(),
      }),
    )
    .optional(),
  /**
   * PRD-57 FR-36: оценка завершена — или результат предварительный.
   *
   * `optional()`: у попытки, завершённой до этой работы, признака нет, и читатель обязан
   * отличать это от «оценка не завершена». Отсутствие означает «вопрос не задавался»,
   * а не «предварительно».
   */
  gradingComplete: z.boolean().optional(),
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
  // The SAME two fields the standard `topicResultSchema` carries, and for the same
  // reason: the results screen renders from the SAVED result, so what the author wrote
  // for the topic (`topics.feedback_json`) and for this test's section over it
  // (`test_sections.feedback_json`) travels WITH the attempt — re-reading live content
  // would hand a past attempt today's wording and today's files.
  //
  // They live here and not only on the standard result because the consolidated
  // recommendations block is a property of the TEST, not of its flow mode: an author who
  // hung a leaflet on a topic owes it to the learner of an adaptive test just the same.
  // `.default([])` keeps adaptive attempts finished before this work valid — they simply
  // carry nothing.
  recommendedAssets: z.array(z.object({ title: z.string(), url: z.string() })).default([]),
  feedbackTexts: z.array(z.string()).default([]),
  // PRD-50 FR-17/FR-39: записи разреза области ЭТОЙ темы, по той же причине и по той же
  // схеме, что у стандартного результата. `.default([])` держит валидными адаптивные
  // попытки, завершённые до этой работы.
  breakdown: z.array(breakdownEntrySchema).default([]),
});

export const adaptiveAttemptResultSchema = z.object({
  mode: z.literal("adaptive"),
  overallPassed: z.boolean(),
  topicResults: z.array(adaptiveTopicResultSchema),
  // issue #33: the graded namespaces of THIS attempt — scales (PRD-5) and indicators
  // (PRD-2) — computed once at finish and never recomputed on read, exactly as on the
  // standard result. They live here because a scale is fed by the measurements hung on
  // questions, and an adaptive test asks questions like any other; the values used to
  // reach the LMS from the package while no host showed them on the results screen.
  //
  // Optional, like their standard counterparts: a test with neither scales nor
  // indicators stores nothing, and adaptive attempts finished before this work stay
  // valid. No `status` twin, though: `controls_status` does not override an adaptive
  // verdict — that one is pronounced by the confirmed levels (see `buildAdaptiveResult`).
  scaleResults: z.record(z.string(), z.unknown()).optional(),
  resultVariables: z.record(z.string(), z.unknown()).optional(),
  // PRD-50 FR-39: записи области ТЕСТА. Как и у стандартного результата — `optional()`,
  // и секционные здесь не дублируются: они лежат на своих темах.
  breakdowns: z.array(breakdownEntrySchema).optional(),
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
  questionType: z.enum(["single", "multiple", "matching", "ranking", "scale", "allocation", "short", "blanks", "long"]),
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
  questionType: z.enum(["single", "multiple", "matching", "ranking", "scale", "allocation", "short", "blanks", "long"]),
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

/**
 * PRD-54: одна строка на загруженную выгрузку отчёта LMS.
 *
 * Хранит ровно столько, сколько нужно для аудита и отката: сам файл на диск не кладётся, от него
 * остаются имя и sha-256 содержимого. По хешу импорт отвечает «этот файл уже грузили», по
 * `batch_id` в `scorm_attempts` партия откатывается целиком.
 */
export const lmsImportBatches = pgTable("lms_import_batches", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  groupId: varchar("group_id", { length: 36 }),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  anonymized: boolean("anonymized").notNull(),
  sourceAnonymized: boolean("source_anonymized").notNull(),
  linkUsers: boolean("link_users").notNull(),
  importedBy: varchar("imported_by", { length: 36 }).notNull(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsCreated: integer("rows_created").notNull().default(0),
  rowsUpdated: integer("rows_updated").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  rowsLinked: integer("rows_linked").notNull().default(0),
  /**
   * PRD-66 FR-11: how many interactions of the file were NOT matched to a question of
   * the test. A counter and not a warning line: the share of losses is what decides
   * whether the batch may be counted at all, and a reader has to see it as a number
   * beside the batch, not dig it out of the log.
   */
  rowsUnmatched: integer("rows_unmatched").notNull().default(0),
  /**
   * PRD-66 FR-12: whether the batch's passages take part in the statistics. Switching
   * it off REMOVES the batch from the sample without deleting a row — a batch loaded
   * from a damaged export stops distorting the figures, and the data stays in place
   * for a second look. Default `true`: every batch already loaded keeps counting.
   */
  counted: boolean("counted").notNull().default(true),
  warningsJson: jsonb("warnings_json"),
}, (table) => ({
  // Партии перечисляются по тесту, новые первыми.
  testIdIdx: index("lms_import_batches_test_id_idx").on(table.testId),
}));

/**
 * PRD-56 FR-07b: СРЕЗ — сохранённый набор условий отбора прохождений.
 *
 * Хранит УСЛОВИЯ, а не список прохождений (FR-07d): срез пересчитывается при каждом открытии,
 * и группа, выросшая на трёх человек, назавтра показывает четверых, а не вчерашнюю тройку.
 * Принять срез за снимок состава — самая дорогая ошибка чтения, поэтому это сказано и в
 * интерфейсе, и здесь.
 *
 * Сущность ОДНА с сохранёнными наборами условий `FilterBar`: двух языков отбора в продукте
 * не заводится. Условия описаны тем же словарём, что фильтр реестра.
 */
export const analyticsSlices = pgTable("analytics_slices", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Имя, под которым срез виден в списке и в заголовке колонки сравнения. */
  name: text("name").notNull(),
  /**
   * Роль записи: сохранённый ФИЛЬТР реестра или СРЕЗ аналитики (решение владельца 2026-09-25).
   *
   * Условия у них одного языка, но вопросы разные. Фильтр отвечает «покажи эти прохождения»
   * и может охватывать РАЗНЫЕ тесты. Срез отвечает «вот выборка одного теста, считай по ней»
   * — у него тест ровно один, иначе средние и пороги теряют смысл (FR-07e). Раньше это была
   * одна сущность (FR-07b), и рабочий фильтр из реестра попадал в список сравнения.
   */
  kind: text("kind").notNull().default("slice"),
  /**
   * Тест. У среза заполнен ВСЕГДА и ровно один — это его определение. У сохранённого
   * фильтра NULL: тесты (сколько угодно) живут в условиях отбора.
   */
  testId: varchar("test_id", { length: 36 }),
  /**
   * Условия отбора: `{ testIds, groupIds, sources, outcomes, from, to }` — тот же словарь,
   * что у фильтра реестра. Жёсткой схемы у колонки нет намеренно: словарь условий будет
   * расти (оси разбиения FR-06a), а миграция ради нового необязательного условия — цена,
   * которую платить не за что.
   */
  conditionsJson: jsonb("conditions_json").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: varchar("created_by", { length: 36 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Срезы перечисляются своим владельцем, новые первыми.
  ownerIdx: index("analytics_slices_owner_idx").on(table.createdBy),
  // Имя уникально у одного владельца: два «Отдела продаж» в списке неразличимы.
  ownerNameUq: uniqueIndex("analytics_slices_owner_name_uq").on(table.createdBy, table.name),
}));

export type AnalyticsSlice = typeof analyticsSlices.$inferSelect;
export type InsertAnalyticsSlice = typeof analyticsSlices.$inferInsert;

/**
 * PRD-55 (FR-05, FR-06): материализованный счётчик выдач задания.
 *
 * Корзина — КАЛЕНДАРНЫЙ МЕСЯЦ: скользящее окно тогда считается суммой последних N корзин, а
 * выпавшие из окна строки удаляются уборкой, без пересчёта чего-либо. Разбивка по тесту нужна
 * отчёту автору («доля попыток ЭТОГО теста»); взвешивание выдачи берёт СУММУ по всем тестам —
 * утечка не разбирает, из какого теста участник увидел вопрос.
 *
 * Таблица — агрегат, а не журнал: она восстановима пересчётом из состава веб-попыток и строк
 * телеметрии (`npm run exposure:rebuild`), поэтому её потеря не теряет фактов.
 */
export const questionExposure = pgTable("question_exposure", {
  questionId: varchar("question_id", { length: 36 }).notNull(),
  testId: varchar("test_id", { length: 36 }).notNull(),
  bucketMonth: date("bucket_month").notNull(),
  deliveredCount: integer("delivered_count").notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.questionId, table.testId, table.bucketMonth] }),
  // Чтение идёт «по списку заданий за окно» — тест в отборе не участвует.
  questionBucketIdx: index("question_exposure_question_bucket_idx").on(table.questionId, table.bucketMonth),
}));

export type QuestionExposure = typeof questionExposure.$inferSelect;
export type InsertQuestionExposure = typeof questionExposure.$inferInsert;

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
}, (table) => ({
  // Packages are listed per test (export history, telemetry).
  testIdIdx: index("scorm_packages_test_id_idx").on(table.testId),
}));

export const scormAttempts = pgTable("scorm_attempts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  // PRD-54: у импортированного прохождения нет ни пакета, ни сессии — оно приехало книгой, а не
  // рантаймом. Для телеметрии оба поля по-прежнему обязательны по смыслу, что и стережёт
  // частичный уникальный индекс ниже.
  packageId: varchar("package_id", { length: 36 }),
  sessionId: varchar("session_id", { length: 64 }),

  // НОВОЕ: Номер попытки внутри сессии (1, 2, 3...)
  attemptNumber: integer("attempt_number").notNull().default(1),

  // ─── PRD-54: второй источник прохождений ──────────────────────────────────
  /**
   * Тест прохождения. Backfill из `scorm_packages.test_id`; остаётся необязательным, потому что у
   * части старых пакетов тест уже удалён. Дальше именно эта колонка отвечает на вопрос «к какому
   * тесту относится прохождение», и аналитике больше не нужен join через пакет.
   */
  testId: varchar("test_id", { length: 36 }),
  /** Откуда строка: живой рантаймом или загруженной выгрузкой. */
  origin: text("origin", { enum: ["telemetry", "import"] }).notNull().default("telemetry"),
  /** Партия импорта — по ней прохождение откатывается вместе со всей загрузкой. */
  batchId: varchar("batch_id", { length: 36 }),
  /** Метка группы для разрезов в аналитике. NULL = без группы. */
  groupId: varchar("group_id", { length: 36 }),
  /**
   * Псевдоним участника. У импорта заполнен ВСЕГДА, в любом режиме обезличивания: на нём держатся
   * ключ идемпотентности и подсчёт уникальных участников. Параметр обезличивания решает не то,
   * есть ли псевдоним, а то, хранятся ли рядом человекочитаемые поля.
   */
  participantKey: text("participant_key"),
  /** Связь с пользователем по внешнему ключу (PRD-54 раздел 8.5). Телеметрия её не заполняет. */
  userId: varchar("user_id", { length: 36 }),
  /** Значения шкал прохождения. Формат один на оба источника. */
  scalesJson: jsonb("scales_json"),
  /** Значения показателей прохождения. */
  variablesJson: jsonb("variables_json"),
  /**
   * PRD-56 FR-19a: версия публикации, по которой шло прохождение — та же величина, что
   * `attempts.snapshot_id` у веб-попытки.
   *
   * NULL означает «версия не сообщена», а НЕ «текущая»: пакеты, собранные до этой работы, её
   * не знают, а снимка с сообщённым номером может уже не быть. Такие прохождения идут в
   * разрезе отдельной строкой — приписать их текущей версии значит сделать разрез слепым
   * ровно там, где он и нужен.
   */
  snapshotId: varchar("snapshot_id", { length: 36 }),
  /**
   * PRD-56 FR-18: выданные варианты (PRD-17) картой «тема -> вариант».
   *
   * Карта, а не строка: вариант — свойство РАЗДЕЛА, и у теста с двумя наборами форм
   * прохождению принадлежат два варианта. Та же форма, что у веб-попытки, где пин лежит в
   * `variant_json.sections[].formId`. NULL = вариантов не было или пакет их не сообщает.
   */
  formsJson: jsonb("forms_json").$type<Record<string, string>>(),

  // Данные из LMS
  lmsUserId: text("lms_user_id"),
  lmsUserName: text("lms_user_name"),
  lmsUserEmail: text("lms_user_email"),
  lmsUserOrg: text("lms_user_org"),
  /**
   * Подразделение и должность участника из выгрузки (решение владельца 2026-09-25).
   *
   * Они входят в псевдоним, и потому их приходится хранить рядом: должность и отдел человека
   * МЕНЯЮТСЯ, а значит после перевода он получит другой ключ и разъедется на двух участников.
   * Пока поля лежат при прохождении, такой разъезд ВИДЕН — два ключа с одним именем и разными
   * отделами читаются как перевод либо как тёзки, и решает это человек. Без них разъезд был бы
   * молчаливым.
   */
  lmsUserUnit: text("lms_user_unit"),
  lmsUserPosition: text("lms_user_position"),

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
  // Уникальный индекс: одна комбинация package+session+attemptNumber.
  // PRD-54: стал ЧАСТИЧНЫМ — импортированные строки пакета не имеют, и без условия они все
  // конфликтовали бы между собой по (NULL, NULL, 1). Для телеметрии поведение не изменилось.
  sessionAttemptIdx: uniqueIndex("scorm_attempts_session_attempt_idx")
    .on(table.packageId, table.sessionId, table.attemptNumber)
    .where(sql`${table.packageId} IS NOT NULL`),
  // PRD-54 раздел 8.1: ключ идемпотентности импорта. Разрешать конфликт должна БАЗА, а не проверка
  // «сначала выбрать, потом вставить»: две параллельные загрузки одного файла иначе задвоили бы строки.
  importRowIdx: uniqueIndex("scorm_attempts_import_row_idx")
    .on(table.testId, table.participantKey, table.startedAt)
    .where(sql`${table.origin} = 'import'`),
  testIdIdx: index("scorm_attempts_test_id_idx").on(table.testId),
}));

export const scormAnswers = pgTable("scorm_answers", {
  id: varchar("id", { length: 36 }).primaryKey(),
  attemptId: varchar("attempt_id", { length: 36 }).notNull(),
  
  // Данные вопроса
  questionId: varchar("question_id", { length: 36 }).notNull(),
  questionPrompt: text("question_prompt").notNull(),
  questionType: text("question_type", { enum: ["single", "multiple", "matching", "ranking", "scale", "allocation", "short", "blanks", "long"] }).notNull(),
  topicId: varchar("topic_id", { length: 36 }),
  topicName: text("topic_name"),
  difficulty: integer("difficulty"),
  
  // Ответ
  userAnswerJson: jsonb("user_answer_json").notNull(),
  /**
   * PRD-54: необязательный — у измерительного вопроса эталона НЕТ вовсе.
   */
  correctAnswerJson: jsonb("correct_answer_json"),
  /**
   * Исход ответа в трёх состояниях (PRD-54 раздел 5.3).
   *
   * Булева `isCorrect` ниже описывала измерительный ответ как «неверный», хотя он не может быть ни
   * верным, ни неверным: у него нет эталона (PRD-26 FR-08, PRD-44 FR-09). `neutral` — то самое
   * третье состояние, которое SCORM 2004 знает, а наша модель до сих пор не знала.
   */
  result: text("result", { enum: ["correct", "incorrect", "neutral"] }).notNull().default("incorrect"),
  /** PRD-54: необязательная. NULL = «оценивать нечего». Оставлена ради прежних читателей. */
  isCorrect: boolean("is_correct"),
  /** PRD-54: необязательные по той же причине, что и `correctAnswerJson`. */
  points: integer("points"),
  maxPoints: integer("max_points"),


  // Варианты ответов для отображения в аналитике
  optionsJson: jsonb("options_json"),           // для single/multiple
  leftItemsJson: jsonb("left_items_json"),      // для matching
  rightItemsJson: jsonb("right_items_json"),    // для matching
  itemsJson: jsonb("items_json"),               // для ranking
  
  // Для адаптивных
  levelIndex: integer("level_index"),
  levelName: text("level_name"),

  /**
   * Время на задании в миллисекундах; `NULL` — не измерялось.
   *
   * Сумма ВСЕХ заходов на вопрос, а не последнего: при разрешённом возврате к неотвеченным
   * человек возвращается, и последний заход показал бы две секунды на задании, над которым
   * думали минуту. Живая телеметрия шлёт миллисекунды, импорт выгрузки LMS переводит в них
   * целые секунды колонки «Продолжительность (сек.)». `NULL` держат оба источника до этой
   * правки, и это честнее нуля: ноль означал бы «ответил мгновенно».
   */
  latencyMs: integer("latency_ms"),

  answeredAt: timestamp("answered_at").notNull(),
}, (table) => ({
  // Answers are always read for a given attempt.
  attemptIdIdx: index("scorm_answers_attempt_id_idx").on(table.attemptId),
}));

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
  /** PRD-22: values of the variant's `settings[]` — PROPERTIES of the page
   *  (sequence identifier, button caption, background), kept apart from the
   *  authored CONTENT in `values_json` so the two have their own rules: content
   *  migrates by shared placeholder keys on variant replace, while a setting like
   *  the sequence identifier survives even a variant that no longer declares it. */
  settingsJson: jsonb("settings_json").notNull().default({}),
  autoAdvance: boolean("auto_advance").notNull().default(false),
  autoAdvanceDelayMs: integer("auto_advance_delay_ms"),
  /** Экран есть в тесте, но ученику не выдаётся (решение владельца 2026-09-20).
   *  Скрыть можно любую карточку полотна, КРОМЕ блока вопросов и маршрутизатора:
   *  первый — сам тест, второй — способ навигации, без него сценарий перестаёт быть
   *  маршрутизаторным. Скрытие обратимо и, в отличие от удаления, сохраняет тексты и
   *  оформление страницы. Экран «Итоги раздела» хранит своё состояние не здесь, а в
   *  `tests.show_section_results` — та настройка появилась раньше (PRD-19 FR-05a), и
   *  второй источник правды для одного экрана заводить нельзя. */
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // getContentPages filters by test_id and orders by (topic_id, position, sort_order).
  testTopicPositionSortIdx: index("content_pages_test_topic_position_sort_idx")
    .on(table.testId, table.topicId, table.position, table.sortOrder),
  // System-page lookups by kind within a test (PRD-1/PRD-19 boundary nodes).
  testKindIdx: index("content_pages_test_kind_idx").on(table.testId, table.kind),
  // getTopicPageRefs filters by topic_id alone (content-guard "where used").
  topicIdIdx: index("content_pages_topic_id_idx").on(table.topicId),
}));

/**
 * PRD-51 §4: ДОКУМЕНТ ОТЧЁТА одного теста — упорядоченный список блоков.
 *
 * Своя таблица, а не зона в {@link contentPages}, хотя форма совпадает почти дословно.
 * Страница отчёта НЕ участвует в выдаче, а каждый потребитель `content_pages` (сборка
 * выдачи, последовательности страниц, гард целостности, книга Excel, снимок публикации)
 * обходит таблицу целиком: один пропущенный фильтр означал бы страницу отчёта посреди
 * прохождения теста — отказ, который увидит ученик. Отдельная таблица делает эту ошибку
 * невозможной, а не маловероятной.
 *
 * Пустой набор строк = документ по умолчанию, объявленный шаблоном (`reportDocument`).
 * Строки материализуются при первой правке документа — так же, как страницы теста.
 */
export const reportBlocks = pgTable("report_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: varchar("test_id", { length: 36 })
    .notNull()
    .references(() => tests.id, { onDelete: "cascade" }),
  /**
   * Документ на РЕЖИМ теста: обе ветви живут одновременно, как в `report_settings_json`,
   * чтобы смена режима не стирала уже собранный документ другого.
   */
  mode: text("mode", { enum: ["standard", "adaptive"] }).notNull(),
  /**
   * Ключ блока (`shared/report/report-blocks`). ТЕКСТ, а не enum: реестр принадлежит коду,
   * и расширять CHECK-констрейнт при каждом новом блоке пришлось бы миграцией. Ключ,
   * которого текущий шаблон не знает, разрешение документа пропускает, но строку не
   * удаляет — смена шаблона обратима.
   */
  block: text("block").notNull(),
  /** Выбранный вариант шаблона; NULL = вариант с `isDefault` этого блока. */
  templateKey: text("template_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Системный блок гасится этим признаком и ОСТАЁТСЯ в списке (PRD-51 §3.1). */
  enabled: boolean("enabled").notNull().default(true),
  /**
   * Содержимое: значения `placeholders[]` варианта.
   *
   * Тип объявлен здесь, а не приводится на каждой стороне: колонка ВСЕГДА хранит карту
   * «ключ поля → значение», и десяток приведений `as Record<...>` по коду — это десяток
   * мест, где однажды приведут к другому.
   */
  valuesJson: jsonb("values_json").$type<Record<string, unknown>>().notNull().default({}),
  /** Свойства: значения `settings[]` варианта. */
  settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Документ читается целиком, одним запросом по (тест, режим), в порядке печати.
  testModeSortIdx: index("report_blocks_test_mode_sort_idx")
    .on(table.testId, table.mode, table.sortOrder),
}));

/** Строка документа отчёта, как её отдаёт база. */
export type ReportBlockRow = typeof reportBlocks.$inferSelect;

/** Строка документа отчёта на запись. */
export type InsertReportBlockRow = typeof reportBlocks.$inferInsert;

// ─── PRD-52: комментарии рецензирования ──────────────────────────────────────

/**
 * Комментарий рецензента к тесту (PRD-52 раздел 6).
 *
 * Ветка — один уровень: у ответа заполнен `parentId`, ответа на ответ нет, и исход
 * (`status`) живёт ТОЛЬКО у корня ветки. Такая форма выбрана осознанно: обсуждение
 * замечания редко ветвится глубже, а плоский ответ позволяет читать историю приёмки
 * подряд, не собирая дерево.
 *
 * Якорь — СУЩНОСТЬ (вопрос, страница, тема, экран), а не позиция в прогоне: выборка
 * вопросов меняется от прогона к прогону, и позиционный якорь обесценился бы на
 * следующем же запуске. Рядом с якорем хранится `contextLabel` — снимок контекста
 * строкой, чтобы комментарий оставался читаемым после удаления объекта, и
 * `pinnedContentHash` — хеш содержимого на момент комментария, по которому автору
 * показывают «изменено после комментария» (тот же приём, что в
 * `test_question_scoring.pinned_content_hash`).
 */
export const testReviewComments = pgTable("test_review_comments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  testId: varchar("test_id", { length: 36 })
    .notNull()
    .references(() => tests.id, { onDelete: "cascade" }),
  authorId: varchar("author_id", { length: 36 }).notNull(),
  /** NULL = корень ветки; заполнен = ответ в этой ветке (ровно один уровень). */
  parentId: varchar("parent_id", { length: 36 }),
  body: text("body").notNull(),
  anchorKind: text("anchor_kind", {
    enum: ["question", "content-page", "topic", "start", "results", "test"],
  }).notNull(),
  questionId: varchar("question_id", { length: 36 }),
  topicId: varchar("topic_id", { length: 36 }),
  contentPageId: uuid("content_page_id"),
  /** Снимок контекста строкой: «Раздел «IPTV» · Вопрос 3 «…»». */
  contextLabel: text("context_label"),
  /** Хеш содержимого якоря на момент комментария; NULL для экранов и теста в целом. */
  pinnedContentHash: text("pinned_content_hash"),
  /** Исход. NULL у ответов: статус несёт только корень ветки. */
  status: text("status", { enum: ["open", "accepted", "rejected"] }),
  resolvedBy: varchar("resolved_by", { length: 36 }),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Лента теста читается целиком, в порядке появления.
  testIdx: index("test_review_comments_test_idx").on(table.testId, table.createdAt),
  // Комментарии к одному вопросу — для панели в карточке вопроса и счётчиков.
  testQuestionIdx: index("test_review_comments_test_question_idx").on(table.testId, table.questionId),
  // Сбор ответов ветки.
  parentIdx: index("test_review_comments_parent_idx").on(table.parentId),
}));

/** Комментарий рецензирования, как его отдаёт база. */
export type TestReviewComment = typeof testReviewComments.$inferSelect;

/** Комментарий рецензирования на запись. */
export type InsertTestReviewComment = typeof testReviewComments.$inferInsert;

/** Вид якоря комментария — общий словарь для клиента и сервера. */
export type ReviewAnchorKind = TestReviewComment["anchorKind"];

/** Исход комментария: открыт, учтён, отклонён. */
export type ReviewCommentStatus = NonNullable<TestReviewComment["status"]>;

// Insert schemas
export const insertScormPackageSchema = createInsertSchema(scormPackages).omit({ id: true });
export const insertScormAttemptSchema = createInsertSchema(scormAttempts).omit({ id: true });
export const insertScormAnswerSchema = createInsertSchema(scormAnswers).omit({ id: true });
// PRD-54: партия импорта выгрузки отчёта LMS.
export const insertLmsImportBatchSchema = createInsertSchema(lmsImportBatches).omit({ id: true });

// Types
export type InsertLmsImportBatch = z.infer<typeof insertLmsImportBatchSchema>;
export type LmsImportBatch = typeof lmsImportBatches.$inferSelect;

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
/**
 * PRD-22: `gallery` is NOT a kind. A gallery slide is a variant of the author
 * page kind `info` with its own `layoutFile`; the navigation indicator comes from
 * the `sequence` setting, not from a separate page kind.
 *
 * PRD-27: `report` and `report.adaptive` are the ATTEMPT REPORT (the PDF the learner
 * downloads). Two kinds, not two variants of one: the standard report prints points,
 * the adaptive one confirmed levels, and a variant of one mode cannot be picked for the
 * other. Unlike the page kinds, a report variant is not an author PAGE — it is bound to
 * the test through the feedback settings (see `shared/report/report-variants`).
 */
export const variantKindSchema = z.enum([
  "start",
  "questions",
  "router",
  "summary",
  "results",
  "intro",
  "info",
  "review",
  "section-results",
  "report",
  "report.adaptive",
  // PRD-51 FR-02: вариант БЛОКА документа отчёта. Не экран и не авторская страница —
  // раскладка одного раздела внутри документа, привязанная к ключу блока из закрытого
  // реестра продукта (`shared/report/report-blocks`). Виды `report`/`report.adaptive`
  // остаются: они стали ОБОЛОЧКОЙ документа, в которую движок вкладывает эти блоки.
  "report.block",
]);
export type VariantKind = z.infer<typeof variantKindSchema>;

/**
 * One field declaration inside a variant. `type` is checked against the shared
 * registry (`shared/template/field-types`); everything template-specific
 * (`textFit`, `constraints`, `allowedRenderers`, …) passes through untouched.
 *
 * PRD-22: the type used to be `z.unknown()`, so a typo like `richtext` reached the
 * editor and silently became a single-line input. Attribute-level checks (e.g.
 * `select` without `options`) live in `validateVariantFields` — they need the
 * whole field, and the manifest validator reports them with variant + field key.
 */
const placeholderDeclSchema = z.object({
  key: z.string().min(1),
  type: z.enum(PLACEHOLDER_TYPES),
  label: z.string().optional(),
  required: z.boolean().optional(),
}).passthrough();

/**
 * One page-PROPERTY declaration (PRD-22). Unlike a placeholder it never renders
 * into the layout: it drives behaviour (`sequence`) or styling (`image` used as a
 * background). May carry a default value and be required.
 */
const settingDeclSchema = z.object({
  key: z.string().min(1),
  type: z.enum(SETTING_TYPES),
  label: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  options: z.array(z.string()).optional(),
}).passthrough();

/**
 * Single entry in `manifest.contentTemplates[]`. Schema is intentionally narrow:
 * it locks the variant-binding contract (key/label/kind) plus the closed field-type
 * registry, and lets template-specific shape (pageKind, textFit, etc.) pass through.
 */
export const contentTemplateEntrySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: variantKindSchema,
  pageKind: z.string().optional(),
  isDefault: z.boolean().optional(),
  placeholders: z.array(placeholderDeclSchema).optional(),
  settings: z.array(settingDeclSchema).optional(),
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

/**
 * PRD-23: `theme` and `paramsByTheme` are optional — a template that declares no
 * themes keeps exactly the shape it had before, so no stored test needs migrating.
 * `params` stays the flat map: it holds everything for a themeless template and the
 * non-colour params for a themed one.
 */
export const designSettingsSchema = z.object({
  templateId: z.string(),
  templateVersion: z.string(),
  templateApiVersion: z.string(),
  params: z.record(z.string(), z.unknown()),
  theme: z.enum(["light", "dark", "auto"]).optional(),
  paramsByTheme: z
    .record(z.enum(["light", "dark"]), z.record(z.string(), z.unknown()))
    .optional(),
  /**
   * PRD-49: the test's own wording of the results-screen labels. Absent = the template's
   * own texts. A value is a record, not a bare string: «switched off» and «never touched»
   * must stay distinguishable (see `shared/template/labels`).
   */
  labels: z.record(z.string(), z.object({ on: z.boolean().optional(), text: z.string().optional() })).optional(),
  /** PRD-49: the author's order of the four sub-blocks under the results umbrella. */
  resultsBlockOrder: z.array(z.enum(["summary", "scales", "indicators", "topics"])).optional(),
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
  // PRD-29: interpretation of the indicator — the outcome list for string/boolean
  // values, bands for numeric ones. `scales` already has its own config_json.
  configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
  // PRD-29: three positions instead of a boolean. Psychodiagnostics routinely needs
  // the LEVEL disclosed while the raw score stays hidden — the score invites
  // self-diagnosis and comparison between people.
  learnerVisibility: text("learner_visibility", { enum: ["hidden", "level", "level_and_value"] })
    .notNull()
    .default("hidden"),
  scormTarget: text("scorm_target", { enum: ["interaction", "suspend_data", "both", "none"] }).notNull().default("both"),
  controlsStatus: text("controls_status", { enum: ["none", "success", "completion"] }).notNull().default("none"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Result variables are always read for a given test.
  testIdIdx: index("result_variables_test_id_idx").on(table.testId),
  // A variable name is addressed by var() in formulas — it must be unique within
  // a test, or the reference is ambiguous.
  testNameUq: uniqueIndex("result_variables_test_id_name_uq").on(table.testId, table.name),
  // No uniqueness on `controls_status`: several variables may drive the same status,
  // and the runtime combines their verdicts with OR (migration 0044 dropped the limit).
  // The name is a DSL identifier (lowercase, starts with a letter, <=64 chars).
  nameFormat: check("result_variables_name_check", sql`${table.name} ~ '^[a-z][a-z0-9_]{0,63}$'`),
}));

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
    configJson: z.record(z.string(), z.unknown()).default({}),
    // PRD-29: see the same note on insertScaleSchema — drizzle-zod does not carry
    // the column default into the parsed value.
    learnerVisibility: z.enum(["hidden", "level", "level_and_value"]).default("hidden"),
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
  // PRD-29: three positions instead of a boolean. Psychodiagnostics routinely needs
  // the LEVEL disclosed while the raw score stays hidden — the score invites
  // self-diagnosis and comparison between people.
  learnerVisibility: text("learner_visibility", { enum: ["hidden", "level", "level_and_value"] })
    .notNull()
    .default("hidden"),
  scormTarget: text("scorm_target", { enum: ["none", "suspend_data", "interaction", "both"] }).notNull().default("none"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Scales are always read for a given test.
  testIdIdx: index("scales_test_id_idx").on(table.testId),
  // A scale key is addressed in formulas — it must be unique within a test.
  testKeyUq: uniqueIndex("scales_test_id_key_uq").on(table.testId, table.key),
  // The key is a DSL identifier (lowercase, starts with a letter, <=64 chars).
  keyFormat: check("scales_key_check", sql`${table.key} ~ '^[a-z][a-z0-9_]{0,63}$'`),
}));

export const insertScaleSchema = createInsertSchema(scales)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/, "key: начинается с буквы; строчные/цифры/подчёркивание; до 64 символов"),
    // Label is OPTIONAL (per the approved wireframe). Empty is allowed; consumers
    // fall back to the key for display. Column is NOT NULL, so "" (not null) is stored.
    label: z.string().max(120).default(""),
    // PRD-29: drizzle-zod marks a defaulted column optional but does NOT carry the
    // column default into the parsed value, so state it here — an insert payload
    // must always name what the learner sees.
    learnerVisibility: z.enum(["hidden", "level", "level_and_value"]).default("hidden"),
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
  // PRD-44: `option_allocation` is the first source whose contribution the LEARNER sets —
  // the unit fires on a non-zero assignment and contributes `assigned * value * weight`.
  // No migration needed: the column is plain `text NOT NULL` with no CHECK.
  sourceType: text("source_type", {
    enum: ["question", "option", "matching_pair", "ranking_position", "option_allocation"],
  }).notNull(),
  sourceKey: text("source_key"),
  valueJson: jsonb("value_json").$type<number>().notNull(),
  weight: real("weight").notNull().default(1),
  conditionJson: jsonb("condition_json"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Measurements are read by test, by question (contribution edits), and by scale.
  testIdIdx: index("question_measurements_test_id_idx").on(table.testId),
  questionIdIdx: index("question_measurements_question_id_idx").on(table.questionId),
  scaleIdIdx: index("question_measurements_scale_id_idx").on(table.scaleId),
}));

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

/**
 * Media library: the registry row for ONE author file. The `id` IS the address —
 * content stores the string `/api/media/<id>`, so the column type of every existing
 * media reference stays `text` and no mass JSON migration is needed.
 *
 * Two layers of dedup, deliberately different: the PHYSICAL file is addressed by
 * `checksum` (re-uploading identical bytes writes no second file), while a REGISTRY
 * ROW is per (content, owner). One row per checksum would leak a private file to
 * anyone who happened to upload the same bytes.
 *
 * `owner_id` is nullable: rows created by the backfill of pre-registry files have no
 * knowable author (the old file name carried none).
 */
export const mediaAssets = pgTable("media_assets", {
  id: varchar("id", { length: 36 }).primaryKey(),
  checksum: varchar("checksum", { length: 64 }).notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  kind: text("kind", { enum: ["image", "audio", "video", "document"] }).notNull(),
  originalName: text("original_name").notNull(),
  title: text("title"),
  ownerId: varchar("owner_id", { length: 36 }),
  visibility: text("visibility", { enum: ["private", "shared"] }).notNull().default("shared"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Dedup barrier, not just a lookup: without uniqueness two concurrent uploads of the
  // same bytes by the same author both miss the SELECT and both insert. Partial because
  // backfilled rows have no owner, and Postgres treats NULLs as distinct — uniqueness
  // could not constrain them anyway.
  ownerChecksumIdx: uniqueIndex("media_assets_owner_checksum_idx")
    .on(table.ownerId, table.checksum)
    .where(sql`${table.ownerId} is not null`),
  // Reference counting before physically removing a file.
  checksumIdx: index("media_assets_checksum_idx").on(table.checksum),
}));

/**
 * Media library: the reverse index "asset -> where it is used". It serves three
 * consumers at once: the delivery rule (may this user receive the file), the
 * «где используется» report, and orphan collection.
 *
 * `field` is the dotted path inside the entity, so the report can say WHERE exactly
 * and a re-sync can replace one entity's rows wholesale.
 */
export const mediaUsages = pgTable("media_usages", {
  // Not polymorphic like entity_type/entity_id: asset_id always points at ONE table,
  // so a real FK is warranted. No cascade on purpose — deletion of an asset is blocked
  // at the application layer (409 when usages exist); the FK is an integrity backstop,
  // not a cascade mechanism.
  assetId: varchar("asset_id", { length: 36 }).notNull().references(() => mediaAssets.id),
  entityType: text("entity_type", {
    enum: [
      "question",
      "content_page",
      "test_design",
      "test_feedback",
      "topic_feedback",
      "scale_feedback",
      "variable_feedback",
      "snapshot",
    ],
  }).notNull(),
  entityId: varchar("entity_id", { length: 36 }).notNull(),
  field: text("field").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.assetId, table.entityType, table.entityId, table.field] }),
  // Re-syncing one entity deletes its rows by this key.
  entityIdx: index("media_usages_entity_idx").on(table.entityType, table.entityId),
}));

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type InsertMediaAsset = typeof mediaAssets.$inferInsert;
export type MediaUsage = typeof mediaUsages.$inferSelect;
export type MediaEntityType = MediaUsage["entityType"];
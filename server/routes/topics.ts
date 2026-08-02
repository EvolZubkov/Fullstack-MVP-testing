import { Router } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { topicCoursesFromFeedback, topicEventsFromFeedback } from "@shared/topics/recommendations";
import { requirePermission } from "../middleware/auth";
import { assessTopicDeletion, type FeasibilityAssessment } from "../services/draw-feasibility";
import {
  respondForbiddenContent,
  respondIfBlocked,
  isDryRun,
  isForcedByAdmin,
  respondDryRun,
} from "../services/content-guard";
import type { Role } from "@shared/access";
import {
  visibleTopicScope,
  canManageTopicContent,
  canDeleteTopic,
  canGrantTopicAccess,
  canChangeTopicOwner,
  dependentTestsForGrant,
  isAdminOrSuper,
  sameOwnerNameClash,
  visibleSameNameTopics,
  duplicateNameGroups,
} from "../services/topic-access";
import { normalizeTopicName } from "@shared/topics/naming";
import { feedbackContentSchema, type FeedbackContent } from "@shared/schema";
import { syncEntityUsages, clearCascadedUsages } from "../services/media/usage-index";

const router = Router();

/**
 * Validate the optional rich `feedbackJson` body field (TD-02). `undefined`/`null`
 * means "not provided" — left untouched. A malformed object yields `null` so the
 * caller can answer 400 instead of persisting garbage.
 */
function parseFeedbackJson(raw: unknown): { ok: true; value: FeedbackContent | undefined } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  const parsed = feedbackContentSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

// GET /api/topics - Список тем с курсами и количеством вопросов
// PRD-15 block C (FR-22): scoped to topics the actor may see (own, granted,
// shared; admin sees all).
router.get("/", requirePermission("topics.read"), async (req, res) => {
  try {
    const scope = await visibleTopicScope(req.effectiveRoles ?? [], req.currentUser?.id ?? "");
    const allTopics = await storage.getTopics();
    const topics = scope.all ? allTopics : allTopics.filter((t) => scope.ids.has(t.id));
    const topicsWithDetails = await Promise.all(
      topics.map(async (topic) => {
        const questions = await storage.getQuestionsByTopic(topic.id);
        return {
          ...topic,
          // TD-02 r.3: recommended courses/events are derived from the topic's
          // feedback (no extra queries; the legacy tables are no longer read).
          courses: topicCoursesFromFeedback(topic),
          events: topicEventsFromFeedback(topic),
          questionCount: questions.length,
        };
      })
    );
    res.json(topicsWithDetails);
  } catch (error) {
    logger.error("Get topics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get topics" });
  }
});

// GET /api/topics/name-check — FR-27 live same-name check (in the visible area).
// `sameOwner` is the hard per-owner clash (would block create); `duplicates`
// are the non-blocking other-owner collisions worth a warning.
router.get("/name-check", requirePermission("topics.read"), async (req, res) => {
  try {
    const name = String(req.query.name ?? "");
    const excludeId = req.query.excludeId ? String(req.query.excludeId) : undefined;
    if (!name.trim()) {
      return res.json({ normalized: "", sameOwner: null, duplicates: [] });
    }
    const ownerId = req.currentUser?.id ?? null;
    const sameOwner = await sameOwnerNameClash(ownerId, name, excludeId);
    const duplicates = await visibleSameNameTopics(
      req.effectiveRoles ?? [],
      ownerId ?? "",
      name,
      excludeId,
    );
    res.json({
      normalized: normalizeTopicName(name),
      sameOwner: sameOwner ? { id: sameOwner.id, name: sameOwner.name } : null,
      duplicates,
    });
  } catch (error) {
    logger.error("Topic name-check error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to check topic name" });
  }
});

// GET /api/topics/duplicates-report — FR-27 administrator report of system-wide
// same-name groups. Authors hold `topics.read`, so the admin gate is explicit.
router.get("/duplicates-report", requirePermission("topics.read"), async (req, res) => {
  try {
    if (!isAdminOrSuper(req.effectiveRoles ?? [])) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ groups: await duplicateNameGroups() });
  } catch (error) {
    logger.error("Topic duplicates-report error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to build duplicates report" });
  }
});

/**
 * Validate the optional topic code (PRD-2 §4.2): a readable slug used by
 * `topicById("<code>")`. Returns `null` for a blank value, the trimmed slug when
 * valid, or `false` when malformed (→ 400).
 */
function normalizeTopicCode(raw: unknown): string | null | false {
  if (raw == null) return null;
  if (typeof raw !== "string") return false;
  const v = raw.trim();
  if (v === "") return null;
  return /^[a-z][a-z0-9_]{0,63}$/.test(v) ? v : false;
}

const INVALID_TOPIC_CODE = {
  error: "invalid_topic_code",
  message: "Id (код): строчная буква в начале; буквы/цифры/подчёркивание; до 64 символов",
};

// POST /api/topics - Создать тему
router.post("/", requirePermission("topics.manage"), async (req, res) => {
  try {
    const { name, description, feedback, folderId, feedbackJson, code } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Name required" });
    }
    const topicCode = normalizeTopicCode(code);
    if (topicCode === false) {
      return res.status(400).json(INVALID_TOPIC_CODE);
    }
    const fb = parseFeedbackJson(feedbackJson);
    if (!fb.ok) {
      return res.status(400).json({ error: "invalid_feedback_json" });
    }
    const ownerId = req.currentUser?.id ?? null;
    // FR-27 hard uniqueness within one owner.
    const clash = await sameOwnerNameClash(ownerId, name);
    if (clash) {
      return res.status(409).json({
        error: "duplicate_topic_name",
        message: "У вас уже есть тема с таким названием",
        topicId: clash.id,
      });
    }
    const topic = await storage.createTopic({
      name,
      code: topicCode,
      description,
      feedback,
      feedbackJson: fb.value,
      folderId,
      createdBy: ownerId,
    });
    // FR-27 non-blocking warning: same name visible elsewhere (other owners).
    const duplicates = await visibleSameNameTopics(
      req.effectiveRoles ?? [],
      ownerId ?? "",
      name,
      topic.id,
    );
    res.status(201).json(
      duplicates.length > 0 ? { ...topic, warnings: [{ kind: "duplicate_name", topics: duplicates }] } : topic,
    );
  } catch (error) {
    logger.error("Create topic error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create topic" });
  }
});

// PUT /api/topics/:id - Обновить тему
// PRD-15 block C: editing a topic requires owner / manage-grant / admin.
router.put("/:id", requirePermission("topics.manage"), async (req, res) => {
  try {
    const topic = await storage.getTopic(req.params.id);
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    if (!(await canManageTopicContent(req.effectiveRoles ?? [], req.currentUser?.id ?? "", topic))) {
      respondForbiddenContent(res);
      return;
    }
    const { name, description, feedback, folderId, feedbackJson, code } = req.body;
    const topicCode = normalizeTopicCode(code);
    if (topicCode === false) {
      return res.status(400).json(INVALID_TOPIC_CODE);
    }
    const fb = parseFeedbackJson(feedbackJson);
    if (!fb.ok) {
      return res.status(400).json({ error: "invalid_feedback_json" });
    }
    // FR-27: a rename to a name already used by ANOTHER of the owner's topics is
    // a hard conflict; a clash with a different owner's visible topic only warns.
    const renamed =
      typeof name === "string" && name.length > 0 &&
      normalizeTopicName(name) !== normalizeTopicName(topic.name);
    if (renamed) {
      const clash = await sameOwnerNameClash(topic.ownerId, name, topic.id);
      if (clash) {
        return res.status(409).json({
          error: "duplicate_topic_name",
          message: "У владельца уже есть тема с таким названием",
          topicId: clash.id,
        });
      }
    }
    const updated = await storage.updateTopic(req.params.id, {
      name,
      code: topicCode,
      description,
      feedback,
      folderId,
      // Only overwrite feedbackJson when the client sent it; undefined is skipped
      // by Drizzle's .set(), so omitting it preserves the stored value.
      ...(fb.value !== undefined ? { feedbackJson: fb.value } : {}),
    });
    if (!updated) {
      return res.status(404).json({ error: "Topic not found" });
    }
    // PRD-2 §4.2: a rename rewrites `topicByName("…")` references in the live
    // formulas of tests using this topic, so показатели stay intact.
    if (typeof name === "string" && name.length > 0 && name !== topic.name) {
      await storage.renameTopicInFormulas(req.params.id, topic.name, name);
    }
    let warnings: Array<{ kind: string; topics: unknown[] }> | undefined;
    if (typeof name === "string" && name.length > 0) {
      const duplicates = await visibleSameNameTopics(
        req.effectiveRoles ?? [],
        req.currentUser?.id ?? "",
        name,
        topic.id,
      );
      if (duplicates.length > 0) warnings = [{ kind: "duplicate_name", topics: duplicates }];
    }
    res.json(warnings ? { ...updated, warnings } : updated);
  } catch (error) {
    logger.error("Update topic error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update topic" });
  }
});

// TD-02 r.3: the recommended-course / recommended-event CRUD endpoints
// (DELETE/POST /courses, /events) were removed — recommendations are edited
// inside the topic's rich feedback (PUT /api/topics/:id, feedback_json).

// DELETE /api/topics/:id - Удалить тему
// PRD-15 block C / FR-05 (E-2): owner/admin only; blocked while published tests
// depend on the topic (409 with the dependents list; admin ?force=true).
router.delete("/:id", requirePermission("topics.manage"), async (req, res) => {
  try {
    const topic = await storage.getTopic(req.params.id);
    if (!topic) {
      return res.status(404).json({ error: "Topic not found" });
    }
    if (!canDeleteTopic(req.effectiveRoles ?? [], req.currentUser?.id ?? "", topic)) {
      respondForbiddenContent(res);
      return;
    }
    const assessment = await assessTopicDeletion(req.params.id);
    if (isDryRun(req)) return respondDryRun(req, res, assessment);
    if (respondIfBlocked(req, res, assessment)) return;
    const result = await storage.deleteTopic(req.params.id);
    if (!result.deleted) {
      return res.status(404).json({ error: "Topic not found" });
    }
    // Медиатека: сама тема удалена (транзакция уже закоммичена), поэтому сбой
    // чистки индекса не должен стоить автору его действия — недостающая строка
    // безопасна и чинится пересборкой.
    await clearCascadedUsages([
      ...result.questionIds.map((id) => ({ entityType: "question" as const, entityId: id })),
      ...result.contentPageIds.map((id) => ({ entityType: "content_page" as const, entityId: id })),
    ]);
    res.json({ success: true, warnings: assessment.warnings });
  } catch (error) {
    logger.error("Delete topic error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete topic" });
  }
});

/** One topic entry with its display name, used in bulk-operation summaries. */
type TopicRefName = { topicId: string; name: string };

/**
 * Partition topic ids for deletion against the PRD-15 content guard (FR-05,
 * partial-batch): `deletable` (no published-test conflicts), `blocked` (used in
 * published tests — skipped unless an admin forces) and `forbidden` (actor may
 * not delete). `warnings` aggregates non-blocking advisories. Used by both the
 * topic bulk-delete and the folder cascade so they share one policy.
 */
async function partitionTopicDeletion(
  ids: string[],
  roles: readonly Role[],
  userId: string,
  forced: boolean,
): Promise<{
  deletable: TopicRefName[];
  blocked: Array<TopicRefName & { blocking: FeasibilityAssessment["blocking"] }>;
  forbidden: TopicRefName[];
  warnings: FeasibilityAssessment["warnings"];
}> {
  const deletable: TopicRefName[] = [];
  const blocked: Array<TopicRefName & { blocking: FeasibilityAssessment["blocking"] }> = [];
  const forbidden: TopicRefName[] = [];
  const warnings: FeasibilityAssessment["warnings"] = [];
  for (const id of ids) {
    const topic = await storage.getTopic(id);
    if (!topic) continue;
    if (!canDeleteTopic(roles, userId, topic)) {
      forbidden.push({ topicId: id, name: topic.name });
      continue;
    }
    const assessment = await assessTopicDeletion(id);
    warnings.push(...assessment.warnings);
    if (assessment.blocking.length > 0 && !forced) {
      blocked.push({ topicId: id, name: topic.name, blocking: assessment.blocking });
    } else {
      deletable.push({ topicId: id, name: topic.name });
    }
  }
  return { deletable, blocked, forbidden, warnings };
}

// POST /api/topics/bulk-delete - Массовое удаление тем (partial-batch, PRD-15 FR-05)
// The batch runs the same guard as single delete, but per-topic: deletable topics
// go, topics used in published tests are skipped and listed (admin `?force=true`
// deletes them too). `?dryRun=true` previews the partition without mutating.
router.post("/bulk-delete", requirePermission("topics.manage"), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "IDs array required" });
    }
    const part = await partitionTopicDeletion(
      ids,
      req.effectiveRoles ?? [],
      req.currentUser?.id ?? "",
      isForcedByAdmin(req),
    );
    if (isDryRun(req)) {
      return res.json({
        dryRun: true,
        deletable: part.deletable,
        blocked: part.blocked,
        forbidden: part.forbidden,
        warnings: part.warnings,
      });
    }
    const deletableIds = part.deletable.map((t) => t.topicId);
    const result = await storage.deleteTopicsBulk(deletableIds);
    await clearCascadedUsages([
      ...result.questionIds.map((id) => ({ entityType: "question" as const, entityId: id })),
      ...result.contentPageIds.map((id) => ({ entityType: "content_page" as const, entityId: id })),
    ]);
    res.json({
      success: true,
      deletedCount: result.count,
      deletedIds: deletableIds,
      skipped: [
        ...part.blocked.map((b) => ({ topicId: b.topicId, name: b.name, reason: "in_use", blocking: b.blocking })),
        ...part.forbidden.map((f) => ({ topicId: f.topicId, name: f.name, reason: "forbidden" })),
      ],
      warnings: part.warnings,
    });
  } catch (error) {
    logger.error("Bulk delete topics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete topics" });
  }
});

// POST /api/topics/bulk-move - Массовый перенос тем в папку (или в корень).
// Организационный (folders carry no ownership) — content-guard не нужен; темы,
// которыми пользователь не управляет, пропускаются.
router.post("/bulk-move", requirePermission("topics.manage"), async (req, res) => {
  try {
    const { ids, folderId } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "IDs array required" });
    }
    if (folderId !== null && typeof folderId !== "string") {
      return res.status(400).json({ error: "folderId must be a string or null" });
    }
    if (typeof folderId === "string" && !(await storage.getFolder(folderId))) {
      return res.status(404).json({ error: "Folder not found" });
    }
    const roles = req.effectiveRoles ?? [];
    const userId = req.currentUser?.id ?? "";
    const movable: string[] = [];
    const skipped: Array<{ topicId: string; name: string; reason: string }> = [];
    for (const id of ids) {
      const topic = await storage.getTopic(id);
      if (!topic) continue;
      if (!(await canManageTopicContent(roles, userId, topic))) {
        skipped.push({ topicId: id, name: topic.name, reason: "forbidden" });
        continue;
      }
      movable.push(id);
    }
    const movedCount = await storage.moveTopicsToFolder(movable, (folderId as string | null) ?? null);
    res.json({ success: true, movedCount, movedIds: movable, skipped });
  } catch (error) {
    logger.error("Bulk move topics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to move topics" });
  }
});

// POST /api/topics/bulk-visibility - Массовая смена видимости (private/shared).
router.post("/bulk-visibility", requirePermission("topics.access.grant"), async (req, res) => {
  try {
    const { ids, visibility } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "IDs array required" });
    }
    if (visibility !== "private" && visibility !== "shared") {
      return res.status(400).json({ error: "visibility must be 'private' or 'shared'" });
    }
    const roles = req.effectiveRoles ?? [];
    const userId = req.currentUser?.id ?? "";
    let updatedCount = 0;
    const skipped: Array<{ topicId: string; name: string; reason: string }> = [];
    for (const id of ids) {
      const topic = await storage.getTopic(id);
      if (!topic) continue;
      if (!canGrantTopicAccess(roles, userId, topic)) {
        skipped.push({ topicId: id, name: topic.name, reason: "forbidden" });
        continue;
      }
      await storage.setTopicVisibility(id, visibility);
      updatedCount++;
    }
    res.json({ success: true, updatedCount, skipped });
  } catch (error) {
    logger.error("Bulk set visibility error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to set visibility" });
  }
});

// POST /api/topics/bulk-owner - Массовая смена владельца (только администратор).
router.post("/bulk-owner", requirePermission("topics.owner.change"), async (req, res) => {
  try {
    const { ids, ownerId } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "IDs array required" });
    }
    if (ownerId !== null && typeof ownerId !== "string") {
      return res.status(400).json({ error: "ownerId must be a string or null" });
    }
    if (!canChangeTopicOwner(req.effectiveRoles ?? [])) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (typeof ownerId === "string" && !(await storage.getUser(ownerId))) {
      return res.status(404).json({ error: "User not found" });
    }
    let updatedCount = 0;
    for (const id of ids) {
      const topic = await storage.getTopic(id);
      if (!topic) continue;
      await storage.setTopicOwner(id, ownerId);
      updatedCount++;
    }
    res.json({ success: true, updatedCount });
  } catch (error) {
    logger.error("Bulk set owner error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to set owner" });
  }
});

// POST /api/topics/bulk-grant - Массовая выдача доступа пользователю (upsert).
router.post("/bulk-grant", requirePermission("topics.access.grant"), async (req, res) => {
  try {
    const { ids, granteeId, accessLevel } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "IDs array required" });
    }
    if (typeof granteeId !== "string" || !granteeId) {
      return res.status(400).json({ error: "granteeId required" });
    }
    if (accessLevel !== "use" && accessLevel !== "manage") {
      return res.status(400).json({ error: "accessLevel must be 'use' or 'manage'" });
    }
    if (!(await storage.getUser(granteeId))) {
      return res.status(404).json({ error: "Grantee not found" });
    }
    const roles = req.effectiveRoles ?? [];
    const userId = req.currentUser?.id ?? "";
    let grantedCount = 0;
    const skipped: Array<{ topicId: string; name: string; reason: string }> = [];
    for (const id of ids) {
      const topic = await storage.getTopic(id);
      if (!topic) continue;
      if (!canGrantTopicAccess(roles, userId, topic)) {
        skipped.push({ topicId: id, name: topic.name, reason: "forbidden" });
        continue;
      }
      await storage.upsertTopicGrant({ topicId: id, granteeId, accessLevel, grantedBy: userId || null });
      grantedCount++;
    }
    logger.info(`Bulk topic grant: ${grantedCount} topics -> user:${granteeId} ${accessLevel} by ${userId || "?"}`);
    res.json({ success: true, grantedCount, skipped });
  } catch (error) {
    logger.error("Bulk grant error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to grant access" });
  }
});

// POST /api/topics/bulk-revoke - Массовый отзыв доступа пользователя.
// Soft (по умолчанию): грант -> revoked_in_use. Hard (`?mode=hard`, админ): грант
// удаляется; темы, где у получателя есть опубликованные зависимые тесты,
// пропускаются (partial-batch) без `?force=true`. `?dryRun=true` — предпросмотр.
router.post("/bulk-revoke", requirePermission("topics.access.grant"), async (req, res) => {
  try {
    const { ids, granteeId } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "IDs array required" });
    }
    if (typeof granteeId !== "string" || !granteeId) {
      return res.status(400).json({ error: "granteeId required" });
    }
    const roles = req.effectiveRoles ?? [];
    const userId = req.currentUser?.id ?? "";
    const skipped: Array<{ topicId: string; name: string; reason: string }> = [];

    if (req.query.mode !== "hard") {
      // Soft revoke: flip each existing grant to revoked_in_use.
      let revokedCount = 0;
      for (const id of ids) {
        const topic = await storage.getTopic(id);
        if (!topic) continue;
        if (!canGrantTopicAccess(roles, userId, topic)) {
          skipped.push({ topicId: id, name: topic.name, reason: "forbidden" });
          continue;
        }
        const grant = await storage.getTopicGrantForGrantee(id, granteeId);
        if (!grant) {
          skipped.push({ topicId: id, name: topic.name, reason: "no_grant" });
          continue;
        }
        await storage.setTopicGrantState(grant.id, "revoked_in_use");
        revokedCount++;
      }
      return res.json({ mode: "soft", success: true, revokedCount, skipped });
    }

    // Hard revoke — administrator only (FR-26).
    if (!isAdminOrSuper(roles)) {
      return res.status(403).json({ error: "hard_revoke_admin_only", message: "Жёсткий отзыв доступен только администратору" });
    }
    const forced = isForcedByAdmin(req);
    const revocable: Array<{ grantId: string; topicId: string; name: string }> = [];
    const blocked: Array<{ topicId: string; name: string; dependents: Awaited<ReturnType<typeof dependentTestsForGrant>> }> = [];
    for (const id of ids) {
      const topic = await storage.getTopic(id);
      if (!topic) continue;
      if (!canGrantTopicAccess(roles, userId, topic)) {
        skipped.push({ topicId: id, name: topic.name, reason: "forbidden" });
        continue;
      }
      const grant = await storage.getTopicGrantForGrantee(id, granteeId);
      if (!grant) {
        skipped.push({ topicId: id, name: topic.name, reason: "no_grant" });
        continue;
      }
      const dependents = await dependentTestsForGrant(id, granteeId);
      const publishedDeps = dependents.filter((d) => d.status === "published");
      if (publishedDeps.length > 0 && !forced) {
        blocked.push({ topicId: id, name: topic.name, dependents });
        continue;
      }
      revocable.push({ grantId: grant.id, topicId: id, name: topic.name });
    }
    const resolutions = ["replace_sections", "unpublish", "change_owner", "materialize_snapshot"];
    if (isDryRun(req)) {
      return res.json({ dryRun: true, mode: "hard", revocable, blocked, skipped, resolutions });
    }
    for (const r of revocable) await storage.removeTopicGrant(r.grantId);
    logger.info(`Bulk hard-revoke: ${revocable.length} grants of user:${granteeId} by ${userId || "?"} (force=${forced}, blocked=${blocked.length})`);
    res.json({ mode: "hard", success: true, revokedCount: revocable.length, revoked: revocable, blocked, skipped, resolutions });
  } catch (error) {
    logger.error("Bulk revoke error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to revoke access" });
  }
});

// POST /api/topics/:id/duplicate - Дублировать тему с вопросами
router.post("/:id/duplicate", requirePermission("topics.manage"), async (req, res) => {
  try {
    const result = await storage.duplicateTopicWithQuestions(
      req.params.id,
      req.currentUser?.id,
    );
    if (!result) {
      return res.status(404).json({ error: "Topic not found" });
    }

    // Медиатека: каждый продублированный вопрос — НОВАЯ сущность со своим id,
    // индексируется под ним (не под id вопроса-оригинала). Вопросы уже
    // зафиксированы (storage.duplicateTopicWithQuestions вернулся), поэтому
    // синхронизация здесь не меняет то, что реально записано. Последовательно,
    // как и остальной импорт/дублирование — при большой теме это заметно
    // медленнее (см. отчёт задачи). Сбой одного вопроса не роняет остальные.
    for (const q of result.questions ?? []) {
      try {
        await syncEntityUsages("question", q.id, q);
      } catch (error) {
        logger.error(`Media usage sync failed for question ${q.id}: ${(error as Error).message}`);
      }
    }

    res.status(201).json(result);
  } catch (error) {
    logger.error("Duplicate topic error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to duplicate topic" });
  }
});

// ─── Topic access grants and ownership (PRD-15 block C, T-27) ────────────────

// GET /api/topics/:id/access — owner, visibility and grants (owner or admin).
router.get("/:id/access", requirePermission("topics.access.grant"), async (req, res) => {
  try {
    const topic = await storage.getTopic(req.params.id);
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    if (!canGrantTopicAccess(req.effectiveRoles ?? [], req.currentUser?.id ?? "", topic)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const grants = await storage.getTopicGrants(topic.id);
    // Resolve grantee (user) display names for the panel.
    const withNames = await Promise.all(
      grants.map(async (g) => ({
        ...g,
        granteeName: (await storage.getUser(g.granteeId))?.name ?? null,
      })),
    );
    res.json({ topicId: topic.id, ownerId: topic.ownerId ?? null, visibility: topic.visibility, grants: withNames });
  } catch (error) {
    logger.error("Get topic access error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get topic access" });
  }
});

// POST /api/topics/:id/access — grant or update use/manage access for a USER
// (TD-01: topic access is granted to users only; groups are for assignment).
router.post("/:id/access", requirePermission("topics.access.grant"), async (req, res) => {
  try {
    const topic = await storage.getTopic(req.params.id);
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    if (!canGrantTopicAccess(req.effectiveRoles ?? [], req.currentUser?.id ?? "", topic)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { granteeId, accessLevel } = req.body ?? {};
    if (typeof granteeId !== "string" || !granteeId) {
      return res.status(400).json({ error: "granteeId required" });
    }
    if (accessLevel !== "use" && accessLevel !== "manage") {
      return res.status(400).json({ error: "accessLevel must be 'use' or 'manage'" });
    }
    if (!(await storage.getUser(granteeId))) {
      return res.status(404).json({ error: "Grantee not found" });
    }
    const grant = await storage.upsertTopicGrant({
      topicId: topic.id,
      granteeId,
      accessLevel,
      grantedBy: req.currentUser?.id ?? null,
    });
    logger.info(
      `Topic grant: ${topic.id} -> user:${granteeId} ${accessLevel} by ${req.currentUser?.id ?? "?"}`,
    );
    res.status(201).json(grant);
  } catch (error) {
    logger.error("Grant topic access error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to grant topic access" });
  }
});

// DELETE /api/topics/:id/access/:grantId — revoke a grant in one of two modes.
//
// Soft revoke (default, FR-25): the grant moves to `revoked_in_use`. It stops
// granting bank access (the topic leaves the grantee's bank and new tests),
// but the grantee keeps the derived in-context read for tests that already
// reference the topic. Available to the owner and administrators.
//
// Hard revoke (`?mode=hard`, FR-26): administrator-only. The grant row is
// removed outright. The grantee's dependent tests are listed; published
// dependents block with 409 + resolution options unless an administrator
// forces (`?force=true`) — the explicit, logged override.
router.delete("/:id/access/:grantId", requirePermission("topics.access.grant"), async (req, res) => {
  try {
    const topic = await storage.getTopic(req.params.id);
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    if (!canGrantTopicAccess(req.effectiveRoles ?? [], req.currentUser?.id ?? "", topic)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const grant = (await storage.getTopicGrants(topic.id)).find((g) => g.id === req.params.grantId);
    if (!grant) return res.status(404).json({ error: "Grant not found" });

    if (req.query.mode !== "hard") {
      // Soft revoke: keep the row, flip to revoked_in_use.
      await storage.setTopicGrantState(grant.id, "revoked_in_use");
      logger.info(
        `Topic grant soft-revoked: ${grant.id} on ${topic.id} by ${req.currentUser?.id ?? "?"}`,
      );
      return res.json({ mode: "soft", grantId: grant.id, state: "revoked_in_use" });
    }

    // Hard revoke is administrator-only (FR-26).
    if (!isAdminOrSuper(req.effectiveRoles ?? [])) {
      return res.status(403).json({
        error: "hard_revoke_admin_only",
        message: "Жёсткий отзыв доступен только администратору",
      });
    }
    const dependents = await dependentTestsForGrant(grant.topicId, grant.granteeId);
    const blocking = dependents.filter((d) => d.status === "published");
    const forced = req.query.force === "true";
    if (blocking.length > 0 && !forced) {
      return res.status(409).json({
        error: "grant_in_use",
        message: "Отзыв затрагивает опубликованные тесты получателя",
        dependents,
        // Author-facing resolution options surfaced by the client dialog.
        resolutions: ["replace_sections", "unpublish", "change_owner", "materialize_snapshot"],
      });
    }
    await storage.removeTopicGrant(grant.id);
    logger.info(
      `Topic grant hard-revoked: ${grant.id} on ${topic.id} by ${req.currentUser?.id ?? "?"} ` +
        `(force=${forced}, dependents=${dependents.length})`,
    );
    res.json({ mode: "hard", grantId: grant.id, removed: true, dependents });
  } catch (error) {
    logger.error("Revoke topic access error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to revoke topic access" });
  }
});

// PATCH /api/topics/:id/visibility — make a topic shared or private (owner/admin).
router.patch("/:id/visibility", requirePermission("topics.access.grant"), async (req, res) => {
  try {
    const topic = await storage.getTopic(req.params.id);
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    if (!canGrantTopicAccess(req.effectiveRoles ?? [], req.currentUser?.id ?? "", topic)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { visibility } = req.body ?? {};
    if (visibility !== "private" && visibility !== "shared") {
      return res.status(400).json({ error: "visibility must be 'private' or 'shared'" });
    }
    await storage.setTopicVisibility(topic.id, visibility);
    res.json({ topicId: topic.id, visibility });
  } catch (error) {
    logger.error("Set topic visibility error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to set topic visibility" });
  }
});

// PATCH /api/topics/:id/owner — change the topic owner (admin/super only).
router.patch("/:id/owner", requirePermission("topics.owner.change"), async (req, res) => {
  try {
    const topic = await storage.getTopic(req.params.id);
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    if (!canChangeTopicOwner(req.effectiveRoles ?? [])) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { ownerId } = req.body ?? {};
    if (ownerId !== null && typeof ownerId !== "string") {
      return res.status(400).json({ error: "ownerId must be a string or null" });
    }
    if (typeof ownerId === "string" && !(await storage.getUser(ownerId))) {
      return res.status(404).json({ error: "User not found" });
    }
    await storage.setTopicOwner(topic.id, ownerId);
    res.json({ topicId: topic.id, ownerId });
  } catch (error) {
    logger.error("Set topic owner error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to set topic owner" });
  }
});

// TD-02 r.3: POST /:topicId/courses and /:topicId/events were removed —
// recommended courses/events are edited via the topic's rich feedback
// (PUT /api/topics/:id, feedback_json.links / feedback_json.events).

// GET /api/topics/:topicId/difficulty-distribution - Распределение сложности
router.get("/:topicId/difficulty-distribution", requirePermission("topics.manage"), async (req, res) => {
  try {
    const questions = await storage.getQuestionsByTopic(req.params.topicId);
    const totalQuestions = questions.length;

    const BUCKET_COUNT = 10;
    const BUCKET_SIZE = 100 / BUCKET_COUNT;
    const histogram = Array.from({ length: BUCKET_COUNT }, (_, i) => {
      const min = Math.round(i * BUCKET_SIZE);
      const max = i === BUCKET_COUNT - 1 ? 100 : Math.round((i + 1) * BUCKET_SIZE) - 1;
      const count = questions.filter((q) => {
        const d = q.difficulty ?? 50;
        return i === BUCKET_COUNT - 1 ? d >= min && d <= max : d >= min && d < min + BUCKET_SIZE;
      }).length;
      return { min, max, count };
    });

    const suggestedLevels = [
      {
        levelName: "Лёгкий",
        minDifficulty: 0,
        maxDifficulty: 33,
        questionCount: questions.filter((q) => (q.difficulty ?? 50) <= 33).length,
      },
      {
        levelName: "Средний",
        minDifficulty: 34,
        maxDifficulty: 66,
        questionCount: questions.filter((q) => {
          const d = q.difficulty ?? 50;
          return d > 33 && d <= 66;
        }).length,
      },
      {
        levelName: "Сложный",
        minDifficulty: 67,
        maxDifficulty: 100,
        questionCount: questions.filter((q) => (q.difficulty ?? 50) > 66).length,
      },
    ];

    const warnings: string[] = [];
    if (totalQuestions === 0) {
      warnings.push("В теме нет вопросов");
    } else if (totalQuestions < 10) {
      warnings.push(`Мало вопросов для адаптивного теста (${totalQuestions}). Рекомендуется минимум 10.`);
    }
    const emptyLevels = suggestedLevels.filter((l) => l.questionCount === 0);
    if (emptyLevels.length > 0) {
      warnings.push(`Нет вопросов для уровней: ${emptyLevels.map((l) => l.levelName).join(", ")}`);
    }

    res.json({ totalQuestions, histogram, suggestedLevels, warnings });
  } catch (error) {
    logger.error("Get difficulty distribution error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get difficulty distribution" });
  }
});

export default router;
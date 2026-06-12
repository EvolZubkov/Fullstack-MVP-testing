import { Router } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { assessTopicDeletion } from "../services/draw-feasibility";
import {
  respondForbiddenContent,
  respondIfBlocked,
  mergeAssessments,
  isDryRun,
  respondDryRun,
} from "../services/content-guard";
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
        const courses = await storage.getTopicCourses(topic.id);
        const events = await storage.getTopicEvents(topic.id);
        const questions = await storage.getQuestionsByTopic(topic.id);
        return {
          ...topic,
          courses,
          events,
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

// POST /api/topics - Создать тему
router.post("/", requirePermission("topics.manage"), async (req, res) => {
  try {
    const { name, description, feedback, folderId, feedbackJson } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Name required" });
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
    const { name, description, feedback, folderId, feedbackJson } = req.body;
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

// DELETE /api/topics/events/:id - Удалить мероприятие (must be before /:id)
router.delete("/events/:id", requirePermission("topics.manage"), async (req, res) => {
  try {
    const success = await storage.deleteTopicEvent(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Event not found" });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("Delete event error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete event" });
  }
});

// DELETE /api/topics/courses/:id - Удалить курс (must be before /:id)
router.delete("/courses/:id", requirePermission("topics.manage"), async (req, res) => {
  try {
    const success = await storage.deleteTopicCourse(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Course not found" });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("Delete course error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete course" });
  }
});

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
    const success = await storage.deleteTopic(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Topic not found" });
    }
    res.json({ success: true, warnings: assessment.warnings });
  } catch (error) {
    logger.error("Delete topic error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete topic" });
  }
});

// POST /api/topics/bulk-delete - Массовое удаление тем
// PRD-15 FR-05 (E-10): bulk paths run the same guards as single deletes.
router.post("/bulk-delete", requirePermission("topics.manage"), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "IDs array required" });
    }
    for (const id of ids) {
      const topic = await storage.getTopic(id);
      if (topic && !canDeleteTopic(req.effectiveRoles ?? [], req.currentUser?.id ?? "", topic)) {
        respondForbiddenContent(res);
        return;
      }
    }
    const assessment = mergeAssessments(
      await Promise.all(ids.map((id: string) => assessTopicDeletion(id))),
    );
    if (isDryRun(req)) return respondDryRun(req, res, assessment);
    if (respondIfBlocked(req, res, assessment)) return;
    const deletedCount = await storage.deleteTopicsBulk(ids);
    res.json({ success: true, deletedCount, warnings: assessment.warnings });
  } catch (error) {
    logger.error("Bulk delete topics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete topics" });
  }
});

// POST /api/topics/:id/duplicate - Дублировать тему с вопросами
router.post("/:id/duplicate", requirePermission("topics.manage"), async (req, res) => {
  try {
    const result = await (storage as any).duplicateTopicWithQuestions(req.params.id);
    if (!result) {
      return res.status(404).json({ error: "Topic not found" });
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
    // Resolve grantee display names for the panel.
    const withNames = await Promise.all(
      grants.map(async (g) => {
        let granteeName: string | null = null;
        if (g.granteeType === "user") granteeName = (await storage.getUser(g.granteeId))?.name ?? null;
        else granteeName = (await storage.getGroup(g.granteeId))?.name ?? null;
        return { ...g, granteeName };
      }),
    );
    res.json({ topicId: topic.id, ownerId: topic.ownerId ?? null, visibility: topic.visibility, grants: withNames });
  } catch (error) {
    logger.error("Get topic access error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get topic access" });
  }
});

// POST /api/topics/:id/access — grant or update use/manage access for a user/group.
router.post("/:id/access", requirePermission("topics.access.grant"), async (req, res) => {
  try {
    const topic = await storage.getTopic(req.params.id);
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    if (!canGrantTopicAccess(req.effectiveRoles ?? [], req.currentUser?.id ?? "", topic)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { granteeType, granteeId, accessLevel } = req.body ?? {};
    if (granteeType !== "user" && granteeType !== "group") {
      return res.status(400).json({ error: "granteeType must be 'user' or 'group'" });
    }
    if (typeof granteeId !== "string" || !granteeId) {
      return res.status(400).json({ error: "granteeId required" });
    }
    if (accessLevel !== "use" && accessLevel !== "manage") {
      return res.status(400).json({ error: "accessLevel must be 'use' or 'manage'" });
    }
    const exists = granteeType === "user"
      ? await storage.getUser(granteeId)
      : await storage.getGroup(granteeId);
    if (!exists) return res.status(404).json({ error: "Grantee not found" });
    const grant = await storage.upsertTopicGrant({
      topicId: topic.id,
      granteeType,
      granteeId,
      accessLevel,
      grantedBy: req.currentUser?.id ?? null,
    });
    logger.info(
      `Topic grant: ${topic.id} -> ${granteeType}:${granteeId} ${accessLevel} by ${req.currentUser?.id ?? "?"}`,
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
    const dependents = await dependentTestsForGrant(grant.topicId, grant.granteeType, grant.granteeId);
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

// POST /api/topics/:topicId/courses - Добавить курс к теме
router.post("/:topicId/courses", requirePermission("topics.manage"), async (req, res) => {
  try {
    const { title, url } = req.body;
    if (!title || !url) {
      return res.status(400).json({ error: "Title and URL required" });
    }
    const course = await storage.createTopicCourse({
      topicId: req.params.topicId,
      title,
      url,
    });
    res.status(201).json(course);
  } catch (error) {
    logger.error("Create course error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create course" });
  }
});

// POST /api/topics/:topicId/events - Добавить мероприятие к теме
router.post("/:topicId/events", requirePermission("topics.manage"), async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Title required" });
    }
    const event = await storage.createTopicEvent({
      topicId: req.params.topicId,
      title,
    });
    res.status(201).json(event);
  } catch (error) {
    logger.error("Create event error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create event" });
  }
});


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
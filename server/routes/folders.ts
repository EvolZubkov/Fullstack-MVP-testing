import { Router } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { assessTopicDeletion } from "../services/draw-feasibility";
import { isDryRun, isForcedByAdmin } from "../services/content-guard";
import { canDeleteTopic } from "../services/topic-access";
import { clearCascadedUsages } from "../services/media/usage-index";

const router = Router();

// GET /api/folders - Список папок
router.get("/", requirePermission("folders.manage"), async (req, res) => {
  try {
    const folders = await storage.getFolders();
    res.json(folders);
  } catch (error) {
    logger.error("Get folders error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get folders" });
  }
});

// POST /api/folders - Создать папку
router.post("/", requirePermission("folders.manage"), async (req, res) => {
  try {
    const { name, parentId } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Name required" });
    }
    const folder = await storage.createFolder({
      name,
      parentId: parentId || null,
      createdBy: req.currentUser?.id ?? null,
    });
    res.status(201).json(folder);
  } catch (error) {
    logger.error("Create folder error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create folder" });
  }
});

// PUT /api/folders/:id - Обновить папку
router.put("/:id", requirePermission("folders.manage"), async (req, res) => {
  try {
    const { name, parentId } = req.body;
    const updated = await storage.updateFolder(req.params.id, { name, parentId });
    if (!updated) {
      return res.status(404).json({ error: "Folder not found" });
    }
    res.json(updated);
  } catch (error) {
    logger.error("Update folder error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update folder" });
  }
});

// POST /api/folders/bulk-reparent - Массовый перенос папок под другого родителя.
// Cycle-safe: папку нельзя перенести внутрь себя или своего потомка.
// Организационный (папки не несут прав) — content-guard не нужен.
router.post("/bulk-reparent", requirePermission("folders.manage"), async (req, res) => {
  try {
    const { ids, parentId } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "IDs array required" });
    }
    if (parentId !== null && typeof parentId !== "string") {
      return res.status(400).json({ error: "parentId must be a string or null" });
    }
    if (typeof parentId === "string" && !(await storage.getFolder(parentId))) {
      return res.status(404).json({ error: "Folder not found" });
    }
    // Cycle guard: destination must not be one of the moved folders or a descendant.
    if (typeof parentId === "string") {
      for (const id of ids) {
        const subtree = await storage.getFolderSubtreeIds(id);
        if (subtree.includes(parentId)) {
          return res.status(400).json({
            error: "invalid_parent",
            message: "Нельзя перенести папку внутрь себя или своего потомка",
          });
        }
      }
    }
    let movedCount = 0;
    for (const id of ids) {
      const folder = await storage.getFolder(id);
      if (!folder) continue;
      await storage.updateFolder(id, { parentId: (parentId as string | null) ?? null });
      movedCount++;
    }
    res.json({ success: true, movedCount });
  } catch (error) {
    logger.error("Bulk reparent folders error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to reparent folders" });
  }
});

// DELETE /api/folders/:id - Удалить папку в одном из двух режимов
// (зеркало папок тестов, но с content-guard, т.к. каскад удаляет темы).
//
//   { mode: "folder-only", moveContentsTo: string|null }
//     — перенести темы и вложенные папки в указанное место (null = корень),
//       затем удалить папку. Организационный, без content-guard. Пустое тело =
//       этот режим с moveContentsTo=null (совместимо с прежним поведением).
//
//   { mode: "folder-and-content", confirmName: string }
//     — каскад: темы поддерева удаляются через content-guard (partial-batch).
//       Темы в опубликованных тестах пропускаются и переносятся в корень
//       (выживают), сами папки удаляются. Требует точное имя папки.
//       `?dryRun=true` — предпросмотр; админ `?force=true` удаляет и заблокированные.
router.delete("/:id", requirePermission("folders.manage"), async (req, res) => {
  try {
    const folder = await storage.getFolder(req.params.id);
    if (!folder) return res.status(404).json({ error: "Folder not found" });
    const body = (req.body ?? {}) as {
      mode?: string;
      moveContentsTo?: string | null;
      confirmName?: string;
    };

    if (body.mode === "folder-and-content") {
      if (!body.confirmName || body.confirmName !== folder.name) {
        return res.status(400).json({ error: "name_mismatch", field: "confirmName" });
      }
      const subtreeIds = await storage.getFolderSubtreeIds(folder.id);
      const subtreeSet = new Set(subtreeIds);
      const topicsInside = (await storage.getTopics()).filter(
        (t) => t.folderId && subtreeSet.has(t.folderId),
      );
      // Partition the subtree's topics against the content guard (same policy as
      // topic bulk-delete): deletable / blocked (published) / forbidden.
      const roles = req.effectiveRoles ?? [];
      const userId = req.currentUser?.id ?? "";
      const forced = isForcedByAdmin(req);
      const deletable: Array<{ topicId: string; name: string }> = [];
      const blocked: Array<{ topicId: string; name: string; blocking: unknown[] }> = [];
      const forbidden: Array<{ topicId: string; name: string }> = [];
      const warnings: unknown[] = [];
      for (const t of topicsInside) {
        if (!canDeleteTopic(roles, userId, t)) {
          forbidden.push({ topicId: t.id, name: t.name });
          continue;
        }
        const assessment = await assessTopicDeletion(t.id);
        warnings.push(...assessment.warnings);
        if (assessment.blocking.length > 0 && !forced) {
          blocked.push({ topicId: t.id, name: t.name, blocking: assessment.blocking });
        } else {
          deletable.push({ topicId: t.id, name: t.name });
        }
      }
      if (isDryRun(req)) {
        return res.json({
          dryRun: true,
          mode: "folder-and-content",
          folderCount: subtreeIds.length,
          deletable,
          blocked,
          forbidden,
          warnings,
        });
      }
      const deletableIds = deletable.map((d) => d.topicId);
      const deletedTopicsResult = await storage.deleteTopicsBulk(deletableIds);
      // Медиатека: темы уже удалены (транзакция закоммичена) — чистка индекса лучших
      // усилий не должна стоить автору его действия; недостающая строка безопасна и
      // чинится пересборкой.
      await clearCascadedUsages([
        ...deletableIds.map((id) => ({ entityType: "topic_feedback" as const, entityId: id })),
        ...deletedTopicsResult.questionIds.map((id) => ({ entityType: "question" as const, entityId: id })),
        ...deletedTopicsResult.contentPageIds.map((id) => ({ entityType: "content_page" as const, entityId: id })),
      ]);
      // Survivors (blocked / forbidden) go to root so no folderId dangles.
      const survivorIds = [...blocked.map((b) => b.topicId), ...forbidden.map((f) => f.topicId)];
      await storage.moveTopicsToFolder(survivorIds, null);
      const deletedFolders = await storage.deleteFoldersBulk(subtreeIds);
      return res.json({
        success: true,
        mode: "folder-and-content",
        deletedTopics: deletedTopicsResult.count,
        deletedFolders,
        skipped: [
          ...blocked.map((b) => ({ topicId: b.topicId, name: b.name, reason: "in_use", blocking: b.blocking })),
          ...forbidden.map((f) => ({ topicId: f.topicId, name: f.name, reason: "forbidden" })),
        ],
        warnings,
      });
    }

    // Default "folder-only": reparent contents to the requested destination.
    const moveTo = body.moveContentsTo === undefined ? null : body.moveContentsTo;
    if (moveTo !== null) {
      if (typeof moveTo !== "string" || !(await storage.getFolder(moveTo))) {
        return res.status(404).json({ error: "Destination folder not found" });
      }
      const subtree = await storage.getFolderSubtreeIds(folder.id);
      if (subtree.includes(moveTo)) {
        return res.status(400).json({
          error: "invalid_destination",
          message: "Нельзя перенести содержимое в удаляемую папку или её потомка",
        });
      }
    }
    const success = await storage.deleteFolder(folder.id, moveTo);
    if (!success) return res.status(404).json({ error: "Folder not found" });
    res.json({ success: true, mode: "folder-only", movedContentsTo: moveTo });
  } catch (error) {
    logger.error("Delete folder error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete folder" });
  }
});

export default router;

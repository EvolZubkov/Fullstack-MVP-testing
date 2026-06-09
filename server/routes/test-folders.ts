import { Router } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";

const router = Router();

// GET /api/test-folders
router.get("/", requirePermission("folders.manage"), async (req, res) => {
  try {
    const folders = await storage.getTestFolders();
    res.json(folders);
  } catch (error) {
    logger.error("Get test folders error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get test folders" });
  }
});

// POST /api/test-folders
router.post("/", requirePermission("folders.manage"), async (req, res) => {
  try {
    const { name, parentId } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: "Name required" });
    }
    const folder = await storage.createTestFolder({ name: name.trim(), parentId: parentId || null });
    res.status(201).json(folder);
  } catch (error) {
    logger.error("Create test folder error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create test folder" });
  }
});

// PUT /api/test-folders/:id
router.put("/:id", requirePermission("folders.manage"), async (req, res) => {
  try {
    const { name, parentId } = req.body;
    const updated = await storage.updateTestFolder(req.params.id, { name, parentId });
    if (!updated) {
      return res.status(404).json({ error: "Folder not found" });
    }
    res.json(updated);
  } catch (error) {
    logger.error("Update test folder error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update test folder" });
  }
});

/**
 * DELETE /api/test-folders/:id
 *
 * Два варианта удаления по эскизу prd7-tests-list.html
 * (s-folder-delete-a / s-folder-delete-b):
 *
 *   { mode: "folder-only", moveTestsTo: string | null }
 *     — удалить только папку; все тесты и вложенные папки переносятся в
 *       указанное место (`null` означает корень).
 *
 *   { mode: "folder-and-tests", confirmName: string }
 *     — удалить папку вместе со всеми тестами в ней (включая транзитивно
 *       через вложенные папки). Требует точное совпадение `confirmName` с
 *       именем папки (FR-30 для папок).
 *
 * Backward compatibility: пустое body — старое поведение «folder-only» с
 * переносом в корень (для legacy-клиентов, оставшихся на старом UI).
 */
router.delete("/:id", requirePermission("folders.manage"), async (req, res) => {
  try {
    const folder = await storage.getTestFolders().then((all) => all.find((f) => f.id === req.params.id));
    if (!folder) return res.status(404).json({ error: "Folder not found" });

    const body = (req.body ?? {}) as {
      mode?: string;
      moveTestsTo?: string | null;
      confirmName?: string;
    };

    if (body.mode === "folder-and-tests") {
      if (!body.confirmName || body.confirmName !== folder.name) {
        return res.status(400).json({ error: "name_mismatch", field: "confirmName" });
      }
      const success = await storage.deleteTestFolderCascade(req.params.id);
      if (!success) return res.status(404).json({ error: "Folder not found" });
      return res.status(204).end();
    }

    // Default "folder-only": move tests/sub-folders to the requested destination.
    const moveTo = body.moveTestsTo === undefined ? null : body.moveTestsTo;
    const success = await storage.deleteTestFolder(req.params.id, moveTo);
    if (!success) return res.status(404).json({ error: "Folder not found" });
    res.status(204).end();
  } catch (error) {
    logger.error("Delete test folder error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete test folder" });
  }
});

// PATCH /api/test-folders/move/:testId — move test to folder
router.patch("/move/:testId", requirePermission("folders.manage"), async (req, res) => {
  try {
    const { folderId } = req.body;
    const success = await storage.moveTestToFolder(req.params.testId, folderId ?? null);
    if (!success) {
      return res.status(404).json({ error: "Test not found" });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("Move test error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to move test" });
  }
});

export default router;

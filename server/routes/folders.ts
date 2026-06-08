import { Router } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";

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
    const folder = await storage.createFolder({ name, parentId: parentId || null });
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

// DELETE /api/folders/:id - Удалить папку
router.delete("/:id", requirePermission("folders.manage"), async (req, res) => {
  try {
    const success = await storage.deleteFolder(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Folder not found" });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("Delete folder error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete folder" });
  }
});

export default router;
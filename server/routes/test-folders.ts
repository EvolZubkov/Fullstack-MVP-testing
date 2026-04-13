import { Router } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { requireAuth, requireAuthor } from "../middleware/auth";

const router = Router();

// GET /api/test-folders
router.get("/", requireAuth, async (req, res) => {
  try {
    const folders = await storage.getTestFolders();
    res.json(folders);
  } catch (error) {
    logger.error("Get test folders error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get test folders" });
  }
});

// POST /api/test-folders
router.post("/", requireAuthor, async (req, res) => {
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
router.put("/:id", requireAuthor, async (req, res) => {
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

// DELETE /api/test-folders/:id
router.delete("/:id", requireAuthor, async (req, res) => {
  try {
    const success = await storage.deleteTestFolder(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Folder not found" });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("Delete test folder error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete test folder" });
  }
});

// PATCH /api/test-folders/move/:testId — move test to folder
router.patch("/move/:testId", requireAuthor, async (req, res) => {
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

import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireAuthor } from "../middleware/auth";

const router = Router();

// GET /api/topics - Список тем с курсами и количеством вопросов
router.get("/", requireAuth, async (req, res) => {
  try {
    const topics = await storage.getTopics();
    const topicsWithDetails = await Promise.all(
      topics.map(async (topic) => {
        const courses = await storage.getTopicCourses(topic.id);
        const questions = await storage.getQuestionsByTopic(topic.id);
        return { 
          ...topic, 
          courses,
          questionCount: questions.length,
        };
      })
    );
    res.json(topicsWithDetails);
  } catch (error) {
    console.error("Get topics error:", error);
    res.status(500).json({ error: "Failed to get topics" });
  }
});

// POST /api/topics - Создать тему
router.post("/", requireAuthor, async (req, res) => {
  try {
    const { name, description, feedback, folderId } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Name required" });
    }
    const topic = await storage.createTopic({ name, description, feedback, folderId });
    res.status(201).json(topic);
  } catch (error) {
    console.error("Create topic error:", error);
    res.status(500).json({ error: "Failed to create topic" });
  }
});

// PUT /api/topics/:id - Обновить тему
router.put("/:id", requireAuthor, async (req, res) => {
  try {
    const { name, description, feedback, folderId } = req.body;
    const updated = await storage.updateTopic(req.params.id, { name, description, feedback, folderId });
    if (!updated) {
      return res.status(404).json({ error: "Topic not found" });
    }
    res.json(updated);
  } catch (error) {
    console.error("Update topic error:", error);
    res.status(500).json({ error: "Failed to update topic" });
  }
});

// DELETE /api/topics/:id - Удалить тему
router.delete("/:id", requireAuthor, async (req, res) => {
  try {
    const success = await storage.deleteTopic(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Topic not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Delete topic error:", error);
    res.status(500).json({ error: "Failed to delete topic" });
  }
});

// POST /api/topics/bulk-delete - Массовое удаление тем
router.post("/bulk-delete", requireAuthor, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "IDs array required" });
    }
    const deletedCount = await storage.deleteTopicsBulk(ids);
    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error("Bulk delete topics error:", error);
    res.status(500).json({ error: "Failed to delete topics" });
  }
});

// POST /api/topics/:id/duplicate - Дублировать тему с вопросами
router.post("/:id/duplicate", requireAuthor, async (req, res) => {
  try {
    const result = await (storage as any).duplicateTopicWithQuestions(req.params.id);
    if (!result) {
      return res.status(404).json({ error: "Topic not found" });
    }
    res.status(201).json(result);
  } catch (error) {
    console.error("Duplicate topic error:", error);
    res.status(500).json({ error: "Failed to duplicate topic" });
  }
});

// POST /api/topics/:topicId/courses - Добавить курс к теме
router.post("/:topicId/courses", requireAuthor, async (req, res) => {
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
    console.error("Create course error:", error);
    res.status(500).json({ error: "Failed to create course" });
  }
});

// DELETE /api/courses/:id - Удалить курс
router.delete("/courses/:id", requireAuthor, async (req, res) => {
  try {
    const success = await storage.deleteTopicCourse(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Course not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Delete course error:", error);
    res.status(500).json({ error: "Failed to delete course" });
  }
});

// GET /api/topics/:topicId/difficulty-distribution - Распределение сложности
router.get("/:topicId/difficulty-distribution", requireAuthor, async (req, res) => {
  try {
    const questions = await storage.getQuestionsByTopic(req.params.topicId);

    const distribution = {
      easy: questions.filter((q) => (q.difficulty || 50) <= 33).length,
      medium: questions.filter((q) => (q.difficulty || 50) > 33 && (q.difficulty || 50) <= 66).length,
      hard: questions.filter((q) => (q.difficulty || 50) > 66).length,
    };

    const byDifficulty: Record<number, number> = {};
    questions.forEach((q) => {
      const d = q.difficulty || 50;
      byDifficulty[d] = (byDifficulty[d] || 0) + 1;
    });

    res.json({
      total: questions.length,
      distribution,
      byDifficulty,
    });
  } catch (error) {
    console.error("Get difficulty distribution error:", error);
    res.status(500).json({ error: "Failed to get difficulty distribution" });
  }
});

export default router;
import { Router } from "express";
import { logger } from "../logger";
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
    logger.error("Get topics error: " + (error as Error).message);
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
    logger.error("Create topic error: " + (error as Error).message);
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
    logger.error("Update topic error: " + (error as Error).message);
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
    logger.error("Delete topic error: " + (error as Error).message);
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
    logger.error("Bulk delete topics error: " + (error as Error).message);
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
    logger.error("Duplicate topic error: " + (error as Error).message);
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
    logger.error("Create course error: " + (error as Error).message);
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
    logger.error("Delete course error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete course" });
  }
});

// GET /api/topics/:topicId/difficulty-distribution - Распределение сложности
router.get("/:topicId/difficulty-distribution", requireAuthor, async (req, res) => {
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
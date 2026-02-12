import { Router } from "express";
import { storage } from "../storage";
import { requireAuthor, requireLearner } from "../middleware/auth";

const router = Router();

// GET /api/tests/:id/assignments - Получить назначения для теста
router.get("/tests/:id/assignments", requireAuthor, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const assignments = await storage.getTestAssignments(req.params.id);

    // Добавляем информацию о пользователях и группах
    const enrichedAssignments = await Promise.all(
      assignments.map(async (assignment) => {
        let user = null;
        let group = null;

        if (assignment.userId) {
          const u = await storage.getUser(assignment.userId);
          if (u) {
            const { passwordHash, ...safeUser } = u;
            user = safeUser;
          }
        }

        if (assignment.groupId) {
          group = await storage.getGroup(assignment.groupId);
        }

        return { ...assignment, user, group };
      })
    );

    res.json(enrichedAssignments);
  } catch (error) {
    console.error("Get test assignments error:", error);
    res.status(500).json({ error: "Failed to fetch assignments" });
  }
});

// POST /api/tests/:id/assignments - Назначить тест пользователю или группе
router.post("/tests/:id/assignments", requireAuthor, async (req, res) => {
  try {
    const { userId, groupId, dueDate } = req.body;

    if (!userId && !groupId) {
      return res.status(400).json({ error: "userId or groupId is required" });
    }

    const test = await storage.getTest(req.params.id);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    if (userId) {
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
    }

    if (groupId) {
      const group = await storage.getGroup(groupId);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }
    }

    const assignment = await storage.createTestAssignment({
      testId: req.params.id,
      userId: userId || null,
      groupId: groupId || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      assignedBy: req.session.userId!,
    });

    res.status(201).json(assignment);
  } catch (error) {
    console.error("Create assignment error:", error);
    res.status(500).json({ error: "Failed to create assignment" });
  }
});

// POST /api/tests/:id/assignments/bulk - Массовое назначение теста
router.post("/tests/:id/assignments/bulk", requireAuthor, async (req, res) => {
  try {
    const { userIds, groupIds, dueDate } = req.body;

    if ((!userIds || userIds.length === 0) && (!groupIds || groupIds.length === 0)) {
      return res.status(400).json({ error: "userIds or groupIds is required" });
    }

    const test = await storage.getTest(req.params.id);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const assignments: any[] = [];

    // Назначаем пользователям
    if (userIds && userIds.length > 0) {
      for (const userId of userIds) {
        const assignment = await storage.createTestAssignment({
          testId: req.params.id,
          userId,
          groupId: null,
          dueDate: dueDate ? new Date(dueDate) : null,
          assignedBy: req.session.userId!,
        });
        assignments.push(assignment);
      }
    }

    // Назначаем группам
    if (groupIds && groupIds.length > 0) {
      for (const groupId of groupIds) {
        const assignment = await storage.createTestAssignment({
          testId: req.params.id,
          userId: null,
          groupId,
          dueDate: dueDate ? new Date(dueDate) : null,
          assignedBy: req.session.userId!,
        });
        assignments.push(assignment);
      }
    }

    res.status(201).json(assignments);
  } catch (error) {
    console.error("Bulk create assignments error:", error);
    res.status(500).json({ error: "Failed to create assignments" });
  }
});

// DELETE /api/assignments/:id - Удалить назначение
router.delete("/assignments/:id", requireAuthor, async (req, res) => {
  try {
    const success = await storage.deleteTestAssignment(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Assignment not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Delete assignment error:", error);
    res.status(500).json({ error: "Failed to delete assignment" });
  }
});

// GET /api/learner/assigned-tests - Назначенные тесты для текущего learner
router.get("/learner/assigned-tests", requireLearner, async (req, res) => {
  try {
    const assignedTests = await storage.getAssignedTestsForUser(req.session.userId!);
    res.json(assignedTests);
  } catch (error) {
    console.error("Get assigned tests error:", error);
    res.status(500).json({ error: "Failed to fetch assigned tests" });
  }
});

export default router;
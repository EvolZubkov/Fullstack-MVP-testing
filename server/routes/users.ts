import { Router } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { requireAuthor } from "../middleware/auth";

const router = Router();

// GET /api/users - Список пользователей
router.get("/", requireAuthor, async (req, res) => {
  try {
    const users = await storage.getUsers();
    const usersWithGroups = await Promise.all(
      users.map(async (user) => {
        const groups = await storage.getUserGroups(user.id);
        return { ...user, groups };
      })
    );
    res.json(usersWithGroups);
  } catch (error) {
    logger.error("Get users error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get users" });
  }
});

// GET /api/users/:id - Получить пользователя
router.get("/:id", requireAuthor, async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const groups = await storage.getUserGroups(user.id);
    res.json({ ...user, groups });
  } catch (error) {
    logger.error("Get user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get user" });
  }
});

// POST /api/users - Создать пользователя
router.post("/", requireAuthor, async (req, res) => {
  try {
    const { email, password, name, role, groupIds } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: "User with this email already exists" });
    }

    const user = await storage.createUser({
      email,
      passwordHash: password,
      name: name || null,
      role: role || "learner",
      status: "pending",
      mustChangePassword: true,
      createdBy: req.session.userId,
    });

    // Добавляем в группы если указаны
    if (groupIds && Array.isArray(groupIds)) {
      await storage.setUserGroups(user.id, groupIds);
    }

    const groups = await storage.getUserGroups(user.id);
    res.status(201).json({ ...user, groups });
  } catch (error) {
    logger.error("Create user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// PUT /api/users/:id - Обновить пользователя
router.put("/:id", requireAuthor, async (req, res) => {
  try {
    const { email, name, role, groupIds } = req.body;
    const userId = req.params.id;

    const existingUser = await storage.getUser(userId);
    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Проверяем уникальность email если он меняется
    if (email && email !== existingUser.email) {
      const userWithEmail = await storage.getUserByEmail(email);
      if (userWithEmail) {
        return res.status(400).json({ error: "Email already in use" });
      }
    }

    const updated = await storage.updateUser(userId, { email, name, role });

    // Обновляем группы если указаны
    if (groupIds && Array.isArray(groupIds)) {
      await storage.setUserGroups(userId, groupIds);
    }

    const groups = await storage.getUserGroups(userId);
    res.json({ ...updated, groups });
  } catch (error) {
    logger.error("Update user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// POST /api/users/:id/reset-password - Сбросить пароль пользователя
router.post("/:id/reset-password", requireAuthor, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ error: "New password required" });
    }

    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await storage.updateUserPassword(user.id, newPassword);
    await storage.updateUser(user.id, { mustChangePassword: true });

    res.json({ success: true });
  } catch (error) {
    logger.error("Reset password error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// POST /api/users/:id/deactivate - Деактивировать пользователя
router.post("/:id/deactivate", requireAuthor, async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role === "author") {
      return res.status(400).json({ error: "Cannot deactivate author accounts" });
    }

    await storage.deactivateUser(user.id);
    res.json({ success: true });
  } catch (error) {
    logger.error("Deactivate user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to deactivate user" });
  }
});

// POST /api/users/:id/activate - Активировать пользователя
router.post("/:id/activate", requireAuthor, async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await storage.activateUser(user.id);
    res.json({ success: true });
  } catch (error) {
    logger.error("Activate user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to activate user" });
  }
});

// POST /api/users/:id/reset-attempts - Сбросить попытки пользователя
router.post("/:id/reset-attempts", requireAuthor, async (req, res) => {
  try {
    const { testId } = req.body;
    const userId = req.params.id;

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (testId) {
      await storage.deleteAttemptsByUserAndTest(userId, testId);
    } else {
      const attempts = await storage.getAttemptsByUser(userId);
      for (const attempt of attempts) {
        await storage.deleteAttemptsByUserAndTest(userId, attempt.testId);
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("Reset attempts error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to reset attempts" });
  }
});

// GET /api/users/:id/attempts-summary - Сводка попыток пользователя
router.get("/:id/attempts-summary", requireAuthor, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const attempts = await storage.getAttemptsByUser(userId);
    const tests = await storage.getTests();

    const summary = tests.map((test) => {
      const testAttempts = attempts.filter((a) => a.testId === test.id);
      const completedAttempts = testAttempts.filter((a) => a.finishedAt);

      let bestScore = null;
      let lastAttemptAt = null;

      if (completedAttempts.length > 0) {
        const results = completedAttempts
          .map((a) => a.resultJson as any)
          .filter(Boolean);
        if (results.length > 0) {
          bestScore = Math.max(...results.map((r) => r.percent || 0));
        }
        lastAttemptAt = completedAttempts.reduce((latest, a) => {
          const finishedAt = a.finishedAt ? new Date(a.finishedAt) : null;
          return finishedAt && (!latest || finishedAt > latest) ? finishedAt : latest;
        }, null as Date | null);
      }

      return {
        testId: test.id,
        testTitle: test.title,
        totalAttempts: testAttempts.length,
        completedAttempts: completedAttempts.length,
        maxAttempts: test.maxAttempts,
        bestScore,
        lastAttemptAt,
      };
    });

    res.json(summary.filter((s) => s.totalAttempts > 0));
  } catch (error) {
    logger.error("Get attempts summary error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get attempts summary" });
  }
});

// GET /api/users/:id/groups - Группы пользователя
router.get("/:id/groups", requireAuthor, async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const groups = await storage.getUserGroups(user.id);
    res.json(groups);
  } catch (error) {
    logger.error("Get user groups error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get user groups" });
  }
});

// PUT /api/users/:id/groups - Обновить группы пользователя
router.put("/:id/groups", requireAuthor, async (req, res) => {
  try {
    const { groupIds } = req.body;
    const userId = req.params.id;

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!Array.isArray(groupIds)) {
      return res.status(400).json({ error: "groupIds must be an array" });
    }

    await storage.setUserGroups(userId, groupIds);

    const groups = await storage.getUserGroups(userId);
    res.json(groups);
  } catch (error) {
    logger.error("Update user groups error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update user groups" });
  }
});

export default router;
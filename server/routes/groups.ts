import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { logger } from "../logger";
import { appBaseUrl } from "../config";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { sendAssignmentEmail } from "../email";

const router = Router();

// Генерирует токен и шлёт письмо новому участнику группы по всем активным назначениям
async function notifyNewGroupMember(userId: string, groupId: string) {
  try {
    const assignments = await storage.getGroupAssignments(groupId);
    if (assignments.length === 0) return;

    const user = await storage.getUser(userId);
    if (!user) return;

    const { decryptEmail } = await import("../utils/crypto");
    let email = user.email;
    try {
      if (user.email && !user.email.includes("@")) {
        email = await decryptEmail(user.email);
      }
    } catch { return; }

    for (const assignment of assignments) {
      const test = await storage.getTest(assignment.testId);
      if (!test) continue;

      const expiresAt = assignment.linkExpiresAt
        ? new Date(assignment.linkExpiresAt)
        : assignment.dueDate
          ? new Date(assignment.dueDate)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const raw = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(raw).digest("hex");
      await storage.createAssignmentAccessToken({
        assignmentId: assignment.id,
        userId,
        testId: assignment.testId,
        tokenHash,
        expiresAt,
      });

      const magicLink = `${appBaseUrl()}/access/${raw}`;
      await sendAssignmentEmail({
        to: email,
        userName: user.name || undefined,
        testTitle: test.title,
        testDescription: test.description,
        dueDate: assignment.dueDate ? new Date(assignment.dueDate) : null,
        magicLink,
      });

      logger.info(`Sent assignment email to new group member ${email} for test "${test.title}"`);
    }
  } catch (e) {
    logger.error("notifyNewGroupMember error: " + (e as Error).message);
  }
}

// GET /api/groups - Список групп
router.get("/", requirePermission("groups.manage"), async (req, res) => {
  try {
    const groups = await storage.getGroups();
    const groupsWithUsers = await Promise.all(
      groups.map(async (group) => {
        const users = await storage.getGroupUsers(group.id);
        return {
          ...group,
          userCount: users.length,
          users: users.map((u) => ({ id: u.id, email: u.email, name: u.name })),
        };
      })
    );
    res.json(groupsWithUsers);
  } catch (error) {
    logger.error("Get groups error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get groups" });
  }
});

// GET /api/groups/:id - Получить группу
router.get("/:id", requirePermission("groups.manage"), async (req, res) => {
  try {
    const group = await storage.getGroup(req.params.id);
    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    const users = await storage.getGroupUsers(group.id);
    res.json({
      ...group,
      users: users.map((u) => ({ id: u.id, email: u.email, name: u.name })),
    });
  } catch (error) {
    logger.error("Get group error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get group" });
  }
});

// POST /api/groups - Создать группу
router.post("/", requirePermission("groups.manage"), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Name required" });
    }

    const group = await storage.createGroup({
      name,
      description: description || null,
      createdBy: req.session.userId,
    });

    res.status(201).json({ ...group, users: [], userCount: 0 });
  } catch (error) {
    logger.error("Create group error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create group" });
  }
});

// PUT /api/groups/:id - Обновить группу
router.put("/:id", requirePermission("groups.manage"), async (req, res) => {
  try {
    const { name, description } = req.body;
    const updated = await storage.updateGroup(req.params.id, { name, description });
    if (!updated) {
      return res.status(404).json({ error: "Group not found" });
    }
    res.json(updated);
  } catch (error) {
    logger.error("Update group error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update group" });
  }
});

// DELETE /api/groups/:id - Удалить группу
router.delete("/:id", requirePermission("groups.manage"), async (req, res) => {
  try {
    const success = await storage.deleteGroup(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Group not found" });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("Delete group error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete group" });
  }
});

// POST /api/groups/:id/users - Добавить пользователей в группу
router.post("/:id/users", requirePermission("groups.manage"), async (req, res) => {
  try {
    const { userIds, userId } = req.body;
    const groupId = req.params.id;

    const group = await storage.getGroup(groupId);
    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    // Поддержка и userId (один), и userIds (массив)
    let idsToAdd: string[] = [];
    if (Array.isArray(userIds) && userIds.length > 0) {
      idsToAdd = userIds;
    } else if (userId) {
      idsToAdd = [userId];
    } else {
      return res.status(400).json({ error: "userId or userIds required" });
    }

    const currentUsers = await storage.getGroupUsers(groupId);
    const currentUserIds = new Set(currentUsers.map((u) => u.id));

    for (const uid of idsToAdd) {
      if (!currentUserIds.has(uid)) {
        await storage.addUserToGroup(uid, groupId);
        // Асинхронно шлём письма — не блокируем ответ
        notifyNewGroupMember(uid, groupId).catch(() => {});
      }
    }

    const updatedUsers = await storage.getGroupUsers(groupId);
    res.json({
      ...group,
      users: updatedUsers.map((u) => ({ id: u.id, email: u.email, name: u.name })),
      userCount: updatedUsers.length,
    });
  } catch (error) {
    logger.error("Add users to group error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to add users to group" });
  }
});

// DELETE /api/groups/:id/users/:userId - Удалить пользователя из группы
router.delete("/:id/users/:userId", requirePermission("groups.manage"), async (req, res) => {
  try {
    const { id: groupId, userId } = req.params;

    const success = await storage.removeUserFromGroup(userId, groupId);
    if (!success) {
      return res.status(404).json({ error: "User not in group" });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("Remove user from group error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to remove user from group" });
  }
});

export default router;
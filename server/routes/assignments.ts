import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { logger } from "../logger";
import { storage } from "../storage";
import { requireAuthor, requireLearner } from "../middleware/auth";
import { sendAssignmentEmail } from "../email";

const router = Router();

const APP_URL = process.env.APP_URL || process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5001}`;

// ─── Вычислить срок жизни magic link ─────────────────────────────────────────
function resolveTokenExpiry(linkExpiresAt?: Date | null, dueDate?: Date | null): Date {
  if (linkExpiresAt) return linkExpiresAt;
  if (dueDate) return dueDate;
  // Дефолт: 30 дней
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

// ─── Сгенерировать токен и сохранить в БД ────────────────────────────────────
async function generateTokenForUser(opts: {
  assignmentId: string;
  userId: string;
  testId: string;
  expiresAt: Date;
}) {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  await storage.createAssignmentAccessToken({
    assignmentId: opts.assignmentId,
    userId: opts.userId,
    testId: opts.testId,
    tokenHash,
    expiresAt: opts.expiresAt,
  });
  return raw; // возвращаем сырой токен для вставки в ссылку
}

// ─── Отправить письмо пользователю ───────────────────────────────────────────
async function notifyUser(opts: {
  userId: string;
  assignmentId: string;
  testId: string;
  testTitle: string;
  testDescription?: string | null;
  dueDate?: Date | null;
  expiresAt: Date;
}) {
  const user = await storage.getUser(opts.userId);
  if (!user) return;

  // email зашифрован — расшифровываем
  let email = "";
  try {
    email = await (user.email ? (user.email.includes("@") ? user.email : "") : "");
    if (!email) {
      const { decryptEmail } = await import("../utils/crypto");
      email = await decryptEmail(user.email);
    }
  } catch {
    logger.warn(`Could not decrypt email for user ${opts.userId}`);
    return;
  }

  if (!email) return;

  // Отзываем старые токены этого пользователя для данного назначения перед созданием нового.
  // Важно: отзываем только токены конкретного пользователя, чтобы групповые назначения
  // не отзывали токены других участников группы.
  await storage.revokeAssignmentAccessTokensByAssignmentAndUser(opts.assignmentId, opts.userId);

  const rawToken = await generateTokenForUser({
    assignmentId: opts.assignmentId,
    userId: opts.userId,
    testId: opts.testId,
    expiresAt: opts.expiresAt,
  });

  const magicLink = `${APP_URL}/access/${rawToken}`;

  await sendAssignmentEmail({
    to: email,
    userName: user.name || undefined,
    testTitle: opts.testTitle,
    testDescription: opts.testDescription,
    dueDate: opts.dueDate,
    magicLink,
  });
}

// ─── GET /api/tests/:id/assignments ──────────────────────────────────────────
router.get("/tests/:id/assignments", requireAuthor, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const assignments = await storage.getTestAssignments(req.params.id);

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

        // Статус токена (берём последний активный)
        const tokens = await storage.getAssignmentAccessTokensByAssignment(assignment.id);
        const activeToken = tokens.find(t => !t.revokedAt && t.expiresAt > new Date());
        const tokenStatus = activeToken ? "active"
          : tokens.some(t => !t.revokedAt && t.expiresAt <= new Date()) ? "expired"
          : tokens.some(t => t.revokedAt) ? "revoked"
          : "none";

        return { ...assignment, user, group, tokenStatus, tokenId: activeToken?.id ?? null };
      })
    );

    res.json(enrichedAssignments);
  } catch (error) {
    logger.error("Get test assignments error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch assignments" });
  }
});

// ─── POST /api/tests/:id/assignments ─────────────────────────────────────────
router.post("/tests/:id/assignments", requireAuthor, async (req, res) => {
  try {
    const { userId, groupId, dueDate, linkExpiresAt } = req.body;

    if (!userId && !groupId) {
      return res.status(400).json({ error: "userId or groupId is required" });
    }

    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const parsedDueDate = dueDate ? new Date(dueDate) : null;
    const parsedLinkExpiry = linkExpiresAt ? new Date(linkExpiresAt) : null;
    const expiresAt = resolveTokenExpiry(parsedLinkExpiry, parsedDueDate);

    if (userId) {
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
    }

    if (groupId) {
      const group = await storage.getGroup(groupId);
      if (!group) return res.status(404).json({ error: "Group not found" });
    }

    const assignment = await storage.createTestAssignment({
      testId: req.params.id,
      userId: userId || null,
      groupId: groupId || null,
      dueDate: parsedDueDate,
      linkExpiresAt: parsedLinkExpiry,
      assignedBy: req.session.userId!,
    });

    // Отправляем письма
    if (userId) {
      notifyUser({
        userId,
        assignmentId: assignment.id,
        testId: req.params.id,
        testTitle: test.title,
        testDescription: test.description,
        dueDate: parsedDueDate,
        expiresAt,
      }).catch(e => logger.error("Assignment email error: " + e.message));
    }

    if (groupId) {
      const groupUsers = await storage.getGroupUsers(groupId);
      for (const u of groupUsers) {
        notifyUser({
          userId: u.id,
          assignmentId: assignment.id,
          testId: req.params.id,
          testTitle: test.title,
          testDescription: test.description,
          dueDate: parsedDueDate,
          expiresAt,
        }).catch(e => logger.error("Assignment email error: " + e.message));
      }
    }

    res.status(201).json(assignment);
  } catch (error) {
    logger.error("Create assignment error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create assignment" });
  }
});

// ─── POST /api/tests/:id/assignments/bulk ────────────────────────────────────
router.post("/tests/:id/assignments/bulk", requireAuthor, async (req, res) => {
  try {
    const { userIds, groupIds, dueDate, linkExpiresAt } = req.body;

    if ((!userIds || userIds.length === 0) && (!groupIds || groupIds.length === 0)) {
      return res.status(400).json({ error: "userIds or groupIds is required" });
    }

    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const parsedDueDate = dueDate ? new Date(dueDate) : null;
    const parsedLinkExpiry = linkExpiresAt ? new Date(linkExpiresAt) : null;
    const expiresAt = resolveTokenExpiry(parsedLinkExpiry, parsedDueDate);

    const assignments: any[] = [];

    if (userIds && userIds.length > 0) {
      for (const userId of userIds) {
        const assignment = await storage.createTestAssignment({
          testId: req.params.id,
          userId,
          groupId: null,
          dueDate: parsedDueDate,
          linkExpiresAt: parsedLinkExpiry,
          assignedBy: req.session.userId!,
        });
        assignments.push(assignment);
        notifyUser({
          userId,
          assignmentId: assignment.id,
          testId: req.params.id,
          testTitle: test.title,
          testDescription: test.description,
          dueDate: parsedDueDate,
          expiresAt,
        }).catch(e => logger.error("Assignment email error: " + e.message));
      }
    }

    if (groupIds && groupIds.length > 0) {
      for (const groupId of groupIds) {
        const assignment = await storage.createTestAssignment({
          testId: req.params.id,
          userId: null,
          groupId,
          dueDate: parsedDueDate,
          linkExpiresAt: parsedLinkExpiry,
          assignedBy: req.session.userId!,
        });
        assignments.push(assignment);
        const groupUsers = await storage.getGroupUsers(groupId);
        for (const u of groupUsers) {
          notifyUser({
            userId: u.id,
            assignmentId: assignment.id,
            testId: req.params.id,
            testTitle: test.title,
            testDescription: test.description,
            dueDate: parsedDueDate,
            expiresAt,
          }).catch(e => logger.error("Assignment email error: " + e.message));
        }
      }
    }

    res.status(201).json(assignments);
  } catch (error) {
    logger.error("Bulk create assignments error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create assignments" });
  }
});

// ─── DELETE /api/assignments/:id ──────────────────────────────────────────────
router.delete("/assignments/:id", requireAuthor, async (req, res) => {
  try {
    // Отзываем все токены назначения перед удалением
    await storage.revokeAssignmentAccessTokensByAssignment(req.params.id);
    const success = await storage.deleteTestAssignment(req.params.id);
    if (!success) return res.status(404).json({ error: "Assignment not found" });
    res.json({ success: true });
  } catch (error) {
    logger.error("Delete assignment error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete assignment" });
  }
});

// ─── PATCH /api/assignment-tokens/:id/revoke ──────────────────────────────────
router.patch("/assignment-tokens/:id/revoke", requireAuthor, async (req, res) => {
  try {
    await storage.revokeAssignmentAccessToken(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error("Revoke token error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to revoke token" });
  }
});

// ─── POST /api/assignments/:id/resend ─────────────────────────────────────────
router.post("/assignments/:id/resend", requireAuthor, async (req, res) => {
  try {
    const tokens = await storage.getAssignmentAccessTokensByAssignment(req.params.id);
    if (tokens.length === 0) {
      return res.status(404).json({ error: "Assignment not found or has no tokens" });
    }

    const token = tokens[0];
    const test = await storage.getTest(token.testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    // Отзываем старые токены и генерируем новый
    await storage.revokeAssignmentAccessTokensByAssignment(req.params.id);

    const expiresAt = resolveTokenExpiry(null, null); // 30 дней от сейчас
    const rawToken = await generateTokenForUser({
      assignmentId: req.params.id,
      userId: token.userId,
      testId: token.testId,
      expiresAt,
    });

    const user = await storage.getUser(token.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    let email = "";
    try {
      if (user.email && user.email.includes("@")) {
        email = user.email;
      } else if (user.email) {
        const { decryptEmail } = await import("../utils/crypto");
        email = await decryptEmail(user.email);
      }
    } catch {
      return res.status(400).json({ error: "Cannot decrypt user email" });
    }

    const magicLink = `${APP_URL}/access/${rawToken}`;
    await sendAssignmentEmail({
      to: email,
      userName: user.name || undefined,
      testTitle: test.title,
      testDescription: test.description,
      magicLink,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("Resend assignment error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to resend" });
  }
});

// ─── GET /api/learner/assigned-tests ─────────────────────────────────────────
router.get("/learner/assigned-tests", requireLearner, async (req, res) => {
  try {
    const assignedTests = await storage.getAssignedTestsForUser(req.session.userId!);
    res.json(assignedTests);
  } catch (error) {
    logger.error("Get assigned tests error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch assigned tests" });
  }
});

export default router;

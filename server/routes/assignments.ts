import { Router } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { requireTestScope, requireAssignmentScope } from "../middleware/test-scope";
import {
  deliverAssignmentLink,
  // Срок жизни magic link считается там же, где ссылка выпускается.
  resolveAssignmentTokenExpiry as resolveTokenExpiry,
} from "../services/assignment-link";

const router = Router();

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

  // Decides may-issue-or-withhold (D-3) and delivers the letter either way.
  await deliverAssignmentLink({
    user,
    email,
    assignmentId: opts.assignmentId,
    testId: opts.testId,
    testTitle: opts.testTitle,
    testDescription: opts.testDescription,
    dueDate: opts.dueDate,
    expiresAt: opts.expiresAt,
  });
}

// ─── GET /api/tests/:id/assignments ──────────────────────────────────────────
router.get("/tests/:id/assignments", requirePermission("assignments.manage"), requireTestScope("assign"), async (req, res) => {
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

        let groupMemberIds: string[] = [];
        if (assignment.groupId) {
          group = await storage.getGroup(assignment.groupId);
          const members = await storage.getGroupUsers(assignment.groupId);
          groupMemberIds = members.map(m => m.id);
        }

        // Статус токена (берём последний активный)
        const tokens = await storage.getAssignmentAccessTokensByAssignment(assignment.id);
        const activeToken = tokens.find(t => !t.revokedAt && t.expiresAt > new Date());
        const tokenStatus = activeToken ? "active"
          : tokens.some(t => !t.revokedAt && t.expiresAt <= new Date()) ? "expired"
          : tokens.some(t => t.revokedAt) ? "revoked"
          : "none";

        return { ...assignment, user, group, groupMemberIds, tokenStatus, tokenId: activeToken?.id ?? null };
      })
    );

    res.json(enrichedAssignments);
  } catch (error) {
    logger.error("Get test assignments error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch assignments" });
  }
});

// ─── POST /api/tests/:id/assignments ─────────────────────────────────────────
router.post("/tests/:id/assignments", requirePermission("assignments.manage"), requireTestScope("assign"), async (req, res) => {
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
router.post("/tests/:id/assignments/bulk", requirePermission("assignments.manage"), requireTestScope("assign"), async (req, res) => {
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
router.delete("/assignments/:id", requirePermission("assignments.manage"), requireAssignmentScope("id"), async (req, res) => {
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
// Token revoke is keyed by token id; per-test scope (token -> assignment -> test)
// is not resolved here, so this is gated by capability only. Admin/superadmin
// always pass; for managers this is a known scope gap to tighten later.
router.patch("/assignment-tokens/:id/revoke", requirePermission("assignments.manage"), async (req, res) => {
  try {
    await storage.revokeAssignmentAccessToken(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error("Revoke token error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to revoke token" });
  }
});

// ─── POST /api/assignments/:id/resend ─────────────────────────────────────────
router.post("/assignments/:id/resend", requirePermission("assignments.manage"), requireAssignmentScope("id"), async (req, res) => {
  try {
    const tokens = await storage.getAssignmentAccessTokensByAssignment(req.params.id);
    if (tokens.length === 0) {
      return res.status(404).json({ error: "Assignment not found or has no tokens" });
    }

    const token = tokens[0];
    const test = await storage.getTest(token.testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const user = await storage.getUser(token.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Отзываем старые токены. Это остаётся штатным действием независимо от
    // того, будет ли выпущен новый (revocation of an existing link is always
    // safe; only the re-issuance of a NEW passwordless link is gated below).
    await storage.revokeAssignmentAccessTokensByAssignment(req.params.id);

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

    // D-3: decides may-issue-or-withhold and delivers the letter either way.
    // `revokeExisting: false` — already revoked above (whole-assignment revoke).
    await deliverAssignmentLink({
      user,
      email,
      assignmentId: req.params.id,
      testId: token.testId,
      testTitle: test.title,
      testDescription: test.description,
      expiresAt: resolveTokenExpiry(null, null), // 30 дней от сейчас
      revokeExisting: false,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("Resend assignment error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to resend" });
  }
});

// ─── GET /api/assignments/:id/group-users — участники группового назначения ───
router.get("/assignments/:id/group-users", requirePermission("assignments.manage"), requireAssignmentScope("id"), async (req, res) => {
  try {
    const assignment = await storage.getAssignment(req.params.id);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });
    if (!assignment.groupId) return res.status(400).json({ error: "Not a group assignment" });

    const groupUsers = await storage.getGroupUsers(assignment.groupId);
    const tokens = await storage.getAssignmentAccessTokensByAssignment(req.params.id);

    // Decrypt emails and attach token status per user
    const { decryptEmail } = await import("../utils/crypto");
    const users = await Promise.all(groupUsers.map(async (u) => {
      let email = u.email;
      try {
        if (u.email && !u.email.includes("@")) {
          email = await decryptEmail(u.email);
        }
      } catch {}
      const token = tokens.find(t => t.userId === u.id && !t.revokedAt && t.expiresAt > new Date());
      return {
        id: u.id,
        email,
        name: u.name,
        status: u.status,
        tokenStatus: token ? "active" : tokens.find(t => t.userId === u.id) ? "revoked" : "none",
      };
    }));

    res.json(users);
  } catch (error) {
    logger.error("Get group assignment users error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get group users" });
  }
});

// ─── POST /api/assignments/:id/resend-group — обновить ссылки для всей группы ─
router.post("/assignments/:id/resend-group", requirePermission("assignments.manage"), requireAssignmentScope("id"), async (req, res) => {
  try {
    const assignment = await storage.getAssignment(req.params.id);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });
    if (!assignment.groupId) return res.status(400).json({ error: "Not a group assignment" });

    const test = await storage.getTest(assignment.testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const groupUsers = await storage.getGroupUsers(assignment.groupId);

    // Revoke all existing tokens for this assignment
    await storage.revokeAssignmentAccessTokensByAssignment(req.params.id);

    const { decryptEmail } = await import("../utils/crypto");
    let sent = 0;

    for (const u of groupUsers) {
      let email = u.email;
      try {
        if (u.email && !u.email.includes("@")) {
          email = await decryptEmail(u.email);
        }
      } catch { continue; }

      // D-3: decides may-issue-or-withhold and delivers the letter either way.
      // `revokeExisting: false` — already revoked above for the whole assignment.
      await deliverAssignmentLink({
        user: u,
        email,
        assignmentId: assignment.id,
        testId: assignment.testId,
        testTitle: test.title,
        testDescription: test.description,
        dueDate: assignment.dueDate ? new Date(assignment.dueDate) : null,
        expiresAt: resolveTokenExpiry(
          assignment.linkExpiresAt ? new Date(assignment.linkExpiresAt) : null,
          assignment.dueDate ? new Date(assignment.dueDate) : null,
        ),
        revokeExisting: false,
      });
      sent++;
    }

    res.json({ success: true, sent });
  } catch (error) {
    logger.error("Resend group assignment error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to resend group" });
  }
});

// ─── POST /api/assignments/:id/resend-user/:userId — обновить ссылку одному пользователю в группе
router.post("/assignments/:id/resend-user/:userId", requirePermission("assignments.manage"), requireAssignmentScope("id"), async (req, res) => {
  try {
    const { id: assignmentId, userId } = req.params;
    const assignment = await storage.getAssignment(assignmentId);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });

    const test = await storage.getTest(assignment.testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Отзываем старые токены этого пользователя для данного назначения. Стоит
    // независимо от того, будет ли выпущен новый (see /resend, /resend-group).
    await storage.revokeAssignmentAccessTokensByAssignmentAndUser(assignmentId, userId);

    const { decryptEmail } = await import("../utils/crypto");
    let email = user.email;
    try {
      if (user.email && !user.email.includes("@")) email = await decryptEmail(user.email);
    } catch { return res.status(400).json({ error: "Cannot decrypt user email" }); }

    // D-3: decides may-issue-or-withhold and delivers the letter either way.
    // `revokeExisting: false` — already revoked above.
    await deliverAssignmentLink({
      user,
      email,
      assignmentId,
      testId: assignment.testId,
      testTitle: test.title,
      testDescription: test.description,
      dueDate: assignment.dueDate ? new Date(assignment.dueDate) : null,
      expiresAt: resolveTokenExpiry(
        assignment.linkExpiresAt ? new Date(assignment.linkExpiresAt) : null,
        assignment.dueDate ? new Date(assignment.dueDate) : null,
      ),
      revokeExisting: false,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("Resend user assignment error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to resend" });
  }
});

// ─── PATCH /api/assignments/:id/revoke-user/:userId — отозвать ссылку пользователя в группе
router.patch("/assignments/:id/revoke-user/:userId", requirePermission("assignments.manage"), requireAssignmentScope("id"), async (req, res) => {
  try {
    const { id: assignmentId, userId } = req.params;
    await storage.revokeAssignmentAccessTokensByAssignmentAndUser(assignmentId, userId);
    res.json({ success: true });
  } catch (error) {
    logger.error("Revoke user token error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to revoke" });
  }
});

// ─── GET /api/learner/assigned-tests ─────────────────────────────────────────
router.get("/learner/assigned-tests", requirePermission("attempts.self.read"), async (req, res) => {
  try {
    const assignedTests = await storage.getAssignedTestsForUser(req.session.userId!);
    res.json(assignedTests);
  } catch (error) {
    logger.error("Get assigned tests error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch assigned tests" });
  }
});

export default router;

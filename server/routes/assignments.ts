import { Router } from "express";
import ExcelJS from "exceljs";
import { audit, logger } from "../logger";
import { config } from "../config";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { requireTestScope, requireAssignmentScope } from "../middleware/test-scope";
import { respondWorkbookReadError, workbookUploadSingle } from "../middleware/upload";
import { addAoaSheet, workbookToBuffer } from "../utils/excel";
import {
  classifyParticipants,
  ParticipantsInviteError,
  parseParticipantsWorkbook,
  runParticipantsInvite,
  type ParticipantPreviewRow,
} from "../services/participants-invite";
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

// ─── Рассылка списком из файла (PRD-28) ──────────────────────────────────────
// The two endpoints that act on accounts — preview and run — carry the full
// gate of FR-22: the capability to assign, the capability to create accounts
// (the run brings participants into being), and the object-level `assign` scope
// on THIS test. Two `requirePermission` in one chain is intended: each is an
// independent gate that either answers 403 or hands over to the next, and the
// capability model has no "all of these" form. The template download and the
// export mark create nothing, so they stop at `assignments.manage` + scope.

/** Multipart field the participants workbook arrives in. */
const participantsUpload = workbookUploadSingle("file");

/**
 * The sentence the operator reads for a refusal the pipeline raised.
 *
 * The service speaks English — its messages go to the log and to developers —
 * and the Russian phrasing is composed here, out of `kind` and the values the
 * refusal carries. That is why the ceiling is named by `detail.maxRows` and not
 * spliced out of the message: rewording the service must never change what the
 * operator sees, nor the number in it.
 */
function participantsRefusalMessage(error: ParticipantsInviteError): string {
  switch (error.kind) {
    case "empty_file":
      return "В файле нет ни одной строки с участниками.";
    case "too_many_rows":
      return `Слишком много строк: за один раз можно загрузить не больше ${error.detail.maxRows}.`;
    case "group_name_taken":
      return `Группа с таким именем уже есть: ${error.detail.groupName}`;
    case "test_not_found":
      return "Тест не найден.";
  }
}

// ─── POST /api/tests/:id/participants/preview — разбор файла (PRD-28 FR-11) ───
router.post(
  "/tests/:id/participants/preview",
  requirePermission("assignments.manage"),
  requirePermission("users.create"),
  requireTestScope("assign"),
  participantsUpload,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "File required" });
      const rows = await parseParticipantsWorkbook(req.file.buffer, {
        maxRows: config.limits.participantsImportMaxRows,
      });
      res.json(await classifyParticipants(rows, { testId: req.params.id, storage }));
    } catch (error) {
      logger.error("Participants preview error: " + (error as Error).message);
      if (respondWorkbookReadError(res, error)) return;
      // What the parser refuses on — an empty book, too many rows — is about the
      // file the operator picked, so it is their error to fix. Anything else
      // (the classification reading the database, say) is ours, and calling it
      // a bad file would send the operator looking in the wrong place.
      //
      // The answer carries the Russian sentence for the human and `code` beside
      // it for the screen: the service message is English by design and must
      // not reach the operator's toast.
      if (error instanceof ParticipantsInviteError) {
        return res.status(400).json({
          code: error.kind,
          error: participantsRefusalMessage(error),
        });
      }
      res.status(500).json({ error: "Failed to preview participants" });
    }
  },
);

// ─── POST /api/tests/:id/participants/invite — прогон (PRD-28 FR-13..FR-18) ───
router.post(
  "/tests/:id/participants/invite",
  requirePermission("assignments.manage"),
  requirePermission("users.create"),
  requireTestScope("assign"),
  async (req, res) => {
    const { rows, dueDate, linkExpiresAt, groupName } = req.body ?? {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "rows is required" });
    }

    try {
      const report = await runParticipantsInvite({
        testId: req.params.id,
        rows: rows as ParticipantPreviewRow[],
        actorId: req.session.userId!,
        dueDate: dueDate ? new Date(dueDate) : null,
        linkExpiresAt: linkExpiresAt ? new Date(linkExpiresAt) : null,
        groupName: typeof groupName === "string" ? groupName : null,
        storage,
      });
      // FR-20: the fact of the run, in counts. The report going back to the
      // operator carries the freshly minted links; the trail carries none.
      audit.participantsInvite(req.params.id, report.created, report.assigned);
      res.json(report);
    } catch (error) {
      logger.error("Participants invite error: " + (error as Error).message);
      // The conditions the run refuses on BEFORE changing anything are the
      // operator's to resolve, and they resolve differently: a missing test is
      // gone (the scope check saw it a moment ago, so this is the race), while a
      // taken group name is a rename away. They are told apart by `kind` and
      // never by the text of the message — the service speaks English, and the
      // sentence the operator reads is composed here, naming the group that
      // stands in the way.
      //
      // `code` travels beside the sentence so the screen can recognize the
      // refusal it knows how to resolve without matching Russian prose.
      if (error instanceof ParticipantsInviteError) {
        const status = error.kind === "test_not_found" ? 404 : 400;
        return res.status(status).json({
          code: error.kind,
          error: participantsRefusalMessage(error),
        });
      }
      res.status(500).json({ error: "Failed to invite participants" });
    }
  },
);

// ─── POST /api/tests/:id/participants/links-exported — отметка (PRD-28 FR-20) ─
// Records that the operator saved the run's links to a file, and nothing else.
// The links do NOT travel here: the file is assembled on the client from the
// report it already holds (раздел 7), so the server is told only the fact and
// the count. Answers 204 — there is nothing to give back.
router.post(
  "/tests/:id/participants/links-exported",
  requirePermission("assignments.manage"),
  requireTestScope("assign"),
  (req, res) => {
    const raw = Number(req.body?.count);
    audit.participantLinksExported(req.params.id, Number.isFinite(raw) ? raw : 0);
    res.status(204).end();
  },
);

// ─── GET /api/tests/:id/participants/template — шаблон книги (PRD-28 FR-10) ───
// Two columns only, unlike the users-import template: `role` and `group` are
// ignored in this scenario (the role is always `learner`, the group comes from
// the form), and offering them would promise behaviour that does not exist.
router.get(
  "/tests/:id/participants/template",
  requirePermission("assignments.manage"),
  requireTestScope("assign"),
  async (_req, res) => {
    const wb = new ExcelJS.Workbook();
    addAoaSheet(wb, "Участники", [
      ["email", "name"],
      ["ivanov@example.com", "Иван Иванов"],
      ["petrova@example.com", "Анна Петрова"],
    ]);
    const buf = await workbookToBuffer(wb);
    res.setHeader("Content-Disposition", "attachment; filename=participants-template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  },
);

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

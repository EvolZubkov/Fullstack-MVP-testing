import { Router } from "express";
import { logger, audit } from "../logger";
import { appBaseUrl } from "../config";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { respondWorkbookReadError } from "../middleware/upload";
import { getEffectiveRoles, isSuperadmin } from "../services/access";
import { validateRoleChange, isStoredRole, type StoredRole } from "@shared/access";
import { sendInviteEmail } from "../email";
import multer from "multer";
import ExcelJS from "exceljs";
import {
  addAoaSheet,
  readWorkbookFromBuffer,
  sheetToObjects,
  workbookToBuffer,
} from "../utils/excel";
import { randomBytes, createHash } from "crypto";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Lifetime of the password-setup token carried by an invitation letter. Longer
 * than an ordinary reset token (an invited person may only read their mail days
 * later), and shared by both senders: bulk import and the single re-send.
 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const router = Router();

// GET /api/users - Список пользователей
router.get("/", requirePermission("users.read"), async (req, res) => {
  try {
    const users = await storage.getUsers();
    const usersWithGroups = await Promise.all(
      users.map(async (user) => {
        const groups = await storage.getUserGroups(user.id);
        const roles = await storage.getUserRoles(user.id);
        return { ...user, roles, groups };
      })
    );
    res.json(usersWithGroups);
  } catch (error) {
    logger.error("Get users error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get users" });
  }
});

// GET /api/users/bulk-template — download CSV template (must be before /:id)
router.get("/bulk-template", requirePermission("users.read"), async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Users", [
    ["email", "name", "role", "group"],
    ["user@example.com", "Иван Иванов", "learner", "Группа А"],
    ["manager@example.com", "Анна Петрова", "learner", ""],
  ]);
  const buf = await workbookToBuffer(wb);
  res.setHeader("Content-Disposition", "attachment; filename=users-template.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});

// GET /api/users/:id - Получить пользователя
router.get("/:id", requirePermission("users.read"), async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const groups = await storage.getUserGroups(user.id);
    res.json({ ...user, roles: await storage.getUserRoles(user.id), groups });
  } catch (error) {
    logger.error("Get user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get user" });
  }
});

// POST /api/users - Создать пользователя
router.post("/", requirePermission("users.create"), async (req, res) => {
  try {
    const { email, password, name, role, roles, groupIds, sendInvite, isExternal } = req.body;

    // PRD-28: an external participant has no password and no invitation letter;
    // the role set is fixed to `learner`, so the caller cannot widen it. The flag is
    // compared to `true` rather than tested for truthiness: a JSON body carrying the
    // STRING "false" is truthy, and reading it loosely would silently create a
    // passwordless account where an ordinary one was asked for.
    const external = isExternal === true;
    if (external) {
      if (!email) return res.status(400).json({ error: "Email required" });
    } else if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Requested role set: new `roles[]`, else legacy single `role` (default learner).
    const requestedRoles: string[] = external
      ? ["learner"]
      : Array.isArray(roles) && roles.length > 0
        ? roles.map((r: unknown) => String(r))
        : [String(role || "learner")];
    if (!requestedRoles.every(isStoredRole)) {
      return res.status(400).json({ error: "Invalid role in request" });
    }

    // Enforce the assignment ceiling (PRD-13): e.g. a manager may create only learners.
    const ceiling = validateRoleChange({
      actorRoles: req.effectiveRoles ?? [],
      currentRoles: [],
      requestedRoles,
      atCreation: true,
    });
    if (!ceiling.ok) {
      return res.status(403).json({ error: "Forbidden", reason: ceiling.reason });
    }

    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: "User with this email already exists" });
    }

    const user = await storage.createUser({
      email,
      passwordHash: external ? null : password,
      isExternal: external,
      name: name || null,
      status: "pending",
      mustChangePassword: true,
      createdBy: req.session.userId,
    });

    await storage.setUserRoles(user.id, requestedRoles as StoredRole[], req.session.userId ?? null);

    // Добавляем в группы если указаны
    if (groupIds && Array.isArray(groupIds)) {
      await storage.setUserGroups(user.id, groupIds);
    }

    const groups = await storage.getUserGroups(user.id);
    audit.userCreate(user.email, requestedRoles.join("+"));

    // The invitation letter, when the create form asked for one. The account is
    // already stored by now, so a mail failure must not fail the request: it is
    // reported as `inviteSent: false` and the operator can re-send from the row
    // menu (POST /:id/invite), which mints exactly the same kind of token.
    let inviteSent = false;
    if (sendInvite && !external) {
      try {
        const rawToken = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(rawToken).digest("hex");
        await storage.createPasswordResetToken(user.id, tokenHash, "invite", INVITE_TTL_MS);

        const inviter = req.session.userId ? await storage.getUser(req.session.userId) : undefined;
        inviteSent = await sendInviteEmail({
          to: user.email,
          userName: user.name || undefined,
          inviteLink: `${appBaseUrl()}/reset-password?token=${rawToken}`,
          inviterName: inviter?.name || undefined,
        });
        audit.userInvite(user.id);
      } catch (e) {
        logger.error(`Invite on create failed for user ${user.id}: ${(e as Error).message}`, "users");
      }
      logger.info(`Invite e-mail on create for user ${user.id} (delivered=${inviteSent})`, "users");
    }

    res.status(201).json({ ...user, roles: requestedRoles, groups, inviteSent });
  } catch (error) {
    logger.error("Create user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// PUT /api/users/:id - Обновить пользователя
router.put("/:id", requirePermission("users.manage"), async (req, res) => {
  try {
    const { email, name, groupIds } = req.body;
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

    const updated = await storage.updateUser(userId, { email, name });

    // Обновляем группы если указаны
    if (groupIds && Array.isArray(groupIds)) {
      await storage.setUserGroups(userId, groupIds);
    }

    const groups = await storage.getUserGroups(userId);
    res.json({ ...updated, roles: await storage.getUserRoles(userId), groups });
  } catch (error) {
    logger.error("Update user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// PUT /api/users/:id/roles - Назначить набор ролей (PRD-13, с потолком)
router.put("/:id/roles", requirePermission("users.role.assign"), async (req, res) => {
  try {
    const target = await storage.getUser(req.params.id);
    if (!target) return res.status(404).json({ error: "User not found" });

    const { roles } = req.body ?? {};
    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: "roles array required" });
    }
    const requestedRoles = roles.map((r: unknown) => String(r));

    const currentRoles = await storage.getUserRoles(target.id);
    const result = validateRoleChange({
      actorRoles: req.effectiveRoles ?? [],
      currentRoles,
      requestedRoles,
      targetIsSuperadmin: isSuperadmin(target),
    });
    if (!result.ok) {
      return res.status(403).json({ error: "Forbidden", reason: result.reason });
    }

    await storage.setUserRoles(target.id, requestedRoles as StoredRole[], req.session.userId ?? null);

    res.json({ id: target.id, roles: requestedRoles });
  } catch (error) {
    logger.error("Set user roles error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to set user roles" });
  }
});

// POST /api/users/:id/reset-password - Сбросить пароль пользователя
router.post("/:id/reset-password", requirePermission("users.manage"), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ error: "New password required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await storage.updateUserPassword(user.id, newPassword);
    await storage.updateUser(user.id, { mustChangePassword: true });
    audit.passwordReset(user.id);
    res.json({ success: true });
  } catch (error) {
    logger.error("Reset password error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// POST /api/users/:id/deactivate - Деактивировать пользователя
router.post("/:id/deactivate", requirePermission("users.manage"), async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (isSuperadmin(user)) {
      return res.status(400).json({ error: "Cannot deactivate a superadmin account" });
    }

    await storage.deactivateUser(user.id);
    audit.userDeactivate(user.id);
    res.json({ success: true });
  } catch (error) {
    logger.error("Deactivate user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to deactivate user" });
  }
});

// POST /api/users/:id/activate - Активировать пользователя
router.post("/:id/activate", requirePermission("users.manage"), async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await storage.activateUser(user.id);
    audit.userActivate(user.id);
    res.json({ success: true });
  } catch (error) {
    logger.error("Activate user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to activate user" });
  }
});

// POST /api/users/:id/invite - Отправить (повторно) письмо-приглашение
//
// The same letter bulk-import sends for a freshly created row, but reachable
// for an account that is already there and still `pending`: created one at a
// time, imported with the invite checkbox off, or whose letter was lost. It
// carries a password-setup link, so it only makes sense while the account has
// never been signed into — an `active` account has a password of its own and a
// blocked one must be unblocked first.
router.post("/:id/invite", requirePermission("users.manage"), async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // PRD-28: the invitation letter carries a password-setup link, and an external
    // participant must never get one — their only way in is the assignment link.
    if (user.isExternal) {
      return res.status(400).json({ error: "An external participant cannot be invited to set a password" });
    }

    if (user.status !== "pending") {
      return res.status(400).json({
        error: "Only a pending account can be invited",
        status: user.status,
      });
    }

    // Same anti-mail-bomb budget as POST /api/auth/forgot-password: both paths
    // mint rows in `password_reset_tokens`, so one shared counter covers both.
    const recentTokens = await storage.getRecentTokensCount(user.id, 1);
    if (recentTokens >= 3) {
      return res.status(429).json({ error: "Too many invites. Please try again later." });
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await storage.createPasswordResetToken(user.id, tokenHash, "invite", INVITE_TTL_MS);

    const inviter = req.session.userId ? await storage.getUser(req.session.userId) : undefined;
    const sent = await sendInviteEmail({
      to: user.email,
      userName: user.name || undefined,
      inviteLink: `${appBaseUrl()}/reset-password?token=${rawToken}`,
      inviterName: inviter?.name || undefined,
    });

    audit.userInvite(user.id);
    logger.info(`Invite e-mail re-sent for user ${user.id} (delivered=${sent})`, "users");
    res.json({ success: true, sent });
  } catch (error) {
    logger.error("Invite user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to send invite" });
  }
});

// POST /api/users/:id/promote — сделать внешнего участника штатным (PRD-28 FR-05)
router.post("/:id/promote", requirePermission("users.manage"), async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.isExternal) {
      return res.status(400).json({ error: "Account is not an external participant" });
    }

    await storage.promoteExternalUser(user.id);

    // The account now needs a password of its own: same letter the ordinary
    // invite path sends, same token kind, same lifetime.
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await storage.createPasswordResetToken(user.id, tokenHash, "promote", INVITE_TTL_MS);
    const sent = await sendInviteEmail({
      to: user.email,
      userName: user.name || undefined,
      inviteLink: `${appBaseUrl()}/reset-password?token=${rawToken}`,
    });

    audit.userInvite(user.id);
    res.json({ success: true, sent });
  } catch (error) {
    logger.error("Promote external user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to promote user" });
  }
});

// POST /api/users/:id/reset-attempts - Сбросить попытки пользователя
router.post("/:id/reset-attempts", requirePermission("users.manage"), async (req, res) => {
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

    audit.attemptsReset(userId, testId ?? null);
    res.json({ success: true });
  } catch (error) {
    logger.error("Reset attempts error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to reset attempts" });
  }
});

// GET /api/users/:id/attempts-summary - Сводка попыток пользователя
router.get("/:id/attempts-summary", requirePermission("users.read"), async (req, res) => {
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
router.get("/:id/groups", requirePermission("users.read"), async (req, res) => {
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
router.put("/:id/groups", requirePermission("users.manage"), async (req, res) => {
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

// POST /api/users/bulk-preview — parse CSV/XLSX, return preview rows with duplicate/group status
router.post("/bulk-preview", requirePermission("users.create"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File required" });

    const wb = await readWorkbookFromBuffer(req.file.buffer);
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: "File is empty" });
    const rows: any[] = sheetToObjects(ws, { defval: "" });

    if (rows.length === 0) return res.status(400).json({ error: "File is empty" });
    if (rows.length > 500) return res.status(400).json({ error: "Maximum 500 rows per upload" });

    const allGroups = await storage.getGroups();

    const preview = await Promise.all(rows.map(async (row, idx) => {
      const email = String(row["email"] || row["Email"] || row["EMAIL"] || "").trim();
      const name = String(row["name"] || row["Name"] || row["ФИО"] || row["имя"] || "").trim();
      const role = String(row["role"] || row["Role"] || "learner").trim().toLowerCase();
      const groupName = String(row["group"] || row["Group"] || row["группа"] || row["Группа"] || "").trim();

      if (!email || !email.includes("@")) {
        return { idx, email, name, role, groupName, groupId: null, groupFound: false, status: "error", error: "Некорректный email" };
      }

      const validRole = role === "author" ? "author" : "learner";
      const existing = await storage.getUserByEmail(email);

      // Resolve group
      let groupId: string | null = null;
      let groupFound = false;
      if (groupName) {
        const found = allGroups.find(g => g.name.toLowerCase() === groupName.toLowerCase());
        if (found) { groupId = found.id; groupFound = true; }
      }

      return {
        idx, email,
        name: name || null,
        role: validRole,
        groupName: groupName || null,
        groupId,
        groupFound,
        status: existing ? "duplicate" : "new",
        existingId: existing?.id || null,
      };
    }));

    res.json(preview);
  } catch (error) {
    logger.error("Bulk preview error: " + (error as Error).message);
    if (respondWorkbookReadError(res, error)) return;
    res.status(500).json({ error: "Failed to parse file" });
  }
});

// POST /api/users/bulk-import — create users, assign groups, send invite emails
router.post("/bulk-import", requirePermission("users.create"), async (req, res) => {
  try {
    // Parse body — fallback to rawBody in case express.json() didn't run
    let parsed = req.body;
    const rawBodyBuf = (req as any).rawBody as Buffer | undefined;
    if ((!parsed || Object.keys(parsed).length === 0) && rawBodyBuf && rawBodyBuf.length > 0) {
      try {
        parsed = JSON.parse(rawBodyBuf.toString("utf8"));
        logger.warn("bulk-import: req.body was empty, fell back to rawBody parse");
      } catch (e) {
        logger.error("bulk-import: rawBody parse failed: " + (e as Error).message);
      }
    }

    const { rows, sendInvites } = (parsed ?? {}) as {
      sendInvites: boolean;
      rows: {
        email: string; name?: string; role?: string;
        groupId?: string | null; groupName?: string | null;
        duplicateAction?: "skip" | "update"; status: string; existingId?: string;
      }[]
    };

    logger.info(`bulk-import body keys: [${Object.keys(parsed || {}).join(",")}] rows type: ${typeof rows} rows length: ${Array.isArray(rows) ? rows.length : "N/A"} ct: ${req.headers["content-type"]}`);
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No rows provided" });
    }

    const baseUrl = appBaseUrl();

    // Cache auto-created groups within this import to avoid duplicates
    const groupNameToId = new Map<string, string>();

    const resolveGroupId = async (groupId: string | null | undefined, groupName: string | null | undefined): Promise<string | null> => {
      if (groupId) return groupId;
      if (!groupName) return null;
      const key = groupName.toLowerCase();
      if (groupNameToId.has(key)) return groupNameToId.get(key)!;
      // Check DB again (might have been created by earlier row)
      const allGroups = await storage.getGroups();
      const existing = allGroups.find(g => g.name.toLowerCase() === key);
      if (existing) { groupNameToId.set(key, existing.id); return existing.id; }
      // Auto-create group
      const newGroup = await storage.createGroup({ name: groupName, createdBy: req.session.userId });
      groupNameToId.set(key, newGroup.id);
      logger.info(`bulk-import: auto-created group "${groupName}" (${newGroup.id})`);
      return newGroup.id;
    };

    let created = 0, updated = 0, skipped = 0, invitesSent = 0, errors: string[] = [];

    for (const row of rows) {
      try {
        if (row.status === "error") { skipped++; continue; }

        if (row.status === "duplicate") {
          if (row.duplicateAction === "skip" || !row.duplicateAction) { skipped++; continue; }
          if (row.duplicateAction === "update" && row.existingId) {
            await storage.updateUser(row.existingId, { name: row.name || undefined });
            const gid = await resolveGroupId(row.groupId, row.groupName);
            if (gid) await storage.addUserToGroup(row.existingId, gid).catch((e: Error) => {
              logger.warn(`bulk-import: addUserToGroup failed for ${row.email} → group ${gid}: ${e.message}`);
            });
            updated++;
          }
          continue;
        }

        // Determine and authorize the row's role set (PRD-13 ceiling).
        const rowRoles = [isStoredRole(String(row.role || "")) ? String(row.role) : "learner"];
        const rowCeiling = validateRoleChange({
          actorRoles: req.effectiveRoles ?? [],
          currentRoles: [],
          requestedRoles: rowRoles,
          atCreation: true,
        });
        if (!rowCeiling.ok) {
          errors.push(`${row.email}: ${rowCeiling.reason ?? "role not allowed"}`);
          continue;
        }

        // Create user with a random temp password
        const tempPassword = randomBytes(16).toString("hex");
        const user = await storage.createUser({
          email: row.email,
          passwordHash: tempPassword,
          name: row.name || null,
          status: "pending",
          mustChangePassword: true,
          gdprConsent: false,
          createdBy: req.session.userId,
        });
        await storage.setUserRoles(user.id, rowRoles as StoredRole[], req.session.userId ?? null);

        // Assign group (auto-create if not found)
        const gid = await resolveGroupId(row.groupId, row.groupName);
        if (gid) await storage.addUserToGroup(user.id, gid).catch((e: Error) => {
          logger.warn(`bulk-import: addUserToGroup failed for ${row.email} → group ${gid}: ${e.message}`);
        });

        // Send invite (password-reset link)
        if (sendInvites) {
          const rawToken = randomBytes(32).toString("hex");
          const tokenHash = createHash("sha256").update(rawToken).digest("hex");
          await storage.createPasswordResetToken(user.id, tokenHash, "bulk-import", INVITE_TTL_MS);
          const inviteLink = `${baseUrl}/reset-password?token=${rawToken}`;
          const sent = await sendInviteEmail({ to: user.email, userName: user.name || undefined, inviteLink });
          if (sent) invitesSent++;
        }

        created++;
      } catch (e) {
        errors.push(`${row.email}: ${(e as Error).message}`);
      }
    }

    audit.bulkImport(created, updated, skipped);
    res.json({ created, updated, skipped, invitesSent, errors });
  } catch (error) {
    logger.error("Bulk import error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to import users" });
  }
});

export default router;
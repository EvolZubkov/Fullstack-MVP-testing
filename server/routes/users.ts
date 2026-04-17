import { Router } from "express";
import { logger, audit } from "../logger";
import { storage } from "../storage";
import { requireAuthor } from "../middleware/auth";
import { sendInviteEmail } from "../email";
import multer from "multer";
import * as XLSX from "xlsx";
import { randomBytes, createHash } from "crypto";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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

// GET /api/users/bulk-template — download CSV template (must be before /:id)
router.get("/bulk-template", requireAuthor, (_req, res) => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["email", "name", "role", "group"],
    ["user@example.com", "Иван Иванов", "learner", "Группа А"],
    ["manager@example.com", "Анна Петрова", "learner", ""],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Users");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=users-template.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
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
    audit.userCreate(user.email, user.role);
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
    audit.userDeactivate(user.id);
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
    audit.userActivate(user.id);
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

    audit.attemptsReset(userId, testId ?? null);
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

// POST /api/users/bulk-preview — parse CSV/XLSX, return preview rows with duplicate/group status
router.post("/bulk-preview", requireAuthor, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File required" });

    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

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
    res.status(500).json({ error: "Failed to parse file" });
  }
});

// POST /api/users/bulk-import — create users, assign groups, send invite emails
router.post("/bulk-import", requireAuthor, async (req, res) => {
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

    const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5001}`;

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
            await storage.updateUser(row.existingId, { name: row.name || undefined, role: (row.role as any) || "learner" });
            const gid = await resolveGroupId(row.groupId, row.groupName);
            if (gid) await storage.addUserToGroup(row.existingId, gid).catch((e: Error) => {
              logger.warn(`bulk-import: addUserToGroup failed for ${row.email} → group ${gid}: ${e.message}`);
            });
            updated++;
          }
          continue;
        }

        // Create user with a random temp password
        const tempPassword = randomBytes(16).toString("hex");
        const user = await storage.createUser({
          email: row.email,
          passwordHash: tempPassword,
          name: row.name || null,
          role: (row.role as any) || "learner",
          status: "pending",
          mustChangePassword: true,
          gdprConsent: false,
          createdBy: req.session.userId,
        });

        // Assign group (auto-create if not found)
        const gid = await resolveGroupId(row.groupId, row.groupName);
        if (gid) await storage.addUserToGroup(user.id, gid).catch((e: Error) => {
          logger.warn(`bulk-import: addUserToGroup failed for ${row.email} → group ${gid}: ${e.message}`);
        });

        // Send invite (password-reset link)
        if (sendInvites) {
          const rawToken = randomBytes(32).toString("hex");
          const tokenHash = createHash("sha256").update(rawToken).digest("hex");
          await storage.createPasswordResetToken(user.id, tokenHash, "bulk-import", 7 * 24 * 60 * 60 * 1000); // 7 дней для invite
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
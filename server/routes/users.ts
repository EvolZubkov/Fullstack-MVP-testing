import { Router } from "express";
import { logger, audit } from "../logger";
import { config, appBaseUrl } from "../config";
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
import { ORG_FIELDS, normalizeOrgValue } from "@shared/org-fields";
import { readOrgColumns, readLmsLearnerIdColumn } from "../utils/org-columns";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Lifetime of the password-setup token carried by an invitation letter. Longer
 * than an ordinary reset token (an invited person may only read their mail days
 * later), and shared by both senders: bulk import and the single re-send.
 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Thrown by {@link issuePasswordSetupInvite} when the recipient has already had
 * `limits.passwordEmailsPerHour` letters within the hour. A dedicated type, not a
 * plain `Error`, so the caller can turn it into `429` instead of the `500` its
 * outer handler would give: being over budget is an answer, not a fault.
 */
class PasswordEmailBudgetExceeded extends Error {
  constructor() {
    super("Password-setup letter budget exceeded");
    this.name = "PasswordEmailBudgetExceeded";
  }
}

/**
 * Mint a password-setup token and send the invitation letter carrying it — the
 * one place in this file where that pair happens.
 *
 * Four senders share it: creating an account with the invite box ticked, the
 * re-send from the row menu, the conversion of an external participant into an
 * ordinary account, and bulk import. They had drifted apart as four copies (one
 * lost the inviter's name, another the hourly budget), which is why every
 * difference that remains is now an argument at the call site rather than an
 * omission in a copy.
 *
 * @param user Recipient; only the identity and the greeting are read.
 * @param opts.reason Stored on the token row, telling the four senders apart.
 * @param opts.inviterName Name shown as the sender, when the path has an operator.
 * @param opts.rateLimit Whether the shared hourly budget applies (it does not on
 *   the conversion path: the letter is a consequence of an operator's one-off
 *   action on one account, not something the account holder can trigger).
 * @returns Whether the transport accepted the letter.
 * @throws PasswordEmailBudgetExceeded When `rateLimit` is on and the budget is spent.
 */
async function issuePasswordSetupInvite(
  user: { id: string; email: string; name?: string | null },
  opts: { reason: string; inviterName?: string; rateLimit: boolean },
): Promise<boolean> {
  if (opts.rateLimit) {
    // Same anti-mail-bomb budget as POST /api/auth/forgot-password: both paths
    // mint rows in `password_reset_tokens`, so one shared counter covers both.
    const recentTokens = await storage.getRecentTokensCount(user.id, 1);
    if (recentTokens >= config.limits.passwordEmailsPerHour) {
      throw new PasswordEmailBudgetExceeded();
    }
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await storage.createPasswordResetToken(user.id, tokenHash, opts.reason, INVITE_TTL_MS);

  return sendInviteEmail({
    to: user.email,
    userName: user.name || undefined,
    inviteLink: `${appBaseUrl()}/reset-password?token=${rawToken}`,
    inviterName: opts.inviterName,
  });
}

/** Resolve the acting operator's name for the letter's "invited by" line. */
async function inviterNameOf(userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  const inviter = await storage.getUser(userId);
  return inviter?.name || undefined;
}

/**
 * The account as the users API shows it: the stored row without its secrets.
 *
 * Every answer of this router used to spread the whole `users` row, so the
 * password hash and the email hash reached any holder of `users.read`. One
 * function for all of them, because the leak was four separate spreads and a
 * fifth one added later would have leaked again.
 *
 * @param user Stored account row (or anything shaped like it).
 * @returns The same fields minus `passwordHash` and `emailHash`.
 */
export function toUserResponse<T extends { passwordHash?: unknown; emailHash?: unknown }>(
  user: T,
): Omit<T, "passwordHash" | "emailHash"> {
  const { passwordHash: _passwordHash, emailHash: _emailHash, ...visible } = user;
  return visible;
}

const router = Router();

// GET /api/users - Список пользователей
router.get("/", requirePermission("users.read"), async (req, res) => {
  try {
    const users = await storage.getUsers();
    const usersWithGroups = await Promise.all(
      users.map(async (user) => {
        const groups = await storage.getUserGroups(user.id);
        const roles = await storage.getUserRoles(user.id);
        return { ...toUserResponse(user), roles, groups };
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
  // PRD-54: колонка «Внешний ключ» — в шаблоне, иначе о ней не узнает никто, кроме читавших спеку.
  // Она необязательна: пустая клетка не трогает уже проставленный ключ.
  // Оргполя и идентификатор в LMS (план оргструктуры, BR-54-29): без них заведённые списком
  // люди остаются без подразделения, и срезам аналитики нечем их делить.
  addAoaSheet(wb, "Users", [
    ["email", "name", "role", "group", "external_key", "organization", "unit", "position", "lms_learner_id"],
    ["user@example.com", "Иван Иванов", "learner", "Группа А", "TAB-1024",
      "АО «Пример»", "Отдел продаж", "Менеджер по продажам", "ivanov_i"],
    ["manager@example.com", "Анна Петрова", "learner", "", "", "", "", "", ""],
  ]);
  const buf = await workbookToBuffer(wb);
  res.setHeader("Content-Disposition", "attachment; filename=users-template.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});

// GET /api/users/org-values — org-structure values in use (must be before /:id).
// Feeds the profile form (choose or create, plan Р-3) and the list filters; the
// counts tell a spelling that came from an LMS export from one typed by hand.
router.get("/org-values", requirePermission("users.read"), async (_req, res) => {
  try {
    res.json(await storage.getOrgValues());
  } catch (error) {
    logger.error("Get org values error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get org values" });
  }
});

// GET /api/users/:id - Получить пользователя
router.get("/:id", requirePermission("users.read"), async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const groups = await storage.getUserGroups(user.id);
    res.json({ ...toUserResponse(user), roles: await storage.getUserRoles(user.id), groups });
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
      // The three things an external participant cannot have used to be dropped
      // in silence: the caller asked for a password, a wider role set or an
      // invitation letter and got an account with none of them, with nothing in
      // the answer to say so. Refuse instead — a request that means two opposite
      // things is a mistake on the caller's side, not something to guess through.
      // Only fields that actually carry a request count: `sendInvite: false` and
      // an empty password are the absence of one, not a conflicting demand.
      const conflicting = [
        password ? "password" : null,
        Array.isArray(roles) && roles.length > 0 ? "roles" : null,
        // `role: "learner"` asks for exactly what an external participant gets,
        // so it contradicts nothing and must not be refused; only a WIDER role
        // is a conflicting demand.
        role && role !== "learner" ? "role" : null,
        sendInvite ? "sendInvite" : null,
      ].filter(Boolean);
      if (conflicting.length > 0) {
        return res.status(400).json({
          error:
            "An external participant has no password, no invitation letter and always the learner role; " +
            `remove: ${conflicting.join(", ")}`,
        });
      }
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

    // Org fields and linking keys (org-structure plan, task 1): allowed for an
    // external participant too — a contractor also works in some unit.
    const profile = readProfileFields(req.body);
    const conflict = await linkingKeyConflict(profile, null);
    if (conflict) return res.status(409).json(conflict);

    const user = await storage.createUser({
      ...profile,
      email,
      passwordHash: external ? null : password,
      isExternal: external,
      name: name || null,
      status: "pending",
      // The flag means "the password this account has must be replaced on the
      // next sign-in". An external participant has no password at all (PRD-28),
      // so there is nothing for the flag to point at; raising it would state a
      // pending change to something that does not exist. `promoteExternalUser`
      // raises it at the moment the account gains a password of its own.
      mustChangePassword: !external,
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
        inviteSent = await issuePasswordSetupInvite(user, {
          reason: "invite",
          inviterName: await inviterNameOf(req.session.userId),
          // No budget check here: the account was created one line ago, so it
          // cannot have spent one — the ceiling guards the re-send, not this.
          rateLimit: false,
        });
        audit.userInvite(user.id);
      } catch (e) {
        logger.error(`Invite on create failed for user ${user.id}: ${(e as Error).message}`, "users");
      }
      logger.info(`Invite e-mail on create for user ${user.id} (delivered=${inviteSent})`, "users");
    }

    res.status(201).json({ ...toUserResponse(user), roles: requestedRoles, groups, inviteSent });
  } catch (error) {
    logger.error("Create user error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// PUT /api/users/:id - Обновить пользователя
/**
 * Привести внешний ключ к хранимому виду (PRD-54 раздел 5.4).
 *
 * Регистр СОХРАНЯЕТСЯ: ключ показывают человеку в том виде, в каком он его ввёл. Нечувствительность
 * при сверке обеспечивают уникальный индекс по `lower(external_key)` и `getUserByExternalKey`.
 *
 * Пустая строка приводится к `null`, а не хранится пустой: иначе она совпала бы с любой другой
 * пустой и связала бы всех безымянных участников с одним пользователем.
 *
 * @param raw значение из формы или книги
 * @returns ключ или `null`, если поле пустое
 */
export function normalizeExternalKey(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Внешний ключ из строки книги массовой загрузки (PRD-54 раздел 11.4).
 *
 * Псевдонимы те же по духу, что у `email`/`ФИО`/`роль`/`группа` рядом: книгу заполняет человек, а
 * не выгружает система, и требовать одно точное написание заголовка — верный способ получить
 * молчаливо пропущенную колонку.
 *
 * @param row строка книги
 * @returns ключ или `null`, если колонки нет или она пуста
 */
export function readExternalKeyColumn(row: Record<string, unknown>): string | null {
  return normalizeExternalKey(
    row["external_key"] ?? row["Внешний ключ"] ?? row["внешний ключ"] ?? row["ключ"] ?? "",
  );
}

/** Profile fields a form or a list may set, besides name and email. */
interface ProfileFields {
  organization?: string | null;
  unit?: string | null;
  position?: string | null;
  lmsLearnerId?: string | null;
  externalKey?: string | null;
}

/**
 * Read the optional profile fields of a request body (org-structure plan, task 1).
 *
 * A field ABSENT from the body is left out of the result — «do not touch»; a
 * field present but empty becomes `null` — «clear». Without that difference
 * every save of a form that does not show a field would wipe it. The org fields
 * are normalised by the shared engine, the two linking keys by the key rule.
 *
 * @param body Request body.
 * @returns Only the fields the body carries, normalised.
 */
function readProfileFields(body: Record<string, unknown>): ProfileFields {
  const fields: ProfileFields = {};
  for (const field of ORG_FIELDS) {
    if (field in body) fields[field] = normalizeOrgValue(body[field]);
  }
  if ("lmsLearnerId" in body) fields.lmsLearnerId = normalizeExternalKey(body.lmsLearnerId);
  if ("externalKey" in body) fields.externalKey = normalizeExternalKey(body.externalKey);
  return fields;
}

/**
 * The first linking key of `fields` that another account already holds.
 *
 * Both keys are unique per person (PRD-54 BR-54-26, BR-54-31; plan Р-6): a key
 * with two owners makes linking a lottery. The check runs BEFORE the write to
 * give an answer that names the owner; for the external key the unique index
 * stays the real barrier against a race of two saves.
 *
 * @param fields Normalised fields about to be written.
 * @param selfId The account being saved; it may keep its own keys.
 * @returns The refusal to send, or `null` when both keys are free.
 */
async function linkingKeyConflict(
  fields: ProfileFields,
  selfId: string | null,
): Promise<{ field: "lmsLearnerId" | "externalKey"; error: string } | null> {
  if (fields.lmsLearnerId) {
    const owner = await storage.getUserByLmsLearnerId(fields.lmsLearnerId);
    if (owner && owner.id !== selfId) {
      return {
        field: "lmsLearnerId",
        error: `Идентификатор в LMS «${fields.lmsLearnerId}» уже у пользователя ${owner.name ?? owner.id}`,
      };
    }
  }
  if (fields.externalKey) {
    const owner = await storage.getUserByExternalKey(fields.externalKey);
    if (owner && owner.id !== selfId) {
      return {
        field: "externalKey",
        error: `Ключ «${fields.externalKey}» уже у пользователя ${owner.name ?? owner.id}`,
      };
    }
  }
  return null;
}

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

    // PRD-54 и план оргструктуры: ключи связывания и оргполя. Все необязательны, поэтому
    // «не передали» (не трогаем) отличается от «передали пустым» (снимаем) — иначе любое
    // сохранение карточки стирало бы то, чего форма не показывает.
    const profile = readProfileFields(req.body);
    const conflict = await linkingKeyConflict(profile, userId);
    if (conflict) return res.status(409).json(conflict);

    const updated = await storage.updateUser(userId, { email, name, ...profile });

    // Обновляем группы если указаны
    if (groupIds && Array.isArray(groupIds)) {
      await storage.setUserGroups(userId, groupIds);
    }

    const groups = await storage.getUserGroups(userId);
    res.json({ ...(updated ? toUserResponse(updated) : {}), roles: await storage.getUserRoles(userId), groups });
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

    // The re-send is the path a person can make repeat, so it is the one the
    // hourly ceiling (`limits.passwordEmailsPerHour`) guards.
    const sent = await issuePasswordSetupInvite(user, {
      reason: "invite",
      inviterName: await inviterNameOf(req.session.userId),
      rateLimit: true,
    });

    audit.userInvite(user.id);
    logger.info(`Invite e-mail re-sent for user ${user.id} (delivered=${sent})`, "users");
    res.json({ success: true, sent });
  } catch (error) {
    if (error instanceof PasswordEmailBudgetExceeded) {
      return res.status(429).json({ error: "Too many invites. Please try again later." });
    }
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
    audit.userPromote(user.id);

    // The kind of the account has changed by now, and that change is one-way:
    // a failure further down must not be reported as "nothing happened", or the
    // operator retries and gets "Account is not an external participant" on an
    // account they were just told had not been converted. Same rule POST /
    // follows for its letter — the letter is the recoverable part (re-send it
    // from the row menu), the flag is not.
    let sent = false;
    try {
      sent = await issuePasswordSetupInvite(user, {
        reason: "promote",
        inviterName: await inviterNameOf(req.session.userId),
        // Deliberately unlimited: an operator converting one account is not the
        // repeatable path the hourly budget exists to cap, and refusing here
        // would leave the account converted with no way in at all.
        rateLimit: false,
      });
      audit.userInvite(user.id);
    } catch (e) {
      logger.error(
        `Password-setup invite after promote failed for user ${user.id}: ${(e as Error).message}`,
        "users",
      );
    }
    logger.info(`Invite e-mail after promote for user ${user.id} (delivered=${sent})`, "users");

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
    const maxRows = config.limits.participantsImportMaxRows;
    if (rows.length > maxRows) {
      return res.status(400).json({ error: `Maximum ${maxRows} rows per upload` });
    }

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

      // PRD-54: ключ, занятый ДРУГИМ пользователем, — ошибка строки, а не повод перезаписать:
      // на уникальности ключа держится связывание, и тихая перезапись порвала бы готовые связи.
      // То же правило — у идентификатора в LMS (план оргструктуры, Р-6).
      const externalKey = readExternalKeyColumn(row);
      const lmsLearnerId = readLmsLearnerIdColumn(row);
      const org = readOrgColumns(row);
      const conflict = await linkingKeyConflict({ externalKey, lmsLearnerId }, existing?.id ?? null);
      if (conflict) {
        return {
          idx, email, name, role: validRole, groupName, groupId: null, groupFound: false,
          externalKey, lmsLearnerId, ...org, status: "error", error: conflict.error,
        };
      }

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
        externalKey,
        lmsLearnerId,
        ...org,
        // PRD-54: строка существующего пользователя с НЕПУСТЫМ ключом (внешним или идентификатором
        // в LMS) не пропускается как дубль, а проставляет ключ. Иначе проставить ключи уже
        // заведённой базе было бы нечем.
        status: existing ? (externalKey || lmsLearnerId ? "keyUpdate" : "duplicate") : "new",
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
        externalKey?: string | null; lmsLearnerId?: string | null;
        organization?: string | null; unit?: string | null; position?: string | null;
      }[]
    };

    /**
     * What a list row may write onto an EXISTING account: only non-empty cells.
     *
     * A list is not a form — an empty cell means «not given», and letting it wipe
     * a unit someone filled in by hand would make every re-upload destructive.
     * Clearing a field is the profile form's job.
     */
    const filledFieldsOf = (row: (typeof rows)[number]) => {
      const fields: ProfileFields = {};
      for (const field of ORG_FIELDS) {
        const value = normalizeOrgValue(row[field]);
        if (value) fields[field] = value;
      }
      const lmsLearnerId = normalizeExternalKey(row.lmsLearnerId);
      if (lmsLearnerId) fields.lmsLearnerId = lmsLearnerId;
      return fields;
    };

    logger.info(`bulk-import body keys: [${Object.keys(parsed || {}).join(",")}] rows type: ${typeof rows} rows length: ${Array.isArray(rows) ? rows.length : "N/A"} ct: ${req.headers["content-type"]}`);
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No rows provided" });
    }

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

        // PRD-54: существующий пользователь с непустым ключом — не дубль, а проставление ключа.
        if (row.status === "keyUpdate" && row.existingId) {
          const externalKey = normalizeExternalKey(row.externalKey);
          await storage.updateUser(row.existingId, {
            // A key update may come from the LMS id alone; an empty external key
            // cell then leaves the stored key as it is.
            ...(externalKey ? { externalKey } : {}),
            ...filledFieldsOf(row),
            ...(row.name ? { name: row.name } : {}),
          });
          const gid = await resolveGroupId(row.groupId, row.groupName);
          if (gid) await storage.addUserToGroup(row.existingId, gid).catch((e: Error) => {
            logger.warn(`bulk-import: addUserToGroup failed for ${row.email} → group ${gid}: ${e.message}`);
          });
          updated++;
          continue;
        }

        if (row.status === "duplicate") {
          if (row.duplicateAction === "skip" || !row.duplicateAction) { skipped++; continue; }
          if (row.duplicateAction === "update" && row.existingId) {
            await storage.updateUser(row.existingId, { name: row.name || undefined, ...filledFieldsOf(row) });
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
          // PRD-54: the preview shows the key of a new row, so the row must be
          // created with it — without this the key was lost for every new person.
          externalKey: normalizeExternalKey(row.externalKey),
          ...filledFieldsOf(row),
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
          // No inviter name and no budget check, as before: the letters go to
          // freshly created accounts, one each, so none of them can be over the
          // hourly ceiling.
          const sent = await issuePasswordSetupInvite(user, {
            reason: "bulk-import",
            rateLimit: false,
          });
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
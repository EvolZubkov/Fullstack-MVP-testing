/**
 * @module server/storage/users-repository
 * @description Data access for the user domain: lookup, creation, password
 * validation, profile/state updates and password-reset tokens
 * (`password_reset_tokens`, which belong to the user aggregate). Emails are
 * encrypted at rest and looked up by a deterministic hash (`emailHash`); the
 * plaintext email is decrypted only on read. Password hashing goes through the
 * `server/utils/crypto` seam (`hashPassword`/`verifyPassword`), keeping this
 * repository crypto-agnostic. `validatePassword` performs a dummy verification
 * on every path that has no password to check — the address is unknown, the
 * account is an external participant (PRD-28), or the row simply carries no hash
 * — so response timing does not tell those apart from a wrong password
 * (anti-enumeration); reset
 * tokens store only a hash and are consumed by marking `usedAt`, never deleted,
 * so `getRecentTokensCount` can rate-limit requests. Exposed to the rest of the
 * app through the `IStorage` facade, never imported directly by routes.
 */
import { randomUUID } from "crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  users, passwordResetTokens, scormAttempts,
  type User, type InsertUser, type PasswordResetToken,
} from "@shared/schema";
import { ORG_FIELDS, foldOrgValues, type OrgField, type OrgValueCount } from "@shared/org-fields";
import {
  encryptEmail,
  decryptEmail,
  hashEmail,
  hashPassword,
  verifyPassword,
  dummyVerifyPassword,
  isLegacyBcryptHash,
} from "../utils/crypto";
import { logger } from "../logger";
import { incrementCounter } from "../metrics";
import { pickDefined } from "./shared";

/** Repository for the `users` table (PRD-13 identities, encrypted emails). */
export class UsersRepository {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (user) {
      return { ...user, email: await decryptEmail(user.email) };
    }
    return undefined;
  }

  /**
   * Найти пользователя по внешнему ключу (PRD-54 раздел 8.5).
   *
   * Регистр и краевые пробелы не учитываются: ключом чаще всего оказывается hex-хеш или табельный
   * код, где разница в регистре смысла не несёт, а сопоставление ломает молча. Сравнение идёт по
   * тому же выражению, на котором построен уникальный индекс `users_external_key_idx`, поэтому
   * поиск по нему индексный, а не последовательный.
   *
   * Почта НЕ расшифровывается: связывание читает только идентификатор, и лишняя расшифровка на
   * каждую строку выгрузки — это сотни ненужных операций на большом файле.
   *
   * @param key значение ключа из файла
   * @returns пользователь или `undefined`; пустой ключ никогда ни с кем не совпадает
   */
  /**
   * Пользователь по идентификатору обучающегося в LMS (PRD-54 BR-54-31).
   *
   * Им связывается ТЕЛЕМЕТРИЯ: `cmi.learner_id` — единственное, чем рантайм LMS опознаёт
   * человека, и он устойчив — не меняется ни при переводе в другой отдел, ни при смене секрета
   * инстанса. Сравнение без учёта регистра по той же причине, что у внешнего ключа: значение
   * приходит из чужой системы, и разница в регистре смысла не несёт, а сопоставление ломает.
   */
  async getUserByLmsLearnerId(learnerId: string): Promise<User | undefined> {
    const normalized = String(learnerId ?? "").trim().toLowerCase();
    if (normalized === "") return undefined;
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.lmsLearnerId}) = ${normalized}`)
      .limit(1);
    return user || undefined;
  }

  async getUserByExternalKey(key: string): Promise<User | undefined> {
    const normalized = String(key ?? "").trim().toLowerCase();
    if (normalized === "") return undefined;
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.externalKey}) = ${normalized}`)
      .limit(1);
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const emailHashValue = hashEmail(email);
    const [user] = await db.select().from(users).where(eq(users.emailHash, emailHashValue));
    if (user) {
      return { ...user, email: await decryptEmail(user.email) };
    }
    return undefined;
  }

  async createUser(insertUser: InsertUser & { createdBy?: string }): Promise<User> {
    const id = randomUUID();
    // PRD-28: `passwordHash` is optional — an external participant is stored with no
    // password at all (NULL), and the assignment link is the only way in.
    const hashedPassword =
      insertUser.passwordHash != null ? await hashPassword(insertUser.passwordHash) : null;
    const emailEncrypted = await encryptEmail(insertUser.email);
    const emailHashValue = hashEmail(insertUser.email);

    const [user] = await db.insert(users).values({
      id,
      email: emailEncrypted,
      emailHash: emailHashValue,
      passwordHash: hashedPassword,
      name: insertUser.name || null,
      isExternal: insertUser.isExternal ?? false,
      status: insertUser.status || "pending",
      mustChangePassword: insertUser.mustChangePassword ?? true,
      gdprConsent: false,
      // PRD-54: внешний ключ можно проставить сразу при заведении — колонкой массовой загрузки.
      externalKey: insertUser.externalKey ?? null,
      // PRD-54 BR-54-28/31 and the org-structure plan: the LMS learner id links
      // telemetry to the person, the three org fields feed the analytics axes.
      lmsLearnerId: insertUser.lmsLearnerId ?? null,
      organization: insertUser.organization ?? null,
      unit: insertUser.unit ?? null,
      position: insertUser.position ?? null,
      createdAt: new Date(),
      createdBy: insertUser.createdBy || null,
    }).returning();

    return { ...user, email: await decryptEmail(user.email) };
  }

  async validatePassword(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    // No password to check: not found, an external participant (PRD-28) or a legacy
    // row without a hash. The three branches are not byte-identical in work done
    // (the not-found one never reaches `decryptEmail`), but they all pay the same
    // scrypt-profile dummy verification, whose cost dominates that difference — so
    // the answer time carries no usable signal about which branch was taken. The
    // flag is checked on its own, not merely the missing hash: an external account
    // that somehow got a password set (e.g. through `updateUserPassword`) must stay
    // locked out.
    if (!user || user.isExternal || !user.passwordHash) {
      await dummyVerifyPassword(password);
      return null;
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return null;

    // PRD-9 Этап 2: transparently migrate a legacy bcrypt hash to scrypt on the
    // first successful login. The plaintext is only available here, so this is the
    // one point where re-hashing is possible without a password reset. Only the
    // hash is touched — `mustChangePassword` and other state stay as-is (a rehash
    // is not a password change). Remove this branch in Этап 3 once the metric is 0.
    if (isLegacyBcryptHash(user.passwordHash)) {
      const rehashed = await hashPassword(password);
      await db.update(users).set({ passwordHash: rehashed }).where(eq(users.id, user.id));
      incrementCounter("auth.legacy_bcrypt_rehash");
      logger.info(`Rehashed legacy bcrypt password to scrypt for user ${user.id}`, "auth");
      return { ...user, passwordHash: rehashed };
    }
    return user;
  }

  async updateUserLastLogin(id: string): Promise<void> {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  }

  async getUsers(): Promise<User[]> {
    const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
    return Promise.all(allUsers.map(async user => ({ ...user, email: await decryptEmail(user.email) })));
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    // Whitelist: never accept passwordHash (use updateUserPassword), emailHash
    // (derived from email), id/createdAt/createdBy/lastLoginAt through a broad
    // Partial<User>. `email` is handled specially (encrypt + derive hash).
    const set: Partial<User> = pickDefined(data, [
      "name", "status", "mustChangePassword", "gdprConsent", "gdprConsentAt",
      // PRD-54: внешний ключ для связывания импортированных прохождений. `null` проходит сквозь
      // `pickDefined` намеренно — это «снять ключ», в отличие от `undefined` = «не трогать».
      "externalKey",
      // Same null-means-clear rule for the LMS learner id and the org fields.
      "lmsLearnerId", "organization", "unit", "position",
    ] as const);
    if (data.email) {
      set.email = await encryptEmail(data.email);
      set.emailHash = hashEmail(data.email);
    }
    if (Object.keys(set).length === 0) return this.getUser(id);

    const [updated] = await db.update(users)
      .set(set)
      .where(eq(users.id, id))
      .returning();

    if (updated) {
      return { ...updated, email: await decryptEmail(updated.email) };
    }
    return undefined;
  }

  /**
   * The org-structure values in use, one list per field (org-structure plan, task 1).
   *
   * Two sources: profiles and passages. Passages count because an LMS export
   * brings its own spelling of a unit, and the operator filling in a profile must
   * see it to repeat it — otherwise the profile says «Отдел продаж», the export
   * «ОТДЕЛ ПРОДАЖ», and nobody notices they are one department until the slices
   * split. Only imported passages carry unit and position; telemetry reports the
   * organisation alone (`cmi.student_org`), and that is counted too.
   *
   * SQL counts exact spellings; folding them into one value per unit is the job
   * of {@link foldOrgValues}, the same engine the analytics compares with.
   *
   * @returns Values per field with profile and passage counts, sorted by label.
   */
  async getOrgValues(): Promise<Record<OrgField, OrgValueCount[]>> {
    const fromUsers = {
      organization: users.organization,
      unit: users.unit,
      position: users.position,
    } as const;
    const fromAttempts = {
      organization: scormAttempts.lmsUserOrg,
      unit: scormAttempts.lmsUserUnit,
      position: scormAttempts.lmsUserPosition,
    } as const;

    const result = {} as Record<OrgField, OrgValueCount[]>;
    for (const field of ORG_FIELDS) {
      const userColumn = fromUsers[field];
      const attemptColumn = fromAttempts[field];
      const [userRows, attemptRows] = await Promise.all([
        db.select({ value: userColumn, count: sql<number>`count(*)` })
          .from(users).where(sql`${userColumn} is not null`).groupBy(userColumn),
        db.select({ value: attemptColumn, count: sql<number>`count(*)` })
          .from(scormAttempts).where(sql`${attemptColumn} is not null`).groupBy(attemptColumn),
      ]);
      result[field] = foldOrgValues([
        ...userRows.map(r => ({ value: r.value ?? "", users: Number(r.count), attempts: 0 })),
        ...attemptRows.map(r => ({ value: r.value ?? "", users: 0, attempts: Number(r.count) })),
      ]);
    }
    return result;
  }

  async updateUserPassword(id: string, newPasswordHash: string): Promise<void> {
    const hashed = await hashPassword(newPasswordHash);
    await db.update(users).set({
      passwordHash: hashed,
      mustChangePassword: false,
    }).where(eq(users.id, id));
  }

  async deactivateUser(id: string): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ status: "inactive" })
      .where(eq(users.id, id))
      .returning();
    return updated || undefined;
  }

  async activateUser(id: string): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ status: "active" })
      .where(eq(users.id, id))
      .returning();
    return updated || undefined;
  }

  /**
   * PRD-28: turn an external participant into an ordinary account. Only this
   * direction exists — the reverse would strip an active employee of their
   * password and cabinet, which is a block dressed up as a kind change.
   */
  async promoteExternalUser(userId: string): Promise<User | undefined> {
    const [user] = await db.update(users)
      .set({ isExternal: false, mustChangePassword: true })
      .where(eq(users.id, userId))
      .returning();
    return user ? { ...user, email: await decryptEmail(user.email) } : undefined;
  }

  // ─── Password reset tokens (part of the user aggregate) ─────────────────────

  async createPasswordResetToken(userId: string, tokenHash: string, requestIp: string, ttlMs?: number): Promise<PasswordResetToken> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + (ttlMs ?? 30 * 60 * 1000)); // 30 minutes by default
    const [token] = await db.insert(passwordResetTokens).values({
      id,
      userId,
      tokenHash,
      expiresAt,
      requestIp,
      createdAt: new Date(),
    }).returning();
    return token;
  }

  async getPasswordResetToken(tokenHash: string): Promise<PasswordResetToken | undefined> {
    const [token] = await db.select().from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash));
    return token || undefined;
  }

  async markTokenAsUsed(id: string): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, id));
  }

  async getRecentTokensCount(userId: string, hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.userId, userId),
        sql`${passwordResetTokens.createdAt} > ${since}`
      ));
    return Number(result[0]?.count || 0);
  }
}

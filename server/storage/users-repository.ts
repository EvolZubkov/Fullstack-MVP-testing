/**
 * @module server/storage/users-repository
 * @description Data access for the user domain: lookup, creation, password
 * validation and profile/state updates. Emails are encrypted at rest and looked
 * up by a deterministic hash (`emailHash`); the plaintext email is decrypted
 * only on read. Password hashing goes through the `server/utils/crypto` seam
 * (`hashPassword`/`verifyPassword`), keeping this repository crypto-agnostic.
 * `validatePassword` performs a dummy verification on the not-found path to
 * equalize response timing (anti-enumeration). Exposed to the rest of the app
 * through the `IStorage` facade, never imported directly by routes.
 */
import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import { users, type User, type InsertUser } from "@shared/schema";
import {
  encryptEmail,
  decryptEmail,
  hashEmail,
  hashPassword,
  verifyPassword,
  dummyVerifyPassword,
} from "../utils/crypto";
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
    const hashedPassword = await hashPassword(insertUser.passwordHash);
    const emailEncrypted = await encryptEmail(insertUser.email);
    const emailHashValue = hashEmail(insertUser.email);

    const [user] = await db.insert(users).values({
      id,
      email: emailEncrypted,
      emailHash: emailHashValue,
      passwordHash: hashedPassword,
      name: insertUser.name || null,
      status: insertUser.status || "pending",
      mustChangePassword: insertUser.mustChangePassword ?? true,
      gdprConsent: false,
      createdAt: new Date(),
      createdBy: insertUser.createdBy || null,
    }).returning();

    return { ...user, email: await decryptEmail(user.email) };
  }

  async validatePassword(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    if (!user) {
      // Equalize timing with the found-user path so response time does not leak
      // whether the account exists (anti-enumeration).
      await dummyVerifyPassword(password);
      return null;
    }
    const valid = await verifyPassword(password, user.passwordHash);
    return valid ? user : null;
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
}

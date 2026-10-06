/**
 * @module server/services/review-invite
 * @description PRD-52 FR-06/FR-07: приглашение рецензентов.
 *
 * Отличие от приглашения участников (PRD-28) ровно одно: человек получает не
 * назначение на прохождение, а ГРАНТ `review` на тест, и ссылка выпускается с
 * назначением «рецензирование». Всё остальное — разбор списка, заведение внешних
 * учёток, письмо, отчёт прогона — то же самое, поэтому здесь нет своей копии этих
 * шагов: расхождение в них означало бы, что участник и рецензент заводятся
 * по-разному, и однажды один из путей потерял бы, например, признак внешнего.
 *
 * Ссылка ПЕРСОНАЛЬНАЯ. Без привязки к учётной записи комментарий нечем подписать,
 * а история приёмки без авторства бесполезна.
 */
import { randomBytes, createHash } from "node:crypto";
import type { IStorage } from "../storage";
import type { User } from "@shared/schema";
import { sendReviewInviteEmail } from "../email";
import { appBaseUrl } from "../config";
import { logger } from "../logger";

/**
 * Кого приглашаем. Либо адрес — тогда учётка находится или заводится, — либо
 * идентификатор уже выбранного пользователя платформы: в диалоге его выбирают из
 * списка, и искать его повторно по адресу значило бы рисковать промахом на
 * однофамильце с похожей почтой.
 */
export interface ReviewInviteRow {
  email?: string;
  userId?: string;
  name?: string | null;
}

export interface ReviewInviteOptions {
  testId: string;
  rows: readonly ReviewInviteRow[];
  /** Кто приглашает — записывается автором гранта. */
  actorId: string;
  /** До какого момента живёт ссылка. */
  linkExpiresAt: Date;
  /** Слать ли письмо. Пользователю платформы оно не обязательно. */
  sendEmail?: boolean;
  storage: IStorage;
}

/** Что произошло с одной строкой. */
export interface ReviewInviteResult {
  /** `null` — the account has no email (PRD-54 BR-54-42); no letter can go to it. */
  email: string | null;
  userId: string;
  /** Учётная запись заведена этим прогоном. */
  accountCreated: boolean;
  /** Грант выдан впервые (иначе доступ уже был). */
  granted: boolean;
  /** Ссылка выпущена; у пользователя платформы её может не быть. */
  magicLink?: string;
  /** Письмо принято транспортом. */
  delivered?: boolean;
}

export interface ReviewInviteFailure {
  email: string;
  reason: string;
}

export interface ReviewInviteReport {
  invited: number;
  alreadyHadAccess: number;
  results: ReviewInviteResult[];
  failed: ReviewInviteFailure[];
}

/**
 * Находит учётную запись по адресу или заводит внешнюю.
 *
 * Новая заводится ровно как участник PRD-28: без пароля, роль `learner`, признак
 * внешнего. Существующая НЕ трогается — в частности, признак внешнего никогда не
 * пишется на обычную учётку, обратного пути у него нет; имя из списка заполняет
 * только пробел.
 */
async function resolveReviewer(
  row: ReviewInviteRow,
  ctx: { actorId: string; storage: IStorage },
): Promise<{ user: User; created: boolean }> {
  if (row.userId) {
    const picked = await ctx.storage.getUser(row.userId);
    if (!picked) throw new Error("User not found");
    return { user: picked, created: false };
  }
  if (!row.email) throw new Error("Не указан адрес");
  const existing = await ctx.storage.getUserByEmail(row.email);
  if (existing) {
    if (!existing.name && row.name) {
      const updated = await ctx.storage.updateUser(existing.id, { name: row.name });
      return { user: updated ?? { ...existing, name: row.name }, created: false };
    }
    return { user: existing, created: false };
  }

  const user = await ctx.storage.createUser({
    email: row.email,
    name: row.name ?? null,
    passwordHash: null,
    isExternal: true,
    status: "pending",
    createdBy: ctx.actorId,
  } as never);
  await ctx.storage.setUserRoles(user.id, ["learner"], ctx.actorId);
  return { user, created: true };
}

/**
 * Приглашает рецензентов: грант `review` + персональная ссылка + письмо.
 *
 * Строки обрабатываются независимо: сбой на одном адресе не отменяет остальных, а
 * попадает в отчёт. Иначе рассылка на полсотни человек падала бы целиком из-за
 * одной опечатки в адресе.
 */
export async function inviteReviewers(opts: ReviewInviteOptions): Promise<ReviewInviteReport> {
  const { testId, rows, actorId, linkExpiresAt, storage } = opts;
  const sendEmail = opts.sendEmail ?? true;

  const test = await storage.getTest(testId);
  if (!test) throw new Error("Test not found");

  const report: ReviewInviteReport = { invited: 0, alreadyHadAccess: 0, results: [], failed: [] };

  for (const row of rows) {
    try {
      const { user, created } = await resolveReviewer(row, { actorId, storage });

      const existingGrant = await storage.getTestGrantForUser(testId, user.id);
      // Уже имеющийся edit-доступ не понижаем до `review`: у автора теста и так
      // есть всё, что даёт рецензирование, а понижение отняло бы у него правку.
      const hadAccess = existingGrant?.accessLevel === "review" || existingGrant?.accessLevel === "edit";
      if (!hadAccess) {
        await storage.upsertTestAccessGrant({
          testId, userId: user.id, accessLevel: "review", grantedBy: actorId,
        });
      }

      const raw = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(raw).digest("hex");
      await storage.createAssignmentAccessToken({
        // У рецензирования назначения нет — доступ несёт грант.
        assignmentId: null,
        userId: user.id,
        testId,
        tokenHash,
        expiresAt: linkExpiresAt,
        purpose: "review",
      });
      const magicLink = `${appBaseUrl()}/access/${raw}`;

      let delivered: boolean | undefined;
      if (sendEmail && (row.email || user.email)) {
        delivered = await sendReviewInviteEmail({
          to: (row.email ?? user.email)!,
          userName: user.name || undefined,
          testTitle: test.title,
          magicLink,
          expiresAt: linkExpiresAt,
        });
      }

      report.results.push({
        email: row.email ?? user.email, userId: user.id, accountCreated: created,
        granted: !hadAccess, magicLink, delivered,
      });
      if (hadAccess) report.alreadyHadAccess += 1;
      else report.invited += 1;
    } catch (error) {
      logger.error(
        `Review invite failed for ${row.email ?? row.userId}: ${(error as Error).message}`,
        "review",
      );
      report.failed.push({ email: row.email ?? row.userId ?? "", reason: (error as Error).message });
    }
  }

  return report;
}

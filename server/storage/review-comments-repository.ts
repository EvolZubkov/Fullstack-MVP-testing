/**
 * @module server/storage/review-comments-repository
 * @description Слой данных КОММЕНТАРИЕВ РЕЦЕНЗИРОВАНИЯ (PRD-52 раздел 6).
 *
 * Ветка — один уровень: корень несёт якорь и исход, ответы ссылаются на него через
 * `parentId` и собственного статуса не имеют. Поэтому чтение здесь всегда идёт
 * ОДНИМ запросом на тест с последующей сборкой веток в памяти: комментариев на тест
 * сотни, а не десятки тысяч, и запрос-на-ветку дал бы N+1 ради экономии, которой
 * никто не заметит.
 *
 * Выставляется через фасад `IStorage`, маршрутами напрямую не импортируется.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  testReviewComments,
  type TestReviewComment,
  type InsertTestReviewComment,
  type ReviewCommentStatus,
} from "@shared/schema";

/**
 * Поля, которые задаёт вызывающий. Идентификатор и отметки времени ставит слой
 * данных, а `status` — только у корня и только жизненным циклом (`resolve`/`reopen`),
 * поэтому в создании его нет.
 */
export type ReviewCommentInput = Omit<
  InsertTestReviewComment,
  "id" | "status" | "resolvedBy" | "resolvedAt" | "createdAt" | "updatedAt"
>;

/** Корень ветки вместе с ответами, в порядке появления. */
export interface ReviewThread extends TestReviewComment {
  replies: TestReviewComment[];
}

export class ReviewCommentsRepository {
  /** Все ветки теста: корни по возрастанию времени, внутри — ответы по времени. */
  async listReviewThreads(testId: string): Promise<ReviewThread[]> {
    const rows = await db
      .select()
      .from(testReviewComments)
      .where(eq(testReviewComments.testId, testId))
      .orderBy(asc(testReviewComments.createdAt));

    const roots = rows.filter((row) => row.parentId === null);
    const repliesByParent = new Map<string, TestReviewComment[]>();
    for (const row of rows) {
      if (!row.parentId) continue;
      const list = repliesByParent.get(row.parentId);
      if (list) list.push(row);
      else repliesByParent.set(row.parentId, [row]);
    }
    return roots.map((root) => ({ ...root, replies: repliesByParent.get(root.id) ?? [] }));
  }

  /** Один комментарий по идентификатору — корень или ответ. */
  async getReviewComment(id: string): Promise<TestReviewComment | undefined> {
    const [row] = await db.select().from(testReviewComments).where(eq(testReviewComments.id, id));
    return row;
  }

  /** Есть ли в ветке хотя бы один ответ: от этого зависит правка, удаление и отклонение. */
  async hasReviewReplies(rootId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: testReviewComments.id })
      .from(testReviewComments)
      .where(eq(testReviewComments.parentId, rootId))
      .limit(1);
    return Boolean(row);
  }

  /**
   * Создать комментарий или ответ. Корень открывается со статусом `open`; у ответа
   * статуса нет вовсе — исход живёт только на корне ветки.
   */
  async createReviewComment(input: ReviewCommentInput): Promise<TestReviewComment> {
    const [row] = await db
      .insert(testReviewComments)
      .values({
        ...input,
        id: randomUUID(),
        status: input.parentId ? null : "open",
      })
      .returning();
    return row;
  }

  /** Правка собственного текста. Якорь и пин при этом не трогаются. */
  async updateReviewCommentBody(id: string, body: string): Promise<TestReviewComment | undefined> {
    const [row] = await db
      .update(testReviewComments)
      .set({ body, updatedAt: new Date() })
      .where(eq(testReviewComments.id, id))
      .returning();
    return row;
  }

  /**
   * Удалить комментарий. Удаляется только собственный корень без ответов либо
   * собственный ответ — проверку прав и наличия ответов делает маршрут; здесь
   * ветка удаляется вместе с ответами, чтобы не осталось висячих строк.
   */
  async deleteReviewComment(id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.delete(testReviewComments).where(eq(testReviewComments.parentId, id));
      const deleted = await tx
        .delete(testReviewComments)
        .where(eq(testReviewComments.id, id))
        .returning({ id: testReviewComments.id });
      return deleted.length > 0;
    });
  }

  /** Закрыть ветку с исходом. */
  async resolveReviewComment(
    id: string,
    outcome: { status: Extract<ReviewCommentStatus, "accepted" | "rejected">; resolvedBy: string },
  ): Promise<TestReviewComment | undefined> {
    const [row] = await db
      .update(testReviewComments)
      .set({
        status: outcome.status,
        resolvedBy: outcome.resolvedBy,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(testReviewComments.id, id))
      .returning();
    return row;
  }

  /** Открыть ветку заново: исход снимается вместе со следом о закрытии. */
  async reopenReviewComment(id: string): Promise<TestReviewComment | undefined> {
    const [row] = await db
      .update(testReviewComments)
      .set({ status: "open", resolvedBy: null, resolvedAt: null, updatedAt: new Date() })
      .where(eq(testReviewComments.id, id))
      .returning();
    return row;
  }

  /** Сколько открытых веток у теста — для счётчика на вкладке. */
  async countOpenReviewComments(testId: string): Promise<number> {
    const rows = await db
      .select({ id: testReviewComments.id })
      .from(testReviewComments)
      .where(
        and(
          eq(testReviewComments.testId, testId),
          isNull(testReviewComments.parentId),
          eq(testReviewComments.status, "open"),
        ),
      );
    return rows.length;
  }

  /**
   * Счётчики открытых веток сразу по многим тестам — список тестов рисуется одним
   * запросом, а не запросом на строку.
   */
  async countOpenReviewCommentsByTests(testIds: string[]): Promise<Record<string, number>> {
    if (testIds.length === 0) return {};
    const rows = await db
      .select({ testId: testReviewComments.testId })
      .from(testReviewComments)
      .where(
        and(
          inArray(testReviewComments.testId, testIds),
          isNull(testReviewComments.parentId),
          eq(testReviewComments.status, "open"),
        ),
      );
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.testId] = (counts[row.testId] ?? 0) + 1;
    return counts;
  }
}

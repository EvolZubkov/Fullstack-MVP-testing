/**
 * @module server/storage/slices-repository
 * @description PRD-56 FR-07b: срезы прохождений — сохранённые наборы условий отбора.
 *
 * Срез хранит УСЛОВИЯ и пересчитывается при каждом открытии (FR-07d), поэтому репозиторий
 * знает только про их хранение: считает по ним прохождения слой наблюдений.
 *
 * Видимость простая и намеренно не шире: срез принадлежит тому, кто его завёл. Общие срезы —
 * отдельный разговор с владельцем продукта: «видно всем» у аналитики означает «видно чужие
 * выборки с чужими людьми», и заводить это молча нельзя.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import {
  analyticsSlices,
  type AnalyticsSlice,
  type InsertAnalyticsSlice,
} from "@shared/schema";

export class SlicesRepository {
  /**
   * Записи владельца одной роли (решение владельца 2026-09-25).
   *
   * По умолчанию — СРЕЗЫ: их спрашивает аналитика и сравнение, и сохранённый фильтр реестра,
   * попавший в этот список, предлагал бы сравнивать выборки разных тестов.
   */
  async getSlices(
    ownerId: string,
    kind: "slice" | "filter" = "slice",
    testId?: string,
  ): Promise<AnalyticsSlice[]> {
    return db
      .select()
      .from(analyticsSlices)
      .where(and(
        eq(analyticsSlices.createdBy, ownerId),
        eq(analyticsSlices.kind, kind),
        // Э3: срезы живут на уровне теста — в списке и сравнении теста только его срезы.
        ...(testId ? [eq(analyticsSlices.testId, testId)] : []),
      ))
      .orderBy(desc(analyticsSlices.createdAt));
  }

  /** Один срез владельца — или `undefined`, если его нет либо он чужой. */
  async getSlice(id: string, ownerId: string): Promise<AnalyticsSlice | undefined> {
    const [row] = await db
      .select()
      .from(analyticsSlices)
      .where(and(eq(analyticsSlices.id, id), eq(analyticsSlices.createdBy, ownerId)));
    return row;
  }

  /**
   * Завести срез.
   *
   * Имя уникально у одного владельца — это стережёт индекс, и нарушение приезжает сюда
   * ошибкой базы: два «Отдела продаж» в списке неразличимы, а значит выбор между ними
   * случаен.
   */
  async createSlice(input: InsertAnalyticsSlice): Promise<AnalyticsSlice> {
    const [row] = await db.insert(analyticsSlices).values(input).returning();
    return row;
  }

  /** Переписать условия или имя среза своего владельца. */
  async updateSlice(
    id: string,
    ownerId: string,
    patch: Partial<Pick<AnalyticsSlice, "name" | "testId" | "conditionsJson">>,
  ): Promise<AnalyticsSlice | undefined> {
    const [row] = await db
      .update(analyticsSlices)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(analyticsSlices.id, id), eq(analyticsSlices.createdBy, ownerId)))
      .returning();
    return row;
  }

  /**
   * Удалить срез. `false` — если его нет либо он принадлежит другому.
   *
   * Ответ строится по `returning`, а не по `rowCount`: счётчик строк драйвер заполняет
   * не везде, и удаление чужого среза молча выглядело бы как успешное.
   */
  async deleteSlice(id: string, ownerId: string): Promise<boolean> {
    const removed = await db
      .delete(analyticsSlices)
      .where(and(eq(analyticsSlices.id, id), eq(analyticsSlices.createdBy, ownerId)))
      .returning({ id: analyticsSlices.id });
    return removed.length > 0;
  }
}

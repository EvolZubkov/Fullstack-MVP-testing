/**
 * @module server/storage/saved-filters-repository
 * @description Сохранённые фильтры списков — «Темы и вопросы», «Тесты», «Пользователи» (решение
 * владельца 2026-10-05: сохранение — везде, где есть фильтр).
 *
 * Набор личный: каждый запрос несёт владельца, и чужой набор для репозитория не существует —
 * ни прочитать, ни поправить, ни удалить его по известному id нельзя.
 */
import { and, asc, eq } from "drizzle-orm";

import { db } from "../db";
import {
  savedListFilters,
  type InsertSavedListFilter,
  type SavedFilterScope,
  type SavedListFilter,
} from "@shared/schema";

export class SavedFiltersRepository {
  /**
   * Наборы владельца для одного экрана, по имени — в меню их ищут глазами.
   *
   * @param ownerId владелец
   * @param scope экран
   */
  async getSavedFilters(ownerId: string, scope: SavedFilterScope): Promise<SavedListFilter[]> {
    return db
      .select()
      .from(savedListFilters)
      .where(and(eq(savedListFilters.createdBy, ownerId), eq(savedListFilters.scope, scope)))
      .orderBy(asc(savedListFilters.name));
  }

  /**
   * Сохранить набор.
   *
   * @param input экран, имя, условия, владелец
   * @returns созданная запись
   */
  async createSavedFilter(input: InsertSavedListFilter): Promise<SavedListFilter> {
    const [row] = await db.insert(savedListFilters).values(input).returning();
    return row;
  }

  /**
   * Поправить имя или условия набора владельца.
   *
   * @returns запись после правки; `undefined`, если набора у владельца нет
   */
  async updateSavedFilter(
    id: string,
    ownerId: string,
    patch: Partial<Pick<SavedListFilter, "name" | "conditionsJson">>,
  ): Promise<SavedListFilter | undefined> {
    const [row] = await db
      .update(savedListFilters)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(savedListFilters.id, id), eq(savedListFilters.createdBy, ownerId)))
      .returning();
    return row;
  }

  /**
   * Удалить набор владельца.
   *
   * @returns был ли такой набор
   */
  async deleteSavedFilter(id: string, ownerId: string): Promise<boolean> {
    const rows = await db
      .delete(savedListFilters)
      .where(and(eq(savedListFilters.id, id), eq(savedListFilters.createdBy, ownerId)))
      .returning({ id: savedListFilters.id });
    return rows.length > 0;
  }
}

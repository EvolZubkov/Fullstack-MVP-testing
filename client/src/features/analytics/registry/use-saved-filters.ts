/**
 * @module features/analytics/registry/use-saved-filters
 * @description Сохранённые фильтры — меню «Сохранённые» полосы фильтра аналитики (решение
 * владельца 2026-10-05).
 *
 * Фильтр и срез — разные сущности. Фильтр — набор критериев отбора, который применяется к любому
 * набору данных: реестру всех прохождений или прохождениям одного теста. Срез — выборка одного
 * теста со своими величинами, он живёт на вкладке «Срезы». Поэтому «Сохранённые» и на общем
 * уровне, и на уровне теста — это одни и те же фильтры владельца: сохранить текущие критерии,
 * применить, обновить изменённый набор, удалить.
 *
 * Сохранённый на уровне теста фильтр хранится без теста: тест задан страницей, а критерии
 * переносимы.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/queryClient";
import { conditionsToFilter, EMPTY_FILTER, filterToSearch, type RegistryFilter } from "./filter-state";

/** Сохранённый фильтр владельца. */
export interface SavedFilter {
  id: string;
  name: string;
  conditions: unknown;
}

/** Ключ списка сохранённых фильтров. */
export const SAVED_FILTERS_KEY = ["/api/analytics/filters"] as const;

/** Критерии фильтра без теста — когда тест задан страницей. */
export function withoutTests(filter: RegistryFilter): RegistryFilter {
  return { ...filter, testIds: [] };
}

/** Совпадают ли критерии: сравниваются в том виде, в каком лежат в адресе. */
export function sameConditions(a: RegistryFilter, b: RegistryFilter): boolean {
  return filterToSearch(a) === filterToSearch(b);
}

/**
 * Какой набор применён и изменён ли он — для кнопки «Сохранённые».
 *
 * Применённым считается выбранный читателем набор; если он не выбирал, а критерии совпали с
 * каким-то набором (пришли ссылкой, набрали те же), — этот набор. Изменённым — выбранный набор,
 * критерии которого уже не совпадают с текущими. Пустые критерии не совпадают ни с чем: иначе
 * набор, у которого на уровне теста не осталось условий, выдавал себя за применённый.
 *
 * @param filters сохранённые фильтры
 * @param appliedId набор, который читатель применил или сохранил последним
 * @param current текущие критерии (на уровне теста — без теста)
 */
export function savedSetState(
  filters: readonly SavedFilter[],
  appliedId: string | null,
  current: RegistryFilter,
): { activeSetId: string | null; dirty: boolean } {
  const applied = appliedId ? filters.find(f => f.id === appliedId) : undefined;
  if (applied) {
    return { activeSetId: applied.id, dirty: !sameConditions(conditionsOf(applied), current) };
  }
  if (filterToSearch(current) === "") return { activeSetId: null, dirty: false };
  const matching = filters.find(f => sameConditions(conditionsOf(f), current));
  return { activeSetId: matching?.id ?? null, dirty: false };
}

/**
 * Наборы, которые есть смысл предлагать на уровне теста: тест там задан страницей, и набор,
 * в котором кроме тестов ничего не было, применил бы пустой отбор.
 *
 * @param filters сохранённые фильтры
 */
export function testLevelFilters(filters: readonly SavedFilter[]): SavedFilter[] {
  return filters.filter(f => filterToSearch(withoutTests(conditionsOf(f))) !== "");
}

/** Критерии сохранённого фильтра в виде фильтра реестра. */
export function conditionsOf(saved: SavedFilter): RegistryFilter {
  return { ...EMPTY_FILTER, ...conditionsToFilter(saved.conditions) };
}

/** Текст ошибки сервера: «409: {"error":"…"}» → «…». */
export function errorText(error: unknown): string {
  const message = (error as Error)?.message ?? "";
  const json = message.slice(message.indexOf(":") + 1).trim();
  try {
    const parsed = JSON.parse(json) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // не JSON — отдаём как есть
  }
  return message || "Не удалось выполнить действие";
}

/**
 * Сохранённые фильтры владельца и действия над ними.
 *
 * @param enabled читать ли список
 */
export function useSavedFilters(enabled = true) {
  const queryClient = useQueryClient();
  const { data } = useQuery<{ filters: SavedFilter[] }>({ queryKey: SAVED_FILTERS_KEY, enabled });
  const refresh = () => queryClient.invalidateQueries({ queryKey: SAVED_FILTERS_KEY });

  /** Сохранить критерии под именем; возвращает созданный набор. */
  const save = async (name: string, conditions: RegistryFilter): Promise<SavedFilter> => {
    const response = await apiRequest("POST", "/api/analytics/slices", { name, kind: "filter", conditions });
    const body = await response.json() as { slice: { id: string; name: string; conditionsJson: unknown } };
    await refresh();
    return { id: body.slice.id, name: body.slice.name, conditions: body.slice.conditionsJson };
  };

  /** Записать текущие критерии в набор. */
  const update = async (id: string, conditions: RegistryFilter): Promise<void> => {
    await apiRequest("PUT", `/api/analytics/slices/${encodeURIComponent(id)}`, { conditions });
    await refresh();
  };

  /** Удалить набор. */
  const remove = async (id: string): Promise<void> => {
    await apiRequest("DELETE", `/api/analytics/filters/${encodeURIComponent(id)}`);
    await refresh();
  };

  return { filters: data?.filters ?? [], save, update, remove };
}

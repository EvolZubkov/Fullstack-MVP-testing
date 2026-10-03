/**
 * @module features/analytics/levels/use-analytics-tab
 * @description Вкладка уровня аналитики — в адресе (`?tab=`), а не в состоянии страницы (Э2).
 *
 * Смена вкладки пишется в историю (`push`): вкладка — место на экране, и «Назад» браузера обязан
 * возвращать на прежнюю, а присланная ссылка — открывать ту же. Условия отбора — наоборот,
 * `replace` (см. `use-registry-filter`): перебор фильтров — не путь по страницам.
 *
 * Состояние записи истории (`history.state`) переносится на новую запись: в нём лежит адрес
 * возврата крошки «Аналитика», и смена вкладки не должна его терять.
 */
import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { TAB_PARAM } from "./analytics-routes";

/**
 * Вкладка из адреса и способ её сменить.
 *
 * @param tabs допустимые вкладки уровня
 * @param fallback вкладка по умолчанию — для пустого и неизвестного значения
 */
export function useAnalyticsTab<T extends string>(tabs: readonly T[], fallback: T): [T, (next: string) => void] {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const raw = new URLSearchParams(search).get(TAB_PARAM);
  const tab = (tabs as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;

  const setTab = useCallback((next: string) => {
    // Строка запроса — от маршрутизатора: он видит и замены условий фильтра (`replaceState`).
    const params = new URLSearchParams(search);
    // Вкладка по умолчанию в адрес не пишется: голый адрес уровня и есть она.
    if (next === fallback) params.delete(TAB_PARAM);
    else params.set(TAB_PARAM, next);
    const query = params.toString();
    navigate(`${location}${query ? `?${query}` : ""}`, {
      state: typeof window === "undefined" ? null : window.history.state,
    });
  }, [fallback, location, navigate, search]);

  return [tab, setTab];
}

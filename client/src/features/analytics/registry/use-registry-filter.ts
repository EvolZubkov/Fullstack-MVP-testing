/**
 * @module features/analytics/registry/use-registry-filter
 * @description PRD-56 FR-03: условия отбора реестра держатся в адресе страницы.
 *
 * Хук — единственное место, где состояние фильтра встречается с историей браузера: разбор и
 * сборка живут в чистом `filter-state`, а сюда вынесено то, что нельзя проверить без DOM.
 *
 * Замена условий пишется через `replace`, а не `push`: перебор фильтров — не путь по
 * страницам, и кнопка «назад» должна возвращать туда, откуда человек пришёл в аналитику, а не
 * прокручивать десяток промежуточных выборок.
 *
 * Э2: адрес делят с фильтром вкладка уровня (`?tab=`) и состояние записи истории (адрес возврата
 * крошки «Аналитика»). Замена условий переписывает только сами условия: прежде она собирала адрес
 * заново и молча сбрасывала вкладку.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";

import { filterToSearch, parseFilter, type RegistryFilter } from "./filter-state";

/** Параметры адреса, которые хук фильтра не трогает: они принадлежат уровню, а не выборке. */
const FOREIGN_PARAMS = ["tab"];

/**
 * Строка запроса: новые условия плюс чужие параметры прежнего адреса.
 *
 * @param current текущая строка запроса
 * @param filter новые условия
 */
export function mergeFilterIntoSearch(current: string, filter: RegistryFilter): string {
  const kept = new URLSearchParams(current.startsWith("?") ? current.slice(1) : current);
  const params = new URLSearchParams(filterToSearch(filter).slice(1));
  for (const name of FOREIGN_PARAMS) {
    const value = kept.get(name);
    if (value !== null) params.set(name, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Условия отбора и способ их изменить. */
export function useRegistryFilter(): [RegistryFilter, (next: RegistryFilter) => void] {
  const [location] = useLocation();
  const [filter, setFilter] = useState<RegistryFilter>(
    () => parseFilter(typeof window === "undefined" ? "" : window.location.search),
  );

  // Адрес меняется и снаружи: переход по ссылке, «назад», ссылка из письма.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setFilter(parseFilter(window.location.search));
  }, [location]);

  const change = useCallback((next: RegistryFilter) => {
    setFilter(next);
    if (typeof window === "undefined") return;
    const search = mergeFilterIntoSearch(window.location.search, next);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search}`);
  }, []);

  return [filter, change];
}

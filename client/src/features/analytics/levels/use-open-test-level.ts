/**
 * @module features/analytics/levels/use-open-test-level
 * @description Переход с общего уровня аналитики на уровень теста (Э2, задача 4).
 *
 * Применимые условия отбора едут с переходом ({@link filterIntoTest}), а адрес общего уровня —
 * со всеми его условиями и вкладкой — кладётся в состояние новой записи истории. По нему крошка
 * «Аналитика» возвращает ровно туда, откуда ушли, включая отбор по тестам: условие о другом тесте
 * на странице теста читалось бы как ошибка, а так оно не теряется (согласовано с эскизом
 * 2026-10-03).
 */
import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import type { RegistryFilter } from "../registry/filter-state";
import { filterIntoTest, testHref, type ReturnState } from "./analytics-routes";

/**
 * Функция перехода на уровень теста.
 *
 * @returns `(testId, filter, tab?)` — тест, условия общего уровня, вкладка уровня теста
 */
export function useOpenTestLevel(): (testId: string, filter: RegistryFilter, tab?: string) => void {
  const [location, navigate] = useLocation();
  const search = useSearch();

  return useCallback((testId: string, filter: RegistryFilter, tab?: string) => {
    const state: ReturnState = { analyticsReturn: `${location}${search ? `?${search}` : ""}` };
    navigate(testHref(testId, filterIntoTest(filter, testId), tab), { state });
  }, [location, navigate, search]);
}
